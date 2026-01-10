/**
 * Auto-Update Module for TimePortal
 *
 * Implements automatic updates using electron-updater with support for:
 * - Automatic background updates
 * - Manual update checks
 * - Update progress tracking
 * - Error handling and recovery
 * - Platform-specific update strategies (macOS, Windows)
 *
 * Update Flow:
 * 1. Check for updates on app start (configurable delay)
 * 2. Download updates in background
 * 3. Notify user when update is ready
 * 4. Install on next app restart (or immediately if user confirms)
 *
 * Publishing:
 * - Updates are published to GitHub Releases
 * - electron-builder handles code signing and distribution
 */

import pkg from 'electron-updater';
const { autoUpdater } = pkg;
type UpdateInfo = pkg.UpdateInfo;
import { BrowserWindow, app } from 'electron';
import log from 'electron-log';

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

export interface UpdateStatus {
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

export class AutoUpdater {
    private mainWindow: BrowserWindow | null = null;
    private updateStatus: UpdateStatus = {
        available: false,
        downloaded: false,
        downloading: false,
    };

    // Configuration
    private checkOnStartup = true;
    private checkOnStartupDelay = 5000; // 5 seconds after app start
    private autoDownload = true; // Automatically download updates when found
    private allowPrerelease = false; // Only stable releases by default

    // Track intervals for cleanup
    private updateCheckInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.setupAutoUpdater();
    }

