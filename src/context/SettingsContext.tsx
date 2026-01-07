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
        apiToken: '',
        baseUrl: 'https://api.tempo.io',
        defaultIssueKey: '',
        enabled: false,
    },
    jira: {
        baseUrl: '',
        email: '',
        apiToken: '',
        enabled: false,
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
                setSettings({ ...defaultSettings, ...parsedSettings });
            } catch (error) {
                console.error('Failed to parse settings from localStorage:', error);
            }
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