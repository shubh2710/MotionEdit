const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
  getMediaInfo: (filePath) => ipcRenderer.invoke('ffmpeg:getInfo', filePath),
  exportVideo: (args) => ipcRenderer.invoke('ffmpeg:export', args),
  generateThumbnail: (args) => ipcRenderer.invoke('ffmpeg:generateThumbnail', args),
  onExportProgress: (callback) => ipcRenderer.on('ffmpeg:progress', (_event, data) => callback(data)),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
});
