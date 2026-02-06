/**
 * Update Notification Component
 *
 * Displays update notifications and handles the update flow:
 * - Shows notification when update is available
 * - Displays download progress
 * - Prompts user to restart when update is ready
 * - Manual update check button
 */

import React, { useEffect, useState } from 'react';

interface UpdateStatus {
    available: boolean;
    downloaded: boolean;
    downloading: boolean;
    version?: string;
    releaseDate?: string;
    releaseNotes?: string;
    error?: string;
    downloadProgress?: {
        percent: number;
        transferred: number;
        total: number;
    };
}

interface UpdateNotificationProps {
    onClose?: () => void;
    showManualCheck?: boolean;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
    onClose,
    showManualCheck = true,
}) => {
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
        available: false,
        downloaded: false,
        downloading: false,
    });
    const [showDetails, setShowDetails] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    // Listen for update status changes from main process
    useEffect(() => {
        const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate(
            (status: UpdateStatus) => {
                console.log('[UpdateNotification] Status update:', status);
                setUpdateStatus(status);
                // Auto-show when update is available or downloaded
                if (status.available || status.downloaded) {
                    setDismissed(false);
                }
            }
        );

        // Listen for install failures
        const unsubscribeInstallFailed = window.electron.ipcRenderer.on(
            'update-install-failed',
            (data: { error: string }) => {
                console.error('[UpdateNotification] Install failed:', data.error);
                setUpdateStatus((prev) => ({
                    ...prev,
                    downloaded: false,
                    error: data.error,
                }));
                setDismissed(false); // Show the notification again with the error
            }
        );

        // Get initial status
        getStatus();

        return () => {
            if (unsubscribe) unsubscribe();
            if (unsubscribeInstallFailed) unsubscribeInstallFailed();
        };
    }, []);

    const getStatus = async () => {
        try {
            const result = await window.electron.ipcRenderer.updater.getStatus();
            if (result.success && result.status) {
                setUpdateStatus(result.status);
            }
        } catch (error) {
            console.error('[UpdateNotification] Failed to get status:', error);
        }
    };

    const handleDownloadUpdate = async () => {
        try {
            // Use electron-updater to download the update automatically
            await window.electron.ipcRenderer.updater.downloadUpdate();
        } catch (error) {
            console.error('[UpdateNotification] Failed to download update:', error);
            // Fallback to manual download if auto-download fails
            const downloadUrl = 'https://github.com/benoittanguay/clearical-releases/releases/latest/download/Clearical-arm64.dmg';
            await window.electron.ipcRenderer.openExternal(downloadUrl);
        }
    };

    const handleInstallUpdate = async () => {
        try {
            // Install the update and restart the app
            await window.electron.ipcRenderer.updater.quitAndInstall();
        } catch (error) {
            console.error('[UpdateNotification] Failed to install update:', error);
        }
    };

    const handleDismiss = () => {
        setDismissed(true);
        if (onClose) onClose();
    };

    // Don't show anything if dismissed or no update available
    if (dismissed || (!updateStatus.available && !updateStatus.error && !showManualCheck)) {
        return null;
    }

    return (
        <div className="fixed bottom-4 right-4 max-w-sm bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded-2xl shadow-2xl z-50 overflow-hidden">
            {/* Accent bar at top */}
            <div className={`h-1 ${updateStatus.error ? 'bg-[var(--color-error)]' : updateStatus.downloaded ? 'bg-[var(--color-success)]' : 'bg-[var(--color-accent)]'}`} />

            <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center mr-3 ${
                            updateStatus.error ? 'bg-[var(--color-error-muted)]' : updateStatus.downloaded ? 'bg-[var(--color-success-muted)]' : 'bg-[var(--color-accent)]/10'
                        }`}>
                            <svg className={`w-5 h-5 ${
                                updateStatus.error ? 'text-[var(--color-error)]' : updateStatus.downloaded ? 'text-[var(--color-success)]' : 'text-[var(--color-accent)]'
                            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] font-display">
                                {updateStatus.downloaded
                                    ? 'Update Ready'
                                    : updateStatus.downloading
                                        ? 'Downloading Update'
                                        : updateStatus.available
                                            ? 'Update Available'
                                            : 'Software Updates'}
                            </h3>
                            {updateStatus.version && (
                                <p className="text-xs text-[var(--color-text-tertiary)]">v{updateStatus.version}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Error State */}
                {updateStatus.error && (
                    <div className="mb-3 p-2.5 bg-[var(--color-error-muted)] border border-[var(--color-error)]/20 rounded-xl">
                        <p className="text-xs text-[var(--color-error)] mb-2">{updateStatus.error}</p>
                        {updateStatus.error.includes('code signing') && (
                            <button
                                onClick={() => window.open('https://github.com/benoittanguay/clearical-releases/releases', '_blank')}
                                className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors underline"
                            >
                                Open releases page
                            </button>
                        )}
                    </div>
                )}

                {/* Download Progress */}
                {updateStatus.downloading && updateStatus.downloadProgress && (
                    <div className="mb-3">
                        <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                            Downloading update...
                        </p>
                        <div className="w-full bg-[var(--color-bg-tertiary)] rounded-full h-2">
                            <div
                                className="bg-[var(--color-accent)] h-2 rounded-full transition-all duration-300"
                                style={{ width: `${updateStatus.downloadProgress.percent}%` }}
                            />
                        </div>
                        <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                            {Math.round(updateStatus.downloadProgress.percent)}%
                        </p>
                    </div>
                )}

                {/* Update Downloaded - Ready to Install */}
                {updateStatus.downloaded && (
                    <div className="mb-3">
                        <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                            Update downloaded and ready to install. Restart to apply the update.
                        </p>
                        {updateStatus.releaseNotes && (
                            <div>
                                <button
                                    onClick={() => setShowDetails(!showDetails)}
                                    className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                                >
                                    {showDetails ? 'Hide' : 'Show'} release notes
                                </button>
                                {showDetails && (
                                    <div className="mt-2 p-2 bg-[var(--color-bg-tertiary)] rounded-xl text-xs text-[var(--color-text-secondary)] max-h-24 overflow-y-auto">
                                        {updateStatus.releaseNotes}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Update Available - Not Yet Downloaded */}
                {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                    <div className="mb-3">
                        <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                            A new version is available. Download now to get the latest features and fixes.
                        </p>
                        {updateStatus.releaseNotes && (
                            <div>
                                <button
                                    onClick={() => setShowDetails(!showDetails)}
                                    className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                                >
                                    {showDetails ? 'Hide' : 'Show'} release notes
                                </button>
                                {showDetails && (
                                    <div className="mt-2 p-2 bg-[var(--color-bg-tertiary)] rounded-xl text-xs text-[var(--color-text-secondary)] max-h-24 overflow-y-auto">
                                        {updateStatus.releaseNotes}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                    {/* Install & Restart button when update is downloaded */}
                    {updateStatus.downloaded && (
                        <>
                            <button
                                onClick={handleInstallUpdate}
                                className="flex-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white px-3 py-2 rounded-full text-xs font-semibold font-mono transition-all hover:scale-105 active:scale-95"
                            >
                                Install & Restart
                            </button>
                            <button
                                onClick={handleDismiss}
                                className="px-3 py-2 text-xs font-mono text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                            >
                                Later
                            </button>
                        </>
                    )}

                    {/* Download button when update is available but not downloaded */}
                    {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                        <>
                            <button
                                onClick={handleDownloadUpdate}
                                className="flex-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white px-3 py-2 rounded-full text-xs font-semibold font-mono transition-all hover:scale-105 active:scale-95"
                            >
                                Download Update
                            </button>
                            <button
                                onClick={handleDismiss}
                                className="px-3 py-2 text-xs font-mono text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                            >
                                Later
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;
