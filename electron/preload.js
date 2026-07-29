const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radexamCloudSync', {
  googleDrive: {
    getStatus: clientId => ipcRenderer.invoke('cloud-sync:google-status', clientId),
    authorize: clientId => ipcRenderer.invoke('cloud-sync:google-authorize', clientId),
    getAccessToken: clientId => ipcRenderer.invoke('cloud-sync:google-access-token', clientId),
    clear: clientId => ipcRenderer.invoke('cloud-sync:google-clear', clientId),
  },
  oneDrive: {
    getStatus: clientId => ipcRenderer.invoke('cloud-sync:microsoft-status', clientId),
    authorize: clientId => ipcRenderer.invoke('cloud-sync:microsoft-authorize', clientId),
    getAccessToken: clientId => ipcRenderer.invoke('cloud-sync:microsoft-access-token', clientId),
    clear: clientId => ipcRenderer.invoke('cloud-sync:microsoft-clear', clientId),
  },
});
