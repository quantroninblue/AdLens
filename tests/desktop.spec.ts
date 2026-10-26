import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const python = (() => {try {return execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import numpy, sys; print(sys.executable)'], {encoding: 'utf8'}).trim();} catch {return '';}})();
const launch = (root: string, extra: Record<string, string> = {}) => {
  // Remove rather than blank: on Windows an empty ELECTRON_RUN_AS_NODE still counts as set.
  const {ELECTRON_RUN_AS_NODE: _, ...env} = process.env as Record<string, string>;
  return electron.launch({chromiumSandbox: true, args: [path.resolve('out/main/index.js')],
    env: {...env, ADLENS_USER_DATA: root, ADLENS_OPENAI_KEY: '', ADLENS_ANTHROPIC_KEY: '', ...extra}});
};
const body = async (req: IncomingMessage) => {const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString();};
const metric = (score: number | null, evidence: string) => ({score, evidence});
const assessment = {
  summary: 'Fixture report from a fake local model.',
  virality: {score: 67, band: 'high', confidence: 'medium', rationale: 'Fixture rationale: a strong opening and a clear payoff.'},
  metrics: {hook: metric(80, 'Fixture hook'), retention: metric(60, 'Fixture'), emotion: metric(55, 'Fixture'), visual: metric(70, 'Fixture'), audio: metric(50, 'Fixture'),
    clarity: metric(65, 'Fixture'), shareability: metric(62, 'Fixture'), cta: metric(40, 'Fixture'), audience: metric(null, 'No brief')},
  neuralReading: {summary: 'Fixture neural reading.', moments: [{time: 2, observation: 'Fixture peak', implication: 'Keep this beat'}]},
  strengths: ['Fixture strength'], weaknesses: ['Fixture weakness'], recommendations: [{title: 'Tighten the middle', detail: 'Fixture detail', time: 12}],
};

test('desktop: copy-only report, empty TRIBE state, chat prompt, settings, persistence and layout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-desktop-'));
  let app = await launch(root, {ADLENS_TRIBE_PYTHON: path.join(root, 'missing-python')});
  try {
    let page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await expect(page.getByRole('heading', {name: 'New analysis.'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Analyze virality'})).toBeDisabled();
    await expect(page.getByText('Connect a local model, your ChatGPT or Claude account, or an API key to chat.')).toBeVisible();
    await page.screenshot({path: 'test-results/workspace.png'});
    await page.getByLabel('Analysis name').fill('Autumn caption');
    await page.getByLabel('Copy, caption & hook text').fill('Save 20 minutes on your morning routine. Try it free today.');
    await page.getByRole('button', {name: 'Analyze virality'}).click();
    await expect(page.getByRole('heading', {name: 'Autumn caption', exact: true})).toBeVisible();
    await expect(page.getByText('Copy rules only')).toBeVisible();
    await expect(page.getByText('Not estimated · low confidence')).toBeVisible();
    await page.getByRole('tab', {name: 'Brain response'}).click();
    await expect(page.getByRole('heading', {name: 'No TRIBE signal in this report'})).toBeVisible();
    await page.getByRole('tab', {name: 'Evidence & sources'}).click();
    await expect(page.getByText('No model inference was used.')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', {name: 'Connections'}).click();
    await expect(page.getByRole('heading', {name: 'Connections.'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'TRIBE v2 · local'})).toBeVisible();
    await expect(page.getByText(/tribev2 is not importable/)).toBeVisible();
    await page.getByRole('button', {name: 'Save connections'}).click();
    await expect(page.getByRole('status')).toHaveText('Connections saved');
    await page.screenshot({path: 'test-results/connections.png'});
    await app.close(); app = await launch(root); page = await app.firstWindow();
    await page.getByRole('navigation').getByRole('button', {name: /Analyses/}).click();
    await expect(page.locator('.history-open')).toContainText('Autumn caption');
    await app.evaluate(({BrowserWindow}) => {BrowserWindow.getAllWindows()[0].setSize(1100, 720);});
    await page.getByRole('button', {name: 'New analysis', exact: true}).first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => typeof (window as unknown as {require?: unknown}).require)).toBe('undefined');
    expect(errors).toEqual([]);
  } finally {await app.close(); await rm(root, {recursive: true, force: true});}
});

test('desktop: video → frames → TRIBE bridge → local model report, brain timeline, chat, export, delete', async () => {
  test.skip(!python, 'python with numpy is needed to run the TRIBE bridge with the test double');
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-pipeline-'));
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    const payload = req.method === 'POST' ? JSON.parse(await body(req)) : undefined;
    if (req.url === '/api/tags') return res.end(JSON.stringify({models: [{name: 'fixture-vl'}]}));
    if (req.url === '/api/show') return res.end(JSON.stringify({capabilities: ['completion', 'vision']}));
    if (req.url !== '/api/chat') {res.writeHead(404); return res.end();}
    requests.push(payload);
    const reply = payload.format === 'json' ? JSON.stringify(assessment) : 'Fixture chat reply about **the hook**.';
    for (let i = 0; i < reply.length; i += 40) res.write(`${JSON.stringify({message: {content: reply.slice(i, i + 40)}, done: false})}\n`);
    res.end(`${JSON.stringify({done: true})}\n`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(root, 'profile');
  await mkdir(profile, {recursive: true});
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({llm: {provider: 'ollama', model: 'fixture-vl', ollamaUrl: `http://127.0.0.1:${(server.address() as {port: number}).port}`}, tribe: {enabled: true, python, device: 'cpu'}}));
  const app = await launch(profile, {PYTHONPATH: path.resolve('tests/fixtures/fake-tribe')});
  try {
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    // Record a short WebM in the renderer; MediaRecorder output also exercises the unknown-duration path.
    const webm = await page.evaluate(async () => {
      const canvas = Object.assign(document.createElement('canvas'), {width: 320, height: 568});
      const context = canvas.getContext('2d')!;
      const recorder = new MediaRecorder(canvas.captureStream(30), {mimeType: 'video/webm'});
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      const done = new Promise(resolve => recorder.onstop = resolve);
      recorder.start();
      const start = performance.now();
      await new Promise<void>(resolve => {const draw = () => {const t = performance.now() - start; context.fillStyle = `hsl(${t / 5 % 360} 70% 50%)`; context.fillRect(0, 0, 320, 568); if (t < 2500) requestAnimationFrame(draw); else resolve();}; draw();});
      recorder.stop(); await done;
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    });
    const video = path.join(root, 'reel.webm'), caption = path.join(root, 'caption.txt'), output = path.join(root, 'export.json');
    await writeFile(video, Buffer.from(webm, 'base64'));
    await writeFile(caption, 'Stop scrolling: three ways to save 20 minutes every morning. Save this for later.');
    await app.evaluate(({dialog}, files) => {dialog.showOpenDialog = async () => ({canceled: false, filePaths: files});}, [video, caption]);
    await page.getByRole('button', {name: 'browse files'}).click();
    await expect(page.getByText('reel.webm')).toBeVisible();
    await expect(page.getByLabel('Copy, caption & hook text')).toHaveValue(/Stop scrolling/);
    await expect(page.getByText('TRIBE input')).toBeVisible();
    await expect(page.getByText('Frames ready')).toBeVisible({timeout: 20000});
    await page.screenshot({path: 'test-results/workspace-video.png'});
    await page.getByRole('button', {name: 'Analyze virality'}).click();
    await expect(page.getByRole('heading', {name: 'reel.webm', exact: true})).toBeVisible({timeout: 60000});
    await expect(page.getByText('High potential · medium confidence')).toBeVisible();
    await expect(page.getByText('Fixture rationale: a strong opening and a clear payoff.')).toBeVisible();
    await expect(page.getByText('TRIBE v2 brain response', {exact: true})).toBeVisible();
    const analysis = requests.find(r => r.format === 'json');
    expect(analysis.messages.at(-1).images.length).toBeGreaterThan(0);
    const context = JSON.parse(analysis.messages.at(-1).content.split('CONTEXT:\n')[1]);
    expect(context.neural.status).toBe('available');
    expect(context.media.transcript).toContain('Stop scrolling');
    await page.screenshot({path: 'test-results/report.png'});
    await page.getByRole('tab', {name: 'Brain response'}).click();
    await expect(page.getByRole('img', {name: 'Predicted brain response over time'})).toBeVisible();
    await expect(page.getByText('Fixture neural reading.')).toBeVisible();
    await page.screenshot({path: 'test-results/brain-response.png'});
    await expect(page.locator('.chat-context')).toContainText('reel.webm');
    await page.getByRole('textbox', {name: 'Message'}).fill('Why this score?');
    await page.getByRole('textbox', {name: 'Message'}).press('Enter');
    await expect(page.locator('.chat-message.assistant')).toContainText('Fixture chat reply about the hook.');
    const chat = requests.filter(r => r.format !== 'json').at(-1);
    expect(chat.messages[0].content).toContain('"virality":{"score":67');
    await app.evaluate(({dialog}, filePath) => {dialog.showSaveDialog = async () => ({canceled: false, filePath});}, output);
    await page.getByRole('button', {name: 'Export report'}).click();
    await expect(page.getByRole('status')).toHaveText('Report exported');
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.neural.timesteps).toBe(20);
    expect(report.assets[0].path).toBeUndefined();
    await page.getByRole('navigation').getByRole('button', {name: /Analyses/}).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', {name: 'Delete reel.webm'}).click();
    await expect(page.getByRole('heading', {name: 'No analyses yet'})).toBeVisible();
    expect(errors).toEqual([]);
  } finally {await app.close(); server.closeAllConnections(); server.close(); await rm(root, {recursive: true, force: true});}
});
