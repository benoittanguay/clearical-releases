/**
 * Audio Recorder Service
 *
 * Coordinates audio recording between main and renderer processes.
 * Uses ScreenCaptureKit (via desktopCapturer) for system audio
 * and getUserMedia for microphone audio.
 *
 * Note: Actual MediaRecorder runs in renderer; this service manages
 * the recording lifecycle and file storage.
 */

import { app, desktopCapturer, systemPreferences } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
    MeetingPlatform,
    AudioRecordingConfig,
    RecordingStatus,
    RecordingResult,
    DEFAULT_AUDIO_CONFIG,
    MEETING_EVENTS,
} from './types.js';

/**
 * Directory for temporary meeting recordings
 */
const RECORDINGS_DIR = path.join(app.getPath('userData'), 'meeting-recordings');

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

/**
 * Audio Recorder Service
 *
 * Singleton service that manages audio recording for meetings.
 * The actual recording is done in the renderer process via MediaRecorder API.
 */
export class AudioRecorder extends EventEmitter {
    private static instance: AudioRecorder | null = null;

    private status: RecordingStatus = {
        isRecording: false,
        recordingId: null,
        entryId: null,
        platform: null,
        startedAt: null,
        duration: 0,
        filePath: null,
        fileSize: 0,
    };

    private config: AudioRecordingConfig = { ...DEFAULT_AUDIO_CONFIG };
    private durationInterval: NodeJS.Timeout | null = null;

    private constructor() {
        super();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): AudioRecorder {
        if (!AudioRecorder.instance) {
            AudioRecorder.instance = new AudioRecorder();
        }
        return AudioRecorder.instance;
    }

    /**
     * Get current recording status
     */
    public getStatus(): RecordingStatus {
        return { ...this.status };
    }

    /**
     * Check if currently recording
     */
    public isRecording(): boolean {
        return this.status.isRecording;
    }

    /**
     * Get recording configuration
     */
    public getConfig(): AudioRecordingConfig {
        return { ...this.config };
    }

