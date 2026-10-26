import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { candidatePaths, label, probe, resolvePython, scan, TribeWorker } from '../src/main/tribe';

const bridge = path.resolve('resources/tribe_bridge.py');
const fake = path.resolve('tests/fixtures/fake-tribe');
const python = (() => {try {return execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import numpy, sys; print(sys.executable)'], {encoding: 'utf8'}).trim();} catch {return '';}})();
const skip = python ? false : 'python3 with numpy is required for the bridge tests';
const withFake = <T,>(fn: () => Promise<T>) => async () => {
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = fake;
  try {return await fn();} finally {if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;}
};

test('probe distinguishes environments with and without tribev2', {skip}, async () => {
  assert.equal((await probe(python, bridge, 'facebook/tribev2'))?.tribev2, false);
  await withFake(async () => {
    const found = await probe(python, bridge, 'facebook/tribev2');
    assert.equal(found?.tribev2, true);
    assert.equal(found?.protocol, 1);
  })();
  assert.equal(await probe('/nonexistent/python', bridge, 'facebook/tribev2'), null);
});

test('bridge returns a validated, bounded summary with clean protocol output', {skip}, withFake(async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'adlens-tribe-'));
  const worker = new TribeWorker(bridge);
  try {
    const progress: string[] = [];
    const result = await worker.predict(python, {path: path.join(cache, 'clip.mp4'), kind: 'video', checkpoint: 'facebook/tribev2', device: 'cpu', cache}, new AbortController().signal, d => progress.push(d));
    assert.equal(result.timesteps, 20);
    assert.equal(result.vertices, 500);
    assert.equal(result.global.length, 20);
    assert.ok(result.moments.some(m => m.kind === 'peak' && m.time === 2), 'the synthetic peak is reported');
    assert.ok(result.moments.some(m => m.kind === 'shift' && m.time === 12), 'the synthetic pattern shift is reported');
    assert.deepEqual(result.words?.map(w => w.text), ['Stop', 'scrolling']);
    assert.ok(result.warnings.some(w => w.includes('fsaverage5')), 'non-fsaverage5 data skips the atlas with a warning');
    assert.deepEqual(result.regions, []);
    assert.ok(progress.some(p => p.includes('Loading TRIBE')));
    assert.ok(progress.some(p => p.includes('brain model')));
    // The loaded model is reused by the same process.
    const again = await worker.predict(python, {path: path.join(cache, 'clip.mp4'), kind: 'audio', checkpoint: 'facebook/tribev2', device: 'cpu', cache}, new AbortController().signal, () => {});
    assert.equal(again.inputKind, 'audio');
  } finally {await worker.stop(); await rm(cache, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});}
}));

test('bridge failures and cancellation surface as errors', {skip}, withFake(async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'adlens-tribe-'));
  const worker = new TribeWorker(bridge);
  const request = {path: path.join(cache, 'clip.mp4'), kind: 'video' as const, checkpoint: 'facebook/tribev2', device: 'cpu', cache};
  try {
    process.env.FAKE_TRIBE_FAIL = '1';
    await assert.rejects(worker.predict(python, request, new AbortController().signal, () => {}), /TRIBE failed: RuntimeError: synthetic failure/);
    delete process.env.FAKE_TRIBE_FAIL;
    await worker.stop();
    process.env.FAKE_TRIBE_SLEEP = '30';
    const controller = new AbortController();
    const pending = worker.predict(python, request, controller.signal, () => controller.abort());
    await assert.rejects(pending, /cancelled/);
  } finally {delete process.env.FAKE_TRIBE_FAIL; delete process.env.FAKE_TRIBE_SLEEP; await worker.stop(); await rm(cache, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});}
}));

test('discovery finds project, conda and pyenv environments and resolves chosen folders', {skip: process.platform === 'win32' || skip}, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'adlens-home-'));
  try {
    const add = async (prefix: string) => {await mkdir(path.join(prefix, 'bin'), {recursive: true}); await symlink(python, path.join(prefix, 'bin', 'python3'));};
    await add(path.join(home, 'Desktop', 'tribev2', '.venv'));
    await add(path.join(home, 'miniconda3', 'envs', 'tribe'));
    await add(path.join(home, '.pyenv', 'versions', '3.11.9'));
    await writeFile(path.join(home, 'notes.txt'), 'not an environment');
    const found = (await candidatePaths(home, {PATH: ''})).map(c => c.python);
    for (const expected of [path.join(home, 'Desktop', 'tribev2', '.venv', 'bin', 'python3'), path.join(home, 'miniconda3', 'envs', 'tribe', 'bin', 'python3'), path.join(home, '.pyenv', 'versions', '3.11.9', 'bin', 'python3')]) assert.ok(found.includes(expected), expected);
    assert.equal(label(path.join(home, 'miniconda3', 'envs', 'tribe', 'bin', 'python3')), 'tribe (conda)');
    assert.equal(label(path.join(home, 'Desktop', 'tribev2', '.venv', 'bin', 'python3')), 'tribev2/.venv');
    assert.equal(label(path.join(home, '.pyenv', 'versions', '3.11.9', 'bin', 'python3')), '3.11.9 (pyenv)');
    assert.equal(await resolvePython(path.join(home, 'Desktop', 'tribev2')), path.join(home, 'Desktop', 'tribev2', '.venv', 'bin', 'python3'));
    assert.equal(await resolvePython(path.join(home, 'Desktop')), null);
  } finally {await rm(home, {recursive: true, force: true});}
});

test('scan reports only interpreters where tribev2 imports, preferring the saved one', {skip}, withFake(async () => {
  const results = await scan(bridge, 'facebook/tribev2', python);
  assert.equal(results[0].python, python);
  assert.equal(results[0].source, 'setting');
}));

test('fsaverage5 predictions get grouped Destrieux regions with opening and trend values', {skip}, async () => {
  const previous = process.env.PYTHONPATH;
  process.env.PYTHONPATH = [fake, path.resolve('tests/fixtures/fake-nilearn')].join(path.delimiter);
  process.env.FAKE_TRIBE_FSAVERAGE = '1';
  const cache = await mkdtemp(path.join(tmpdir(), 'adlens-tribe-'));
  const worker = new TribeWorker(bridge);
  try {
    const result = await worker.predict(python, {path: path.join(cache, 'clip.mp4'), kind: 'video', checkpoint: 'facebook/tribev2', device: 'cpu', cache}, new AbortController().signal, () => {});
    assert.equal(result.vertices, 20484);
    assert.match(result.atlas ?? '', /Destrieux/);
    const visual = result.regions.find(r => r.id === 'early_visual');
    assert.ok(visual && visual.vertices > 0);
    assert.ok(visual.hookZ !== null && visual.hookZ > 1, 'the synthetic opening response shows up as a positive hookZ');
    assert.ok(visual.trend < 0, 'and as a falling trend');
    assert.ok(result.regions.some(r => r.id === 'auditory') && result.regions.some(r => r.id === 'default_mode'));
    assert.equal(result.regions.some(r => r.id === 'language'), false, 'groups without any matching labels are omitted');
  } finally {
    await worker.stop(); delete process.env.FAKE_TRIBE_FSAVERAGE;
    if (previous === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previous;
    await rm(cache, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
});
