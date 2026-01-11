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
        checkScreenPermission: () => electron_1.ipcRenderer.invoke('check-screen-permission'),
        requestScreenPermission: () => electron_1.ipcRenderer.invoke('request-screen-permission'),
        openScreenPermissionSettings: () => electron_1.ipcRenderer.invoke('open-screen-permission-settings'),
        openAccessibilitySettings: () => electron_1.ipcRenderer.invoke('open-accessibility-settings'),
        showPermissionResetInstructions: () => electron_1.ipcRenderer.invoke('show-permission-reset-instructions'),
        getAppIcon: (appName) => electron_1.ipcRenderer.invoke('get-app-icon', appName),
        getScreenshot: (filePath) => electron_1.ipcRenderer.invoke('get-screenshot', filePath),
        showItemInFolder: (filePath) => electron_1.ipcRenderer.invoke('show-item-in-folder', filePath),
        openExternal: (url) => electron_1.ipcRenderer.invoke('open-external-url', url),
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
        // Subscription (Stripe-based)
        subscriptionValidate: () => electron_1.ipcRenderer.invoke('subscription:validate'),
        subscriptionGetInfo: () => electron_1.ipcRenderer.invoke('subscription:get-info'),
        subscriptionGetStatus: () => electron_1.ipcRenderer.invoke('subscription:get-status'),
        subscriptionHasFeature: (featureName) => electron_1.ipcRenderer.invoke('subscription:has-feature', featureName),
        subscriptionGetTrialInfo: () => electron_1.ipcRenderer.invoke('subscription:get-trial-info'),
        subscriptionCreateCheckout: (plan, email) => electron_1.ipcRenderer.invoke('subscription:create-checkout', plan, email),
        subscriptionOpenPortal: () => electron_1.ipcRenderer.invoke('subscription:open-portal'),
        subscriptionSubscribe: (email, plan) => electron_1.ipcRenderer.invoke('subscription:subscribe', email, plan),
        subscriptionCancel: () => electron_1.ipcRenderer.invoke('subscription:cancel'),
        // Environment info
        getEnvironmentInfo: () => electron_1.ipcRenderer.invoke('get-environment-info'),
        // AI features
        suggestAssignment: (request) => electron_1.ipcRenderer.invoke('suggest-assignment', request),
        selectTempoAccount: (request) => electron_1.ipcRenderer.invoke('select-tempo-account', request),
        // Auto-updater operations
        updater: {
            checkForUpdates: () => electron_1.ipcRenderer.invoke('updater:check-for-updates'),
            getStatus: () => electron_1.ipcRenderer.invoke('updater:get-status'),
            downloadUpdate: () => electron_1.ipcRenderer.invoke('updater:download-update'),
            quitAndInstall: () => electron_1.ipcRenderer.invoke('updater:quit-and-install'),
            configure: (options) => electron_1.ipcRenderer.invoke('updater:configure', options),
            onStatusUpdate: (callback) => {
                const subscription = (_event, status) => callback(status);
                electron_1.ipcRenderer.on('update-status', subscription);
                return () => electron_1.ipcRenderer.removeListener('update-status', subscription);
            },
        },
        // Database operations
        db: {
            // Entries
            getAllEntries: () => electron_1.ipcRenderer.invoke('db:get-all-entries'),
            getEntry: (id) => electron_1.ipcRenderer.invoke('db:get-entry', id),
            insertEntry: (entry) => electron_1.ipcRenderer.invoke('db:insert-entry', entry),
            updateEntry: (id, updates) => electron_1.ipcRenderer.invoke('db:update-entry', id, updates),
            deleteEntry: (id) => electron_1.ipcRenderer.invoke('db:delete-entry', id),
            deleteAllEntries: () => electron_1.ipcRenderer.invoke('db:delete-all-entries'),
            // Buckets
            getAllBuckets: () => electron_1.ipcRenderer.invoke('db:get-all-buckets'),
            insertBucket: (bucket) => electron_1.ipcRenderer.invoke('db:insert-bucket', bucket),
            updateBucket: (id, updates) => electron_1.ipcRenderer.invoke('db:update-bucket', id, updates),
            deleteBucket: (id) => electron_1.ipcRenderer.invoke('db:delete-bucket', id),
            // Settings
            getSetting: (key) => electron_1.ipcRenderer.invoke('db:get-setting', key),
            setSetting: (key, value) => electron_1.ipcRenderer.invoke('db:set-setting', key, value),
            deleteSetting: (key) => electron_1.ipcRenderer.invoke('db:delete-setting', key),
            getAllSettings: () => electron_1.ipcRenderer.invoke('db:get-all-settings'),
            // Jira Issues Cache
            getAllJiraIssues: () => electron_1.ipcRenderer.invoke('db:get-all-jira-issues'),
            getJiraIssuesByProject: (projectKey) => electron_1.ipcRenderer.invoke('db:get-jira-issues-by-project', projectKey),
            getJiraIssue: (key) => electron_1.ipcRenderer.invoke('db:get-jira-issue', key),
            upsertJiraIssue: (issue) => electron_1.ipcRenderer.invoke('db:upsert-jira-issue', issue),
            clearJiraCache: () => electron_1.ipcRenderer.invoke('db:clear-jira-cache'),
            // Jira Cache Metadata
            getJiraCacheMeta: (key) => electron_1.ipcRenderer.invoke('db:get-jira-cache-meta', key),
            setJiraCacheMeta: (key, data, query) => electron_1.ipcRenderer.invoke('db:set-jira-cache-meta', key, data, query),
            // Crawler State
            getCrawlerState: (projectKey) => electron_1.ipcRenderer.invoke('db:get-crawler-state', projectKey),
            setCrawlerState: (projectKey, state) => electron_1.ipcRenderer.invoke('db:set-crawler-state', projectKey, state),
            clearCrawlerState: () => electron_1.ipcRenderer.invoke('db:clear-crawler-state'),
            // Database Stats
            getStats: () => electron_1.ipcRenderer.invoke('db:get-stats'),
            // Migration
            needsMigration: () => electron_1.ipcRenderer.invoke('db:needs-migration'),
            migrateFromLocalStorage: (localStorageData) => electron_1.ipcRenderer.invoke('db:migrate-from-localstorage', localStorageData),
        },
        // App Blacklist operations
        appBlacklist: {
            getBlacklistedApps: () => electron_1.ipcRenderer.invoke('get-blacklisted-apps'),
            addBlacklistedApp: (bundleId, name, category) => electron_1.ipcRenderer.invoke('add-blacklisted-app', bundleId, name, category),
            removeBlacklistedApp: (bundleId) => electron_1.ipcRenderer.invoke('remove-blacklisted-app', bundleId),
            isAppBlacklisted: (bundleId) => electron_1.ipcRenderer.invoke('is-app-blacklisted', bundleId),
            refreshBlacklist: () => electron_1.ipcRenderer.invoke('refresh-blacklist'),
            getInstalledApps: () => electron_1.ipcRenderer.invoke('get-installed-apps'),
            getAppIconBase64: (iconPath) => electron_1.ipcRenderer.invoke('get-app-icon-base64', iconPath),
        },
    },
});