    /**
     * Update recording configuration
     */
    public setConfig(config: Partial<AudioRecordingConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Check if screen recording permission is granted (for system audio)
     */
    public async checkScreenRecordingPermission(): Promise<boolean> {
        if (process.platform !== 'darwin') {
            return true;
        }

        const status = systemPreferences.getMediaAccessStatus('screen');
        console.log('[AudioRecorder] Screen recording permission status:', status);
        return status === 'granted';
    }

    /**
     * Check if microphone permission is granted
     */
    public async checkMicrophonePermission(): Promise<boolean> {
        if (process.platform !== 'darwin') {
            return true;
        }

        const status = systemPreferences.getMediaAccessStatus('microphone');
        console.log('[AudioRecorder] Microphone permission status:', status);
        return status === 'granted';
    }

    /**
     * Request microphone permission
     */
    public async requestMicrophonePermission(): Promise<boolean> {
        if (process.platform !== 'darwin') {
            return true;
        }

        try {
            const granted = await systemPreferences.askForMediaAccess('microphone');
            console.log('[AudioRecorder] Microphone permission request result:', granted);
            return granted;
        } catch (error) {
            console.error('[AudioRecorder] Failed to request microphone permission:', error);
            return false;
        }
    }

    /**
     * Get screen capture source for system audio
     * Returns the source ID that the renderer can use with getUserMedia
     */
    public async getSystemAudioSourceId(): Promise<string | null> {
        try {
            // Get display sources with audio support
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
            });

            if (sources.length > 0) {
                console.log('[AudioRecorder] Found screen source for audio:', sources[0].id);
                return sources[0].id;
            }

            console.warn('[AudioRecorder] No screen sources found');
            return null;
        } catch (error) {
            console.error('[AudioRecorder] Failed to get system audio source:', error);
            return null;
        }
    }

    /**
     * Start recording
     *
     * This initializes the recording state. The actual recording
     * will be triggered in the renderer via IPC.
     */
    public async startRecording(
        entryId: string,
        platform: MeetingPlatform
    ): Promise<{ success: boolean; recordingId?: string; filePath?: string; error?: string }> {
        if (this.status.isRecording) {
            return { success: false, error: 'Already recording' };
        }

        // Check permissions
        const hasMicPermission = await this.checkMicrophonePermission();
        const hasScreenPermission = await this.checkScreenRecordingPermission();

        if (!hasMicPermission && this.config.captureMicrophone) {
            console.warn('[AudioRecorder] No microphone permission, will try to record system audio only');
        }

        if (!hasScreenPermission && this.config.captureSystemAudio) {
            console.warn('[AudioRecorder] No screen recording permission, will try to record microphone only');
        }

        if (!hasMicPermission && !hasScreenPermission) {
            return { success: false, error: 'No audio capture permissions' };
        }

        const recordingId = crypto.randomUUID();
        const timestamp = Date.now();
        const platformSafe = platform.replace(/[\/\\:*?"<>|]/g, '_');
        const filename = `${timestamp}___${recordingId}___${platformSafe}.webm`;
        const filePath = path.join(RECORDINGS_DIR, filename);

        this.status = {
            isRecording: true,
            recordingId,
            entryId,
            platform,
            startedAt: timestamp,
            duration: 0,
            filePath,
            fileSize: 0,
        };

        // Start duration tracking
        this.durationInterval = setInterval(() => {
            if (this.status.startedAt) {
                this.status.duration = Date.now() - this.status.startedAt;
            }
        }, 1000);

        this.emit(MEETING_EVENTS.RECORDING_STARTED, {
            recordingId,
            entryId,
            platform,
            timestamp,
        });

        console.log('[AudioRecorder] Recording started:', {
            recordingId,
            entryId,
            platform,
            filePath,
        });

        return { success: true, recordingId, filePath };
    }

    /**
     * Save audio data to file
     *
     * Called from renderer with audio chunks
     */
    public async saveAudioChunk(
        recordingId: string,
        chunk: Buffer
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.status.isRecording || this.status.recordingId !== recordingId) {
            return { success: false, error: 'Recording not active or ID mismatch' };
        }

        if (!this.status.filePath) {
            return { success: false, error: 'No file path set' };
        }

        try {
            await fs.promises.appendFile(this.status.filePath, chunk);
            this.status.fileSize += chunk.length;
            return { success: true };
        } catch (error) {
            console.error('[AudioRecorder] Failed to save audio chunk:', error);
            return { success: false, error: String(error) };
        }
    }

    /**
     * Write complete audio blob to file
     */
    public async writeAudioFile(
        recordingId: string,
        audioData: Buffer
    ): Promise<{ success: boolean; error?: string }> {
        if (this.status.recordingId !== recordingId) {
            return { success: false, error: 'Recording ID mismatch' };
        }

        if (!this.status.filePath) {
            return { success: false, error: 'No file path set' };
        }

        try {
            await fs.promises.writeFile(this.status.filePath, audioData);
            this.status.fileSize = audioData.length;
            console.log('[AudioRecorder] Audio file written:', {
                path: this.status.filePath,
                size: audioData.length,
            });
            return { success: true };
        } catch (error) {
            console.error('[AudioRecorder] Failed to write audio file:', error);
            return { success: false, error: String(error) };
        }
    }

    /**
     * Stop recording
     */
    public async stopRecording(): Promise<RecordingResult> {
        if (!this.status.isRecording) {
            return {
                success: false,
                recordingId: '',
                filePath: '',
                duration: 0,
                fileSize: 0,
                startTime: 0,
                endTime: 0,
                platform: 'Zoom',
                error: 'Not recording',
            };
        }

        // Stop duration tracking
        if (this.durationInterval) {
            clearInterval(this.durationInterval);
            this.durationInterval = null;
        }

        const endTime = Date.now();
        const result: RecordingResult = {
            success: true,
            recordingId: this.status.recordingId!,
            filePath: this.status.filePath!,
            duration: this.status.duration,
            fileSize: this.status.fileSize,
            startTime: this.status.startedAt!,
            endTime,
            platform: this.status.platform!,
        };

        console.log('[AudioRecorder] Recording stopped:', result);

        this.emit(MEETING_EVENTS.RECORDING_STOPPED, result);

        // Reset status
        this.status = {
            isRecording: false,
            recordingId: null,
            entryId: null,
            platform: null,
            startedAt: null,
            duration: 0,
            filePath: null,
            fileSize: 0,
        };

        return result;
    }

    /**
     * Delete a recording file
     */
    public async deleteRecording(filePath: string): Promise<boolean> {
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                console.log('[AudioRecorder] Deleted recording:', filePath);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[AudioRecorder] Failed to delete recording:', error);
            return false;
        }
    }

    /**
     * Get recordings directory path
     */
    public getRecordingsDir(): string {
        return RECORDINGS_DIR;
    }

    /**
     * Clean up old recordings (called periodically)
     *
     * @param maxAgeMs Maximum age in milliseconds (default: 1 hour)
     */
    public async cleanupOldRecordings(maxAgeMs: number = 3600000): Promise<number> {
        let deletedCount = 0;

        try {
            const files = await fs.promises.readdir(RECORDINGS_DIR);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(RECORDINGS_DIR, file);
                const stats = await fs.promises.stat(filePath);

                if (now - stats.mtimeMs > maxAgeMs) {
                    await fs.promises.unlink(filePath);
                    deletedCount++;
                    console.log('[AudioRecorder] Cleaned up old recording:', file);
                }
            }
        } catch (error) {
            console.error('[AudioRecorder] Failed to cleanup old recordings:', error);
        }

        return deletedCount;
    }
}

// Export singleton getter for convenience
export function getAudioRecorder(): AudioRecorder {
    return AudioRecorder.getInstance();
}
