"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
console.log('PRELOAD LOADED');
try {
    electron_1.ipcRenderer.send('ping', 'from-preload');
}
catch (e) {
    console.error('Preload ping failed', e);
}
electron_1.contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => electron_1.ipcRenderer.send(channel, data),
        on: (channel, func) => {
            const subscription = (_event, ...args) => func(...args);
            electron_1.ipcRenderer.on(channel, subscription);
            return () => electron_1.ipcRenderer.removeListener(channel, subscription);
        },
        once: (channel, func) => {
            electron_1.ipcRenderer.once(channel, (_event, ...args) => func(...args));
        },
        invoke: (channel, ...args) => electron_1.ipcRenderer.invoke(channel, ...args),
        captureScreenshot: () => electron_1.ipcRenderer.invoke('capture-screenshot'),
        getActiveWindow: () => electron_1.ipcRenderer.invoke('get-active-window'),
        checkAccessibilityPermission: () => electron_1.ipcRenderer.invoke('check-accessibility-permission'),
    },
});
