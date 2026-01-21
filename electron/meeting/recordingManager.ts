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
import { MEETING_EVENTS, MEETING_IPC_CHANNELS, MeetingPlatform } from './types.js';

export class RecordingManager extends EventEmitter {
    private static instance: RecordingManager | null = null;

    private audioRecorder: AudioRecorder;
    private activeEntryId: string | null = null;
    private isEnabled: boolean = true;
    private isRendererRecording: boolean = false;
    private recordingStartTime: number | null = null;

    private constructor() {
        super();
        this.audioRecorder = getAudioRecorder();
        this.setupMediaMonitorListeners();
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
        const wasActive = this.activeEntryId !== null;
        this.activeEntryId = entryId;

        console.log('[RecordingManager] Active entry changed:', {
            from: wasActive ? 'active' : 'none',
            to: entryId ? entryId : 'none'
        });

        if (entryId) {
            // Entry became active - check if media is already in use
            if (mediaMonitor.isMediaInUse() && !this.audioRecorder.isRecording()) {
                this.startRecording();
            }
        } else {
            // Entry stopped - stop any recording
            if (this.audioRecorder.isRecording()) {
                this.audioRecorder.stopRecording();
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
    public getMediaStatus(): { micInUse: boolean; cameraInUse: boolean; isRecording: boolean } {
        return {
            micInUse: mediaMonitor.isMicrophoneInUse(),
            cameraInUse: mediaMonitor.isCameraInUse(),
            isRecording: this.isRendererRecording
        };
    }

    /**
     * Send event to all renderer windows
     */
    private sendToRenderer(channel: string, ...args: any[]): void {
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (!win.isDestroyed()) {
                win.webContents.send(channel, ...args);
            }
        }
    }

    /**
     * Notify renderer that recording should start
     */
    private notifyRendererToStartRecording(): void {
        if (!this.activeEntryId) return;

        this.isRendererRecording = true;
        this.recordingStartTime = Date.now();

        console.log('[RecordingManager] Notifying renderer to start recording');
        this.sendToRenderer(MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_START, {
            entryId: this.activeEntryId,
            timestamp: this.recordingStartTime,
        });

        this.emit(MEETING_EVENTS.RECORDING_STARTED, {
            entryId: this.activeEntryId,
            timestamp: this.recordingStartTime,
        });
    }

    /**
     * Notify renderer that recording should stop
     */
    private notifyRendererToStopRecording(): void {
        if (!this.isRendererRecording) return;

        const duration = this.recordingStartTime ? Date.now() - this.recordingStartTime : 0;
        const entryId = this.activeEntryId;

        console.log('[RecordingManager] Notifying renderer to stop recording, duration:', duration);
        this.sendToRenderer(MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_STOP, {
            entryId,
            duration,
        });

        this.isRendererRecording = false;
        this.recordingStartTime = null;

        this.emit(MEETING_EVENTS.RECORDING_STOPPED, {
            entryId,
            duration,
        });
    }

    private onMediaStarted(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] ${device} started`);

        this.emit(MEETING_EVENTS.MEDIA_STARTED, { device });

        // Only start recording if:
        // 1. Auto-recording is enabled
        // 2. There's an active entry
        // 3. We're not already recording
        if (!this.isEnabled) {
            console.log('[RecordingManager] Auto-recording disabled, skipping');
            return;
        }

        if (!this.activeEntryId) {
            console.log('[RecordingManager] No active entry, skipping recording');
            return;
        }

        if (this.isRendererRecording) {
            console.log('[RecordingManager] Already recording, continuing');
            return;
        }

        this.notifyRendererToStartRecording();
    }

    private onMediaStopped(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] ${device} stopped`);

        this.emit(MEETING_EVENTS.MEDIA_STOPPED, { device });

        // Only stop recording if BOTH mic and camera are inactive
        if (!mediaMonitor.isMicrophoneInUse() && !mediaMonitor.isCameraInUse()) {
            if (this.isRendererRecording) {
                console.log('[RecordingManager] All media stopped, stopping recording');
                this.notifyRendererToStopRecording();
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
