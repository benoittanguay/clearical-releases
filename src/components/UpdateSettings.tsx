/**
 * Update Settings Component
 *
 * Allows users to configure auto-update behavior:
 * - Enable/disable automatic update checks
 * - Configure when to check for updates
 * - Enable/disable automatic downloads
 * - Opt-in to pre-release versions
 */

import React, { useState, useEffect } from 'react';

interface UpdateSettingsProps {
    onSettingsChange?: () => void;
}

export const UpdateSettings: React.FC<UpdateSettingsProps> = ({ onSettingsChange }) => {
    const [checkOnStartup, setCheckOnStartup] = useState(true);
    const [checkDelay, setCheckDelay] = useState(5000);
    const [autoDownload, setAutoDownload] = useState(true);
    const [allowPrerelease, setAllowPrerelease] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        // Load current settings from localStorage or use defaults
        const savedSettings = localStorage.getItem('updateSettings');
        if (savedSettings) {
            try {
                const settings = JSON.parse(savedSettings);
                setCheckOnStartup(settings.checkOnStartup ?? true);
                setCheckDelay(settings.checkDelay ?? 5000);
                setAutoDownload(settings.autoDownload ?? true);
                setAllowPrerelease(settings.allowPrerelease ?? false);
            } catch (error) {
                console.error('[UpdateSettings] Failed to load settings:', error);
            }
        }
    }, []);

    const handleSaveSettings = async () => {
        setIsSaving(true);
        setSaveSuccess(false);

        const settings = {
            checkOnStartup,
            checkOnStartupDelay: checkDelay,
            autoDownload,
            allowPrerelease,
        };

        try {
            // Save to localStorage
            localStorage.setItem('updateSettings', JSON.stringify(settings));

            // Apply to updater
            await window.electron.ipcRenderer.updater.configure(settings);

            setSaveSuccess(true);
            if (onSettingsChange) onSettingsChange();

            // Clear success message after 3 seconds
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error('[UpdateSettings] Failed to save settings:', error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Update Settings</h3>

            <div className="space-y-4">
                {/* Check on Startup */}
                <div className="flex items-start">
                    <div className="flex items-center h-5">
                        <input
                            id="check-on-startup"
                            type="checkbox"
                            checked={checkOnStartup}
                            onChange={(e) => setCheckOnStartup(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                    <div className="ml-3">
                        <label htmlFor="check-on-startup" className="font-medium text-gray-700">
                            Check for updates on startup
                        </label>
                        <p className="text-sm text-gray-500">
                            Automatically check for updates when the app starts
                        </p>
                    </div>
                </div>

                {/* Startup Delay */}
                {checkOnStartup && (
                    <div className="ml-7">
                        <label htmlFor="check-delay" className="block text-sm font-medium text-gray-700 mb-1">
                            Startup check delay
                        </label>
                        <select
                            id="check-delay"
                            value={checkDelay}
                            onChange={(e) => setCheckDelay(Number(e.target.value))}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value={0}>Immediately</option>
                            <option value={2000}>2 seconds</option>
                            <option value={5000}>5 seconds</option>
                            <option value={10000}>10 seconds</option>
                            <option value={30000}>30 seconds</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            Time to wait after startup before checking for updates
                        </p>
                    </div>
                )}

                {/* Auto Download */}
                <div className="flex items-start">
                    <div className="flex items-center h-5">
                        <input
                            id="auto-download"
                            type="checkbox"
                            checked={autoDownload}
                            onChange={(e) => setAutoDownload(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                    <div className="ml-3">
                        <label htmlFor="auto-download" className="font-medium text-gray-700">
                            Automatically download updates
                        </label>
                        <p className="text-sm text-gray-500">
                            Download updates in the background when found
                        </p>
                    </div>
                </div>

                {/* Allow Prerelease */}
                <div className="flex items-start">
                    <div className="flex items-center h-5">
                        <input
                            id="allow-prerelease"
                            type="checkbox"
                            checked={allowPrerelease}
                            onChange={(e) => setAllowPrerelease(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                    </div>
                    <div className="ml-3">
                        <label htmlFor="allow-prerelease" className="font-medium text-gray-700">
                            Receive pre-release updates
                        </label>
                        <p className="text-sm text-gray-500">
                            Get early access to beta versions (may be unstable)
                        </p>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex items-center gap-3 pt-2">
                    <button
                        onClick={handleSaveSettings}
                        disabled={isSaving}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Save Settings'}
                    </button>

                    {saveSuccess && (
                        <span className="text-sm text-green-600 flex items-center">
                            <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                    fillRule="evenodd"
                                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clipRule="evenodd"
                                />
                            </svg>
                            Settings saved
                        </span>
                    )}
                </div>

                {/* Info */}
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-sm text-blue-700">
                        <strong>Note:</strong> Updates are checked periodically (every 4 hours) regardless of
                        these settings. Manual update checks are always available.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default UpdateSettings;
