import { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { JiraCache } from '../services/jiraCache';
import { useSettings } from './SettingsContext';
import { useSubscription } from './SubscriptionContext';

interface JiraCacheContextValue {
    jiraCache: JiraCache;
}

const JiraCacheContext = createContext<JiraCacheContextValue | null>(null);

export function JiraCacheProvider({ children }: { children: ReactNode }) {
    const { settings } = useSettings();
    const { hasFeature } = useSubscription();
    const [jiraCache] = useState(() => new JiraCache());

    // Track whether initial configuration has been done
    const initialConfigDoneRef = useRef(false);

    // Extract specific jira settings to avoid triggering on lastSyncTimestamp changes
    const jira = settings.jira;
    const jiraEnabled = jira?.enabled;
    const jiraApiToken = jira?.apiToken;
    const jiraBaseUrl = jira?.baseUrl;
    const jiraEmail = jira?.email;
    const jiraSelectedProjects = jira?.selectedProjects;
    // Serialize selectedProjects for stable dependency comparison
    const jiraSelectedProjectsKey = JSON.stringify(jiraSelectedProjects || []);
    const jiraAutoSync = jira?.autoSync;
    const jiraSyncInterval = jira?.syncInterval;
    // Only use lastSyncTimestamp for initial configuration
    const jiraLastSyncTimestamp = jira?.lastSyncTimestamp;

    // Initialize JiraCache service when meaningful settings change
    // Note: lastSyncTimestamp is NOT in the dependency array to avoid
    // restarting the scheduler after every sync completes
    useEffect(() => {
        // Check if user has access to Jira feature
        const hasJiraAccess = hasFeature('jira');

        if (hasJiraAccess && jiraEnabled && jiraApiToken && jiraBaseUrl && jiraEmail) {
            jiraCache.initializeService(jiraBaseUrl, jiraEmail, jiraApiToken);
            if (jiraSelectedProjects?.length) {
                jiraCache.setSelectedProjects(jiraSelectedProjects);
            }

            // Configure sync scheduler
            const syncConfig = {
                enabled: jiraAutoSync ?? true,
                intervalMinutes: jiraSyncInterval || 30,
                // Only pass lastSyncTimestamp on initial configuration
                // to prevent scheduler from thinking it needs to sync immediately
                // after settings are restored on app startup
                lastSyncTimestamp: initialConfigDoneRef.current ? undefined : (jiraLastSyncTimestamp || 0),
            };
            console.log('[JiraCacheContext] Configuring sync scheduler:', {
                rawSyncInterval: jiraSyncInterval,
                configuredInterval: syncConfig.intervalMinutes,
                enabled: syncConfig.enabled,
                isInitialConfig: !initialConfigDoneRef.current
            });
            jiraCache.configureSyncScheduler(syncConfig);
            initialConfigDoneRef.current = true;
        } else {
            // Stop sync scheduler if Jira is disabled or feature is not available
            jiraCache.configureSyncScheduler({
                enabled: false,
                intervalMinutes: 30,
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jiraEnabled, jiraApiToken, jiraBaseUrl, jiraEmail, jiraSelectedProjectsKey, jiraAutoSync, jiraSyncInterval, jiraCache, hasFeature]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            jiraCache.destroy();
        };
    }, [jiraCache]);

    return (
        <JiraCacheContext.Provider value={{ jiraCache }}>
            {children}
        </JiraCacheContext.Provider>
    );
}

export function useJiraCache() {
    const context = useContext(JiraCacheContext);
    if (!context) {
        throw new Error('useJiraCache must be used within JiraCacheProvider');
    }
    return context.jiraCache;
}
