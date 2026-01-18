import { useState, useEffect, useRef } from 'react';
import type { TempoSettings, JiraSettings } from '../context/SettingsContext';
import type { JiraProject } from '../services/jiraService';
import { TempoAccountBlacklistManager } from './TempoAccountBlacklistManager';

interface IntegrationConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTempoSettings: TempoSettings;
    currentJiraSettings: JiraSettings;
    onSave: (tempoSettings: TempoSettings, jiraSettings: JiraSettings) => void;
}

export function IntegrationConfigModal({
    isOpen,
    onClose,
    currentTempoSettings,
    currentJiraSettings,
    onSave
}: IntegrationConfigModalProps) {
    const [tempTempoSettings, setTempTempoSettings] = useState<TempoSettings>(currentTempoSettings);
    const [tempJiraSettings, setTempJiraSettings] = useState<JiraSettings>(currentJiraSettings);
    const [isTestingTempo, setIsTestingTempo] = useState(false);
    const [isTestingJira, setIsTestingJira] = useState(false);
    const [activeTab, setActiveTab] = useState<'jira' | 'tempo'>('jira');
    const [availableProjects, setAvailableProjects] = useState<JiraProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [isDevelopment, setIsDevelopment] = useState(false);

    // Track the initial state when modal opens to detect external changes
    const initialJiraSettingsRef = useRef<JiraSettings>(currentJiraSettings);
    const initialTempoSettingsRef = useRef<TempoSettings>(currentTempoSettings);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setTempTempoSettings(currentTempoSettings);
            setTempJiraSettings(currentJiraSettings);
            // Capture the initial state for comparison
            initialJiraSettingsRef.current = currentJiraSettings;
            initialTempoSettingsRef.current = currentTempoSettings;
        }
    }, [isOpen, currentTempoSettings, currentJiraSettings]);

    // Monitor for external settings changes while modal is open
    // Only update if there's a meaningful change beyond lastSyncTimestamp
    // This preserves user's unsaved changes when background Jira sync updates the timestamp
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        // Compare current settings with the initial settings when modal opened
        // This detects if settings changed externally (not just from user edits in the modal)
        const initialJira = initialJiraSettingsRef.current;
        const initialTempo = initialTempoSettingsRef.current;

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

        // Check if Tempo settings changed externally
        const hasExternalTempoChange = (
            currentTempoSettings.enabled !== initialTempo.enabled ||
            currentTempoSettings.baseUrl !== initialTempo.baseUrl ||
            currentTempoSettings.apiToken !== initialTempo.apiToken ||
            currentTempoSettings.defaultIssueKey !== initialTempo.defaultIssueKey
        );

        // Only reset if there's a meaningful external change
        // This allows background sync to update lastSyncTimestamp without disrupting the user
        if (hasExternalJiraChange) {
            setTempJiraSettings(currentJiraSettings);
            initialJiraSettingsRef.current = currentJiraSettings;
        }

        if (hasExternalTempoChange) {
            setTempTempoSettings(currentTempoSettings);
            initialTempoSettingsRef.current = currentTempoSettings;
        }
    }, [isOpen, currentTempoSettings, currentJiraSettings]);

    // Check environment mode on mount
    useEffect(() => {
        const checkEnvironment = async () => {
            try {
                const envInfo = await window.electron.ipcRenderer.getEnvironmentInfo();
                setIsDevelopment(envInfo.isDevelopment);
            } catch (error) {
                console.error('Failed to get environment info:', error);
                // Default to production (hide banner) if we can't determine
                setIsDevelopment(false);
            }
        };
        checkEnvironment();
    }, []);

    const handleSave = () => {
        onSave(tempTempoSettings, tempJiraSettings);
        onClose();
    };

    const handleTestTempo = async () => {
        if (!tempTempoSettings.apiToken || !tempTempoSettings.baseUrl) {
            alert('Please enter API token and select base URL first.');
            return;
        }

        setIsTestingTempo(true);
        try {
            const { TempoService } = await import('../services/tempoService');
            const service = new TempoService(tempTempoSettings.baseUrl, tempTempoSettings.apiToken);
            const isConnected = await service.testConnection();
            alert(isConnected ? 'Tempo connection successful!' : 'Tempo connection failed. Please check your API token and URL.');
        } catch (error) {
            alert(`Tempo connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingTempo(false);
        }
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
            <div className="bg-[var(--color-bg-secondary)] rounded-[12px] p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto border border-[var(--color-border-primary)] shadow-2xl animate-scale-in">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] font-display">Configure Time Tracking Integration</h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[#FAF5EE] transition-colors"
                        aria-label="Close dialog"
                        title="Close"
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
                            <span className="text-[var(--color-text-primary)] text-sm font-medium font-display">Testing Mode</span>
                        </div>
                        <p className="text-[var(--color-text-secondary)] text-xs mt-1">
                            Development credentials are automatically loaded for testing purposes.
                        </p>
                    </div>
                )}

                <div className="mb-4 text-sm text-[var(--color-text-secondary)]">
                    Both Jira and Tempo integrations work together to provide comprehensive time tracking capabilities.
                </div>

                {/* Tab Navigation */}
                <div className="flex space-x-1 mb-6 bg-[var(--color-bg-tertiary)] rounded-lg p-1">
                    <button
                        onClick={() => setActiveTab('jira')}
                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'jira'
                                ? 'bg-[var(--color-accent)] text-white'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-quaternary)]'
                        }`}
                    >
                        Jira Setup
                    </button>
                    <button
                        onClick={() => setActiveTab('tempo')}
                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'tempo'
                                ? 'bg-[var(--color-accent)] text-white'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-quaternary)]'
                        }`}
                    >
                        Tempo Setup
                    </button>
                </div>

                {/* Jira Configuration Tab */}
                {activeTab === 'jira' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 mb-4">
                            <input
                                id="jira-enabled-unified"
                                type="checkbox"
                                checked={tempJiraSettings.enabled}
                                onChange={(e) => {
                                    setTempJiraSettings(prev => ({ ...prev, enabled: e.target.checked }));
                                }}
                                className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-1"
                            />
                            <label htmlFor="jira-enabled-unified" className="text-sm text-[var(--color-text-primary)]">
                                Enable Jira Integration
                            </label>
                        </div>

                        {tempJiraSettings.enabled && (
                            <>
                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-display">
                                        Jira Base URL *
                                    </label>
                                    <input
                                        type="text"
                                        value={tempJiraSettings.baseUrl}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{ fontFamily: 'var(--font-body)', borderColor: 'var(--color-border-primary)' }}
                                        onMouseEnter={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = '#8c877d';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }
                                        }}
                                        placeholder="https://your-domain.atlassian.net"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                        Email *
                                    </label>
                                    <input
                                        type="email"
                                        value={tempJiraSettings.email}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, email: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{ fontFamily: 'var(--font-body)', borderColor: 'var(--color-border-primary)' }}
                                        onMouseEnter={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = '#8c877d';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }
                                        }}
                                        placeholder="your.email@company.com"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                        API Token *
                                    </label>
                                    <input
                                        type="password"
                                        value={tempJiraSettings.apiToken}
                                        onChange={(e) => {
                                            setTempJiraSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{ fontFamily: 'var(--font-body)', borderColor: 'var(--color-border-primary)' }}
                                        onMouseEnter={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = '#8c877d';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }
                                        }}
                                        placeholder="Enter your Jira API token"
                                    />
                                    <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
                                        Generate at: Jira → Profile → Security → Create and manage API tokens
                                    </div>
                                </div>

                                <button
                                    onClick={handleTestJira}
                                    disabled={isTestingJira}
                                    className="w-full px-4 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {isTestingJira ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            Testing Jira...
                                        </>
                                    ) : (
                                        'Test Jira Connection'
                                    )}
                                </button>

                                {/* Project Selection */}
                                {availableProjects.length > 0 && (
                                    <div className="mt-6">
                                        <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                            Select Projects to Fetch Data From
                                        </label>
                                        <div className="text-xs text-[var(--color-text-tertiary)] mb-3">
                                            Choose which projects to include in issue fetching. This improves performance and focuses on relevant data for AI features.
                                        </div>

                                        <div className="flex items-center gap-2 mb-3">
                                            <button
                                                onClick={selectAllProjects}
                                                className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                            >
                                                Select All
                                            </button>
                                            <span className="text-xs text-[var(--color-text-tertiary)]">|</span>
                                            <button
                                                onClick={clearAllProjects}
                                                className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                            >
                                                Clear All
                                            </button>
                                            <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                                                {tempJiraSettings.selectedProjects?.length || 0} of {availableProjects.length} selected
                                            </span>
                                        </div>

                                        <div className="max-h-48 overflow-y-auto bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg px-3 py-2">
                                            {availableProjects.map((project) => (
                                                <div key={project.key} className="flex items-center gap-2 py-2 border-b border-[var(--color-border-primary)] last:border-b-0">
                                                    <input
                                                        type="checkbox"
                                                        id={`project-${project.key}`}
                                                        checked={tempJiraSettings.selectedProjects?.includes(project.key) || false}
                                                        onChange={() => handleProjectToggle(project.key)}
                                                        className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-2"
                                                    />
                                                    <label
                                                        htmlFor={`project-${project.key}`}
                                                        className="flex-1 text-sm text-[var(--color-text-primary)] cursor-pointer"
                                                    >
                                                        <span className="font-medium text-[var(--color-accent)]">{project.key}</span>
                                                        <span className="text-[var(--color-text-tertiary)] ml-2">- {project.name}</span>
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
                )}

                {/* Tempo Configuration Tab */}
                {activeTab === 'tempo' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 mb-4">
                            <input
                                id="tempo-enabled-unified"
                                type="checkbox"
                                checked={tempTempoSettings.enabled}
                                onChange={(e) => {
                                    setTempTempoSettings(prev => ({ ...prev, enabled: e.target.checked }));
                                }}
                                className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-2"
                            />
                            <label htmlFor="tempo-enabled-unified" className="text-sm text-[var(--color-text-primary)]">
                                Enable Tempo Integration
                            </label>
                        </div>

                        {tempTempoSettings.enabled && (
                            <>
                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                        API Token *
                                    </label>
                                    <input
                                        type="password"
                                        value={tempTempoSettings.apiToken}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{ fontFamily: 'var(--font-body)', borderColor: 'var(--color-border-primary)' }}
                                        onMouseEnter={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = '#8c877d';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }
                                        }}
                                        placeholder="Enter your Tempo API token"
                                    />
                                    <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
                                        Get your API token from Tempo → Settings → API Integration
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                        Base URL *
                                    </label>
                                    <select
                                        value={tempTempoSettings.baseUrl}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]"
                                        style={{ fontFamily: 'var(--font-body)' }}
                                    >
                                        <option value="https://api.tempo.io">Global (api.tempo.io)</option>
                                        <option value="https://api.eu.tempo.io">EU (api.eu.tempo.io)</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm text-[var(--color-text-secondary)] mb-2">
                                        Default Issue Key (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={tempTempoSettings.defaultIssueKey || ''}
                                        onChange={(e) => {
                                            setTempTempoSettings(prev => ({ ...prev, defaultIssueKey: e.target.value }));
                                        }}
                                        className="w-full bg-[var(--color-bg-primary)] border text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] transition-all"
                                        style={{ fontFamily: 'var(--font-body)', borderColor: 'var(--color-border-primary)' }}
                                        onMouseEnter={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = '#8c877d';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (document.activeElement !== e.currentTarget) {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }
                                        }}
                                        placeholder="e.g. PROJECT-123"
                                    />
                                    <div className="text-xs text-[var(--color-text-tertiary)] mt-1">
                                        Default Jira issue for time logging (can be overridden per entry)
                                    </div>
                                </div>

                                <button
                                    onClick={handleTestTempo}
                                    disabled={isTestingTempo}
                                    className="w-full px-4 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                                >
                                    {isTestingTempo ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            Testing Tempo...
                                        </>
                                    ) : (
                                        'Test Tempo Connection'
                                    )}
                                </button>

                                {/* Account Selection Note */}
                                <div className="mt-4 bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent)] flex-shrink-0 mt-0.5">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M12 16v-4"/>
                                            <path d="M12 8h.01"/>
                                        </svg>
                                        <div>
                                            <div className="text-[var(--color-text-primary)] text-sm font-semibold mb-1 font-display">Account Selection</div>
                                            <div className="text-[var(--color-text-secondary)] text-sm">
                                                Tempo accounts are now selected when logging time. The account dropdown will show accounts linked to the specific Jira issue you're logging time to.
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Account Blacklist Manager */}
                                <div className="mt-6 pt-6 border-t border-[var(--color-border-primary)]">
                                    <TempoAccountBlacklistManager
                                        tempoApiToken={tempTempoSettings.apiToken}
                                        tempoBaseUrl={tempTempoSettings.baseUrl}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={tempJiraSettings.enabled && availableProjects.length > 0 && (tempJiraSettings.selectedProjects?.length || 0) === 0}
                        className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed disabled:shadow-none text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:transform-none"
                    >
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
}