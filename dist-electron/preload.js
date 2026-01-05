import { contextBridge, ipcRenderer } from 'electron';
console.log('PRELOAD LOADED');
try {
    ipcRenderer.send('ping', 'from-preload');
}
catch (e) {
    console.error('Preload ping failed', e);
}
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, func) => {
            const subscription = (_event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        },
        once: (channel, func) => {
            ipcRenderer.once(channel, (_event, ...args) => func(...args));
        },
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
    },
});
