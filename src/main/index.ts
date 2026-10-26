import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, safeStorage, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { chatRequestSchema, framesSchema, inputSchema, llmProviderLabels, settingsSchema, type Asset, type ImportedItem, type ProviderStatus, type Report, type Settings, type TribeCandidate } from '../shared/schema';
import { Store } from './store';
import { analyze, type PreparedAsset, type Providers } from './engine';
import { createClient, llmStatus, ProviderKeys } from './llm';
import { endpoint } from './llm/transport';
import { chatInstructions } from './prompts';
import { probe, resolvePython, scan, TribeWorker, label } from './tribe';

app.setName('AdLens');
if (process.env.ADLENS_USER_DATA) app.setPath('userData', process.env.ADLENS_USER_DATA);
protocol.registerSchemesAsPrivileged([{scheme: 'adlens-media', privileges: {standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true}}]);
let window: BrowserWindow;
const assets = new Map<string, PreparedAsset>();
const active = new Map<string, AbortController>();
const chats = new Map<string, AbortController>();
const store = new Store(app.getPath('userData'));
const keys = new ProviderKeys(path.join(app.getPath('userData'), 'keys'), {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value),
});
// Built code lives in out/main; the bridge ships as an extra resource when packaged.
const bridge = app.isPackaged ? path.join(process.resourcesPath, 'tribe_bridge.py') : path.join(__dirname, '..', '..', 'resources', 'tribe_bridge.py');
const worker = new TribeWorker(bridge);
const tribeCache = path.join(app.getPath('userData'), 'tribe-cache');
let scanned: TribeCandidate[] | undefined;

