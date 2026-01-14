import { useState, useEffect, useRef } from 'react';
import type { TempoSettings } from '../context/SettingsContext';
import { TempoAccountBlacklistManager } from './TempoAccountBlacklistManager';

interface TempoConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentTempoSettings: TempoSettings;
    onSave: (tempoSettings: TempoSettings) => void;
}

export function TempoConfigModal({
    isOpen,
    onClose,
    currentTempoSettings,
    onSave
}: TempoConfigModalProps) {
    const [tempTempoSettings, setTempTempoSettings] = useState<TempoSettings>(currentTempoSettings);
    const [isTestingTempo, setIsTestingTempo] = useState(false);
    const [isDevelopment, setIsDevelopment] = useState(false);

    // Track the initial state when modal opens to detect external changes
    const initialTempoSettingsRef = useRef<TempoSettings>(currentTempoSettings);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setTempTempoSettings(currentTempoSettings);
            initialTempoSettingsRef.current = currentTempoSettings;
        }
    }, [isOpen, currentTempoSettings]);

    // Monitor for external settings changes while modal is open
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const initialTempo = initialTempoSettingsRef.current;

        // Check if Tempo settings changed externally
        const hasExternalTempoChange = (
            currentTempoSettings.enabled !== initialTempo.enabled ||
            currentTempoSettings.baseUrl !== initialTempo.baseUrl ||
            currentTempoSettings.apiToken !== initialTempo.apiToken ||
            currentTempoSettings.defaultIssueKey !== initialTempo.defaultIssueKey
        );

        if (hasExternalTempoChange) {
            setTempTempoSettings(currentTempoSettings);
            initialTempoSettingsRef.current = currentTempoSettings;
        }
    }, [isOpen, currentTempoSettings]);

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
        onSave(tempTempoSettings);
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-[var(--color-bg-secondary)] rounded-[32px] p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto border border-[var(--color-border-primary)] shadow-2xl animate-scale-in">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)] font-['Syne']">Configure Tempo Integration</h3>
                    <button
                        onClick={onClose}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
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
                    Connect to Tempo to log time entries directly from your activities.
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-4">
                        <input
                            id="tempo-enabled"
                            type="checkbox"
                            checked={tempTempoSettings.enabled}
                            onChange={(e) => {
                                setTempTempoSettings(prev => ({ ...prev, enabled: e.target.checked }));
                            }}
                            className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-1"
                        />
                        <label htmlFor="tempo-enabled" className="text-sm text-[var(--color-text-primary)]">
                            Enable Tempo Integration
                        </label>
                    </div>

                    {tempTempoSettings.enabled && (
                        <>
                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    API Token *
                                </label>
                                <input
                                    type="password"
                                    value={tempTempoSettings.apiToken}
                                    onChange={(e) => {
                                        setTempTempoSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    placeholder="Enter your Tempo API token"
                                />
                                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Get your API token from Tempo → Settings → API Integration
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    Base URL *
                                </label>
                                <select
                                    value={tempTempoSettings.baseUrl}
                                    onChange={(e) => {
                                        setTempTempoSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                >
                                    <option value="https://api.tempo.io">Global (api.tempo.io)</option>
                                    <option value="https://api.eu.tempo.io">EU (api.eu.tempo.io)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm text-[var(--color-text-secondary)] mb-2 font-['Syne']">
                                    Default Issue Key (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={tempTempoSettings.defaultIssueKey || ''}
                                    onChange={(e) => {
                                        setTempTempoSettings(prev => ({ ...prev, defaultIssueKey: e.target.value }));
                                    }}
                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    placeholder="e.g. PROJECT-123"
                                />
                                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                                    Default Jira issue for time logging (can be overridden per entry)
                                </div>
                            </div>

                            <button
                                onClick={handleTestTempo}
                                disabled={isTestingTempo}
                                className="w-full px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:cursor-not-allowed disabled:text-[var(--color-text-tertiary)] text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                {isTestingTempo ? (
                                    <>
                                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                        Testing Tempo...
                                    </>
                                ) : (
                                    'Test Tempo Connection'
                                )}
                            </button>

                            {/* Account Selection Note */}
                            <div className="mt-4 bg-[var(--color-info-muted)] border border-[var(--color-info)]/30 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-info)] flex-shrink-0 mt-0.5">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M12 16v-4"/>
                                        <path d="M12 8h.01"/>
                                    </svg>
                                    <div>
                                        <div className="text-[var(--color-info)] text-xs font-semibold mb-1">Account Selection</div>
                                        <div className="text-[var(--color-text-secondary)] text-xs">
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
