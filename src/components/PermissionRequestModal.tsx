import { useState, useEffect } from 'react';

interface PermissionRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPermissionsGranted: () => void;
}

interface PermissionStatus {
    accessibility: boolean;
    screenRecording: boolean;
}

export function PermissionRequestModal({ isOpen, onClose, onPermissionsGranted }: PermissionRequestModalProps) {
    const [permissions, setPermissions] = useState<PermissionStatus>({
        accessibility: false,
        screenRecording: false
    });
    const [checking, setChecking] = useState(false);
    const [showStaleInstructions, setShowStaleInstructions] = useState(false);

    useEffect(() => {
        if (isOpen) {
            checkPermissions();
            setShowStaleInstructions(false);
        }
    }, [isOpen]);

    // Auto-check permissions every 2 seconds while modal is open
    useEffect(() => {
        if (!isOpen) return;

        const interval = setInterval(() => {
            checkPermissions();
        }, 2000);

        return () => clearInterval(interval);
    }, [isOpen]);

    // Auto-close when both permissions are granted
    useEffect(() => {
        if (permissions.accessibility === true && permissions.screenRecording === true) {
            setTimeout(() => {
                onPermissionsGranted();
                onClose();
            }, 500);
        }
    }, [permissions, onPermissionsGranted, onClose]);

    const checkPermissions = async () => {
        try {
            // Check screen recording permission
            const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
            const screenGranted = screenStatus === 'granted';

            // Check accessibility permission by trying to get active window
            let accessibilityGranted = false;
            try {
                await window.electron.ipcRenderer.getActiveWindow();
                accessibilityGranted = true;
            } catch {
                accessibilityGranted = false;
            }

            setPermissions({
                accessibility: accessibilityGranted,
                screenRecording: screenGranted
            });
        } catch (error) {
            console.error('Error checking permissions:', error);
        }
    };

    const requestScreenRecording = async () => {
        setChecking(true);
        try {
            const status = await window.electron.ipcRenderer.requestScreenPermission();

            if (status !== 'granted') {
                // Open System Settings
                await window.electron.ipcRenderer.openScreenPermissionSettings();
            }

            // Recheck after a delay
            setTimeout(checkPermissions, 1000);
        } catch (error) {
            console.error('Error requesting screen recording permission:', error);
        } finally {
            setChecking(false);
        }
    };

    const requestAccessibility = async () => {
        setChecking(true);
        try {
            await window.electron.ipcRenderer.openAccessibilitySettings();

            // Recheck after a delay
            setTimeout(checkPermissions, 1000);
        } catch (error) {
            console.error('Error requesting accessibility permission:', error);
        } finally {
            setChecking(false);
        }
    };

    const handleCheckAgain = () => {
        checkPermissions();
    };

    const handleShowStaleInstructions = () => {
        setShowStaleInstructions(true);
    };

    if (!isOpen) return null;

    const allGranted = permissions.accessibility && permissions.screenRecording;
    const someGranted = permissions.accessibility || permissions.screenRecording;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden border border-gray-700">
                {/* Header */}
                <div className="bg-gradient-to-r from-red-900/30 to-orange-900/30 border-b border-gray-700 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                            </div>
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-white">Permissions Required</h2>
                            <p className="text-gray-400 text-sm">Clearical needs system permissions to track your activity</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    {/* Why Box */}
                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 mb-6">
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 mt-0.5">
                                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-blue-300 mb-1">Why these permissions?</h4>
                                <p className="text-sm text-blue-200/80">
                                    Clearical needs these permissions to automatically track which apps you're using and capture screenshots for AI-powered summaries. Without them, the timer cannot function properly.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Permissions List */}
                    <div className="space-y-4 mb-6">
                        {/* Accessibility Permission */}
                        <div className={`bg-gray-800/50 border rounded-xl p-5 transition-all ${
                            permissions.accessibility === false
                                ? 'border-red-700/50 ring-2 ring-red-500/20'
                                : permissions.accessibility === true
                                    ? 'border-green-700/50'
                                    : 'border-gray-700'
                        }`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all ${
                                        permissions.accessibility === true
                                            ? 'bg-gradient-to-br from-green-500 to-green-600 shadow-green-500/30'
                                            : permissions.accessibility === false
                                                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30'
                                                : 'bg-gradient-to-br from-gray-600 to-gray-700'
                                    }`}>
                                        {permissions.accessibility === true ? (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : permissions.accessibility === false ? (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-semibold text-white">Accessibility</h3>
                                        {permissions.accessibility === true && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900 text-green-400 border border-green-700">
                                                Granted
                                            </span>
                                        )}
                                        {permissions.accessibility === false && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-900 text-red-400 border border-red-700">
                                                Not Granted
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-400 mb-3">
                                        Required to detect which app and window you're currently using
                                    </p>
                                    {permissions.accessibility !== true && (
                                        <button
                                            onClick={requestAccessibility}
                                            disabled={checking}
                                            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-all shadow-lg hover:shadow-amber-500/30"
                                        >
                                            {checking ? 'Opening Settings...' : 'Grant Permission'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Screen Recording Permission */}
                        <div className={`bg-gray-800/50 border rounded-xl p-5 transition-all ${
                            permissions.screenRecording === false
                                ? 'border-red-700/50 ring-2 ring-red-500/20'
                                : permissions.screenRecording === true
                                    ? 'border-green-700/50'
                                    : 'border-gray-700'
                        }`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg transition-all ${
                                        permissions.screenRecording === true
                                            ? 'bg-gradient-to-br from-green-500 to-green-600 shadow-green-500/30'
                                            : permissions.screenRecording === false
                                                ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30'
                                                : 'bg-gradient-to-br from-gray-600 to-gray-700'
                                    }`}>
                                        {permissions.screenRecording === true ? (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : permissions.screenRecording === false ? (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-semibold text-white">Screen Recording</h3>
                                        {permissions.screenRecording === true && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900 text-green-400 border border-green-700">
                                                Granted
                                            </span>
                                        )}
                                        {permissions.screenRecording === false && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-900 text-red-400 border border-red-700">
                                                Not Granted
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-400 mb-3">
                                        Required to capture screenshots of your work for AI-powered summaries
                                    </p>
                                    {permissions.screenRecording !== true && (
                                        <button
                                            onClick={requestScreenRecording}
                                            disabled={checking}
                                            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-all shadow-lg hover:shadow-amber-500/30"
                                        >
                                            {checking ? 'Opening Settings...' : 'Grant Permission'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Stale Permission Help */}
                    {someGranted && !allGranted && (
                        <div className="mb-6">
                            <button
                                onClick={handleShowStaleInstructions}
                                className="text-sm text-blue-400 hover:text-blue-300 underline"
                            >
                                Having trouble? Permission showing as granted but not working?
                            </button>
                        </div>
                    )}

                    {showStaleInstructions && (
                        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 mb-6">
                            <h4 className="text-sm font-semibold text-yellow-300 mb-2">Stale Permission Fix</h4>
                            <p className="text-sm text-yellow-200/80 mb-3">
                                Sometimes macOS caches permissions incorrectly. To fix this:
                            </p>
                            <ol className="text-sm text-yellow-200/80 space-y-2 list-decimal list-inside">
                                <li>Open System Settings → Privacy & Security</li>
                                <li>Go to Screen Recording (or Accessibility)</li>
                                <li>Find Clearical in the list and toggle it OFF</li>
                                <li>Wait 2 seconds, then toggle it back ON</li>
                                <li>Restart Clearical</li>
                            </ol>
                        </div>
                    )}

                    {/* Success message */}
                    {allGranted && (
                        <div className="bg-green-900/20 border border-green-700/50 rounded-xl p-4 mb-6 animate-pulse">
                            <div className="flex items-center gap-3">
                                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h4 className="text-sm font-semibold text-green-300">All permissions granted!</h4>
                                    <p className="text-sm text-green-200/80">Starting timer...</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-between gap-3 pt-4 border-t border-gray-700">
                        <button
                            onClick={onClose}
                            className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <div className="flex gap-3">
                            <button
                                onClick={handleCheckAgain}
                                disabled={checking || allGranted}
                                className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-semibold rounded-lg transition-all"
                            >
                                Check Again
                            </button>
                            {allGranted && (
                                <button
                                    onClick={() => {
                                        onPermissionsGranted();
                                        onClose();
                                    }}
                                    className="px-6 py-2.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-600/30"
                                >
                                    Continue
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