async function settings(): Promise<Settings> {
  const saved = await store.settings();
  return settingsSchema.parse({...saved, tribe: {...saved.tribe, python: process.env.ADLENS_TRIBE_PYTHON ?? saved.tribe.python}});
}
function handle(name: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event: IpcMainInvokeEvent, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
const types: Record<string, {mime: string; kind: Asset['kind'] | 'text'}> = {
  '.png': {mime: 'image/png', kind: 'image'}, '.jpg': {mime: 'image/jpeg', kind: 'image'}, '.jpeg': {mime: 'image/jpeg', kind: 'image'}, '.webp': {mime: 'image/webp', kind: 'image'},
  '.mp4': {mime: 'video/mp4', kind: 'video'}, '.mov': {mime: 'video/quicktime', kind: 'video'}, '.webm': {mime: 'video/webm', kind: 'video'}, '.mkv': {mime: 'video/x-matroska', kind: 'video'},
  '.mp3': {mime: 'audio/mpeg', kind: 'audio'}, '.wav': {mime: 'audio/wav', kind: 'audio'}, '.ogg': {mime: 'audio/ogg', kind: 'audio'}, '.flac': {mime: 'audio/flac', kind: 'audio'},
  '.txt': {mime: 'text/plain', kind: 'text'}, '.md': {mime: 'text/markdown', kind: 'text'},
};
const extensions = Object.keys(types).map(e => e.slice(1));
async function importFile(file: string): Promise<ImportedItem> {
  const info = await stat(file);
  const type = types[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`${path.basename(file)}: supported formats are ${extensions.join(', ').toUpperCase()}.`);
  const limit = type.kind === 'text' ? 200_000 : type.kind === 'image' ? 30 * 1024 * 1024 : 500 * 1024 * 1024;
  if (!info.isFile() || !info.size || info.size > limit) throw new Error(`${path.basename(file)} is empty or larger than ${Math.round(limit / 1024 / 1024) || 0.2} MB.`);
  if (type.kind === 'text') return {type: 'text', name: path.basename(file), text: (await readFile(file, 'utf8')).replace(/\r\n/g, '\n').slice(0, 20000)};
  const asset: PreparedAsset = {id: randomUUID(), name: path.basename(file), mime: type.mime, size: info.size, kind: type.kind, path: file};
  if (type.kind === 'image') {
    const decoded = nativeImage.createFromPath(file);
    if (decoded.isEmpty()) throw new Error(`${asset.name} could not be decoded.`);
    const {width, height} = decoded.getSize();
    const still = width > 1280 || height > 1280 ? decoded.resize(width >= height ? {width: 1280} : {height: 1280}) : decoded;
    asset.still = {data: still.toJPEG(85).toString('base64'), width, height};
    asset.preview = decoded.resize({width: Math.min(width, 900)}).toDataURL();
  } else asset.url = `adlens-media://asset/${asset.id}`;
  assets.set(asset.id, asset);
  if (assets.size > 40) assets.delete(assets.keys().next().value!);
  const {path: _, still: __, frames: ___, ...publicAsset} = asset;
  return {type: 'asset', asset: publicAsset};
}
async function importMany(files: string[]) {
  const items: ImportedItem[] = [];
  for (const file of files.slice(0, 12)) items.push(await importFile(file));
  return items;
}
// Streams imported videos to the renderer for preview and frame sampling, with range support for seeking.
async function serveMedia(request: Request) {
  const asset = assets.get(new URL(request.url).pathname.slice(1));
  if (!asset || asset.kind === 'image') return new Response('Not found', {status: 404});
  const size = (await stat(asset.path)).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  const headers = {'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*'};
  if (!range) return new Response(Readable.toWeb(createReadStream(asset.path)) as ReadableStream, {headers: {...headers, 'Content-Length': String(size)}});
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${size}`}});
  return new Response(Readable.toWeb(createReadStream(asset.path, {start, end})) as ReadableStream, {status: 206,
    headers: {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1)}});
}

async function tribePython(config: Settings) {
  if (config.tribe.python) return config.tribe.python;
  scanned ??= await scan(bridge, config.tribe.checkpoint);
  return scanned[0]?.python;
}
async function tribeStatus(config: Settings): Promise<ProviderStatus> {
  const base = {id: 'tribe' as const, name: 'TRIBE v2'};
  if (!config.tribe.enabled) return {...base, state: 'unconfigured', detail: 'Turned off in Connections'};
  if (config.tribe.python) {
    const result = await probe(config.tribe.python, bridge, config.tribe.checkpoint);
    if (!result?.tribev2) return {...base, state: 'unavailable', detail: `tribev2 is not importable from ${config.tribe.python}`};
    return {...base, state: 'available', detail: `${label(config.tribe.python)}${result.version ? ` · tribev2 ${result.version}` : ''}${result.checkpointCached === false ? ' · weights download on first run' : ''}`};
  }
  scanned ??= await scan(bridge, config.tribe.checkpoint);
  if (!scanned.length) return {...base, state: 'unconfigured', detail: 'No Python environment with tribev2 found. Choose its folder in Connections.'};
  return {...base, state: 'available', detail: `${scanned[0].label}${scanned[0].version ? ` · tribev2 ${scanned[0].version}` : ''}${scanned[0].checkpointCached === false ? ' · weights download on first run' : ''}`};
}
async function selectedLLMStatus(config: Settings): Promise<ProviderStatus> {
  const base = {id: 'llm' as const, name: 'Language model'};
  if (!config.llm.provider) return {...base, state: 'unconfigured', detail: 'Not connected'};
  const status = (await llmStatus(config, keys, config.llm.provider))[0];
  const model = status.models.find(m => m.id === config.llm.model)?.name ?? (config.llm.model || 'default model');
  return {...base, state: status.available ? 'available' : 'unavailable', detail: status.available ? `${llmProviderLabels[config.llm.provider]} · ${model}` : status.detail};
}
// The chat gets the report without bulky per-step series.
function chatContext(report: Report | undefined, draft: unknown) {
  if (!report) return JSON.stringify({report: null, draft: draft ?? null, note: 'No analysis has been run for this draft yet.'});
  const {neural, ...rest} = report;
  return JSON.stringify({report: {...rest, neural: neural ? {...neural, words: undefined, global: neural.global.filter((_, i) => i % 2 === 0)} : null}});
}

function register() {
  handle('asset:import', async () => {
    const result = await dialog.showOpenDialog(window, {properties: ['openFile', 'multiSelections'], filters: [{name: 'Videos, images, audio and copy', extensions}]});
    return result.canceled ? [] : importMany(result.filePaths);
  });
  handle('asset:drop', (files: unknown) => importMany(z.array(z.string().min(1).max(4096)).max(12).parse(files)));
  handle('asset:frames', (id: unknown, raw: unknown) => {
    const asset = assets.get(z.string().uuid().parse(id));
    if (!asset || asset.kind !== 'video') throw new Error('Unknown video.');
    const frames = framesSchema.parse(raw);
    for (const frame of frames.frames) if (nativeImage.createFromDataURL(frame.image).isEmpty()) throw new Error('A sampled frame could not be decoded.');
    asset.frames = frames;
  });
  handle('settings:get', settings);
  handle('settings:save', async (raw: unknown) => {
    if (active.size) throw new Error('Wait for the running analysis before changing connections.');
    const config = settingsSchema.parse(raw);
    endpoint(config.llm.ollamaUrl, 'api/tags');
    const previous = await settings();
    if (previous.tribe.python !== config.tribe.python || previous.tribe.checkpoint !== config.tribe.checkpoint || previous.tribe.device !== config.tribe.device) worker.stop();
    await store.saveSettings(config); return settings();
  });
  handle('status:list', async () => {const config = await settings(); return Promise.all([selectedLLMStatus(config), tribeStatus(config)]);});
  handle('tribe:scan', async () => {const config = await settings(); scanned = await scan(bridge, config.tribe.checkpoint, config.tribe.python); return scanned;});
  handle('tribe:choose', async () => {
    const result = await dialog.showOpenDialog(window, {title: 'Choose the Python environment or project folder where TRIBE v2 is installed',
      properties: process.platform === 'darwin' ? ['openFile', 'openDirectory', 'treatPackageAsDirectory'] : ['openDirectory']});
    if (result.canceled) return null;
    const python = await resolvePython(result.filePaths[0]);
    if (!python) throw new Error('No Python interpreter found there. Choose the environment folder (with bin/python) or the project folder containing .venv.');
    const config = await settings();
    const found = await probe(python, bridge, config.tribe.checkpoint);
    if (!found) throw new Error(`${python} could not run the AdLens TRIBE bridge.`);
    if (!found.tribev2) throw new Error(`tribev2 is not installed in ${label(python)}.`);
    return {python, label: label(python), version: found.version, checkpointCached: found.checkpointCached, source: 'setting'} satisfies TribeCandidate;
  });
  handle('llm:status', async () => llmStatus(await settings(), keys));
  handle('keys:set', (provider: unknown, key: unknown, remember: unknown) => keys.set(z.enum(['openai', 'anthropic']).parse(provider), z.string().parse(key), z.boolean().parse(remember)));
  handle('keys:remove', (provider: unknown) => keys.remove(z.enum(['openai', 'anthropic']).parse(provider)));
  handle('analysis:run', async (raw: unknown) => {
    if (active.size) throw new Error('An analysis is already running.');
    const input = inputSchema.parse(raw), config = await settings();
    const selected = input.assetIds.map(id => assets.get(id));
    if (selected.some(a => !a)) throw new Error('Add the files again; a file reference has expired.');
    for (const asset of selected) if ((await stat(asset!.path)).size !== asset!.size) throw new Error(`${asset!.name} changed on disk. Add it again.`);
    const controller = new AbortController(); active.set(input.id, controller);
    try {
      const providers: Providers = {};
      providers.llm = await createClient(config, keys);
      if (providers.llm && config.llm.provider) providers.llmInfo = {provider: config.llm.provider, model: config.llm.model};
      if (!config.tribe.enabled) providers.tribeDisabledReason = 'TRIBE is turned off in Connections';
      else {
        const python = await tribePython(config);
        if (!python) providers.tribeDisabledReason = 'No Python environment with tribev2 was found';
        else {
          await mkdir(tribeCache, {recursive: true, mode: 0o700});
          providers.tribe = {analyze: (asset, signal, progress) => worker.predict(python, {path: asset.path, kind: asset.kind, checkpoint: config.tribe.checkpoint, device: config.tribe.device, cache: tribeCache}, signal, progress)};
        }
      }
      const report = await analyze(input, selected as PreparedAsset[], providers, controller.signal, event => {if (!window.isDestroyed()) window.webContents.send('analysis:progress', event);});
      controller.signal.throwIfAborted();
      await store.add(report);
      if (!window.isDestroyed()) window.webContents.send('analysis:progress', {id: input.id, stage: 'report', state: 'done', detail: 'Report saved', at: new Date().toISOString()});
      return report;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Analysis cancelled.');
      throw error;
    } finally {active.delete(input.id);}
  });
  handle('analysis:cancel', (id: unknown) => {active.get(z.string().uuid().parse(id))?.abort();});
  handle('chat:send', async (raw: unknown) => {
    const request = chatRequestSchema.parse(raw);
    if (request.messages[request.messages.length - 1].role !== 'user') throw new Error('The last chat message must come from you.');
    if (chats.size) throw new Error('Wait for the current reply.');
    const client = await createClient(await settings(), keys);
    if (!client) throw new Error('Connect a language model in Connections first.');
    const report = request.reportId ? (await store.history()).find(r => r.id === request.reportId) : undefined;
    const controller = new AbortController(); chats.set(request.id, controller);
    const send = (event: object) => {if (!window.isDestroyed()) window.webContents.send('chat:event', {id: request.id, ...event});};
    try {
      const reply = await client.complete({system: `${chatInstructions()}\n\nCONTEXT:\n${chatContext(report, request.draft)}`, messages: request.messages}, controller.signal, delta => send({delta}));
      await store.saveChat(request.reportId, [...request.messages, {role: 'assistant', content: reply.slice(0, 40000)}]);
      send({done: true});
    } catch (error) {
      if (controller.signal.aborted) {send({done: true}); return;}
      throw error;
    } finally {chats.delete(request.id);}
  });
  handle('chat:cancel', (id: unknown) => {chats.get(z.string().uuid().parse(id))?.abort();});
  handle('chat:history', (id: unknown) => store.chat(z.string().uuid().nullable().parse(id)));
  handle('chat:clear', (id: unknown) => store.clearChat(z.string().uuid().nullable().parse(id)));
  handle('history:list', () => store.history());
  handle('history:remove', async (id: unknown) => {
    if (active.size) throw new Error('Wait for the current analysis before deleting a report.');
    await store.remove(z.string().uuid().parse(id));
  });
  handle('report:export', async (id: unknown) => {
    const report = (await store.history()).find(r => r.id === z.string().uuid().parse(id));
    if (!report) throw new Error('Report not found.');
    const result = await dialog.showSaveDialog(window, {defaultPath: `AdLens-${report.id.slice(0, 8)}.json`, filters: [{name: 'JSON report', extensions: ['json']}]});
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, JSON.stringify(report, null, 2), {mode: 0o600}); return true;
  });
  handle('window:action', (raw: unknown) => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(raw);
    if (action === 'close') window.close();
    else if (action === 'minimize') window.minimize();
    else window.isMaximized() ? window.unmaximize() : window.maximize();
  });
}
function createWindow() {
  window = new BrowserWindow({title: 'AdLens', width: 1500, height: 960, minWidth: 1100, minHeight: 700, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    ...(process.platform === 'darwin' ? {vibrancy: 'under-window' as const} : {}),
    webPreferences: {preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false}});
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => {for (const controller of [...active.values(), ...chats.values()]) controller.abort();});
  window.once('ready-to-show', () => window.show());
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle('adlens-media', serveMedia);
  await keys.load();
  register(); createWindow();
  app.on('activate', () => {if (!BrowserWindow.getAllWindows().length) createWindow();});
});
app.on('before-quit', () => worker.stop());
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
