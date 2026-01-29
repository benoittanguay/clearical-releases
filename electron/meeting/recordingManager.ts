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
    private isPromptMode: boolean = false;  // When widget is showing "Start timer?" prompt
    private isTimerRunningCallback: (() => boolean) | null = null;  // Callback to check if timer is running

    private constructor() {
        super();
        console.log('[RecordingManager] ========================================');
        console.log('[RecordingManager] CONSTRUCTOR - Initializing RecordingManager');
        console.log('[RecordingManager] ========================================');
        this.audioRecorder = getAudioRecorder();
        this.setupMediaMonitorListeners();
        this.setupWidgetCallback();
        console.log('[RecordingManager] Initialization complete');
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
        widgetManager.setOnPromptAcceptedCallback(() => {
            console.log('[RecordingManager] Prompt accepted from widget');
            this.handlePromptAccepted();
        });
        widgetManager.setOnPromptDismissedCallback(() => {
            console.log('[RecordingManager] Prompt dismissed from widget');
            this.handlePromptDismissed();
        });
    }

    public static getInstance(): RecordingManager {
        if (!RecordingManager.instance) {
            RecordingManager.instance = new RecordingManager();
        }
        return RecordingManager.instance;
    }

    private setupMediaMonitorListeners(): void {
        console.log('[RecordingManager] Setting up MediaMonitor listeners...');
        console.log('[RecordingManager] mediaMonitor available:', !!mediaMonitor);
        console.log('[RecordingManager] mediaMonitor.on available:', typeof mediaMonitor?.on);

        mediaMonitor.on('mic-started', () => {
            console.log('[RecordingManager] >>> MIC-STARTED EVENT RECEIVED <<<');
            this.onMediaStarted('microphone');
        });
        mediaMonitor.on('mic-stopped', () => {
            console.log('[RecordingManager] >>> MIC-STOPPED EVENT RECEIVED <<<');
            this.onMediaStopped('microphone');
        });
        mediaMonitor.on('camera-started', () => {
            console.log('[RecordingManager] >>> CAMERA-STARTED EVENT RECEIVED <<<');
            this.onMediaStarted('camera');
        });
        mediaMonitor.on('camera-stopped', () => {
            console.log('[RecordingManager] >>> CAMERA-STOPPED EVENT RECEIVED <<<');
            this.onMediaStopped('camera');
        });

        console.log('[RecordingManager] MediaMonitor listeners registered');
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

            // Edge case: If prompt was showing and user started timer manually, close prompt
            if (this.isPromptMode) {
                console.log('[RecordingManager] Timer started while prompt showing - closing prompt');
                this.isPromptMode = false;
                const widgetManager = getRecordingWidgetManager();
                widgetManager.close();
            }

            console.log('[RecordingManager] Entry active, checking media:', {
                micInUse,
                cameraInUse,
                mediaInUse,
                meetingApp: this.currentMeetingApp?.appName || null,
                isRendererRecording: this.isRendererRecording
            });

            if (mediaInUse && !this.isRendererRecording) {
                console.log('[RecordingManager] *** MANUAL START: Media in use, starting recording ***');
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
     * Set callback to check if timer is currently running
     * Used to avoid showing prompt when timer is already active
     */
    public setIsTimerRunningCallback(callback: () => boolean): void {
        this.isTimerRunningCallback = callback;
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

        let sentCount = 0;
        for (const win of windows) {
            if (!win.isDestroyed()) {
                const title = win.getTitle();
                const url = win.webContents.getURL();
                const isWidget = url.includes('widget.html');
                console.log(`[RecordingManager] Window: title="${title}", url="${url}", isWidget=${isWidget}`);

                // Send to all windows, but log which ones receive it
                win.webContents.send(channel, ...args);
                sentCount++;
                console.log(`[RecordingManager] Sent ${channel} to window "${title}"`);
            } else {
                console.log(`[RecordingManager] Skipping destroyed window`);
            }
        }
        console.log(`[RecordingManager] Total messages sent: ${sentCount}`);
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
            console.log('[RecordingManager] *** No active entry - showing prompt widget ***');
            this.showPromptWidget();
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
            } else if (this.isPromptMode) {
                // Edge case: Media stopped while prompt was showing - auto-dismiss
                console.log('[RecordingManager] *** ALL MEDIA STOPPED WHILE PROMPT SHOWING - AUTO-DISMISSING ***');
                this.handlePromptDismissed();
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

    /**
     * Show prompt widget asking user to start timer
     */
    private showPromptWidget(): void {
        console.log('[RecordingManager] ========================================');
        console.log('[RecordingManager] showPromptWidget CALLED');
        console.log('[RecordingManager] isPromptMode:', this.isPromptMode);
        console.log('[RecordingManager] currentMeetingApp:', this.currentMeetingApp?.appName || 'null');
        console.log('[RecordingManager] ========================================');

        if (this.isPromptMode) {
            console.log('[RecordingManager] Already in prompt mode, skipping');
            return;
        }

        this.isPromptMode = true;
        const widgetManager = getRecordingWidgetManager();
        console.log('[RecordingManager] Got widgetManager, calling showPrompt...');
        widgetManager.showPrompt(this.currentMeetingApp);
        console.log('[RecordingManager] Prompt widget shown successfully');
    }

    /**
     * Handle user accepting the prompt (clicked "Yes, Start")
     */
    public handlePromptAccepted(): void {
        console.log('[RecordingManager] *** handlePromptAccepted ***');
        this.isPromptMode = false;

        // IMPORTANT: Send request to main app BEFORE closing the widget
        // This ensures the main window receives the message before any window state changes
        console.log('[RecordingManager] Sending request-start-timer to renderer');
        this.sendToRenderer(MEETING_IPC_CHANNELS.REQUEST_START_TIMER, {
            meetingApp: this.currentMeetingApp,
            timestamp: Date.now(),
        });

        // Close the prompt widget after sending the message
        const widgetManager = getRecordingWidgetManager();
        widgetManager.close();
    }

    /**
     * Handle user dismissing the prompt (clicked "Dismiss")
     * User explicitly declined to start recording - respect their choice and don't re-prompt
     */
    public handlePromptDismissed(): void {
        console.log('[RecordingManager] *** handlePromptDismissed - user declined, no re-prompt ***');
        this.isPromptMode = false;

        // Close the widget - user said no, we respect that
        const widgetManager = getRecordingWidgetManager();
        widgetManager.close();
        console.log('[RecordingManager] Prompt dismissed, widget closed');
    }

    /**
     * Check if currently in prompt mode
     */
    public isInPromptMode(): boolean {
        return this.isPromptMode;
    }
}

// Export singleton getter
export function getRecordingManager(): RecordingManager {
    return RecordingManager.getInstance();
}
