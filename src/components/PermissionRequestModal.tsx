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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div className="bg-[var(--color-bg-secondary)] rounded-[12px] shadow-2xl w-full max-w-2xl mx-4 border border-[var(--color-border-primary)] max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="bg-[var(--color-warning-muted)] border-b border-[var(--color-border-primary)] px-6 py-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                            <div className="w-12 h-12 bg-[var(--color-warning)] rounded-xl flex items-center justify-center shadow-lg">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                            </div>
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Permissions Required</h2>
                            <p className="text-[var(--color-text-secondary)] text-sm" style={{ fontFamily: 'var(--font-body)' }}>Clearical needs system permissions to track your activity</p>
                        </div>
                    </div>
                </div>

                {/* Content - Scrollable */}
                <div className="p-6 overflow-y-auto flex-1">
                    {/* Why Box */}
                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-accent)]/30 rounded-2xl p-4 mb-6">
                        <div className="flex gap-3">
                            <div className="flex-shrink-0 mt-0.5">
                                <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1" style={{ fontFamily: 'var(--font-display)' }}>Why these permissions?</h4>
                                <p className="text-sm text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
                                    Clearical needs these permissions to automatically track which apps you're using and capture screenshots for AI-powered summaries. Without them, the timer cannot function properly.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Permissions List */}
                    <div className="space-y-4 mb-6">
                        {/* Accessibility Permission */}
                        <div className={`bg-[var(--color-bg-secondary)] border rounded-2xl p-5 transition-all shadow-sm ${
                            permissions.accessibility === false
                                ? 'border-[var(--color-error)]/40 ring-2 ring-[var(--color-error)]/20'
                                : permissions.accessibility === true
                                    ? 'border-[var(--color-success)]/40'
                                    : 'border-[var(--color-border-primary)]'
                        }`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md transition-all ${
                                        permissions.accessibility === true
                                            ? 'bg-[var(--color-success-muted)] shadow-[var(--color-success)]/20'
                                            : permissions.accessibility === false
                                                ? 'bg-[var(--color-error-muted)] shadow-[var(--color-error)]/20'
                                                : 'bg-[var(--color-bg-tertiary)]'
                                    }`}>
                                        {permissions.accessibility === true ? (
                                            <svg className="w-6 h-6 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : permissions.accessibility === false ? (
                                            <svg className="w-6 h-6 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <svg className="w-6 h-6 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Accessibility</h3>
                                        {permissions.accessibility === true && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-success-muted)] text-[var(--color-success)] border border-[var(--color-success)]/30">
                                                Granted
                                            </span>
                                        )}
                                        {permissions.accessibility === false && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-error-muted)] text-[var(--color-error)] border border-[var(--color-error)]/30">
                                                Not Granted
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                                        Required to detect which app and window you're currently using
                                    </p>
                                    {permissions.accessibility !== true && (
                                        <button
                                            onClick={requestAccessibility}
                                            disabled={checking}
                                            className="px-4 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg"
                                        >
                                            {checking ? 'Opening Settings...' : 'Grant Permission'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Screen Recording Permission */}
                        <div className={`bg-[var(--color-bg-secondary)] border rounded-2xl p-5 transition-all shadow-sm ${
                            permissions.screenRecording === false
                                ? 'border-[var(--color-error)]/40 ring-2 ring-[var(--color-error)]/20'
                                : permissions.screenRecording === true
                                    ? 'border-[var(--color-success)]/40'
                                    : 'border-[var(--color-border-primary)]'
                        }`}>
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md transition-all ${
                                        permissions.screenRecording === true
                                            ? 'bg-[var(--color-success-muted)] shadow-[var(--color-success)]/20'
                                            : permissions.screenRecording === false
                                                ? 'bg-[var(--color-error-muted)] shadow-[var(--color-error)]/20'
                                                : 'bg-[var(--color-bg-tertiary)]'
                                    }`}>
                                        {permissions.screenRecording === true ? (
                                            <svg className="w-6 h-6 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : permissions.screenRecording === false ? (
                                            <svg className="w-6 h-6 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <svg className="w-6 h-6 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                            </svg>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Screen Recording</h3>
                                        {permissions.screenRecording === true && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-success-muted)] text-[var(--color-success)] border border-[var(--color-success)]/30">
                                                Granted
                                            </span>
                                        )}
                                        {permissions.screenRecording === false && (
                                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-error-muted)] text-[var(--color-error)] border border-[var(--color-error)]/30">
                                                Not Granted
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                                        Required to capture screenshots of your work for AI-powered summaries
                                    </p>
                                    {permissions.screenRecording !== true && (
                                        <button
                                            onClick={requestScreenRecording}
                                            disabled={checking}
                                            className="px-4 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white text-sm font-semibold rounded-lg transition-all shadow-md hover:shadow-lg"
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
                                className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline transition-colors"
                            >
                                Having trouble? Permission showing as granted but not working?
                            </button>
                        </div>
                    )}

                    {showStaleInstructions && (
                        <div className="bg-[var(--color-warning-muted)] border border-[var(--color-warning)]/30 rounded-2xl p-4 mb-6">
                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>Stale Permission Fix</h4>
                            <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                                Sometimes macOS caches permissions incorrectly. To fix this:
                            </p>
                            <ol className="text-sm text-[var(--color-text-secondary)] space-y-2 list-decimal list-inside">
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
                        <div className="bg-[var(--color-success-muted)] border border-[var(--color-success)]/30 rounded-2xl p-4 mb-6 animate-pulse">
                            <div className="flex items-center gap-3">
                                <svg className="w-6 h-6 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>All permissions granted!</h4>
                                    <p className="text-sm text-[var(--color-text-secondary)]">Starting timer...</p>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                {/* Actions - Sticky Footer */}
                <div className="flex justify-between gap-3 p-6 pt-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        Cancel
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={handleCheckAgain}
                            disabled={checking || allGranted}
                            className="px-5 py-2.5 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border-primary)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-all border border-[var(--color-border-primary)]"
                            style={{ fontFamily: 'var(--font-body)' }}
                        >
                            Check Again
                        </button>
                        {allGranted && (
                            <button
                                onClick={() => {
                                    onPermissionsGranted();
                                    onClose();
                                }}
                                className="px-6 py-2.5 bg-[var(--color-success)] hover:bg-[var(--color-success)]/90 text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-md hover:shadow-lg"
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Continue
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
