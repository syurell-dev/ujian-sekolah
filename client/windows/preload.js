'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let info = { platform: 'windows', version: '0.0.0', clientId: '' };
try {
  info = ipcRenderer.sendSync('client:info') || info;
} catch (_) {}

contextBridge.exposeInMainWorld('examClient', {
  platform: info.platform,
  version: info.version,
  clientId: info.clientId,
  sign: (payload) => ipcRenderer.invoke('client:sign', String(payload)),
  state: () => ipcRenderer.invoke('client:state'),
  requestExit: () => ipcRenderer.invoke('client:exit')
});
