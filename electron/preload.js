const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radExamVlm', {
  getStatus: () => ipcRenderer.invoke('vlm:get-status'),
  install: modelId => ipcRenderer.invoke('vlm:install', modelId),
  pause: () => ipcRenderer.invoke('vlm:pause'),
  select: modelId => ipcRenderer.invoke('vlm:select', modelId),
  remove: modelId => ipcRenderer.invoke('vlm:remove', modelId),
  restart: () => ipcRenderer.invoke('vlm:restart'),
  onProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('vlm:progress', listener);
    return () => ipcRenderer.removeListener('vlm:progress', listener);
  }
});
