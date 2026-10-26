import { execFile, spawn } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flatten, outputLimit, type LLMClient, type LLMRequest } from './types';

const windows = process.platform === 'win32';
export async function findExecutable(name: string) {
  const names = windows ? [`${name}.exe`, `${name}.cmd`] : [name];
  const home = os.homedir();
  const directories = [...(process.env.PATH ?? '').split(path.delimiter), path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'),
    path.join(home, '.claude', 'local'), '/usr/local/bin', '/opt/homebrew/bin', ...(windows && process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : [])];
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) continue;
    for (const file of names.map(n => path.join(directory, n))) {
      try {await fs.access(file, windows ? constants.F_OK : constants.X_OK); if ((await fs.stat(file)).isFile()) return file;} catch {/* Try the next location. */}
    }
  }
  return null;
}
// npm installs .cmd shims on Windows. Running them needs cmd.exe, whose quoting would mangle
// arguments like JSON or empty strings, so launch the script behind the shim with Node instead.
type Launch = {command: string; prefix: string[]; env?: NodeJS.ProcessEnv};
export async function launcher(file: string): Promise<Launch> {
  if (!file.toLowerCase().endsWith('.cmd')) return {command: file, prefix: []};
  const shim = await fs.readFile(file, 'utf8').catch(() => '');
  const target = /"%~?dp0%?\\([^"%]+\.(?:c|m)?js)"/i.exec(shim)?.[1];
  if (!target) throw new Error(`${path.basename(file)} is not a recognised npm launcher. Reinstall the CLI with npm.`);
  const script = path.join(path.dirname(file), target);
  const node = await findExecutable('node');
  // Electron can act as Node when no separate installation is on PATH.
  return node ? {command: node, prefix: [script]} : {command: process.execPath, prefix: [script], env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}};
}
export async function inspect(file: string, args: string[], timeout = 10000) {
  const launch = await launcher(file).catch(() => null);
  if (!launch) return {code: -1, output: ''};
  return new Promise<{code: number; output: string}>(resolve => {
    const child = execFile(launch.command, [...launch.prefix, ...args], {timeout, maxBuffer: 65536, windowsHide: true, cwd: os.tmpdir(), env: launch.env}, (error, stdout, stderr) => {
      resolve({code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, output: `${stdout}\n${stderr}`.trim()});
    });
    child.stdin?.end();
  });
}

type Run = {file: string; args: string[]; cwd: string; input: string; signal: AbortSignal; timeoutMs: number; onLine: (line: string) => void; name: string};
async function run({file, args, cwd, input, signal, timeoutMs, onLine, name}: Run) {
  signal.throwIfAborted();
  const launch = await launcher(file);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, [...launch.prefix, ...args], {cwd, env: launch.env, detached: !windows, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let buffer = '', bytes = 0, stderr = '', failure: Error | undefined, finished = false;
    const kill = (hard: boolean) => {
      if (!child.pid) return;
      if (windows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'}).on('error', () => child.kill());
      else {try {process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM');} catch {/* Already exited. */}}
    };
    const stop = (error: Error) => {
      if (finished || failure) return;
      failure = error; kill(false);
      setTimeout(() => kill(true), 1500).unref();
    };
    const abort = () => stop(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(() => stop(new Error(`${name} timed out.`)), timeoutMs);
    const line = (text: string) => {if (text.trim() && !failure) try {onLine(text);} catch (error) {stop(error as Error);}};
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += chunk.length; buffer += chunk;
      if (bytes > 16_000_000) {stop(new Error(`${name} output exceeded its size limit.`)); return;}
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {const next = buffer.slice(0, index); buffer = buffer.slice(index + 1); line(next);}
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {stderr = (stderr + chunk).slice(-4000);});
    child.stdin.on('error', () => {/* Exit handling reports the failure. */});
    child.once('error', () => stop(new Error(`${name} could not be started. Check its installation.`)));
    child.once('close', code => {
      line(buffer); finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) {
        const hint = stderr.trim().split('\n').filter(Boolean).pop()?.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 300);
        reject(new Error(`${name} exited with code ${code}.${hint ? ` ${hint}` : ''}`));
      } else resolve();
    });
    child.stdin.end(input);
  });
}
async function scratch<T>(fn: (directory: string) => Promise<T>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'adlens-llm-'));
  try {return await fn(directory);} finally {await fs.rm(directory, {recursive: true, force: true});}
}
const modelPattern = /^[\w.:\/-]{1,120}$/;

