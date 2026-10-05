import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('desktop: input, report, source transparency, history persistence, settings and compact layout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-desktop-'));
  const launch = () => electron.launch({chromiumSandbox: true, args: [path.resolve('out/main/index.js')], env: {...process.env, ELECTRON_RUN_AS_NODE: '', ADLENS_USER_DATA: root, ADLENS_REASONING_URL: '', ADLENS_TRIBE_URL: '', ADLENS_MEDIA_URL: ''}});
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await expect(page.getByRole('heading', {name: 'New analysis.'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Analyze content', exact: true})).toBeDisabled();
    await page.screenshot({path: 'test-results/workspace.png'});
    await page.getByLabel('Analysis name').fill('Autumn campaign');
    await page.getByLabel('Copy & caption').fill('Save 20 minutes on your morning routine. Try it free today.');
    await page.getByLabel('Target audience').fill('Busy professionals');
    await page.getByRole('button', {name: 'Analyze content', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'Autumn campaign', exact: true})).toBeVisible();
    await expect(page.getByText('Heuristic · copy rules')).toBeVisible();
    await expect(page.getByText('3 of 6 dimensions assessed')).toBeVisible();
    await page.screenshot({path: 'test-results/report.png'});
    await page.getByRole('button', {name: 'Evidence & sources'}).click();
    await expect(page.getByText('No model inference was used.')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', {name: 'Connections'}).click();
    await expect(page.getByRole('heading', {name: 'Connections.'})).toBeVisible();
    await page.locator('#reasoningUrl').fill('http://remote.example');
    await page.getByRole('button', {name: 'Save connections'}).click();
    await expect(page.getByRole('alert')).toContainText('HTTPS');
    await page.locator('#reasoningUrl').fill('');
    await page.getByRole('button', {name: 'Save connections'}).click();
    await expect(page.getByRole('status')).toHaveText('Connections saved');
    await page.getByRole('navigation').getByRole('button', {name: /Analyses/}).click();
    await page.getByLabel('Search analyses').fill('nothing matches');
    await expect(page.getByRole('heading', {name: 'No matching analyses'})).toBeVisible();
    await page.getByRole('button', {name: 'Clear search'}).click();
    await expect(page.locator('.history-open')).toHaveCount(1);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.getByRole('navigation').getByRole('button', {name: /Analyses/}).click();
    await expect(page.locator('.history-open')).toContainText('Autumn campaign');
    await page.locator('.history-open').click();
    await expect(page.getByRole('heading', {name: 'Autumn campaign', exact: true})).toBeVisible();
    await app.evaluate(({BrowserWindow}) => {BrowserWindow.getAllWindows()[0].setSize(1000, 760);});
    await page.getByRole('button', {name: 'New analysis', exact: true}).first().click();
    await page.screenshot({path: 'test-results/workspace-compact.png'});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await app.close(); await rm(root, {recursive: true, force: true});}
});

test('desktop: native image import, honest asset-only report, JSON export, deletion, isolated renderer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adlens-media-desktop-'));
  const file = path.join(root, 'fixture.png'), output = path.join(root, 'export.json');
  const app = await electron.launch({chromiumSandbox: true, args: [path.resolve('out/main/index.js')], env: {...process.env, ELECTRON_RUN_AS_NODE: '', ADLENS_USER_DATA: path.join(root, 'profile'), ADLENS_REASONING_URL: '', ADLENS_TRIBE_URL: '', ADLENS_MEDIA_URL: ''}});
  try {
    const page = await app.firstWindow();
    const png = await app.evaluate(({nativeImage}) => nativeImage.createFromBitmap(Buffer.alloc(16, 255), {width: 2, height: 2}).toPNG().toString('base64'));
    await writeFile(file, Buffer.from(png, 'base64'));
    await app.evaluate(({dialog}, filePath) => {dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filePath]});}, file);
    await page.getByRole('button', {name: 'browse files'}).click();
    await expect(page.getByRole('img', {name: 'Preview of fixture.png'})).toBeVisible();
    await expect(page.getByText('Connect media analysis to assess this asset. Copy can be assessed now.')).toBeVisible();
    await page.getByRole('button', {name: 'Analyze content', exact: true}).click();
    await expect(page.getByText('0 of 6 dimensions assessed')).toBeVisible();
    await app.evaluate(({dialog}, filePath) => {dialog.showSaveDialog = async () => ({canceled: false, filePath});}, output);
    await page.getByRole('button', {name: 'Export report'}).click();
    await expect(page.getByRole('status')).toHaveText('Report exported');
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.overall).toBeNull(); expect(report.asset.name).toBe('fixture.png');
    expect(report.metadata.models).toEqual([]); expect(report.asset.path).toBeUndefined();
    expect(await page.evaluate(() => typeof (window as unknown as {require?: unknown}).require)).toBe('undefined');
    await page.getByRole('navigation').getByRole('button', {name: /Analyses/}).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', {name: 'Delete fixture.png'}).click();
    await expect(page.getByRole('heading', {name: 'No analyses yet'})).toBeVisible();
  } finally {await app.close(); await rm(root, {recursive: true, force: true});}
});
