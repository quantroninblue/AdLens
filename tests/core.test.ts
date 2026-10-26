import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assessCopy, fuse } from '../src/main/heuristics';
import { analyze, selectImages, type PreparedAsset, type Providers } from '../src/main/engine';
import { Store } from '../src/main/store';
import { extractJson } from '../src/main/prompts';
import { ProviderKeys } from '../src/main/llm/keys';
import type { LLMClient, LLMRequest } from '../src/main/llm';
import { assessmentSchema, reportSchema, settingsSchema, type AnalysisInput, type Assessment, type NeuralSignal, type Progress } from '../src/shared/schema';

const input = (): AnalysisInput => ({id: randomUUID(), title: 'Launch reel', text: 'Save 20 minutes on your morning routine. Try it free today.', audience: '', platform: 'Instagram', assetIds: []});
const signal = () => new AbortController().signal;
const pixel = 'data:image/jpeg;base64,/9j/AA==';
const video = (frames = 12): PreparedAsset => ({id: randomUUID(), name: 'reel.mp4', mime: 'video/mp4', size: 10, kind: 'video', path: '/fixture/reel.mp4',
  frames: {duration: 24, width: 1080, height: 1920, frames: Array.from({length: frames}, (_, i) => ({time: i * 2, image: pixel}))}});
const neural = (): NeuralSignal => ({source: 'tribe', model: 'TRIBE v2', checkpoint: 'facebook/tribev2', device: 'cpu', asset: 'reel.mp4', inputKind: 'video', tr: 1, timesteps: 3, vertices: 20484, duration: 3,
  timeConvention: 'Fixture', method: 'Fixture', atlas: null, global: [{t: 0, activity: 1, change: null}, {t: 1, activity: 0, change: .2}, {t: 2, activity: -1, change: .1}],
  regions: [], moments: [{time: 0, kind: 'peak', detail: 'Fixture'}], words: [{time: 0.4, text: 'Stop'}, {time: 0.8, text: 'scrolling'}, {time: 6, text: 'now'}], runtimeSeconds: 1, warnings: ['Fixture warning']});
function modelReport(): Assessment {
  const metric = {score: 70, evidence: 'Fixture evidence'};
  return {summary: 'Fixture summary', virality: {score: 64, band: 'high', confidence: 'medium', rationale: 'Fixture rationale'},
    metrics: {hook: metric, retention: metric, emotion: metric, visual: {...metric, score: 90}, audio: metric, clarity: metric, shareability: metric, cta: metric, audience: {...metric, score: 95}},
    neuralReading: {summary: 'Fixture reading', moments: [{time: 0, observation: 'Peak', implication: 'Strong hook'}]}, strengths: ['Fast hook'], weaknesses: [], recommendations: [{title: 'Cut', detail: 'Trim the middle', time: 6}]};
}
class FakeLLM implements LLMClient {
  name = 'fixture-model'; requests: LLMRequest[] = [];
  constructor(private replies: string[], readonly vision = true) {}
  async complete(request: LLMRequest, _signal: AbortSignal, onDelta: (text: string) => void) {
    this.requests.push(request);
    const reply = this.replies.shift() ?? '';
    onDelta(reply); return reply;
  }
}

test('copy rules score only observable copy and never estimate virality', () => {
  const result = assessCopy(input());
  assert.equal(result.metrics.cta.score, 75);
  for (const key of ['visual', 'audience', 'emotion', 'retention', 'shareability'] as const) assert.equal(result.metrics[key].score, null);
  assert.equal(result.virality.score, null);
  assert.equal(assessCopy({...input(), text: 'Beautiful furniture for your home.'}).metrics.cta.score, 25);
  assert.ok(Object.values(assessCopy({...input(), text: ''}).metrics).every(m => m.score === null));
});
test('content score renormalizes over assessed dimensions', () => {
  const metrics = assessCopy(input()).metrics;
  metrics.hook.score = 80; metrics.clarity.score = 60; metrics.cta.score = 40;
  const result = fuse(metrics);
  assert.equal(result.overall, Math.round((80 * .2 + 60 * .1 + 40 * .05) / .35));
  assert.ok(Math.abs(Object.values(result.contributions).reduce((a, b) => a + b, 0) - 1) < 1e-10);
  assert.deepEqual(fuse(assessCopy({...input(), text: ''}).metrics), {overall: null, contributions: {}});
});
test('settings defaults fill nested objects', () => {
  const settings = settingsSchema.parse({});
  assert.equal(settings.llm.provider, null);
  assert.equal(settings.tribe.checkpoint, 'facebook/tribev2');
  assert.equal(settingsSchema.parse({tribe: {python: '/x/python'}}).tribe.device, 'auto');
});
test('model JSON is extracted from fences and prose', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": 1}\n```'), {a: 1});
  assert.deepEqual(extractJson('{"a": {"b": 2}} trailing'), {a: {b: 2}});
  assert.throws(() => extractJson('no json'));
});
test('image selection gives the primary video most of the budget and labels timestamps', () => {
  const still: PreparedAsset = {id: randomUUID(), name: 'cover.png', mime: 'image/png', size: 5, kind: 'image', path: '/fixture/cover.png', still: {data: 'AAAA', width: 10, height: 10}};
  const images = selectImages([video(12), still, {...video(12), name: 'b-roll.mp4'}]);
  assert.equal(images.filter(i => i.label.startsWith('reel.mp4')).length, 8);
  assert.equal(images.filter(i => i.label.startsWith('b-roll.mp4')).length, 3);
  assert.ok(images.length <= 12);
  assert.match(images[0].label, /reel\.mp4 frame at 0\.0 s/);
  assert.ok(images.some(i => i.label === 'cover.png (still image)'));
});

