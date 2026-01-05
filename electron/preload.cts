import { contextBridge, ipcRenderer } from 'electron';

console.log('PRELOAD LOADED');
try {
    ipcRenderer.send('ping', 'from-preload');
} catch (e) {
    console.error('Preload ping failed', e);
}

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel: string, data: any) => ipcRenderer.send(channel, data),
        on: (channel: string, func: (...args: any[]) => void) => {
            const subscription = (_event: any, ...args: any[]) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        },
        once: (channel: string, func: (...args: any[]) => void) => {
            ipcRenderer.once(channel, (_event, ...args) => func(...args));
        },
        invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
        captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
        getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
        checkAccessibilityPermission: () => ipcRenderer.invoke('check-accessibility-permission'),
        getAppIcon: (appName: string) => ipcRenderer.invoke('get-app-icon', appName),
    },
});