// ChatGPT account through the official Codex CLI. Codex owns the sign-in; AdLens never reads its tokens.
export async function codexStatus(file: string | null) {
  if (!file) return {available: false, detail: 'Codex CLI not found. Install it and run `codex login`.'};
  const {code, output} = await inspect(file, ['login', 'status']);
  const line = output.split('\n').find(l => /logged in/i.test(l))?.trim().slice(0, 120);
  return code === 0 && line && !/not logged in/i.test(line) ? {available: true, detail: line, account: line} : {available: false, detail: 'Codex is installed but not signed in. Run `codex login` in a terminal.'};
}
export class CodexClient implements LLMClient {
  readonly vision = true;
  readonly name: string;
  constructor(private file: string, private model: string) {
    if (model && !modelPattern.test(model)) throw new Error('Invalid Codex model name.');
    this.name = `${model || 'Codex default model'} (ChatGPT via Codex)`;
  }
  complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void) {
    return scratch(async directory => {
      const images: string[] = [];
      for (const [i, image] of (request.images ?? []).entries()) {
        const file = path.join(directory, `image-${String(i).padStart(2, '0')}.${image.mime.split('/')[1].replace('jpeg', 'jpg')}`);
        await fs.writeFile(file, Buffer.from(image.data, 'base64'), {mode: 0o600}); images.push(file);
      }
      const last = path.join(directory, 'last-message.txt');
      // Read-only sandbox in an empty folder, no user config, MCP servers, rules or browser tools.
      const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', directory,
        '-c', 'approval_policy="never"', '-c', 'features.browser_use=false', '-c', 'features.computer_use=false', '-c', 'features.apps=false',
        '-o', last, ...(this.model ? ['-m', this.model] : []), ...images.map(f => `--image=${f}`), '-'];
      let streamed = '', error = '';
      await run({file: this.file, args, cwd: directory, signal, timeoutMs: 20 * 60_000, name: 'Codex', input: flatten(request), onLine: text => {
        let event: any;
        try {event = JSON.parse(text);} catch {return;}
        if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
          const delta = (streamed ? '\n\n' : '') + event.item.text;
          streamed += delta;
          if (streamed.length > outputLimit) throw new Error('Codex output exceeded the size limit.');
          onDelta(delta);
        } else if (event.type === 'turn.failed' || event.type === 'error') error = String(event.error?.message ?? event.message ?? 'Codex reported an error.').slice(0, 400);
      }}).catch(e => {throw error && !signal.aborted ? new Error(`Codex: ${error}`) : e;});
      if (error) throw new Error(`Codex: ${error}`);
      const final = await fs.readFile(last, 'utf8').catch(() => '');
      if (!final.trim() && !streamed.trim()) throw new Error('Codex finished without a reply. Check `codex login status` and your plan limits.');
      return final.trim() ? final : streamed;
    });
  }
}

// Claude subscription through the official Claude Code CLI, with every tool, hook, MCP server and setting source disabled.
export const claudeModels = [{id: '', name: 'Claude Code default'}, {id: 'opus', name: 'Opus'}, {id: 'sonnet', name: 'Sonnet'}, {id: 'haiku', name: 'Haiku'}, {id: 'fable', name: 'Fable'}];
const version = (raw: string) => {const m = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(raw); return m ? [+m[1], +m[2], +m[3]] : null;};
const atLeast = (v: number[] | null, min: number[]) => !!v && (v[0] - min[0] || v[1] - min[1] || v[2] - min[2]) >= 0;
export async function claudeStatus(file: string | null) {
  if (!file) return {available: false, detail: 'Claude Code not found. Install it and sign in with `claude`.', version: null};
  const v = version((await inspect(file, ['--version'])).output);
  const {output} = await inspect(file, ['auth', 'status']);
  try {
    const auth = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
    const account = typeof auth.email === 'string' ? auth.email.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 120) : undefined;
    if (auth.loggedIn === true) return {available: true, detail: `Signed in${account ? ` as ${account}` : ''}`, account, version: v};
  } catch {/* Older versions print text. */}
  return {available: false, detail: 'Claude Code is installed but not signed in. Run `claude` in a terminal and sign in.', version: v};
}
export class ClaudeCodeClient implements LLMClient {
  readonly vision = true;
  readonly name: string;
  constructor(private file: string, private model: string, private cliVersion: number[] | null) {
    if (model && !claudeModels.some(m => m.id === model) && !/^claude-[\w.-]{1,80}$/.test(model)) throw new Error('Invalid Claude model name.');
    this.name = `${claudeModels.find(m => m.id === model)?.name ?? model} (Claude via Claude Code)`;
  }
  complete(request: LLMRequest, signal: AbortSignal, onDelta: (text: string) => void) {
    return scratch(async directory => {
      const instructions = path.join(directory, 'instructions.txt');
      await fs.writeFile(instructions, request.system, {mode: 0o600});
      const args = ['--print', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', JSON.stringify({disableAllHooks: true, autoMemoryEnabled: false}),
        '--system-prompt-file', instructions, '--permission-mode', 'dontAsk', '--max-turns', '1', '--no-session-persistence', '--disable-slash-commands',
        ...(atLeast(this.cliVersion, [2, 1, 248]) ? ['--restricted', '--no-chrome'] : []), ...(this.model ? ['--model', this.model] : [])];
      const content = [...(request.images ?? []).flatMap(image => [{type: 'text', text: image.label}, {type: 'image', source: {type: 'base64', media_type: image.mime, data: image.data}}]),
        {type: 'text', text: flatten(request, false)}];
      let text = '', result: string | undefined, failed = false;
      await run({file: this.file, args, cwd: directory, signal, timeoutMs: 20 * 60_000, name: 'Claude Code', input: `${JSON.stringify({type: 'user', message: {role: 'user', content}})}\n`, onLine: line => {
        let event: any;
        try {event = JSON.parse(line);} catch {return;}
        if (event.parent_tool_use_id) return;
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta' && typeof event.event.delta.text === 'string') {
          text += event.event.delta.text;
          if (text.length > outputLimit) throw new Error('Claude Code output exceeded the size limit.');
          onDelta(event.event.delta.text);
        } else if (event.type === 'result') {
          if (event.is_error || event.subtype !== 'success') failed = true;
          else if (typeof event.result === 'string') result = event.result;
        }
      }});
      if (failed) throw new Error('Claude Code could not complete the request. Check its sign-in, model access and usage limits.');
      const reply = result ?? text;
      if (!reply.trim()) throw new Error('Claude Code finished without a reply.');
      if (!text && result) onDelta(result);
      return reply;
    });
  }
}
