/**
 * Recording Manager
 *
 * Orchestrates media monitoring (mic/camera detection) with audio recording.
 * Recording only happens when:
 * 1. Auto-recording is enabled
 * 2. There's an active time entry
 * 3. Mic or camera is in use
 *
 * The actual audio capture happens in the renderer process using MediaRecorder.
 * This manager coordinates by sending events to the renderer.
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { mediaMonitor } from '../native/index.js';
import { AudioRecorder, getAudioRecorder } from './audioRecorder.js';
import { MEETING_EVENTS, MEETING_IPC_CHANNELS, MeetingAppInfo } from './types.js';
import { getRecordingWidgetManager } from './recordingWidgetManager.js';

export class RecordingManager extends EventEmitter {
    private static instance: RecordingManager | null = null;

    private audioRecorder: AudioRecorder;
    private activeEntryId: string | null = null;
    private isEnabled: boolean = true;
    private isRendererRecording: boolean = false;
    private recordingStartTime: number | null = null;
    private currentMeetingApp: MeetingAppInfo | null = null;

    private constructor() {
        super();
        this.audioRecorder = getAudioRecorder();
        this.setupMediaMonitorListeners();
        this.setupWidgetCallback();
    }

    /**
     * Setup widget stop callback
     */
    private setupWidgetCallback(): void {
        const widgetManager = getRecordingWidgetManager();
        widgetManager.setOnStopCallback(() => {
            console.log('[RecordingManager] Stop requested from widget');
            // Stop recording when user clicks stop in widget
            this.notifyRendererToStopRecording();
            widgetManager.close();
        });
    }

    public static getInstance(): RecordingManager {
        if (!RecordingManager.instance) {
            RecordingManager.instance = new RecordingManager();
        }
        return RecordingManager.instance;
    }

    private setupMediaMonitorListeners(): void {
        mediaMonitor.on('mic-started', () => this.onMediaStarted('microphone'));
        mediaMonitor.on('mic-stopped', () => this.onMediaStopped('microphone'));
        mediaMonitor.on('camera-started', () => this.onMediaStarted('camera'));
        mediaMonitor.on('camera-stopped', () => this.onMediaStopped('camera'));
    }

    /**
     * Start monitoring for media device usage
     */
    public start(): void {
        mediaMonitor.start();
        console.log('[RecordingManager] Started media monitoring');
    }

    /**
     * Stop monitoring
     */
    public stop(): void {
        mediaMonitor.stop();

        // Stop any active recording
        if (this.audioRecorder.isRecording()) {
            this.audioRecorder.stopRecording();
        }

        console.log('[RecordingManager] Stopped media monitoring');
    }

    /**
     * Set the active time entry ID
     * Recording will only happen when an entry is active
     */
    public setActiveEntry(entryId: string | null): void {
        console.log('[RecordingManager] *** setActiveEntry CALLED ***');
        const wasActive = this.activeEntryId !== null;
        const previousEntryId = this.activeEntryId;
        this.activeEntryId = entryId;

        console.log('[RecordingManager] Active entry changed:', {
            from: wasActive ? previousEntryId : 'none',
            to: entryId ? entryId : 'none',
            isRendererRecording: this.isRendererRecording,
        });

        if (entryId) {
            // Entry became active - check if media is already in use
            const micInUse = mediaMonitor.isMicrophoneInUse();
            const cameraInUse = mediaMonitor.isCameraInUse();
            const mediaInUse = mediaMonitor.isMediaInUse();

            // If mic is in use, detect which meeting app is using it
            if (micInUse && !this.currentMeetingApp) {
                this.currentMeetingApp = mediaMonitor.getLikelyMeetingAppUsingMic();
                console.log('[RecordingManager] Detected meeting app:', this.currentMeetingApp);
            }

            console.log('[RecordingManager] Entry active, checking media:', {
                micInUse,
                cameraInUse,
                mediaInUse,
                meetingApp: this.currentMeetingApp?.appName || null,
                isRendererRecording: this.isRendererRecording
            });

            if (mediaInUse && !this.isRendererRecording) {
                console.log('[RecordingManager] Media already in use, starting recording');
                this.startRecording();
            }
        } else {
            console.log('[RecordingManager] Entry stopped - checking if need to stop recording');
            // Entry stopped - stop any active recordings
            if (this.audioRecorder.isRecording()) {
                console.log('[RecordingManager] Stopping audio recorder');
                this.audioRecorder.stopRecording();
            }

            // Also stop renderer recording if active
            // Pass the previous entry ID since we already cleared this.activeEntryId
            if (this.isRendererRecording) {
                console.log('[RecordingManager] *** ENTRY STOPPED WHILE RECORDING - STOPPING RENDERER AND WIDGET ***');
                this.notifyRendererToStopRecording(previousEntryId);
            } else {
                console.log('[RecordingManager] Entry stopped but not recording, nothing to stop');
            }
        }
    }

    /**
     * Get the active entry ID
     */
    public getActiveEntry(): string | null {
        return this.activeEntryId;
    }

    /**
     * Enable/disable auto-recording
     */
    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        console.log('[RecordingManager] Auto-recording enabled:', enabled);

        if (!enabled && this.audioRecorder.isRecording()) {
            this.audioRecorder.stopRecording();
        }
    }

    /**
     * Check if auto-recording is enabled
     */
    public isAutoRecordingEnabled(): boolean {
        return this.isEnabled;
    }

    /**
     * Get current media status
     */
    public getMediaStatus(): { micInUse: boolean; cameraInUse: boolean; isRecording: boolean; meetingApp: MeetingAppInfo | null } {
        return {
            micInUse: mediaMonitor.isMicrophoneInUse(),
            cameraInUse: mediaMonitor.isCameraInUse(),
            isRecording: this.isRendererRecording,
            meetingApp: this.currentMeetingApp
        };
    }

    /**
     * Get current meeting app info
     */
    public getCurrentMeetingApp(): MeetingAppInfo | null {
        return this.currentMeetingApp;
    }

    /**
     * Get list of running meeting apps
     */
    public getRunningMeetingApps(): MeetingAppInfo[] {
        return mediaMonitor.getRunningMeetingApps();
    }

    /**
     * Send event to all renderer windows
     */
    private sendToRenderer(channel: string, ...args: any[]): void {
        const windows = BrowserWindow.getAllWindows();
        console.log(`[RecordingManager] sendToRenderer: channel=${channel}, args=`, args);
        console.log(`[RecordingManager] Found ${windows.length} windows`);

        for (const win of windows) {
            if (!win.isDestroyed()) {
                const title = win.getTitle();
                const url = win.webContents.getURL();
                console.log(`[RecordingManager] Sending to window: title="${title}", url="${url}"`);
                win.webContents.send(channel, ...args);
            }
        }
    }

    /**
     * Notify renderer that recording should start
     */
    private notifyRendererToStartRecording(): void {
        if (!this.activeEntryId) {
            console.log('[RecordingManager] Cannot start recording - no active entry ID');
            return;
        }

        this.isRendererRecording = true;
        this.recordingStartTime = Date.now();

        console.log('[RecordingManager] *** NOTIFYING RENDERER TO START RECORDING ***');
        console.log('[RecordingManager] Entry ID:', this.activeEntryId);
        console.log('[RecordingManager] Meeting app:', this.currentMeetingApp?.appName || 'Unknown');
        console.log('[RecordingManager] Channel:', MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_START);
        this.sendToRenderer(MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_START, {
            entryId: this.activeEntryId,
            timestamp: this.recordingStartTime,
            meetingApp: this.currentMeetingApp,
        });
        console.log('[RecordingManager] Start event sent to all renderer windows');

        // Show the recording widget
        const widgetManager = getRecordingWidgetManager();
        widgetManager.show();

        this.emit(MEETING_EVENTS.RECORDING_STARTED, {
            entryId: this.activeEntryId,
            timestamp: this.recordingStartTime,
            meetingApp: this.currentMeetingApp,
        });
    }

    /**
     * Notify renderer that recording should stop
     * @param overrideEntryId Optional entry ID to use instead of activeEntryId (useful when entry is being cleared)
     */
    private notifyRendererToStopRecording(overrideEntryId?: string | null): void {
        console.log('[RecordingManager] *** notifyRendererToStopRecording CALLED ***');
        console.log('[RecordingManager] Current state:', {
            isRendererRecording: this.isRendererRecording,
            overrideEntryId,
            activeEntryId: this.activeEntryId,
            meetingApp: this.currentMeetingApp?.appName || null
        });

        if (!this.isRendererRecording) {
            console.log('[RecordingManager] Not recording, nothing to stop');
            return;
        }

        const duration = this.recordingStartTime ? Date.now() - this.recordingStartTime : 0;
        // Use override if provided, otherwise use current activeEntryId
        const entryId = overrideEntryId !== undefined ? overrideEntryId : this.activeEntryId;
        const meetingApp = this.currentMeetingApp;

        console.log('[RecordingManager] Sending stop event to renderer:', { entryId, duration, meetingApp: meetingApp?.appName });
        this.sendToRenderer(MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_STOP, {
            entryId,
            duration,
            meetingApp,
        });

        // Close the recording widget
        console.log('[RecordingManager] Closing recording widget...');
        const widgetManager = getRecordingWidgetManager();
        widgetManager.close();
        console.log('[RecordingManager] Widget close() called');

        this.isRendererRecording = false;
        this.recordingStartTime = null;
        // Keep currentMeetingApp until next meeting starts (for reference)

        this.emit(MEETING_EVENTS.RECORDING_STOPPED, {
            entryId,
            duration,
            meetingApp,
        });
        console.log('[RecordingManager] Recording stopped, state reset');
    }

    private onMediaStarted(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] ========================================`);
        console.log(`[RecordingManager] *** onMediaStarted CALLBACK: ${device} ***`);
        console.log(`[RecordingManager] ========================================`);

        // Detect which meeting app is using the mic
        if (device === 'microphone') {
            this.currentMeetingApp = mediaMonitor.getLikelyMeetingAppUsingMic();
            console.log(`[RecordingManager] Detected meeting app:`, this.currentMeetingApp);
        }

        console.log(`[RecordingManager] Current state:`, {
            isEnabled: this.isEnabled,
            activeEntryId: this.activeEntryId,
            isRendererRecording: this.isRendererRecording,
            micInUse: mediaMonitor.isMicrophoneInUse(),
            cameraInUse: mediaMonitor.isCameraInUse(),
            meetingApp: this.currentMeetingApp?.appName || null,
        });

        this.emit(MEETING_EVENTS.MEDIA_STARTED, { device, meetingApp: this.currentMeetingApp });

        // Only start recording if:
        // 1. Auto-recording is enabled
        // 2. There's an active entry
        // 3. We're not already recording
        if (!this.isEnabled) {
            console.log('[RecordingManager] *** SKIPPING: Auto-recording disabled ***');
            return;
        }

        if (!this.activeEntryId) {
            console.log('[RecordingManager] *** SKIPPING: No active entry ***');
            return;
        }

        if (this.isRendererRecording) {
            console.log('[RecordingManager] *** SKIPPING: Already recording ***');
            return;
        }

        console.log('[RecordingManager] *** ALL CONDITIONS MET - Starting recording ***');
        this.notifyRendererToStartRecording();
    }

    private onMediaStopped(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] *** ${device.toUpperCase()} STOPPED ***`);

        const previousMeetingApp = this.currentMeetingApp;

        // Clear meeting app when mic stops
        if (device === 'microphone') {
            this.currentMeetingApp = null;
            console.log('[RecordingManager] Cleared meeting app info');
        }

        this.emit(MEETING_EVENTS.MEDIA_STOPPED, { device, meetingApp: previousMeetingApp });

        const micInUse = mediaMonitor.isMicrophoneInUse();
        const cameraInUse = mediaMonitor.isCameraInUse();

        console.log('[RecordingManager] Media state after stop:', {
            device,
            micInUse,
            cameraInUse,
            isRendererRecording: this.isRendererRecording
        });

        // Only stop recording if BOTH mic and camera are inactive
        if (!micInUse && !cameraInUse) {
            if (this.isRendererRecording) {
                console.log('[RecordingManager] *** ALL MEDIA STOPPED - STOPPING RECORDING AND CLOSING WIDGET ***');
                this.notifyRendererToStopRecording();
            } else {
                console.log('[RecordingManager] All media stopped but not recording, nothing to stop');
            }
        } else {
            console.log('[RecordingManager] Other media still active, continuing recording');
        }
    }

    private async startRecording(): Promise<void> {
        if (!this.activeEntryId) {
            console.error('[RecordingManager] Cannot start recording without active entry');
            return;
        }

        // Now we just notify the renderer to start capturing
        this.notifyRendererToStartRecording();
    }
}

// Export singleton getter
export function getRecordingManager(): RecordingManager {
    return RecordingManager.getInstance();
}
