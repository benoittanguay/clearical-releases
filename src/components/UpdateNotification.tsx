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

        // Get initial status
        getStatus();

        return () => {
            if (unsubscribe) unsubscribe();
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
            await window.electron.ipcRenderer.updater.downloadUpdate();
        } catch (error) {
            console.error('[UpdateNotification] Failed to download update:', error);
        }
    };

    const handleInstallUpdate = async () => {
        try {
            await window.electron.ipcRenderer.updater.quitAndInstall();
        } catch (error) {
            console.error('[UpdateNotification] Failed to install update:', error);
        }
    };

    const handleDismiss = () => {
        setDismissed(true);
        if (onClose) onClose();
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    // Don't show anything if dismissed or no update available
    if (dismissed || (!updateStatus.available && !updateStatus.error && !showManualCheck)) {
        return null;
    }

    return (
        <div className="fixed bottom-4 right-4 max-w-sm bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Accent bar at top */}
            <div className={`h-1 ${updateStatus.downloaded ? 'bg-green-500' : updateStatus.error ? 'bg-red-500' : 'bg-blue-500'}`} />

            <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 ${
                            updateStatus.downloaded ? 'bg-green-500/20' : updateStatus.error ? 'bg-red-500/20' : 'bg-blue-500/20'
                        }`}>
                            {updateStatus.downloaded ? (
                                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                            )}
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-white">
                                {updateStatus.downloaded
                                    ? 'Update Ready'
                                    : updateStatus.downloading
                                    ? 'Downloading Update'
                                    : updateStatus.available
                                    ? 'Update Available'
                                    : 'Software Updates'}
                            </h3>
                            {updateStatus.version && (
                                <p className="text-xs text-gray-400">v{updateStatus.version}</p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Error State */}
                {updateStatus.error && (
                    <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                        <p className="text-xs text-red-400">{updateStatus.error}</p>
                    </div>
                )}

                {/* Update Available */}
                {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                    <div className="mb-3">
                        <p className="text-xs text-gray-400 mb-2">
                            A new version is ready to download.
                        </p>
                        {updateStatus.releaseNotes && (
                            <div>
                                <button
                                    onClick={() => setShowDetails(!showDetails)}
                                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    {showDetails ? 'Hide' : 'Show'} release notes
                                </button>
                                {showDetails && (
                                    <div className="mt-2 p-2 bg-gray-900/50 rounded-lg text-xs text-gray-400 max-h-24 overflow-y-auto">
                                        {updateStatus.releaseNotes}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Downloading State */}
                {updateStatus.downloading && updateStatus.downloadProgress && (
                    <div className="mb-3">
                        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                            <span>Downloading...</span>
                            <span>
                                {formatBytes(updateStatus.downloadProgress.transferred)} / {formatBytes(updateStatus.downloadProgress.total)}
                            </span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                            <div
                                className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${updateStatus.downloadProgress.percent}%` }}
                            />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {Math.round(updateStatus.downloadProgress.percent)}% complete
                        </p>
                    </div>
                )}

                {/* Downloaded State */}
                {updateStatus.downloaded && (
                    <p className="text-xs text-gray-400 mb-3">
                        Ready to install. The app will restart to complete the update.
                    </p>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                    {updateStatus.downloaded && (
                        <button
                            onClick={handleInstallUpdate}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                        >
                            Restart & Install
                        </button>
                    )}

                    {updateStatus.available && !updateStatus.downloaded && !updateStatus.downloading && (
                        <button
                            onClick={handleDownloadUpdate}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                        >
                            Download
                        </button>
                    )}

                    {(updateStatus.available || updateStatus.downloading) && !updateStatus.downloaded && (
                        <button
                            onClick={handleDismiss}
                            className="px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
                        >
                            Later
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UpdateNotification;
