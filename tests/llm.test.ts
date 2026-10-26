import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OllamaClient, ollamaModels, ollamaVision } from '../src/main/llm/ollama';
import { ClaudeCodeClient, CodexClient, claudeStatus, codexStatus, launcher } from '../src/main/llm/cli';
import { endpoint, readLines } from '../src/main/llm/transport';
import type { LLMRequest } from '../src/main/llm';

const body = async (req: IncomingMessage) => {const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString();};
const request: LLMRequest = {system: 'SYSTEM RULES', json: true, messages: [{role: 'user', content: 'First question'}, {role: 'assistant', content: 'First answer'}, {role: 'user', content: 'Assess this'}],
  images: [{mime: 'image/jpeg', data: Buffer.from('JPEGDATA').toString('base64'), label: 'reel.mp4 frame at 0.1 s'}]};

test('endpoints allow HTTPS and loopback HTTP only', () => {
  assert.equal(endpoint('http://127.0.0.1:11434/', 'api/tags'), 'http://127.0.0.1:11434/api/tags');
  for (const url of ['http://remote.example', 'https://user:pw@remote.example', 'file:///tmp/a']) assert.throws(() => endpoint(url, 'x'));
});
test('line reader handles lines split across chunks', async () => {
  const bytes = new TextEncoder().encode('{"a":1}\n{"b":"é"}\n{"c":3}');
  const response = new Response(new ReadableStream({start(c) {for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close();}}));
  const lines: string[] = [];
  await readLines(response, l => lines.push(l));
  assert.deepEqual(lines.map(l => JSON.parse(l)), [{a: 1}, {b: 'é'}, {c: 3}]);
});

test('Ollama: models, vision capability, streamed chat with images and JSON format', async () => {
  const received: any[] = [];
  const server = createServer(async (req, res) => {
    const payload = req.method === 'POST' ? JSON.parse(await body(req)) : undefined;
    if (req.url === '/api/tags') res.end(JSON.stringify({models: [{name: 'qwen2.5vl:7b'}, {name: 'llama3.2:3b'}]}));
    else if (req.url === '/api/show') res.end(JSON.stringify({capabilities: payload.model.includes('vl') ? ['completion', 'vision'] : ['completion']}));
    else if (req.url === '/api/chat') {
      received.push(payload);
      for (const part of ['{"sum', 'mary":', ' "ok"}']) res.write(`${JSON.stringify({message: {content: part}, done: false})}\n`);
      res.end(`${JSON.stringify({done: true})}\n`);
    } else {res.writeHead(404); res.end();}
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  try {
    assert.deepEqual((await ollamaModels(base)).map(m => m.id), ['qwen2.5vl:7b', 'llama3.2:3b']);
    assert.equal(await ollamaVision(base, 'qwen2.5vl:7b'), true);
    assert.equal(await ollamaVision(base, 'llama3.2:3b'), false);
    const deltas: string[] = [];
    const reply = await new OllamaClient(base, 'qwen2.5vl:7b', true).complete(request, new AbortController().signal, d => deltas.push(d));
    assert.equal(reply, '{"summary": "ok"}'); assert.equal(deltas.length, 3);
    assert.equal(received[0].format, 'json');
    assert.equal(received[0].messages[0].role, 'system');
    assert.deepEqual(received[0].messages.at(-1).images, [request.images![0].data]);
    await new OllamaClient(base, 'llama3.2:3b', false).complete(request, new AbortController().signal, () => {});
    assert.equal(received[1].messages.at(-1).images, undefined, 'no images for a text-only model');
  } finally {server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));}
});