    /**
     * Initialize auto-updater with event handlers
     */
    private setupAutoUpdater(): void {
        // Configure auto-updater
        autoUpdater.autoDownload = this.autoDownload;
        autoUpdater.autoInstallOnAppQuit = true; // Install when app quits
        autoUpdater.allowPrerelease = this.allowPrerelease;

        // Event: Checking for updates
        autoUpdater.on('checking-for-update', () => {
            log.info('[AutoUpdater] Checking for updates...');
            this.updateStatus = {
                available: false,
                downloaded: false,
                downloading: false,
            };
            this.sendStatusToRenderer();
        });

        // Event: Update available
        autoUpdater.on('update-available', (info: UpdateInfo) => {
            log.info('[AutoUpdater] Update available:', info.version);
            this.updateStatus = {
                available: true,
                downloaded: false,
                downloading: this.autoDownload,
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes as string | undefined,
            };
            this.sendStatusToRenderer();
        });

        // Event: Update not available
        autoUpdater.on('update-not-available', (info: UpdateInfo) => {
            log.info('[AutoUpdater] No updates available. Current version:', info.version);
            this.updateStatus = {
                available: false,
                downloaded: false,
                downloading: false,
            };
            this.sendStatusToRenderer();
        });

        // Event: Download progress
        autoUpdater.on('download-progress', (progressObj) => {
            log.info(`[AutoUpdater] Download progress: ${progressObj.percent.toFixed(2)}%`);
            this.updateStatus = {
                ...this.updateStatus,
                downloading: true,
                downloadProgress: {
                    percent: progressObj.percent,
                    transferred: progressObj.transferred,
                    total: progressObj.total,
                },
            };
            this.sendStatusToRenderer();
        });

        // Event: Update downloaded
        autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
            log.info('[AutoUpdater] Update downloaded:', info.version);
            this.updateStatus = {
                ...this.updateStatus,
                available: true,
                downloaded: true,
                downloading: false,
                version: info.version,
                releaseDate: info.releaseDate,
                releaseNotes: info.releaseNotes as string | undefined,
            };
            this.sendStatusToRenderer();
        });

        // Event: Error
        autoUpdater.on('error', (error) => {
            log.error('[AutoUpdater] Error:', error);

            // Check if this is a 404 error (repo doesn't exist yet)
            const is404Error =
                error.message.includes('404') ||
                error.message.includes('Not Found') ||
                error.message.includes('net::ERR_HTTP_RESPONSE_CODE_FAILURE');

            if (is404Error) {
                // Silently handle 404 errors - just log and don't notify user
                log.info('[AutoUpdater] Update repo not found (404) - silently ignoring');
                this.updateStatus = {
                    available: false,
                    downloaded: false,
                    downloading: false,
                };
                // Don't send error status to renderer for 404s
                return;
            }

            // For other errors, update status and notify renderer
            this.updateStatus = {
                ...this.updateStatus,
                downloading: false,
                error: error.message,
            };
            this.sendStatusToRenderer();
        });
    }

    /**
     * Set the main window reference for sending updates
     */
    public setMainWindow(window: BrowserWindow | null): void {
        this.mainWindow = window;
    }

    /**
     * Send update status to renderer process
     */
    private sendStatusToRenderer(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('update-status', this.updateStatus);
        }
    }

    /**
     * Start auto-update checks
     * Called after app is ready
     */
    public start(): void {
        // Skip update checks in development
        if (!app.isPackaged) {
            log.info('[AutoUpdater] Skipping update checks in development mode');
            return;
        }

        // Check for updates on startup (with delay)
        if (this.checkOnStartup) {
            setTimeout(() => {
                log.info('[AutoUpdater] Starting automatic update check...');
                this.checkForUpdates();
            }, this.checkOnStartupDelay);
        }

        // Set up periodic checks (every 4 hours)
        this.updateCheckInterval = setInterval(() => {
            log.info('[AutoUpdater] Periodic update check...');
            this.checkForUpdates();
        }, 4 * 60 * 60 * 1000);
    }

    /**
     * Cleanup auto-updater resources
     * Should be called before app quits
     */
    public cleanup(): void {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
            log.info('[AutoUpdater] Update check interval cleared');
        }
    }

    /**
     * Manually check for updates
     * Returns update info if available
     */
    public async checkForUpdates(): Promise<UpdateStatus> {
        try {
            log.info('[AutoUpdater] Manual update check initiated');

            // In development, return mock status
            if (!app.isPackaged) {
                log.info('[AutoUpdater] Development mode - no updates available');
                return {
                    available: false,
                    downloaded: false,
                    downloading: false,
                };
            }

            await autoUpdater.checkForUpdates();
            return this.updateStatus;
        } catch (error) {
            log.error('[AutoUpdater] Error checking for updates:', error);

            // Check if this is a 404 error (repo doesn't exist yet)
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const is404Error =
                errorMessage.includes('404') ||
                errorMessage.includes('Not Found') ||
                errorMessage.includes('net::ERR_HTTP_RESPONSE_CODE_FAILURE');

            if (is404Error) {
                // Silently handle 404 errors - don't set error status
                log.info('[AutoUpdater] Update repo not found (404) - silently ignoring');
                this.updateStatus = {
                    available: false,
                    downloaded: false,
                    downloading: false,
                };
            } else {
                // For other errors, set error status
                this.updateStatus = {
                    ...this.updateStatus,
                    error: errorMessage,
                };
            }
            return this.updateStatus;
        }
    }

    /**
     * Download update (if not auto-downloading)
     */
    public async downloadUpdate(): Promise<void> {
        try {
            log.info('[AutoUpdater] Manual download initiated');

            if (!this.updateStatus.available) {
                throw new Error('No update available to download');
            }

            await autoUpdater.downloadUpdate();
        } catch (error) {
            log.error('[AutoUpdater] Error downloading update:', error);
            throw error;
        }
    }

    /**
     * Install update and restart app
     * WARNING: This will quit the app immediately
     */
    public quitAndInstall(): void {
        if (!this.updateStatus.downloaded) {
            log.warn('[AutoUpdater] No update downloaded to install');
            return;
        }

        log.info('[AutoUpdater] Installing update and restarting...');

        // setImmediate ensures the renderer process has time to handle the event
        setImmediate(() => {
            // false = don't force close windows (allows cleanup)
            // true = quit after install
            autoUpdater.quitAndInstall(false, true);
        });
    }

    /**
     * Get current update status
     */
    public getStatus(): UpdateStatus {
        return { ...this.updateStatus };
    }

    /**
     * Configure auto-updater settings
     */
    public configure(options: {
        checkOnStartup?: boolean;
        checkOnStartupDelay?: number;
        autoDownload?: boolean;
        allowPrerelease?: boolean;
    }): void {
        if (options.checkOnStartup !== undefined) {
            this.checkOnStartup = options.checkOnStartup;
        }
        if (options.checkOnStartupDelay !== undefined) {
            this.checkOnStartupDelay = options.checkOnStartupDelay;
        }
        if (options.autoDownload !== undefined) {
            this.autoDownload = options.autoDownload;
            autoUpdater.autoDownload = options.autoDownload;
        }
        if (options.allowPrerelease !== undefined) {
            this.allowPrerelease = options.allowPrerelease;
            autoUpdater.allowPrerelease = options.allowPrerelease;
        }

        log.info('[AutoUpdater] Configuration updated:', options);
    }
}

// Export singleton instance
export const updater = new AutoUpdater();
