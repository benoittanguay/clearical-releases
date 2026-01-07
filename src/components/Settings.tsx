import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { IntegrationConfigModal } from './IntegrationConfigModal';

type PermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export function Settings() {
    const { settings, updateSettings, resetSettings } = useSettings();
    const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
    const [tempSettings, setTempSettings] = useState(settings);
    const [saveTimeoutId, setSaveTimeoutId] = useState<NodeJS.Timeout | null>(null);
    const [showIntegrationModal, setShowIntegrationModal] = useState(false);

    const checkPermission = async () => {
        // @ts-ignore - window.electron is defined in preload
        if (window.electron) {
            // @ts-ignore
            const status = await window.electron.ipcRenderer.invoke('check-screen-permission');
            setPermissionStatus(status);
        }
    };

    const openSettings = async () => {
        // @ts-ignore
        if (window.electron) {
            // @ts-ignore
            await window.electron.ipcRenderer.invoke('open-screen-permission-settings');
        }
    };

    useEffect(() => {
        checkPermission();
        // Poll every few seconds in case user changed it
        const interval = setInterval(checkPermission, 2000);
        return () => clearInterval(interval);
    }, []);

    // Update tempSettings when settings change
    useEffect(() => {
        setTempSettings(settings);
    }, [settings]);

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const seconds = ms / 1000;
        if (seconds < 60) return `${seconds}s`;
        const minutes = seconds / 60;
        return `${minutes}m`;
    };

    const parseDurationInput = (input: string): number => {
        const trimmed = input.toLowerCase().trim();
        
        // Handle milliseconds
        if (trimmed.endsWith('ms')) {
            return parseInt(trimmed.slice(0, -2)) || 0;
        }
        
        // Handle seconds
        if (trimmed.endsWith('s')) {
            return (parseFloat(trimmed.slice(0, -1)) * 1000) || 0;
        }
        
        // Handle minutes
        if (trimmed.endsWith('m')) {
            return (parseFloat(trimmed.slice(0, -1)) * 60 * 1000) || 0;
        }
        
        // Default to milliseconds if no unit
        return parseInt(trimmed) || 0;
    };

    // Auto-save function with debouncing
    const autoSave = () => {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }
        
        const timeoutId = setTimeout(() => {
            updateSettings(tempSettings);
        }, 500); // 500ms debounce
        
        setSaveTimeoutId(timeoutId);
    };

    // Auto-save when tempSettings changes
    useEffect(() => {
        // Only auto-save if the values are different from the original settings
        if (JSON.stringify(tempSettings) !== JSON.stringify(settings)) {
            autoSave();
        }
        
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, [tempSettings]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, []);

    const handleResetSettings = () => {
        resetSettings();
    };

    return (
        <div className="w-full flex-1 flex flex-col p-4">
            <h2 className="text-xl font-bold mb-6 text-gray-200">Settings</h2>

            {/* Activity Filtering Settings */}
            <div className="bg-gray-800 p-4 rounded-lg mb-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Activity Filtering</h3>
                
                <div className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs text-gray-400">
                                Minimum Activity Duration
                            </label>
                            <div className="text-xs text-gray-500">
                                Auto-saved
                            </div>
                        </div>
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={formatDuration(tempSettings.minActivityDuration)}
                                onChange={(e) => {
                                    const newDuration = parseDurationInput(e.target.value);
                                    setTempSettings(prev => ({ ...prev, minActivityDuration: newDuration }));
                                }}
                                className="w-full bg-gray-900 border border-gray-700 text-white text-xs rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500"
                                placeholder="e.g. 1s, 1000ms"
                            />
                            <div className="text-xs text-gray-500">
                                Activities shorter than this will be filtered unless they're near other activities from the same app
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs text-gray-400">
                                Activity Gap Threshold
                            </label>
                            <div className="text-xs text-gray-500">
                                Auto-saved
                            </div>
                        </div>
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={formatDuration(tempSettings.activityGapThreshold)}
                                onChange={(e) => {
                                    const newThreshold = parseDurationInput(e.target.value);
                                    setTempSettings(prev => ({ ...prev, activityGapThreshold: newThreshold }));
                                }}
                                className="w-full bg-gray-900 border border-gray-700 text-white text-xs rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500"
                                placeholder="e.g. 2m, 120s"
                            />
                            <div className="text-xs text-gray-500">
                                Maximum time gap between same-app activities to keep short activities
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex gap-2 pt-2">
                        <button
                            onClick={handleResetSettings}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            </div>

            {/* Time Tracking Integration Settings */}
            <div className="bg-gray-800 p-4 rounded-lg mb-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Time Tracking Integration</h3>
                
                <div className="space-y-3">
                    {/* Jira Status */}
                    <div className="flex items-center justify-between bg-gray-900 p-3 rounded border border-gray-700">
                        <div>
                            <div className="text-sm font-medium text-white">
                                Jira Status
                            </div>
                            <div className="text-xs text-gray-500">
                                {tempSettings.jira?.enabled 
                                    ? `Connected to ${tempSettings.jira.baseUrl?.replace('https://', '') || 'Jira instance'}`
                                    : 'Integration disabled'
                                }
                            </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                            tempSettings.jira?.enabled && tempSettings.jira?.apiToken && tempSettings.jira?.baseUrl && tempSettings.jira?.email
                                ? 'bg-green-900 text-green-400' 
                                : 'bg-gray-900 text-gray-400'
                        }`}>
                            {tempSettings.jira?.enabled && tempSettings.jira?.apiToken && tempSettings.jira?.baseUrl && tempSettings.jira?.email ? 'CONNECTED' : 'DISABLED'}
                        </span>
                    </div>

                    {/* Tempo Status */}
                    <div className="flex items-center justify-between bg-gray-900 p-3 rounded border border-gray-700">
                        <div>
                            <div className="text-sm font-medium text-white">
                                Tempo Status
                            </div>
                            <div className="text-xs text-gray-500">
                                {tempSettings.tempo?.enabled 
                                    ? `Connected to ${tempSettings.tempo.baseUrl?.includes('eu') ? 'EU' : 'Global'} region`
                                    : 'Integration disabled'
                                }
                            </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                            tempSettings.tempo?.enabled && tempSettings.tempo?.apiToken 
                                ? 'bg-green-900 text-green-400' 
                                : 'bg-gray-900 text-gray-400'
                        }`}>
                            {tempSettings.tempo?.enabled && tempSettings.tempo?.apiToken ? 'CONNECTED' : 'DISABLED'}
                        </span>
                    </div>

                    {/* Configure Button */}
                    <button
                        onClick={() => setShowIntegrationModal(true)}
                        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    >
                        Configure Integration
                    </button>
                </div>
            </div>

            <div className="bg-gray-800 p-4 rounded-lg mb-4">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Permissions</h3>
                <div className="flex justify-between items-center bg-gray-900 p-3 rounded border border-gray-700">
                    <div>
                        <div className="text-sm font-medium text-white">Screen Recording</div>
                        <div className="text-xs text-gray-500">Required for Screenshots</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded ${permissionStatus === 'granted' ? 'bg-green-900 text-green-400' :
                            permissionStatus === 'denied' ? 'bg-red-900 text-red-400' : 'bg-yellow-900 text-yellow-400'
                            }`}>
                            {permissionStatus.toUpperCase()}
                        </span>
                    </div>
                </div>
                {permissionStatus !== 'granted' && (
                    <button
                        onClick={openSettings}
                        className="mt-3 w-full text-xs bg-blue-600 hover:bg-blue-500 text-white py-2 rounded transition-colors"
                    >
                        Open System Settings
                    </button>
                )}

                <button
                    onClick={async () => {
                        // @ts-ignore
                        if (window.electron?.ipcRenderer?.captureScreenshot) {
                            // @ts-ignore
                            console.log('[Settings] Manual capture triggered');
                            // @ts-ignore
                            await window.electron.ipcRenderer.captureScreenshot();
                        }
                    }}
                    className="mt-3 w-full text-xs bg-gray-700 hover:bg-gray-600 text-white py-2 rounded transition-colors border border-gray-600"
                >
                    Test Screenshot Capture
                </button>
            </div>

            <div className="bg-gray-800 p-4 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">About</h3>
                <p className="text-xs text-gray-500">TimePortal v0.1.0</p>
            </div>

            {/* Integration Configuration Modal */}
            <IntegrationConfigModal
                isOpen={showIntegrationModal}
                onClose={() => setShowIntegrationModal(false)}
                currentTempoSettings={tempSettings.tempo || { enabled: false, apiToken: '', baseUrl: 'https://api.tempo.io' }}
                currentJiraSettings={tempSettings.jira || { enabled: false, apiToken: '', baseUrl: '', email: '' }}
                onSave={(tempoSettings, jiraSettings) => {
                    setTempSettings(prev => ({ ...prev, tempo: tempoSettings, jira: jiraSettings }));
                }}
            />
        </div>
    );
}
