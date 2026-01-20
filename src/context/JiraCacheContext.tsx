import { createContext, useContext, useState, useEffect } from 'react';
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

    // Initialize JiraCache service when settings change
    useEffect(() => {
        const { jira } = settings;

        // Check if user has access to Jira feature
        const hasJiraAccess = hasFeature('jira');

        if (hasJiraAccess && jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);
            if (jira.selectedProjects?.length) {
                jiraCache.setSelectedProjects(jira.selectedProjects);
            }

            // Configure sync scheduler
            const syncConfig = {
                enabled: jira.autoSync ?? true,
                intervalMinutes: jira.syncInterval || 30,
                lastSyncTimestamp: jira.lastSyncTimestamp || 0,
            };
            console.log('[JiraCacheContext] Configuring sync scheduler:', {
                rawSyncInterval: jira.syncInterval,
                configuredInterval: syncConfig.intervalMinutes,
                enabled: syncConfig.enabled
            });
            jiraCache.configureSyncScheduler(syncConfig);
        } else {
            // Stop sync scheduler if Jira is disabled or feature is not available
            jiraCache.configureSyncScheduler({
                enabled: false,
                intervalMinutes: 30,
            });
        }
    }, [settings.jira, jiraCache, hasFeature]);

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
