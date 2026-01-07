import { useState, useEffect } from 'react';

interface TempoSettings {
    apiToken: string;
    baseUrl: string;
    defaultIssueKey?: string;
    enabled: boolean;
}

interface TempoConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentSettings: TempoSettings;
    onSave: (settings: TempoSettings) => void;
}

export function TempoConfigModal({ isOpen, onClose, currentSettings, onSave }: TempoConfigModalProps) {
    const [tempSettings, setTempSettings] = useState<TempoSettings>(currentSettings);
    const [isTestingConnection, setIsTestingConnection] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTempSettings(currentSettings);
        }
    }, [isOpen, currentSettings]);

    const handleSave = () => {
        onSave(tempSettings);
        onClose();
    };

    const handleTestConnection = async () => {
        if (!tempSettings.apiToken || !tempSettings.baseUrl) {
            alert('Please enter API token and select base URL first.');
            return;
        }

        setIsTestingConnection(true);
        try {
            const { TempoService } = await import('../services/tempoService');
            const service = new TempoService(tempSettings.baseUrl, tempSettings.apiToken);
            const isConnected = await service.testConnection();
            alert(isConnected ? 'Connection successful!' : 'Connection failed. Please check your API token and URL.');
        } catch (error) {
            alert(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingConnection(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-white">Configure Tempo Integration</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-4">
                        <input
                            id="tempo-enabled-modal"
                            type="checkbox"
                            checked={tempSettings.enabled}
                            onChange={(e) => {
                                setTempSettings(prev => ({ ...prev, enabled: e.target.checked }));
                            }}
                            className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                        />
                        <label htmlFor="tempo-enabled-modal" className="text-sm text-gray-300">
                            Enable Tempo Integration
                        </label>
                    </div>

                    {tempSettings.enabled && (
                        <>
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    API Token *
                                </label>
                                <input
                                    type="password"
                                    value={tempSettings.apiToken}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({ ...prev, apiToken: e.target.value }));
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Enter your Tempo API token"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Get your API token from Tempo → Settings → API Integration
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Base URL *
                                </label>
                                <select
                                    value={tempSettings.baseUrl}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="https://api.tempo.io">Global (api.tempo.io)</option>
                                    <option value="https://api.eu.tempo.io">EU (api.eu.tempo.io)</option>
                                </select>
                                <div className="text-xs text-gray-500 mt-1">
                                    Select your Tempo instance region
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Default Issue Key (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={tempSettings.defaultIssueKey || ''}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({ ...prev, defaultIssueKey: e.target.value }));
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="e.g. PROJECT-123"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Default Jira issue for time logging (can be overridden per entry)
                                </div>
                            </div>

                            <button
                                onClick={handleTestConnection}
                                disabled={isTestingConnection}
                                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                            >
                                {isTestingConnection ? (
                                    <>
                                        <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                        Testing...
                                    </>
                                ) : (
                                    'Test Connection'
                                )}
                            </button>
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                    >
                        Save Configuration
                    </button>
                </div>
            </div>
        </div>
    );
}