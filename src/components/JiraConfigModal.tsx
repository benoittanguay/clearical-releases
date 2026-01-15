import { useState, useEffect, useRef } from 'react';
import type { JiraSettings } from '../context/SettingsContext';
import type { JiraProject } from '../services/jiraService';

interface JiraConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentJiraSettings: JiraSettings;
    onSave: (jiraSettings: JiraSettings) => void;
}

export function JiraConfigModal({
    isOpen,
    onClose,
    currentJiraSettings,
    onSave
}: JiraConfigModalProps) {
    const [tempJiraSettings, setTempJiraSettings] = useState<JiraSettings>(currentJiraSettings);
    const [isTestingJira, setIsTestingJira] = useState(false);
    const [availableProjects, setAvailableProjects] = useState<JiraProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [isDevelopment, setIsDevelopment] = useState(false);

    // Track the initial state when modal opens to detect external changes
    const initialJiraSettingsRef = useRef<JiraSettings>(currentJiraSettings);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setTempJiraSettings(currentJiraSettings);
            initialJiraSettingsRef.current = currentJiraSettings;
        }
    }, [isOpen, currentJiraSettings]);

    // Monitor for external settings changes while modal is open
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const initialJira = initialJiraSettingsRef.current;

        // Check if Jira settings changed externally (not just lastSyncTimestamp)
        const hasExternalJiraChange = (
            currentJiraSettings.enabled !== initialJira.enabled ||
            currentJiraSettings.baseUrl !== initialJira.baseUrl ||
            currentJiraSettings.email !== initialJira.email ||
            currentJiraSettings.apiToken !== initialJira.apiToken ||
            JSON.stringify(currentJiraSettings.selectedProjects) !== JSON.stringify(initialJira.selectedProjects) ||
            currentJiraSettings.autoSync !== initialJira.autoSync ||
            currentJiraSettings.syncInterval !== initialJira.syncInterval
        );

        if (hasExternalJiraChange) {
            setTempJiraSettings(currentJiraSettings);
            initialJiraSettingsRef.current = currentJiraSettings;
        }
    }, [isOpen, currentJiraSettings]);

    // Check environment mode on mount
    useEffect(() => {
        const checkEnvironment = async () => {
            try {
                const envInfo = await window.electron.ipcRenderer.getEnvironmentInfo();
                setIsDevelopment(envInfo.isDevelopment);
            } catch (error) {
                console.error('Failed to get environment info:', error);
                setIsDevelopment(false);
            }
        };
        checkEnvironment();
    }, []);

    const handleSave = () => {
        onSave(tempJiraSettings);
        onClose();
    };

    const handleTestJira = async () => {
        if (!tempJiraSettings.apiToken || !tempJiraSettings.baseUrl || !tempJiraSettings.email) {
            alert('Please enter all Jira fields first.');
            return;
        }

        setIsTestingJira(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(tempJiraSettings.baseUrl, tempJiraSettings.email, tempJiraSettings.apiToken);
            const isConnected = await service.testConnection();

            if (isConnected) {
                alert('Jira connection successful!');
                // Load available projects after successful connection
                loadAvailableProjects();
            } else {
                alert('Jira connection failed. Please check your credentials and URL.');
            }
        } catch (error) {
            alert(`Jira connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingJira(false);
        }
    };

    const loadAvailableProjects = async () => {
        if (!tempJiraSettings.apiToken || !tempJiraSettings.baseUrl || !tempJiraSettings.email) {
            return;
        }

        setLoadingProjects(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(tempJiraSettings.baseUrl, tempJiraSettings.email, tempJiraSettings.apiToken);
            const projects = await service.getProjects();
            setAvailableProjects(projects);
        } catch (error) {
            console.error('Failed to load projects:', error);
            setAvailableProjects([]);
        } finally {
            setLoadingProjects(false);
        }
    };

    const handleProjectToggle = (projectKey: string) => {
        setTempJiraSettings(prev => {
            const currentSelected = prev.selectedProjects || [];
            const isSelected = currentSelected.includes(projectKey);

            const newSelected = isSelected
                ? currentSelected.filter(key => key !== projectKey)
                : [...currentSelected, projectKey];

            return { ...prev, selectedProjects: newSelected };
        });
    };

    const selectAllProjects = () => {
        setTempJiraSettings(prev => ({
            ...prev,
            selectedProjects: availableProjects.map(p => p.key)
        }));
    };

    const clearAllProjects = () => {
        setTempJiraSettings(prev => ({
            ...prev,
            selectedProjects: []
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-[var(--color-bg-secondary)] rounded-[32px] p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto border border-[var(--color-border-primary)] shadow-2xl animate-scale-in">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] font-['Syne']">Configure Jira Integration</h3>
                    <button
                        onClick={onClose}
                        className="p-1 -m-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        aria-label="Close dialog"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                {/* Testing Credentials Banner - Only show in development */}
                {isDevelopment && (
                    <div className="bg-[var(--color-warning-muted)] border border-[var(--color-warning)]/30 rounded-lg p-3 mb-4">
                        <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-warning)]">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <span className="text-[var(--color-text-primary)] text-sm font-medium font-['Syne']">Testing Mode</span>
                        </div>
                        <p className="text-[var(--color-text-secondary)] text-xs mt-1">
                            Development credentials are automatically loaded for testing purposes.
                        </p>
                    </div>
                )}

                <div className="mb-4 text-sm text-[var(--color-text-secondary)]">
                    Connect to Jira to sync issues and enable time tracking features.
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-4">
                        <input
                            id="jira-enabled"
                            type="checkbox"
                            checked={tempJiraSettings.enabled}
                            onChange={(e) => {
                                setTempJiraSettings(prev => ({ ...prev, enabled: e.target.checked }));
                            }}
                            className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-1"
                        />
                        <label htmlFor="jira-enabled" className="text-sm text-[var(--color-text-primary)]">
                            Enable Jira Integration
                        </label>
                    </div>

                    {tempJiraSettings.enabled && (
                        <>
                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    Jira Base URL *
                                </label>
                                <input
                                    type="text"
                                    value={tempJiraSettings.baseUrl}
                                    onChange={(e) => {
                                        setTempJiraSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    placeholder="https://your-domain.atlassian.net"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    Email *
                                </label>
                                <input
                                    type="email"
                                    value={tempJiraSettings.email}
                                    onChange={(e) => {
                                        setTempJiraSettings(prev => ({ ...prev, email: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    placeholder="your.email@company.com"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    API Token *
                                </label>
                                <input
                                    type="password"
                                    value={tempJiraSettings.apiToken}
                                    onChange={(e) => {
                                        setTempJiraSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    placeholder="Enter your Jira API token"
                                />
                                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Generate at: Jira → Profile → Security → Create and manage API tokens
                                </div>
                            </div>

                            <button
                                onClick={handleTestJira}
                                disabled={isTestingJira}
                                className="w-full px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-tertiary)] text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {isTestingJira ? (
                                    <>
                                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                        Testing Jira...
                                    </>
                                ) : (
                                    'Test Jira Connection'
                                )}
                            </button>

                            {/* Project Selection */}
                            {availableProjects.length > 0 && (
                                <div className="mt-6">
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                        Select Projects to Fetch Data From
                                    </label>
                                    <div className="text-xs text-[var(--color-text-secondary)] mb-3">
                                        Choose which projects to include in issue fetching. This improves performance and focuses on relevant data for AI features.
                                    </div>

                                    <div className="flex items-center gap-2 mb-3">
                                        <button
                                            onClick={selectAllProjects}
                                            className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                        >
                                            Select All
                                        </button>
                                        <span className="text-xs text-[var(--color-text-secondary)]">|</span>
                                        <button
                                            onClick={clearAllProjects}
                                            className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                        >
                                            Clear All
                                        </button>
                                        <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                                            {tempJiraSettings.selectedProjects?.length || 0} of {availableProjects.length} selected
                                        </span>
                                    </div>

                                    <div className="max-h-48 overflow-y-auto bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-lg px-3 py-2">
                                        {availableProjects.map((project) => (
                                            <div key={project.key} className="flex items-center gap-2 py-2 border-b border-[var(--color-border-primary)] last:border-b-0">
                                                <input
                                                    type="checkbox"
                                                    id={`project-${project.key}`}
                                                    checked={tempJiraSettings.selectedProjects?.includes(project.key) || false}
                                                    onChange={() => handleProjectToggle(project.key)}
                                                    className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-1"
                                                />
                                                <label
                                                    htmlFor={`project-${project.key}`}
                                                    className="flex-1 text-sm text-[var(--color-text-primary)] cursor-pointer"
                                                >
                                                    <span className="font-medium text-[var(--color-accent)]">{project.key}</span>
                                                    <span className="text-[var(--color-text-secondary)] ml-2">- {project.name}</span>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {loadingProjects && (
                                <div className="mt-4 flex items-center justify-center py-4 text-sm text-[var(--color-text-secondary)]">
                                    <div className="w-4 h-4 border border-[var(--color-text-secondary)] border-t-transparent rounded-full animate-spin mr-2"></div>
                                    Loading available projects...
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg"
                    >
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
}
