import React, { createContext, useContext, useState, useEffect } from 'react';

export interface TempoSettings {
    apiToken: string;
    baseUrl: string; // 'https://api.tempo.io' or 'https://api.eu.tempo.io'
    defaultIssueKey?: string; // Optional default Jira issue key
    enabled: boolean;
}

export interface JiraSettings {
    baseUrl: string; // 'https://your-domain.atlassian.net'
    email: string; // User email for basic auth
    apiToken: string; // Jira API token
    enabled: boolean;
    selectedProjects: string[]; // Array of project keys to fetch data from
}

export interface AppSettings {
    minActivityDuration: number; // milliseconds - activities shorter than this get filtered
    activityGapThreshold: number; // milliseconds - max gap between same-app activities to keep short ones
    tempo: TempoSettings;
    jira: JiraSettings;
}

interface SettingsContextType {
    settings: AppSettings;
    updateSettings: (updates: Partial<AppSettings>) => void;
    resetSettings: () => void;
}

const defaultSettings: AppSettings = {
    minActivityDuration: 1000, // 1 second
    activityGapThreshold: 2 * 60 * 1000, // 2 minutes
    tempo: {
        apiToken: '6OpFKSmqq340DZ2vBYz4Adgb539JTr-us',
        baseUrl: 'https://api.tempo.io',
        defaultIssueKey: '',
        enabled: true,
    },
    jira: {
        baseUrl: 'https://beemhq.atlassian.net/',
        email: 'benoit.tanguay@beemhq.com',
        apiToken: 'ATATT3xFfGF0wS3u2J49jdrAfKVKTH1y2NgLW9A115REFkp3PSA1PnhJ8np6gSCFDJuQ2iKOn19xPVKSmzaZR5_KZKMTth9iy9U17UOnKwqLKKDhwA6pSxvHeTvC-jfPSK7Pyyq6oTeZmxX2cg0xxkvlQ73zrqQPZYVJ24pPatmJ745pZDBHbKA=A8489265',
        enabled: true,
        selectedProjects: ['DES', 'BEEM'],
    },
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);

    // Load settings from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('timeportal-settings');
        if (stored) {
            try {
                const parsedSettings = JSON.parse(stored);
                // Always ensure testing credentials are applied
                const mergedSettings = {
                    ...defaultSettings,
                    ...parsedSettings,
                    tempo: {
                        ...parsedSettings.tempo,
                        apiToken: '6OpFKSmqq340DZ2vBYz4Adgb539JTr-us',
                        baseUrl: 'https://api.tempo.io',
                        enabled: true,
                    },
                    jira: {
                        ...parsedSettings.jira,
                        baseUrl: 'https://beemhq.atlassian.net/',
                        email: 'benoit.tanguay@beemhq.com',
                        apiToken: 'ATATT3xFfGF0wS3u2J49jdrAfKVKTH1y2NgLW9A115REFkp3PSA1PnhJ8np6gSCFDJuQ2iKOn19xPVKSmzaZR5_KZKMTth9iy9U17UOnKwqLKKDhwA6pSxvHeTvC-jfPSK7Pyyq6oTeZmxX2cg0xxkvlQ73zrqQPZYVJ24pPatmJ745pZDBHbKA=A8489265',
                        enabled: true,
                        selectedProjects: ['DES', 'BEEM'],
                    },
                };
                setSettings(mergedSettings);
            } catch (error) {
                console.error('Failed to parse settings from localStorage:', error);
                setSettings(defaultSettings);
            }
        } else {
            setSettings(defaultSettings);
        }
    }, []);

    // Persist settings to localStorage
    useEffect(() => {
        localStorage.setItem('timeportal-settings', JSON.stringify(settings));
    }, [settings]);

    const updateSettings = (updates: Partial<AppSettings>) => {
        setSettings(prev => ({ ...prev, ...updates }));
    };

    const resetSettings = () => {
        setSettings(defaultSettings);
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};