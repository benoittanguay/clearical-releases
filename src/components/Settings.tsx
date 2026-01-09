import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { IntegrationConfigModal } from './IntegrationConfigModal';

type PermissionStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

export function Settings() {
    const { settings, updateSettings, resetSettings } = useSettings();
    const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
    const [tempSettings, setTempSettings] = useState(settings);
    const [saveTimeoutId, setSaveTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
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
            {/* Activity Filtering Settings */}
            <div className="bg-gray-800 p-3 rounded-lg mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Activity Filtering</h3>

                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-gray-400">
                                Minimum Activity Duration
                            </label>
                        </div>
                        <div className="space-y-1.5">
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
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs text-gray-400">
                                Activity Gap Threshold
                            </label>
                        </div>
                        <div className="space-y-1.5">
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

                    <div className="flex gap-2 pt-1.5">
                        <button
                            onClick={handleResetSettings}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                        >
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            </div>

            {/* AI Features Settings */}
            <div className="bg-gray-800 p-3 rounded-lg mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">AI Features</h3>

                <div className="space-y-3">
                    {/* Auto-generate descriptions */}
                    <div className="flex items-center justify-between bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div>
                            <div className="text-sm font-medium text-white">Auto-generate Descriptions</div>
                            <div className="text-xs text-gray-500">Automatically create descriptions from screenshots</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoGenerateDescription ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: e.target.checked,
                                            autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                            autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                            assignmentConfidenceThreshold: prev.ai?.assignmentConfidenceThreshold ?? 0.7,
                                            accountConfidenceThreshold: prev.ai?.accountConfidenceThreshold ?? 0.8,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                    </div>

                    {/* Auto-assign work */}
                    <div className="flex items-center justify-between bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div>
                            <div className="text-sm font-medium text-white">Auto-assign Work</div>
                            <div className="text-xs text-gray-500">Automatically assign entries to buckets or Jira issues</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoAssignWork ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                            autoAssignWork: e.target.checked,
                                            autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                            assignmentConfidenceThreshold: prev.ai?.assignmentConfidenceThreshold ?? 0.7,
                                            accountConfidenceThreshold: prev.ai?.accountConfidenceThreshold ?? 0.8,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                    </div>

                    {/* Assignment confidence threshold */}
                    <div className="bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-white">Assignment Confidence Threshold</div>
                            <div className="text-sm font-mono text-green-400">{Math.round((tempSettings.ai?.assignmentConfidenceThreshold ?? 0.7) * 100)}%</div>
                        </div>
                        <input
                            type="range"
                            min="50"
                            max="90"
                            value={Math.round((tempSettings.ai?.assignmentConfidenceThreshold ?? 0.7) * 100)}
                            onChange={(e) => {
                                setTempSettings(prev => ({
                                    ...prev,
                                    ai: {
                                        ...prev.ai,
                                        autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                        autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                        autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                        assignmentConfidenceThreshold: parseInt(e.target.value) / 100,
                                        accountConfidenceThreshold: prev.ai?.accountConfidenceThreshold ?? 0.8,
                                    }
                                }));
                            }}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-600"
                        />
                        <div className="text-xs text-gray-500 mt-1">Minimum confidence to auto-assign work</div>
                    </div>

                    {/* Auto-select Tempo accounts */}
                    <div className="flex items-center justify-between bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div>
                            <div className="text-sm font-medium text-white">Auto-select Tempo Accounts</div>
                            <div className="text-xs text-gray-500">Automatically select Tempo accounts for Jira issues</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tempSettings.ai?.autoSelectAccount ?? true}
                                onChange={(e) => {
                                    setTempSettings(prev => ({
                                        ...prev,
                                        ai: {
                                            ...prev.ai,
                                            autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                            autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                            autoSelectAccount: e.target.checked,
                                            assignmentConfidenceThreshold: prev.ai?.assignmentConfidenceThreshold ?? 0.7,
                                            accountConfidenceThreshold: prev.ai?.accountConfidenceThreshold ?? 0.8,
                                        }
                                    }));
                                }}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                        </label>
                    </div>

                    {/* Account confidence threshold */}
                    <div className="bg-gray-900 p-2.5 rounded border border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-white">Account Confidence Threshold</div>
                            <div className="text-sm font-mono text-green-400">{Math.round((tempSettings.ai?.accountConfidenceThreshold ?? 0.8) * 100)}%</div>
                        </div>
                        <input
                            type="range"
                            min="60"
                            max="100"
                            value={Math.round((tempSettings.ai?.accountConfidenceThreshold ?? 0.8) * 100)}
                            onChange={(e) => {
                                setTempSettings(prev => ({
                                    ...prev,
                                    ai: {
                                        ...prev.ai,
                                        autoGenerateDescription: prev.ai?.autoGenerateDescription ?? true,
                                        autoAssignWork: prev.ai?.autoAssignWork ?? true,
                                        autoSelectAccount: prev.ai?.autoSelectAccount ?? true,
                                        assignmentConfidenceThreshold: prev.ai?.assignmentConfidenceThreshold ?? 0.7,
                                        accountConfidenceThreshold: parseInt(e.target.value) / 100,
                                    }
                                }));
                            }}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-600"
                        />
                        <div className="text-xs text-gray-500 mt-1">Minimum confidence to auto-select accounts</div>
                    </div>
                </div>
            </div>

            {/* Time Tracking Integration Settings */}
            <div className="bg-gray-800 p-3 rounded-lg mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Time Tracking Integration</h3>

                <div className="space-y-2">
                    {/* Jira Status */}
                    <div className="flex items-center justify-between bg-gray-900 p-2.5 rounded border border-gray-700">
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
                    <div className="flex items-center justify-between bg-gray-900 p-2.5 rounded border border-gray-700">
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
                        className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    >
                        Configure Integration
                    </button>
                </div>
            </div>

            <div className="bg-gray-800 p-3 rounded-lg mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Permissions</h3>
                <div className="flex justify-between items-center bg-gray-900 p-2.5 rounded border border-gray-700">
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
                        className="mt-2 w-full text-xs bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded transition-colors"
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
                    className="mt-2 w-full text-xs bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded transition-colors border border-gray-600"
                >
                    Test Screenshot Capture
                </button>
            </div>

            <div className="bg-gray-800 p-3 rounded-lg">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">About</h3>
                <p className="text-xs text-gray-500">TimePortal v0.1.0</p>
            </div>

            {/* Integration Configuration Modal */}
            <IntegrationConfigModal
                isOpen={showIntegrationModal}
                onClose={() => setShowIntegrationModal(false)}
                currentTempoSettings={tempSettings.tempo || { enabled: false, apiToken: '', baseUrl: 'https://api.tempo.io' }}
                currentJiraSettings={tempSettings.jira || { enabled: false, apiToken: '', baseUrl: '', email: '', selectedProjects: [] }}
                onSave={(tempoSettings, jiraSettings) => {
                    setTempSettings(prev => ({ ...prev, tempo: tempoSettings, jira: jiraSettings }));
                }}
            />
        </div>
    );
}
