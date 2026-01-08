import { useState, useEffect } from 'react';
import type { JiraSettings } from '../context/SettingsContext';

interface JiraConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentSettings: JiraSettings;
    onSave: (settings: JiraSettings) => void;
}

export function JiraConfigModal({ isOpen, onClose, currentSettings, onSave }: JiraConfigModalProps) {
    const [tempSettings, setTempSettings] = useState<JiraSettings>(currentSettings);
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
        if (!tempSettings.apiToken || !tempSettings.baseUrl || !tempSettings.email) {
            alert('Please enter all required fields first.');
            return;
        }

        setIsTestingConnection(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(tempSettings.baseUrl, tempSettings.email, tempSettings.apiToken);
            const isConnected = await service.testConnection();
            alert(isConnected ? 'Connection successful!' : 'Connection failed. Please check your credentials and URL.');
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
                    <h3 className="text-lg font-semibold text-white">Configure Jira Integration</h3>
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

                {/* Testing Credentials Banner */}
                <div className="bg-orange-900/50 border border-orange-700 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span className="text-orange-300 text-sm font-medium">Testing Mode</span>
                    </div>
                    <p className="text-orange-200 text-xs mt-1">
                        Development credentials are automatically loaded for testing purposes.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 mb-4">
                        <input
                            id="jira-enabled-modal"
                            type="checkbox"
                            checked={tempSettings.enabled}
                            onChange={(e) => {
                                setTempSettings(prev => ({ ...prev, enabled: e.target.checked }));
                            }}
                            className="w-4 h-4 text-blue-600 bg-gray-900 border border-gray-700 rounded focus:ring-blue-500 focus:ring-1"
                        />
                        <label htmlFor="jira-enabled-modal" className="text-sm text-gray-300">
                            Enable Jira Integration
                        </label>
                    </div>

                    {tempSettings.enabled && (
                        <>
                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Jira Base URL *
                                </label>
                                <input
                                    type="text"
                                    value={tempSettings.baseUrl}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({ ...prev, baseUrl: e.target.value }));
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="https://your-domain.atlassian.net"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Your Jira Cloud instance URL
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400 mb-2">
                                    Email *
                                </label>
                                <input
                                    type="email"
                                    value={tempSettings.email}
                                    onChange={(e) => {
                                        setTempSettings(prev => ({ ...prev, email: e.target.value }));
                                    }}
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="your.email@company.com"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Your Jira account email address
                                </div>
                            </div>
                            
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
                                    placeholder="Enter your Jira API token"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Generate at: Jira → Profile → Security → Create and manage API tokens
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