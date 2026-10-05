import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, Progress } from '../shared/schema';
const api: DesktopAPI = {
  importAsset: () => ipcRenderer.invoke('asset:import'),
  importDropped: file => ipcRenderer.invoke('asset:drop', webUtils.getPathForFile(file)),
  analyze: input => ipcRenderer.invoke('analysis:run', input),
  cancel: id => ipcRenderer.invoke('analysis:cancel', id),
  history: () => ipcRenderer.invoke('history:list'),
  removeReport: id => ipcRenderer.invoke('history:remove', id),
  exportReport: id => ipcRenderer.invoke('report:export', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  models: () => ipcRenderer.invoke('models:list'),
  onProgress: callback => {const listener = (_event: unknown, progress: Progress) => callback(progress); ipcRenderer.on('analysis:progress', listener); return () => ipcRenderer.removeListener('analysis:progress', listener);},
  window: action => {void ipcRenderer.invoke('window:action', action);},
};
contextBridge.exposeInMainWorld('adlens', api);
