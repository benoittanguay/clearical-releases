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
        // Auth OAuth
        signInWithOAuth: (provider: 'google' | 'azure' | 'apple') =>
            ipcRenderer.invoke('auth:sign-in-oauth', provider),
        captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
        analyzeScreenshot: (imagePath: string, requestId?: string) => ipcRenderer.invoke('analyze-screenshot', imagePath, requestId),
        generateActivitySummary: (context: {
            entryId: string;
            screenshotDescriptions: string[];
            windowTitles: string[];
            appNames: string[];
            duration: number;
            startTime: number;
            endTime: number;
            userRole?: string;
        }) => ipcRenderer.invoke('generate-activity-summary', context),
        analyzeSplits: (activityData: {
            id: string;
            startTime: number;
            endTime: number;
            duration: number;
            screenshots: Array<{ timestamp: number; description: string }>;
        }) => ipcRenderer.invoke('ai:analyze-splits', activityData),
        getActiveWindow: () => ipcRenderer.invoke('get-active-window'),
        checkAccessibilityPermission: () => ipcRenderer.invoke('check-accessibility-permission'),
        checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
        requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
        openScreenPermissionSettings: () => ipcRenderer.invoke('open-screen-permission-settings'),
        openAccessibilitySettings: () => ipcRenderer.invoke('open-accessibility-settings'),
        showPermissionResetInstructions: () => ipcRenderer.invoke('show-permission-reset-instructions'),
        getAppIcon: (appName: string) => ipcRenderer.invoke('get-app-icon', appName),
        getScreenshot: (filePath: string) => ipcRenderer.invoke('get-screenshot', filePath),
        showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
        openExternal: (url: string) => ipcRenderer.invoke('open-external-url', url),
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
        // Subscription (Stripe-based)
        subscriptionValidate: () =>
            ipcRenderer.invoke('subscription:validate'),
        subscriptionGetInfo: () =>
            ipcRenderer.invoke('subscription:get-info'),
        subscriptionGetStatus: () =>
            ipcRenderer.invoke('subscription:get-status'),
        subscriptionHasFeature: (featureName: string) =>
            ipcRenderer.invoke('subscription:has-feature', featureName),
        subscriptionGetTrialInfo: () =>
            ipcRenderer.invoke('subscription:get-trial-info'),
        subscriptionCreateCheckout: (plan: string, email: string) =>
            ipcRenderer.invoke('subscription:create-checkout', plan, email),
        subscriptionOpenPortal: () =>
            ipcRenderer.invoke('subscription:open-portal'),
        subscriptionSubscribe: (email: string, plan: string) =>
            ipcRenderer.invoke('subscription:subscribe', email, plan),
        subscriptionCancel: () =>
            ipcRenderer.invoke('subscription:cancel'),
        // Environment info
        getEnvironmentInfo: () =>
            ipcRenderer.invoke('get-environment-info'),
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
                currentCalendarEvent: string | null;
                recentCalendarEvents: string[];
                upcomingCalendarEvents: string[];
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
        // Auto-updater operations
        updater: {
            checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
            getStatus: () => ipcRenderer.invoke('updater:get-status'),
            downloadUpdate: () => ipcRenderer.invoke('updater:download-update'),
            quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
            configure: (options: {
                checkOnStartup?: boolean;
                checkOnStartupDelay?: number;
                autoDownload?: boolean;
                allowPrerelease?: boolean;
            }) => ipcRenderer.invoke('updater:configure', options),
            onStatusUpdate: (callback: (status: any) => void) => {
                const subscription = (_event: any, status: any) => callback(status);
                ipcRenderer.on('update-status', subscription);
                return () => ipcRenderer.removeListener('update-status', subscription);
            },
        },
        // Database operations
        db: {
            // Entries
            getAllEntries: () => ipcRenderer.invoke('db:get-all-entries'),
            getEntry: (id: string) => ipcRenderer.invoke('db:get-entry', id),
            insertEntry: (entry: any) => ipcRenderer.invoke('db:insert-entry', entry),
            updateEntry: (id: string, updates: any) => ipcRenderer.invoke('db:update-entry', id, updates),
            deleteEntry: (id: string) => ipcRenderer.invoke('db:delete-entry', id),
            deleteAllEntries: () => ipcRenderer.invoke('db:delete-all-entries'),
            // Buckets
            getAllBuckets: () => ipcRenderer.invoke('db:get-all-buckets'),
            insertBucket: (bucket: any) => ipcRenderer.invoke('db:insert-bucket', bucket),
            updateBucket: (id: string, updates: any) => ipcRenderer.invoke('db:update-bucket', id, updates),
            deleteBucket: (id: string) => ipcRenderer.invoke('db:delete-bucket', id),
            // Settings
            getSetting: (key: string) => ipcRenderer.invoke('db:get-setting', key),
            setSetting: (key: string, value: any) => ipcRenderer.invoke('db:set-setting', key, value),
            deleteSetting: (key: string) => ipcRenderer.invoke('db:delete-setting', key),
            getAllSettings: () => ipcRenderer.invoke('db:get-all-settings'),
            // Jira Issues Cache
            getAllJiraIssues: () => ipcRenderer.invoke('db:get-all-jira-issues'),
            getJiraIssuesByProject: (projectKey: string) => ipcRenderer.invoke('db:get-jira-issues-by-project', projectKey),
            getJiraIssue: (key: string) => ipcRenderer.invoke('db:get-jira-issue', key),
            upsertJiraIssue: (issue: any) => ipcRenderer.invoke('db:upsert-jira-issue', issue),
            clearJiraCache: () => ipcRenderer.invoke('db:clear-jira-cache'),
            // Jira Cache Metadata
            getJiraCacheMeta: (key: string) => ipcRenderer.invoke('db:get-jira-cache-meta', key),
            setJiraCacheMeta: (key: string, data: any, query?: string) => ipcRenderer.invoke('db:set-jira-cache-meta', key, data, query),
            // Tempo Cache Metadata
            getTempoCacheMeta: (key: string) => ipcRenderer.invoke('db:get-tempo-cache-meta', key),
            setTempoCacheMeta: (key: string, data: any, query?: string) => ipcRenderer.invoke('db:set-tempo-cache-meta', key, data, query),
            // Tempo Accounts Cache
            getAllTempoAccounts: () => ipcRenderer.invoke('db:get-all-tempo-accounts'),
            getTempoAccountsByStatus: (status: string) => ipcRenderer.invoke('db:get-tempo-accounts-by-status', status),
            upsertTempoAccount: (account: any) => ipcRenderer.invoke('db:upsert-tempo-account', account),
            clearTempoCache: () => ipcRenderer.invoke('db:clear-tempo-cache'),
            // Crawler State
            getCrawlerState: (projectKey: string) => ipcRenderer.invoke('db:get-crawler-state', projectKey),
            setCrawlerState: (projectKey: string, state: any) => ipcRenderer.invoke('db:set-crawler-state', projectKey, state),
            clearCrawlerState: () => ipcRenderer.invoke('db:clear-crawler-state'),
            // Database Stats
            getStats: () => ipcRenderer.invoke('db:get-stats'),
            // Migration
            needsMigration: () => ipcRenderer.invoke('db:needs-migration'),
            migrateFromLocalStorage: (localStorageData: Record<string, string>) => ipcRenderer.invoke('db:migrate-from-localstorage', localStorageData),
        },
        // App Blacklist operations
        appBlacklist: {
            getBlacklistedApps: () => ipcRenderer.invoke('get-blacklisted-apps'),
            addBlacklistedApp: (bundleId: string, name: string, category?: string) =>
                ipcRenderer.invoke('add-blacklisted-app', bundleId, name, category),
            removeBlacklistedApp: (bundleId: string) =>
                ipcRenderer.invoke('remove-blacklisted-app', bundleId),
            isAppBlacklisted: (bundleId: string) =>
                ipcRenderer.invoke('is-app-blacklisted', bundleId),
            refreshBlacklist: () => ipcRenderer.invoke('refresh-blacklist'),
            getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
            getAppIconBase64: (iconPath: string) => ipcRenderer.invoke('get-app-icon-base64', iconPath),
        },
        // Tempo Account Blacklist operations
        tempoAccountBlacklist: {
            getBlacklistedAccounts: () => ipcRenderer.invoke('get-blacklisted-tempo-accounts'),
            addBlacklistedAccount: (accountKey: string, accountId: string, name: string) =>
                ipcRenderer.invoke('add-blacklisted-tempo-account', accountKey, accountId, name),
            removeBlacklistedAccount: (accountKey: string) =>
                ipcRenderer.invoke('remove-blacklisted-tempo-account', accountKey),
            isAccountBlacklisted: (accountKey: string) =>
                ipcRenderer.invoke('is-tempo-account-blacklisted', accountKey),
        },
        // Calendar operations
        calendar: {
            connect: () => ipcRenderer.invoke('calendar:connect'),
            disconnect: () => ipcRenderer.invoke('calendar:disconnect'),
            isConnected: () => ipcRenderer.invoke('calendar:is-connected'),
            getAccount: () => ipcRenderer.invoke('calendar:get-account'),
            sync: () => ipcRenderer.invoke('calendar:sync'),
            getContext: (timestamp: number) => ipcRenderer.invoke('calendar:get-context', timestamp),
            createFocusTime: (input: {
                title: string;
                description: string;
                startTime: number;
                endTime: number;
            }) => ipcRenderer.invoke('calendar:create-focus-time', input),
        },
        // Meeting/Recording operations (mic/camera detection)
        meeting: {
            setActiveEntry: (entryId: string | null) =>
                ipcRenderer.invoke('meeting:set-active-entry', entryId),
            getMediaStatus: () =>
                ipcRenderer.invoke('meeting:get-media-status'),
            getRecordingStatus: () =>
                ipcRenderer.invoke('meeting:get-recording-status'),
            setAutoRecordEnabled: (enabled: boolean) =>
                ipcRenderer.invoke('meeting:set-auto-record-enabled', enabled),
            // Audio capture and transcription
            saveAudioAndTranscribe: (entryId: string, audioBase64: string, mimeType?: string) =>
                ipcRenderer.invoke('meeting:save-audio-and-transcribe', entryId, audioBase64, mimeType),
            retryTranscription: (entryId: string, audioPath: string, mimeType: string) =>
                ipcRenderer.invoke('meeting:retry-transcription', entryId, audioPath, mimeType),
            getTranscriptionUsage: () =>
                ipcRenderer.invoke('meeting:get-transcription-usage'),
            // System audio capture (for capturing what others say in meetings)
            isSystemAudioAvailable: () =>
                ipcRenderer.invoke('meeting:is-system-audio-available'),
            startSystemAudioCapture: () =>
                ipcRenderer.invoke('meeting:start-system-audio-capture'),
            stopSystemAudioCapture: () =>
                ipcRenderer.invoke('meeting:stop-system-audio-capture'),
            onSystemAudioSamples: (callback: (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number }) => void) => {
                const subscription = (_event: any, data: any) => {
                    // Convert the samples array back to Float32Array if needed
                    const samples = data.samples instanceof Float32Array
                        ? data.samples
                        : new Float32Array(data.samples);
                    callback({ ...data, samples });
                };
                ipcRenderer.on('meeting:system-audio-samples', subscription);
                return () => ipcRenderer.removeListener('meeting:system-audio-samples', subscription);
            },
            // Native microphone capture (bypasses getUserMedia limitations when Chrome has exclusive mic access)
            isMicCaptureAvailable: () =>
                ipcRenderer.invoke('meeting:is-mic-capture-available'),
            startMicCapture: () =>
                ipcRenderer.invoke('meeting:start-mic-capture'),
            stopMicCapture: () =>
                ipcRenderer.invoke('meeting:stop-mic-capture'),
            onMicAudioSamples: (callback: (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number }) => void) => {
                const subscription = (_event: any, data: any) => {
                    // Convert the samples array back to Float32Array if needed
                    const samples = data.samples instanceof Float32Array
                        ? data.samples
                        : new Float32Array(data.samples);
                    callback({ ...data, samples });
                };
                ipcRenderer.on('meeting:mic-audio-samples', subscription);
                return () => ipcRenderer.removeListener('meeting:mic-audio-samples', subscription);
            },
            // Event subscriptions for automatic recording
            onRecordingShouldStart: (callback: (data: { entryId: string; timestamp: number }) => void) => {
                const subscription = (_event: any, data: { entryId: string; timestamp: number }) => callback(data);
                ipcRenderer.on('meeting:event-recording-should-start', subscription);
                return () => ipcRenderer.removeListener('meeting:event-recording-should-start', subscription);
            },
            onRecordingShouldStop: (callback: (data: { entryId: string; duration: number }) => void) => {
                const subscription = (_event: any, data: { entryId: string; duration: number }) => callback(data);
                ipcRenderer.on('meeting:event-recording-should-stop', subscription);
                return () => ipcRenderer.removeListener('meeting:event-recording-should-stop', subscription);
            },
            // Send audio levels to widget for visualization
            sendAudioLevels: (levels: number[]) =>
                ipcRenderer.send('meeting:send-audio-levels', levels),
        },
    },
    // Analytics (top-level, not inside ipcRenderer)
    analytics: {
        sendEvents: (events: any[], sessionId: string) =>
            ipcRenderer.invoke('analytics:send-events', events, sessionId),
        getEnabled: () => ipcRenderer.invoke('analytics:get-enabled'),
        setEnabled: (enabled: boolean) => ipcRenderer.invoke('analytics:set-enabled', enabled),
    },
});