// Stand-in CLIs record their arguments and stdin, then emit the event formats AdLens parses.
async function fakeCli(directory: string, name: string, script: string) {
  const file = path.join(directory, name);
  await writeFile(file, `#!${process.execPath}\nconst fs = require('fs'); const args = process.argv.slice(2); let input = '';\nprocess.stdin.on('data', d => input += d).on('end', () => {\n${script}\n});\n`);
  await chmod(file, 0o755);
  return file;
}
test('Codex CLI: restricted read-only exec, images as files, final message from -o', {skip: process.platform === 'win32'}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'adlens-codex-'));
  try {
    const log = path.join(dir, 'log.json');
    const codex = await fakeCli(dir, 'codex', `
      if (args[0] === 'login') { console.log('Logged in using ChatGPT'); return; }
      const images = args.filter(a => a.startsWith('--image=')).map(a => a.slice(8));
      fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({args, input, images: images.map(f => fs.readFileSync(f, 'utf8'))}));
      fs.writeFileSync(args[args.indexOf('-o') + 1], '{"final": true}');
      console.log(JSON.stringify({type: 'thread.started'}));
      console.log(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: '{"final": true}'}}));`);
    assert.deepEqual(await codexStatus(codex), {available: true, detail: 'Logged in using ChatGPT', account: 'Logged in using ChatGPT'});
    assert.equal((await codexStatus(null)).available, false);
    const deltas: string[] = [];
    const reply = await new CodexClient(codex, 'gpt-5.5').complete(request, new AbortController().signal, d => deltas.push(d));
    assert.equal(reply, '{"final": true}'); assert.deepEqual(deltas, ['{"final": true}']);
    const {args, input, images} = JSON.parse(await readFile(log, 'utf8'));
    for (const flag of ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', 'read-only']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('-m') + 1], 'gpt-5.5');
    assert.equal(args.at(-1), '-');
    assert.deepEqual(images, ['JPEGDATA']);
    assert.match(input, /^INSTRUCTIONS:\nSYSTEM RULES/);
    assert.match(input, /USER:\nFirst question\n\nASSISTANT:\nFirst answer\n\nUSER:\nAssess this/);
    assert.throws(() => new CodexClient(codex, 'bad model; rm -rf'));
  } finally {await rm(dir, {recursive: true, force: true});}
});
test('Codex CLI failures and cancellation', {skip: process.platform === 'win32'}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'adlens-codex-'));
  try {
    const failing = await fakeCli(dir, 'codex', `console.log(JSON.stringify({type: 'turn.failed', error: {message: 'usage limit reached'}})); process.exit(1);`);
    await assert.rejects(new CodexClient(failing, '').complete(request, new AbortController().signal, () => {}), /Codex: usage limit reached/);
    const slow = await fakeCli(dir, 'codex-slow', `setTimeout(() => {}, 30000);`);
    const controller = new AbortController();
    const pending = new CodexClient(slow, '').complete(request, controller.signal, () => {});
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(pending, /abort/i);
  } finally {await rm(dir, {recursive: true, force: true});}
});
test('Claude Code CLI: no tools or settings, image blocks over stream-json, streamed text', {skip: process.platform === 'win32'}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'adlens-claude-'));
  try {
    const log = path.join(dir, 'log.json');
    const claude = await fakeCli(dir, 'claude', `
      if (args[0] === '--version') { console.log('2.1.310 (Claude Code)'); return; }
      if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn: true, email: 'person@example.com', authMethod: 'claude.ai'})); return; }
      const promptFile = args[args.indexOf('--system-prompt-file') + 1];
      fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({args, input, system: fs.readFileSync(promptFile, 'utf8')}));
      for (const text of ['{"a"', ': 1}']) console.log(JSON.stringify({type: 'stream_event', event: {type: 'content_block_delta', delta: {type: 'text_delta', text}}}));
      console.log(JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: '{"a": 1}'}));`);
    const status = await claudeStatus(claude);
    assert.equal(status.available, true); assert.equal(status.account, 'person@example.com'); assert.deepEqual(status.version, [2, 1, 310]);
    const deltas: string[] = [];
    const reply = await new ClaudeCodeClient(claude, 'sonnet', status.version).complete(request, new AbortController().signal, d => deltas.push(d));
    assert.equal(reply, '{"a": 1}'); assert.deepEqual(deltas, ['{"a"', ': 1}']);
    const {args, input, system} = JSON.parse(await readFile(log, 'utf8'));
    assert.equal(system, 'SYSTEM RULES');
    assert.equal(args[args.indexOf('--tools') + 1], '');
    for (const flag of ['--print', '--strict-mcp-config', '--no-session-persistence', '--restricted', '--disable-slash-commands']) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
    assert.equal(args[args.indexOf('--max-turns') + 1], '1');
    const message = JSON.parse(input.trim());
    assert.equal(message.type, 'user');
    assert.deepEqual(message.message.content.map((b: {type: string}) => b.type), ['text', 'image', 'text']);
    assert.equal(message.message.content[1].source.data, request.images![0].data);
    assert.doesNotMatch(message.message.content[2].text, /SYSTEM RULES/, 'the system prompt goes through the file, not the message');
    const old = await new ClaudeCodeClient(claude, '', [2, 0, 1]).complete(request, new AbortController().signal, () => {});
    assert.equal(old, '{"a": 1}');
    assert.equal(JSON.parse(await readFile(log, 'utf8')).args.includes('--restricted'), false, 'older CLIs do not get newer flags');
    const failing = await fakeCli(dir, 'claude-fail', `console.log(JSON.stringify({type: 'result', subtype: 'error_during_execution', is_error: true}));`);
    await assert.rejects(new ClaudeCodeClient(failing, '', null).complete(request, new AbortController().signal, () => {}), /could not complete/);
  } finally {await rm(dir, {recursive: true, force: true});}
});
test('npm .cmd launchers resolve to their script so no shell is involved', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'adlens-shim-'));
  try {
    const shim = path.join(dir, 'codex.cmd');
    await writeFile(shim, '@ECHO off\r\nGOTO start\r\n:start\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    const launch = await launcher(shim);
    assert.equal(launch.prefix[0], path.join(dir, 'node_modules\\@openai\\codex\\bin\\codex.js'));
    assert.ok(launch.command.length > 0);
    await writeFile(shim, '@ECHO off\r\nsomething else\r\n');
    await assert.rejects(launcher(shim), /not a recognised npm launcher/);
    assert.deepEqual(await launcher('/usr/bin/codex'), {command: '/usr/bin/codex', prefix: []});
  } finally {await rm(dir, {recursive: true, force: true});}
});
