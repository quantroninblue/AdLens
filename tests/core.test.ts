import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assessCopy, fuse } from '../src/main/heuristics';
import { analyze, type Providers } from '../src/main/engine';
import { Store } from '../src/main/store';
import { endpoint, readCompletion, boundedText } from '../src/main/providers/transport';
import type { ReasoningContext } from '../src/main/providers';
import { assessmentSchema, settingsSchema, reportSchema, type AnalysisInput, type Progress } from '../src/shared/schema';

const input = (): AnalysisInput => ({id: randomUUID(), title: 'Launch copy', text: 'Save 20 minutes on your morning routine. Try it free today.', audience: '', platform: 'Instagram'});
const settings = settingsSchema.parse({});
const signal = () => new AbortController().signal;
test('fallback scores only observable English copy dimensions', () => {
  const result = assessCopy(input());
  assert.equal(result.metrics.cta.score, 75);
  assert.equal(result.metrics.visual.score, null);
  assert.equal(result.metrics.audience.score, null);
  assert.equal(result.metrics.emotion.score, null);
  const noCta = assessCopy({...input(), text: 'Beautiful furniture for your home.'});
  assert.equal(noCta.metrics.cta.score, 25);
  assert.ok(noCta.recommendations.some(r => r.title.includes('next step')));
});
test('empty asset assessment invents no scores or strengths', () => {
  const result = assessCopy({...input(), text: ''});
  assert.ok(Object.values(result.metrics).every(m => m.score === null));
  assert.deepEqual(result.strengths, []);
});
test('fusion renormalizes missing dimensions and excludes absent TRIBE', () => {
  const metrics = assessCopy(input()).metrics;
  metrics.hook.score = 80; metrics.clarity.score = 60; metrics.cta.score = 40;
  const result = fuse(metrics, settings.weights);
  assert.equal(result.overall, 63);
  assert.equal(result.engagement, result.overall);
  assert.ok(Math.abs(Object.values(result.contributions).reduce((a,b) => a+b, 0) - 1) < 1e-10);
  assert.equal(fuse(metrics, settings.weights, {score: 100, weight: .2}).engagement, 70);
  assert.deepEqual(fuse(assessCopy({...input(), text: ''}).metrics, settings.weights), {overall: null, engagement: null, contributions: {}});
});
test('schema rejects fabricated ranges and malformed output', () => {
  const result = assessCopy(input()); result.metrics.hook.score = 101;
  assert.throws(() => assessmentSchema.parse(result));
  assert.throws(() => assessmentSchema.parse({summary: 'Looks good'}));
});
test('pipeline produces a validated report and truthful skipped stages', async () => {
  const events: Progress[] = [];
  const report = await analyze(input(), undefined, settings, {}, signal(), p => events.push(p));
  assert.equal(report.basis, 'heuristic'); assert.deepEqual(report.metadata.models, []);
  assert.equal(report.neural, undefined); reportSchema.parse(report);
  assert.equal(events.find(e => e.stage === 'neural')?.state, 'skipped');
  assert.ok(report.metadata.limitations.some(l => l.includes('uncalibrated')));
});
test('provider failure is visible and does not destroy copy analysis', async () => {
  const fail = async () => {throw new Error('test failure');};
  const report = await analyze(input(), undefined, settings, {reasoning: {analyze: fail}, tribe: {analyze: fail}}, signal(), () => {});
  assert.equal(report.basis, 'heuristic'); assert.equal(report.metadata.providers.filter(p => p.state === 'failed').length, 2);
  assert.equal(report.engagement, report.overall);
});
test('model cannot assign visual or audience scores without evidence', async () => {
  const result = assessCopy(input()); result.metrics.visual.score = 90; result.metrics.audience.score = 95;
  const report = await analyze(input(), undefined, settings, {reasoning: {analyze: async () => result}, reasoningName: 'test-fixture'}, signal(), () => {});
  assert.equal(report.basis, 'model'); assert.equal(report.assessment.metrics.visual.score, null); assert.equal(report.assessment.metrics.audience.score, null);
});
test('media, reasoning and neural signals remain separate with explicit fusion', async () => {
  const config = {...settings, weights: {...settings.weights, tribe: .1}};
  const providers: Providers = {
    media: {represent: async () => ({summary: 'Test fixture description', observations: [{time: 0, description: 'Test frame'}], modalities: ['video', 'audio'], models: ['fixture-vision', 'fixture-speech'], transcript: 'Try it free'})},
    reasoning: {analyze: async () => {const result = assessCopy(input()); result.metrics.visual = {score: 60, evidence: 'Test frame'}; return result;}},
    tribe: {analyze: async () => ({source: 'tribe', model: 'fixture-tribe', score: 80, confidence: null, interpretation: 'Test-only proxy', method: 'Test-only transform', inputModalities: ['video']})},
  };
  const report = await analyze(input(), {id: randomUUID(), name: 'fixture.mp4', size: 10, path: '/test-fixture', mime: 'video/mp4'}, config, providers, signal(), () => {});
  assert.equal(report.metadata.contributions.tribe, .1); assert.equal(report.assessment.metrics.visual.score, 60);
  assert.equal(report.metadata.providers.filter(p => p.state === 'used').length, 3);
  assert.ok(report.metadata.modalities.includes('audio'));
});
test('reasoning receives the validated TRIBE result even when direct fusion weight is zero', async () => {
  const neural = {source: 'tribe' as const, model: 'fixture-tribe', score: 61, confidence: null, interpretation: 'Fixture proxy', method: 'Fixture transformation v1', inputModalities: ['text' as const]};
  const contexts: ReasoningContext[] = [];
  const report = await analyze(input(), undefined, settings, {
    tribe: {analyze: async () => neural},
    reasoning: {analyze: async context => {contexts.push(context); return assessCopy(context.input);}},
  }, signal(), () => {});
  assert.deepEqual(contexts[0].neural, {status: 'available', signal: neural, fusionWeight: 0});
  assert.equal(report.metadata.neuralContextProvided, true);
  assert.equal(report.metadata.contributions.tribe, undefined);
  assert.equal(report.engagement, report.overall);
});
test('reasoning distinguishes disabled, failed, and invalid TRIBE; no prior signal leaks between runs', async () => {
  const contexts: ReasoningContext[] = [];
  const reasoning = {analyze: async (context: ReasoningContext) => {contexts.push(context); return assessCopy(context.input);}};
  const fail = async () => {throw new Error('fixture failure');};
  const invalid = async () => ({source: 'tribe' as const, model: 'bad-fixture', score: 101, confidence: null, interpretation: 'Invalid', method: 'Fixture', inputModalities: ['text' as const]});
  await analyze(input(), undefined, settings, {reasoning, tribe: {analyze: async () => ({...await invalid(), score: 50})}}, signal(), () => {});
  const disabled = await analyze(input(), undefined, settings, {reasoning}, signal(), () => {});
  const failed = await analyze(input(), undefined, settings, {reasoning, tribe: {analyze: fail}}, signal(), () => {});
  const malformed = await analyze(input(), undefined, settings, {reasoning, tribe: {analyze: invalid}}, signal(), () => {});
  assert.deepEqual(contexts.map(c => c.neural.status), ['available', 'disabled', 'unavailable', 'unavailable']);
  for (const context of contexts.slice(1)) assert.equal('signal' in context.neural, false);
  for (const report of [disabled, failed, malformed]) {assert.equal(report.basis, 'model'); assert.equal(report.neural, undefined); assert.equal(report.metadata.neuralContextProvided, false);}
});
test('fallback reports do not claim neural context reached a successful reasoning model', async () => {
  const report = await analyze(input(), undefined, settings, {
    tribe: {analyze: async () => ({source: 'tribe', model: 'fixture', score: 60, confidence: null, method: 'Fixture', interpretation: 'Fixture', inputModalities: ['text']})},
    reasoning: {analyze: async () => {throw new Error('fixture failure');}},
  }, signal(), () => {});
  assert.equal(report.basis, 'heuristic'); assert.ok(report.neural);
  assert.equal(report.metadata.neuralContextProvided, false);
});
test('an unscored neural response reaches reasoning without inventing an engagement contribution', async () => {
  const config = {...settings, weights: {...settings.weights, tribe: .2}};
  const contexts: ReasoningContext[] = [];
  const report = await analyze(input(), undefined, config, {
    tribe: {analyze: async () => ({source: 'tribe', model: 'fixture', score: null, confidence: null, method: 'Descriptive summary only; no engagement calibration', interpretation: 'Fixture neural response summary', inputModalities: ['text']})},
    reasoning: {analyze: async context => {contexts.push(context); return assessCopy(context.input);}},
  }, signal(), () => {});
  assert.equal(report.neural?.score, null);
  assert.equal(report.metadata.neuralContextProvided, true);
  assert.equal(report.metadata.contributions.tribe, undefined);
  assert.equal(report.engagement, report.overall);
  assert.equal(contexts[0].neural.status, 'available');
});
test('TRIBE-only media evidence can reach reasoning while unsupported marketing scores remain blank', async () => {
  const contexts: ReasoningContext[] = [];
  const report = await analyze({...input(), text: ''}, {id: randomUUID(), name: 'fixture.mp4', size: 10, path: '/fixture', mime: 'video/mp4'}, settings, {
    tribe: {analyze: async () => ({source: 'tribe', model: 'fixture', score: null, confidence: null, method: 'Descriptive summary', interpretation: 'Fixture response', inputModalities: ['video']})},
    reasoning: {analyze: async context => {contexts.push(context); return assessCopy(input());}},
  }, signal(), () => {});
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].neural.status, 'available');
  assert.equal(report.basis, 'model');
  assert.equal(report.metadata.neuralContextProvided, true);
  assert.ok(Object.values(report.assessment.metrics).every(m => m.score === null));
  assert.equal(report.overall, null);
});
test('cancellation aborts rather than silently falling back', async () => {
  const controller = new AbortController();
  await assert.rejects(analyze(input(), undefined, settings, {reasoning: {analyze: async () => {controller.abort(); throw new Error('cancel');}}}, controller.signal, () => {}), /abort/i);
});
test('SSE parser handles UTF-8 and CRLF fragmented into individual bytes', async () => {
  const streamText = 'data: {"choices":[{"delta":{"content":"hé"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(streamText);
  const response = new Response(new ReadableStream({start(controller) {for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close();}}), {headers: {'content-type': 'text/event-stream'}});
  const counts: number[] = [];
  assert.equal(await readCompletion(response, count => counts.push(count)), 'héllo'); assert.deepEqual(counts, [2, 5]);
});
test('transport rejects oversized, errored, and empty streams', async () => {
  await assert.rejects(boundedText(new Response('12345'), 4), /size limit/);
  await assert.rejects(readCompletion(new Response('data: {"error":{"message":"no"}}\n\n', {headers: {'content-type': 'text/event-stream'}}), () => {}), /error/);
  await assert.rejects(readCompletion(new Response('data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}}), () => {}), /no structured/);
});
test('remote credentials only travel over HTTPS; loopback HTTP is allowed', () => {
  assert.equal(endpoint('https://inference.example/v1/', 'models'), 'https://inference.example/v1/models');
  assert.equal(endpoint('http://127.0.0.1:9999', 'health'), 'http://127.0.0.1:9999/health');
  for (const url of ['http://remote.example', 'https://user:secret@remote.example', 'file:///tmp/a', 'https://remote.example?key=secret']) assert.throws(() => endpoint(url, 'health'));
});
test('store persists validated reports and preserves corrupt storage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-store-'));
  try {
    const store = new Store(root), report = await analyze(input(), undefined, settings, {}, signal(), () => {});
    await store.add(report); assert.equal((await new Store(root).history())[0].id, report.id);
    await store.remove(report.id); assert.deepEqual(await store.history(), []);
    await writeFile(path.join(root, 'reports.json'), 'corrupt');
    await assert.rejects(store.add(report), /left intact/);
  } finally {await rm(root, {recursive: true, force: true});}
});
