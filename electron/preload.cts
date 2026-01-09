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
        analyzeScreenshot: (imagePath: string, requestId?: string) => ipcRenderer.invoke('analyze-screenshot', imagePath, requestId),
        generateActivitySummary: (context: {
            screenshotDescriptions: string[];
            windowTitles: string[];
            appNames: string[];
            duration: number;
            startTime: number;
            endTime: number;
        }) => ipcRenderer.invoke('generate-activity-summary', context),
        getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
        checkAccessibilityPermission: () => ipcRenderer.invoke('check-accessibility-permission'),
        getAppIcon: (appName: string) => ipcRenderer.invoke('get-app-icon', appName),
        getScreenshot: (filePath: string) => ipcRenderer.invoke('get-screenshot', filePath),
        showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
        tempoApiRequest: (requestParams: { url: string, method?: string, headers?: Record<string, string>, body?: any }) =>
            ipcRenderer.invoke('tempo-api-request', requestParams),
        jiraApiRequest: (requestParams: { url: string, method?: string, headers?: Record<string, string>, body?: any }) =>
            ipcRenderer.invoke('jira-api-request', requestParams),
        // Secure credential storage
        secureStoreCredential: (key: string, value: string) =>
            ipcRenderer.invoke('secure-store-credential', key, value),
        secureGetCredential: (key: string) =>
            ipcRenderer.invoke('secure-get-credential', key),
        secureDeleteCredential: (key: string) =>
            ipcRenderer.invoke('secure-delete-credential', key),
        secureHasCredential: (key: string) =>
            ipcRenderer.invoke('secure-has-credential', key),
        secureListCredentials: () =>
            ipcRenderer.invoke('secure-list-credentials'),
        secureIsAvailable: () =>
            ipcRenderer.invoke('secure-is-available'),
        // Licensing
        licenseValidate: () =>
            ipcRenderer.invoke('license-validate'),
        licenseGetInfo: () =>
            ipcRenderer.invoke('license-get-info'),
        licenseActivate: (licenseKey: string, email?: string) =>
            ipcRenderer.invoke('license-activate', licenseKey, email),
        licenseDeactivate: () =>
            ipcRenderer.invoke('license-deactivate'),
        licenseGetDevices: () =>
            ipcRenderer.invoke('license-get-devices'),
        licenseDeactivateDevice: (deviceId: string) =>
            ipcRenderer.invoke('license-deactivate-device', deviceId),
        licenseGetTrialInfo: () =>
            ipcRenderer.invoke('license-get-trial-info'),
        licenseIsValid: () =>
            ipcRenderer.invoke('license-is-valid'),
        licenseHasFeature: (featureName: string) =>
            ipcRenderer.invoke('license-has-feature', featureName),
        // AI features
        suggestAssignment: (request: {
            context: {
                description: string;
                appNames: string[];
                windowTitles: string[];
                detectedTechnologies: string[];
                detectedActivities: string[];
                duration: number;
                startTime: number;
            };
            buckets: any[];
            jiraIssues: any[];
            historicalEntries: any[];
        }) => ipcRenderer.invoke('suggest-assignment', request),
        selectTempoAccount: (request: {
            issue: any;
            accounts: any[];
            description?: string;
            historicalAccounts: any[];
        }) => ipcRenderer.invoke('select-tempo-account', request),
    },
});
