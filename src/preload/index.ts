import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ChatEvent, DesktopAPI, Progress } from '../shared/schema';
const listen = <T,>(channel: string, callback: (value: T) => void) => {
  const listener = (_event: unknown, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => {ipcRenderer.removeListener(channel, listener);};
};
const api: DesktopAPI = {
  importAssets: () => ipcRenderer.invoke('asset:import'),
  importDropped: files => ipcRenderer.invoke('asset:drop', files.map(file => webUtils.getPathForFile(file))),
  setFrames: (id, frames) => ipcRenderer.invoke('asset:frames', id, frames),
  analyze: input => ipcRenderer.invoke('analysis:run', input),
  cancel: id => ipcRenderer.invoke('analysis:cancel', id),
  history: () => ipcRenderer.invoke('history:list'),
  removeReport: id => ipcRenderer.invoke('history:remove', id),
  exportReport: id => ipcRenderer.invoke('report:export', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  status: () => ipcRenderer.invoke('status:list'),
  scanTribe: () => ipcRenderer.invoke('tribe:scan'),
  chooseTribePython: () => ipcRenderer.invoke('tribe:choose'),
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  setApiKey: (provider, key, remember) => ipcRenderer.invoke('keys:set', provider, key, remember),
  removeApiKey: provider => ipcRenderer.invoke('keys:remove', provider),
  chat: request => ipcRenderer.invoke('chat:send', request),
  cancelChat: id => ipcRenderer.invoke('chat:cancel', id),
  chatHistory: reportId => ipcRenderer.invoke('chat:history', reportId),
  clearChat: reportId => ipcRenderer.invoke('chat:clear', reportId),
  onChat: callback => listen<ChatEvent>('chat:event', callback),
  onProgress: callback => listen<Progress>('analysis:progress', callback),
  window: action => {void ipcRenderer.invoke('window:action', action);},
};
contextBridge.exposeInMainWorld('adlens', api);
