import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { inputSchema, settingsSchema, type Asset, type ProviderStatus } from '../shared/schema';
import { Store } from './store';
import { analyze } from './engine';
import { CompatibleReasoningProvider, RemoteMediaProvider, RemoteTribeProvider } from './providers';
import { boundedText, endpoint, request } from './providers/transport';

app.setName('AdLens');
if (process.env.ADLENS_USER_DATA) app.setPath('userData', process.env.ADLENS_USER_DATA);
let window: BrowserWindow;
const assets = new Map<string, Asset & {path: string}>();
const active = new Map<string, AbortController>();
const store = new Store(app.getPath('userData'));
const keys = {reasoning: process.env.ADLENS_REASONING_KEY, media: process.env.ADLENS_MEDIA_KEY, tribe: process.env.ADLENS_TRIBE_KEY};
async function settings() {
  const saved = await store.settings();
  return settingsSchema.parse({...saved,
    reasoningUrl: process.env.ADLENS_REASONING_URL ?? saved.reasoningUrl,
    model: process.env.ADLENS_REASONING_MODEL ?? saved.model,
    mediaUrl: process.env.ADLENS_MEDIA_URL ?? saved.mediaUrl,
    tribeUrl: process.env.ADLENS_TRIBE_URL ?? saved.tribeUrl,
  });
}
function handle(name: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(name, (event: IpcMainInvokeEvent, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
async function importAsset(file: string) {
  const info = await stat(file);
  if (!info.isFile() || info.size > 100 * 1024 * 1024 || info.size === 0) throw new Error('Choose a non-empty image or video up to 100 MB.');
  const extension = path.extname(file).toLowerCase();
  const types: Record<string, string> = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm'};
  const mime = types[extension];
  if (!mime) throw new Error('Supported formats: PNG, JPG, WebP, MP4, MOV, WebM.');
  let preview: string | undefined;
  if (mime.startsWith('image/')) {
    const decoded = nativeImage.createFromPath(file);
    if (decoded.isEmpty()) throw new Error('The image could not be decoded.');
    preview = decoded.resize({width: Math.min(decoded.getSize().width, 1000)}).toDataURL();
  }
  const asset: Asset & {path: string} = {id: randomUUID(), name: path.basename(file), mime, size: info.size, preview, path: file};
  assets.set(asset.id, asset);
  if (assets.size > 20) assets.delete(assets.keys().next().value!);
  const {path: _, ...publicAsset} = asset;
  return publicAsset;
}
function register() {
  handle('asset:import', async () => {
    const result = await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: 'Marketing content', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mov', 'webm']}]});
    return result.canceled ? null : importAsset(result.filePaths[0]);
  });
  handle('asset:drop', (file: unknown) => importAsset(z.string().min(1).max(4096).parse(file)));
  handle('settings:get', settings);
  handle('settings:save', async (raw: unknown) => {
    if (active.size) throw new Error('Wait for the active analysis before changing connections.');
    const config = settingsSchema.parse(raw);
    for (const url of [config.reasoningUrl, config.mediaUrl, config.tribeUrl]) if (url) endpoint(url, 'health');
    if (!Object.entries(config.weights).some(([key, val]) => key !== 'tribe' && val > 0)) throw new Error('At least one content weight must be positive.');
    await store.saveSettings(config); return settings();
  });
  handle('models:list', async (): Promise<ProviderStatus[]> => {
    const config = await settings();
    return Promise.all(([
      {id: 'reasoning', name: 'Reasoning', url: config.reasoningUrl, suffix: 'models'},
      {id: 'media', name: 'Media analysis', url: config.mediaUrl, suffix: 'health'},
      {id: 'tribe', name: 'TRIBE v2', url: config.tribeUrl, suffix: 'health'},
    ] as const).map(async provider => {
      if (!provider.url) return {id: provider.id, name: provider.name, state: 'unconfigured' as const, detail: 'Not connected'};
      try {
        const response = await request(endpoint(provider.url, provider.suffix), keys[provider.id], {}, new AbortController().signal, 5000);
        const health = JSON.parse(await boundedText(response));
        if (provider.id === 'reasoning') {
          if (!config.model || !Array.isArray(health.data) || !health.data.some((m: {id?: string}) => m.id === config.model)) throw new Error('Model not available');
        } else if (health.available !== true) throw new Error('Provider unavailable');
        return {id: provider.id, name: provider.name, state: 'available' as const, detail: 'Server reports ready; inference verified per run'};
      } catch {return {id: provider.id, name: provider.name, state: 'unavailable' as const, detail: 'Unreachable, invalid health response, or model unavailable'};}
    }));
  });
  handle('analysis:run', async (raw: unknown) => {
    if (active.size) throw new Error('An analysis is already running.');
    const input = inputSchema.parse(raw), config = await settings();
    const asset = input.assetId ? assets.get(input.assetId) : undefined;
    if (input.assetId && !asset) throw new Error('Select the asset again; this file reference has expired.');
    if (asset && (await stat(asset.path)).size !== asset.size) throw new Error('The file changed. Import it again before analysis.');
    if (active.size) throw new Error('An analysis is already running.');
    const controller = new AbortController(); active.set(input.id, controller);
    try {
      const report = await analyze(input, asset, config, {
        reasoning: config.reasoningUrl ? new CompatibleReasoningProvider(config, keys.reasoning) : undefined,
        media: config.mediaUrl ? new RemoteMediaProvider(config.mediaUrl, keys.media) : undefined,
        tribe: config.tribeUrl ? new RemoteTribeProvider(config.tribeUrl, keys.tribe) : undefined,
        reasoningName: config.model,
      }, controller.signal, event => {if (!window.isDestroyed()) window.webContents.send('analysis:progress', event);});
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
  window = new BrowserWindow({title: 'AdLens', width: 1440, height: 940, minWidth: 980, minHeight: 680, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    ...(process.platform === 'darwin' ? {vibrancy: 'under-window' as const} : {}),
    webPreferences: {preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false}});
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => {for (const controller of active.values()) controller.abort();});
  window.once('ready-to-show', () => window.show());
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  register(); createWindow();
  app.on('activate', () => {if (!BrowserWindow.getAllWindows().length) createWindow();});
});
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
