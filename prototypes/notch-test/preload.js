const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    hideWidget: () => ipcRenderer.send('widget:hide'),
    stopRecording: () => ipcRenderer.send('widget:stop'),
    onShow: (callback) => ipcRenderer.on('widget:show', callback)
});
