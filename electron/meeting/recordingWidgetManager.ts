/**
 * Recording Widget Manager
 *
 * Manages the floating recording widget window that appears when
 * audio recording is active. Shows waveform visualization and
 * allows the user to stop the recording.
 */

import { BrowserWindow, screen, ipcMain, app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Widget dimensions
const WIDGET_WIDTH = 420;
const WIDGET_HEIGHT = 80;
const WIDGET_MARGIN_TOP = 16;

/**
 * Recording Widget Manager
 *
 * Singleton that manages the recording widget window lifecycle.
 */
export class RecordingWidgetManager {
    private static instance: RecordingWidgetManager | null = null;
    private widgetWindow: BrowserWindow | null = null;
    private isShowing = false;
    private onStopCallback: (() => void) | null = null;

    private constructor() {
        this.registerIpcHandlers();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): RecordingWidgetManager {
        if (!RecordingWidgetManager.instance) {
            RecordingWidgetManager.instance = new RecordingWidgetManager();
        }
        return RecordingWidgetManager.instance;
    }

    /**
     * Register IPC handlers for widget communication
     */
    private registerIpcHandlers(): void {
        // Handle stop recording request from widget
        ipcMain.on('widget:stop-recording', () => {
            console.log('[RecordingWidgetManager] Stop recording requested from widget');
            console.log('[RecordingWidgetManager] onStopCallback is set:', !!this.onStopCallback);
            if (this.onStopCallback) {
                try {
                    this.onStopCallback();
                    console.log('[RecordingWidgetManager] Stop callback executed successfully');
                } catch (error) {
                    console.error('[RecordingWidgetManager] Error in stop callback:', error);
                }
            } else {
                console.warn('[RecordingWidgetManager] No stop callback registered!');
            }
        });

        // Handle minimize request from widget
        ipcMain.on('widget:minimize', () => {
            console.log('[RecordingWidgetManager] Minimize requested from widget');
            this.hide();
        });

        // Handle ping from widget to verify IPC is working
        ipcMain.on('widget:ping', (_event, data) => {
            console.log('[RecordingWidgetManager] *** WIDGET PING RECEIVED ***', data);
            console.log('[RecordingWidgetManager] This confirms preload is loaded and IPC is working!');
        });

        console.log('[RecordingWidgetManager] IPC handlers registered');
    }

    /**
     * Set callback for when user clicks stop in widget
     */
    public setOnStopCallback(callback: () => void): void {
        this.onStopCallback = callback;
    }

    /**
     * Show the recording widget
     */
    public show(): void {
        if (this.isShowing && this.widgetWindow && !this.widgetWindow.isDestroyed()) {
            this.widgetWindow.show();
            return;
        }

        this.createWindow();
        this.isShowing = true;
    }

    /**
     * Hide the recording widget
     */
    public hide(): void {
        if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
            this.widgetWindow.hide();
        }
        this.isShowing = false;
    }

    /**
     * Close and destroy the recording widget
     */
    public close(): void {
        console.log('[RecordingWidgetManager] close() called');
        console.log('[RecordingWidgetManager] widgetWindow exists:', !!this.widgetWindow);
        console.log('[RecordingWidgetManager] widgetWindow destroyed:', this.widgetWindow?.isDestroyed());

        if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
            console.log('[RecordingWidgetManager] Closing widget window...');
            this.widgetWindow.close();
            this.widgetWindow = null;
            console.log('[RecordingWidgetManager] Widget window closed and nulled');
        } else {
            console.log('[RecordingWidgetManager] Widget window already closed or null');
        }
        this.isShowing = false;
    }

    /**
     * Send audio level data to the widget for visualization
     */
    private audioLevelsSentCount = 0;
    public sendAudioLevels(levels: number[]): void {
        if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
            this.audioLevelsSentCount++;
            if (this.audioLevelsSentCount <= 3 || this.audioLevelsSentCount % 100 === 0) {
                console.log('[RecordingWidgetManager] Sending audio levels to widget, count:', this.audioLevelsSentCount);
            }
            this.widgetWindow.webContents.send('widget:audio-levels', {
                levels,
                timestamp: Date.now(),
            });
        } else {
            if (this.audioLevelsSentCount === 0) {
                console.warn('[RecordingWidgetManager] Cannot send audio levels - widget window not available');
                this.audioLevelsSentCount = -1; // Only log once
            }
        }
    }

    /**
     * Create the widget window
     */
    private createWindow(): void {
        // Get the primary display
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth } = primaryDisplay.workAreaSize;

        // Position at top center of screen
        const x = Math.round((screenWidth - WIDGET_WIDTH) / 2);
        const y = WIDGET_MARGIN_TOP;

        // Determine the preload script path
        const preloadPath = path.join(__dirname, '..', 'preload.cjs');
        console.log('[RecordingWidgetManager] __dirname:', __dirname);
        console.log('[RecordingWidgetManager] Resolved preload path:', preloadPath);

        // Verify preload exists (for debugging)
        try {
            const fs = require('fs');
            const exists = fs.existsSync(preloadPath);
            console.log('[RecordingWidgetManager] Preload file exists:', exists);
        } catch (e) {
            console.log('[RecordingWidgetManager] Could not check preload existence:', e);
        }

        this.widgetWindow = new BrowserWindow({
            width: WIDGET_WIDTH,
            height: WIDGET_HEIGHT,
            x,
            y,
            frame: false,
            transparent: true,
            resizable: false,
            movable: true,
            minimizable: false,
            maximizable: false,
            closable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            hasShadow: true,
            show: false,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        // Set window level to float above other windows (macOS)
        if (process.platform === 'darwin') {
            this.widgetWindow.setAlwaysOnTop(true, 'floating');
            this.widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }

        // Load the widget HTML
        if (process.env.VITE_DEV_SERVER_URL) {
            // Development: load from Vite dev server
            this.widgetWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}widget.html`);
        } else {
            // Production: load from built files
            const widgetPath = path.join(process.env.DIST || '', 'widget.html');
            this.widgetWindow.loadFile(widgetPath);
        }

        // Show window once ready
        this.widgetWindow.once('ready-to-show', () => {
            if (this.widgetWindow && !this.widgetWindow.isDestroyed()) {
                this.widgetWindow.show();
                // Open devtools in dev mode to see widget console logs
                if (process.env.VITE_DEV_SERVER_URL) {
                    this.widgetWindow.webContents.openDevTools({ mode: 'detach' });
                }
            }
        });

        // Log when widget loads and preload status
        this.widgetWindow.webContents.on('did-finish-load', () => {
            console.log('[RecordingWidgetManager] Widget finished loading');
            console.log('[RecordingWidgetManager] Preload path was:', preloadPath);
        });

        this.widgetWindow.webContents.on('preload-error', (event, preloadPath, error) => {
            console.error('[RecordingWidgetManager] Preload error:', preloadPath, error);
        });

        // Handle window closed
        this.widgetWindow.on('closed', () => {
            this.widgetWindow = null;
            this.isShowing = false;
        });

        console.log('[RecordingWidgetManager] Widget window created');
    }

    /**
     * Check if widget is currently showing
     */
    public isVisible(): boolean {
        return this.isShowing && this.widgetWindow !== null && !this.widgetWindow.isDestroyed();
    }
}

// Export singleton getter
export function getRecordingWidgetManager(): RecordingWidgetManager {
    return RecordingWidgetManager.getInstance();
}