test('full pipeline: TRIBE summary, frames and transcript reach the model; report is validated', async () => {
  const llm = new FakeLLM([JSON.stringify(modelReport())]);
  const events: Progress[] = [];
  const tribeCalls: string[] = [];
  const providers: Providers = {llm, llmInfo: {provider: 'ollama', model: 'fixture'}, tribe: {analyze: async (asset, _s, progress) => {tribeCalls.push(asset.name); progress('Fixture stage'); return neural();}}};
  const report = await analyze({...input(), audience: 'Busy parents'}, [video()], providers, signal(), e => events.push(e));
  reportSchema.parse(report);
  assert.deepEqual(tribeCalls, ['reel.mp4']);
  assert.equal(report.basis, 'model');
  assert.equal(report.assessment.virality.score, 64);
  assert.equal(report.assessment.metrics.visual.score, 90);
  assert.equal(report.metadata.neuralContextProvided, true);
  assert.equal(report.media.imagesSent, 8);
  assert.match(report.media.transcript ?? '', /^\[0\.4s\] Stop scrolling\n\[6\.0s\] now$/);
  const request = llm.requests[0];
  assert.equal(request.json, true);
  assert.equal(request.images?.length, 8);
  const context = JSON.parse(request.messages[0].content.split('CONTEXT:\n')[1]);
  assert.equal(context.neural.status, 'available');
  assert.equal(context.neural.summary.words, undefined, 'words travel as the transcript, not inside the neural summary');
  assert.match(request.system, /HOW TO READ THE TRIBE v2 SIGNAL/);
  assert.match(request.system, /untrusted data/);
  assert.ok(events.some(e => e.stage === 'neural' && e.detail === 'Fixture stage'));
  assert.ok(report.metadata.limitations.some(l => l === 'TRIBE: Fixture warning'));
});
test('a malformed model reply gets one repair round, then falls back to copy rules', async () => {
  const fixed = new FakeLLM(['not json', JSON.stringify(modelReport())]);
  const repaired = await analyze(input(), [], {llm: fixed}, signal(), () => {});
  assert.equal(repaired.basis, 'model');
  assert.equal(fixed.requests.length, 2);
  assert.match(fixed.requests[1].messages[2].content, /did not match the schema/);
  assert.equal(fixed.requests[1].images?.length, 0);
  const broken = new FakeLLM(['nope', '{"summary": "still wrong"}']);
  const fallback = await analyze(input(), [], {llm: broken}, signal(), () => {});
  assert.equal(fallback.basis, 'heuristic');
  assert.equal(fallback.assessment.virality.score, null);
  assert.equal(fallback.metadata.providers.find(p => p.name === 'Language model')?.state, 'failed');
});
test('evidence rules override model claims', async () => {
  const report = await analyze(input(), [], {llm: new FakeLLM([JSON.stringify(modelReport())])}, signal(), () => {});
  assert.equal(report.assessment.metrics.visual.score, null, 'no images were shown');
  assert.equal(report.assessment.metrics.audience.score, null, 'no audience brief');
  assert.equal(report.assessment.metrics.audio.score, null, 'no transcript or TRIBE');
  assert.equal(report.assessment.neuralReading, null, 'no TRIBE, no neural reading');
  const blind = await analyze(input(), [video()], {llm: new FakeLLM([JSON.stringify(modelReport())], false)}, signal(), () => {});
  assert.equal(blind.media.imagesSent, 0);
  assert.equal(blind.assessment.metrics.visual.score, null);
  assert.ok(blind.metadata.limitations.some(l => l.includes('cannot see images')));
});
test('TRIBE failure, skip reasons and image-only input are reported honestly', async () => {
  const llm = new FakeLLM([JSON.stringify(modelReport()), JSON.stringify(modelReport()), JSON.stringify(modelReport())]);
  const failed = await analyze(input(), [video()], {llm, tribe: {analyze: async () => {throw new Error('CUDA out of memory');}}}, signal(), () => {});
  assert.equal(failed.neural, undefined);
  assert.equal(failed.metadata.providers.find(p => p.name === 'TRIBE v2')?.state, 'failed');
  assert.ok(failed.metadata.limitations.some(l => l.includes('CUDA out of memory')));
  assert.equal(JSON.parse(llm.requests[0].messages[0].content.split('CONTEXT:\n')[1]).neural.status, 'unavailable');
  const off = await analyze(input(), [video()], {llm, tribeDisabledReason: 'TRIBE is turned off in Connections'}, signal(), () => {});
  assert.equal(off.metadata.providers.find(p => p.name === 'TRIBE v2')?.detail, 'TRIBE is turned off in Connections');
  const still: PreparedAsset = {id: randomUUID(), name: 'cover.png', mime: 'image/png', size: 5, kind: 'image', path: '/fixture/cover.png', still: {data: 'AAAA', width: 10, height: 10}};
  let called = false;
  const image = await analyze(input(), [still], {llm, tribe: {analyze: async () => {called = true; return neural();}}}, signal(), () => {});
  assert.equal(called, false);
  assert.equal(image.metadata.providers.find(p => p.name === 'TRIBE v2')?.detail, 'TRIBE needs a video or audio file');
});
test('no model: copy rules only, no invented scores', async () => {
  const report = await analyze(input(), [], {}, signal(), () => {});
  assert.equal(report.basis, 'heuristic'); assert.deepEqual(report.metadata.models, []);
  assert.equal(report.metadata.llm, null);
  assert.ok(report.metadata.limitations.some(l => l.includes('not a forecast')));
  await assert.rejects(analyze({...input(), text: ''}, [], {}, signal(), () => {}), /Add a video/);
});
test('cancellation aborts rather than silently falling back', async () => {
  const controller = new AbortController();
  const llm: LLMClient = {name: 'x', vision: true, complete: async () => {controller.abort(); throw new Error('cancel');}};
  await assert.rejects(analyze(input(), [], {llm}, controller.signal, () => {}), /abort/i);
});
test('schema rejects out-of-range scores', () => {
  const result = modelReport(); result.virality.score = 101;
  assert.equal(assessmentSchema.safeParse(result).success, false);
});
test('store keeps unreadable old reports on disk, persists chats, and preserves corrupt files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-store-'));
  try {
    await writeFile(path.join(root, 'reports.json'), JSON.stringify([{id: 'old-format', engagement: 50}]));
    const store = new Store(root), report = await analyze(input(), [], {}, signal(), () => {});
    assert.deepEqual(await store.history(), []);
    await store.add(report);
    assert.equal((await new Store(root).history())[0].id, report.id);
    assert.ok((await readFile(path.join(root, 'reports.json'), 'utf8')).includes('old-format'));
    await store.saveChat(report.id, [{role: 'user', content: 'Why?'}, {role: 'assistant', content: 'Because.'}]);
    await store.saveChat(null, [{role: 'user', content: 'Draft question'}]);
    assert.equal((await store.chat(report.id)).length, 2);
    assert.equal((await store.chat(null))[0].content, 'Draft question');
    await store.remove(report.id);
    assert.deepEqual(await store.history(), []);
    assert.deepEqual(await store.chat(report.id), []);
    await writeFile(path.join(root, 'reports.json'), 'corrupt');
    await assert.rejects(store.add(report), /left intact/);
  } finally {await rm(root, {recursive: true, force: true});}
});
test('API keys: encrypted on disk, session-only on request, environment wins', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-keys-'));
  const cipher = {available: () => true, encrypt: (v: string) => Buffer.from(`enc:${v}`), decrypt: (b: Buffer) => b.toString().slice(4)};
  try {
    const keys = new ProviderKeys(root, cipher, {});
    await keys.set('openai', 'sk-test-123456', true);
    assert.equal((await readFile(path.join(root, 'openai.bin'), 'utf8')), 'enc:sk-test-123456');
    const reloaded = new ProviderKeys(root, cipher, {}); await reloaded.load();
    assert.deepEqual(reloaded.get('openai'), {key: 'sk-test-123456', storage: 'encrypted'});
    await keys.set('anthropic', 'sk-ant-abcdefgh', false);
    await assert.rejects(readFile(path.join(root, 'anthropic.bin')));
    await assert.rejects(keys.set('openai', 'short', true), /valid API key/);
    await assert.rejects(new ProviderKeys(root, {...cipher, available: () => false}, {}).set('openai', 'sk-test-123456', true), /Secure storage/);
    const env = new ProviderKeys(root, cipher, {ADLENS_OPENAI_KEY: 'sk-from-env-1'}); await env.load();
    assert.equal(env.get('openai')?.storage, 'environment');
    await keys.remove('openai'); assert.equal(keys.get('openai'), undefined);
  } finally {await rm(root, {recursive: true, force: true});}
});
