import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompatibleReasoningProvider, RemoteMediaProvider, RemoteTribeProvider, type ReasoningContext } from '../src/main/providers';
import { settingsSchema, type AnalysisInput } from '../src/shared/schema';
import { assessCopy } from '../src/main/heuristics';

const input: AnalysisInput = {id: randomUUID(), title: 'HTTP fixture', text: 'Save 10 minutes. Try it free.', audience: '', platform: 'General'};
const body = async (req: IncomingMessage) => {const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString();};
test('real HTTP adapters: SSE JSON, multipart media, neural provenance, validation and cancellation', async () => {
  const received: {url?: string; auth?: string; body: string; type?: string}[] = [];
  let malformed = false, wait = false;
  const server = createServer(async (req, res) => {
    received.push({url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body: await body(req)});
    if (wait) return;
    if (req.url === '/v1/chat/completions') {
      res.setHeader('content-type', 'text/event-stream');
      const value = malformed ? '{"summary":"missing required fields"}' : JSON.stringify(assessCopy(input));
      for (let i = 0; i < value.length; i += 23) res.write(`data: ${JSON.stringify({choices: [{delta: {content: value.slice(i, i + 23)}}]})}\n\n`);
      res.end('data: [DONE]\n\n');
    } else if (req.url === '/v1/representations') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({summary: 'HTTP fixture only', observations: [{time: 0, description: 'Fixture scene'}], models: ['fixture-vision'], modalities: ['video']}));
    } else if (req.url === '/v1/neural-response') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({source: 'tribe', model: 'fixture-tribe', inputModalities: malformed ? ['image'] : ['video'], score: 60, confidence: null, method: 'Test-only transform', interpretation: 'Contract fixture, not actual model output'}));
    } else {res.writeHead(404); res.end();}
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-provider-'));
  const controller = new AbortController();
  try {
    const reasoning = new CompatibleReasoningProvider(settingsSchema.parse({reasoningUrl: `${base}/v1`, model: 'fixture-model'}), 'fixture-key');
    const context: ReasoningContext = {input, neural: {status: 'available', fusionWeight: 0, signal: {source: 'tribe', model: 'fixture-tribe', inputModalities: ['text'], score: 60, confidence: null, method: 'Test-only transform', interpretation: 'Contract fixture'}}};
    const deltas: number[] = [];
    assert.equal((await reasoning.analyze(context, controller.signal, n => deltas.push(n))).metrics.cta.score, 75);
    assert.ok(deltas.length > 5); assert.equal(received[0].auth, 'Bearer fixture-key');
    assert.equal(JSON.parse(received[0].body).stream, true);
    assert.equal(JSON.parse(received[0].body).model, 'fixture-model');
    const messages = JSON.parse(received[0].body).messages;
    assert.deepEqual(JSON.parse(messages[1].content).neural, context.neural);
    assert.match(messages[0].content, /not observed viewer activity/);
    assert.match(messages[0].content, /Null confidence means confidence is unestablished/);
    malformed = true;
    await assert.rejects(reasoning.analyze(context, controller.signal, () => {}));
    malformed = false;
    const file = path.join(root, 'fixture.mp4'); await writeFile(file, 'TEST-FIXTURE-BYTES');
    const asset = {path: file, name: 'fixture.mp4', mime: 'video/mp4'};
    const media = await new RemoteMediaProvider(base).represent(asset, controller.signal);
    assert.deepEqual(media.modalities, ['video']);
    assert.match(received[2].type!, /multipart\/form-data/);
    assert.match(received[2].body, /TEST-FIXTURE-BYTES/);
    assert.match(received[2].body, /max_frames/);
    const tribe = new RemoteTribeProvider(base);
    const neural = await tribe.analyze({input}, controller.signal, asset);
    assert.equal(neural.source, 'tribe'); assert.equal(neural.confidence, null);
    assert.match(received[3].body, /TEST-FIXTURE-BYTES/);
    assert.match(received[3].body, /Save 10 minutes/);
    assert.match(received[3].body, /name="context"/);
    assert.match(received[3].body, /"transcriptTiming":"unavailable"/);
    malformed = true;
    await assert.rejects(tribe.analyze({input}, controller.signal, asset), /not supplied/);
    malformed = false; wait = true;
    const pending = reasoning.analyze(context, controller.signal, () => {});
    controller.abort(); await assert.rejects(pending, /abort/i);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, {recursive: true, force: true});
  }
});
