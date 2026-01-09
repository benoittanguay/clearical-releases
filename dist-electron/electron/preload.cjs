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
        analyzeScreenshot: (imagePath, requestId) => electron_1.ipcRenderer.invoke('analyze-screenshot', imagePath, requestId),
        generateActivitySummary: (context) => electron_1.ipcRenderer.invoke('generate-activity-summary', context),
        getActiveWindow: () => electron_1.ipcRenderer.invoke('get-active-window'),
        checkAccessibilityPermission: () => electron_1.ipcRenderer.invoke('check-accessibility-permission'),
        getAppIcon: (appName) => electron_1.ipcRenderer.invoke('get-app-icon', appName),
        getScreenshot: (filePath) => electron_1.ipcRenderer.invoke('get-screenshot', filePath),
        showItemInFolder: (filePath) => electron_1.ipcRenderer.invoke('show-item-in-folder', filePath),
        tempoApiRequest: (requestParams) => electron_1.ipcRenderer.invoke('tempo-api-request', requestParams),
        jiraApiRequest: (requestParams) => electron_1.ipcRenderer.invoke('jira-api-request', requestParams),
        // Secure credential storage
        secureStoreCredential: (key, value) => electron_1.ipcRenderer.invoke('secure-store-credential', key, value),
        secureGetCredential: (key) => electron_1.ipcRenderer.invoke('secure-get-credential', key),
        secureDeleteCredential: (key) => electron_1.ipcRenderer.invoke('secure-delete-credential', key),
        secureHasCredential: (key) => electron_1.ipcRenderer.invoke('secure-has-credential', key),
        secureListCredentials: () => electron_1.ipcRenderer.invoke('secure-list-credentials'),
        secureIsAvailable: () => electron_1.ipcRenderer.invoke('secure-is-available'),
        // Licensing
        licenseValidate: () => electron_1.ipcRenderer.invoke('license-validate'),
        licenseGetInfo: () => electron_1.ipcRenderer.invoke('license-get-info'),
        licenseActivate: (licenseKey, email) => electron_1.ipcRenderer.invoke('license-activate', licenseKey, email),
        licenseDeactivate: () => electron_1.ipcRenderer.invoke('license-deactivate'),
        licenseGetDevices: () => electron_1.ipcRenderer.invoke('license-get-devices'),
        licenseDeactivateDevice: (deviceId) => electron_1.ipcRenderer.invoke('license-deactivate-device', deviceId),
        licenseGetTrialInfo: () => electron_1.ipcRenderer.invoke('license-get-trial-info'),
        licenseIsValid: () => electron_1.ipcRenderer.invoke('license-is-valid'),
        licenseHasFeature: (featureName) => electron_1.ipcRenderer.invoke('license-has-feature', featureName),
        // AI features
        suggestAssignment: (request) => electron_1.ipcRenderer.invoke('suggest-assignment', request),
        selectTempoAccount: (request) => electron_1.ipcRenderer.invoke('select-tempo-account', request),
    },
});
