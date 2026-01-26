/**
 * Apple Speech Transcriber
 *
 * Wraps Apple's on-device SpeechAnalyzer/SFSpeechRecognizer for transcription.
 * Used as the primary transcription engine for free-tier users.
 *
 * Requirements:
 * - macOS 10.15+ (Catalina) for SFSpeechRecognizer
 * - macOS 13+ (Ventura) for on-device recognition
 * - Speech Recognition permission granted
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { TranscriptionResult, TranscriptionSegment } from './types.js';

/**
 * Native module interface for speech transcription
 */
interface NativeSpeechModule {
    isSpeechTranscriptionAvailable: () => boolean;
    getSupportedTranscriptionLanguages: () => string[];
    transcribeAudioFile: (filePath: string, language?: string) => {
        success: boolean;
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
        }>;
        error?: string;
    };
    transcribeAudioBuffer: (buffer: Float32Array, sampleRate: number, language?: string) => {
        success: boolean;
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
        }>;
        error?: string;
    };
}

/**
 * Apple Speech Transcriber
 *
 * Provides on-device transcription using Apple's Speech framework.
 */
export class AppleTranscriber {
    private static instance: AppleTranscriber | null = null;
    private nativeModule: NativeSpeechModule | null = null;
    private available: boolean = false;
    private availabilityChecked: boolean = false;

    private constructor() {
        this.loadNativeModule();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): AppleTranscriber {
        if (!AppleTranscriber.instance) {
            AppleTranscriber.instance = new AppleTranscriber();
        }
        return AppleTranscriber.instance;
    }

    /**
     * Load the native module
     */
    private loadNativeModule(): void {
        try {
            // Try different paths for the native module
            const possiblePaths = [
                // Development path
                path.join(app.getAppPath(), 'electron', 'native', 'build', 'Release', 'media_monitor.node'),
                // Production path (unpacked from asar)
                path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'build', 'Release', 'media_monitor.node'),
                // Alternative production path
                path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'electron', 'native', 'build', 'Release', 'media_monitor.node'),
            ];

            for (const modulePath of possiblePaths) {
                if (fs.existsSync(modulePath)) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    this.nativeModule = require(modulePath) as NativeSpeechModule;
                    console.log('[AppleTranscriber] Native module loaded from:', modulePath);
                    return;
                }
            }

            console.warn('[AppleTranscriber] Native module not found at any expected path');
        } catch (error) {
            console.error('[AppleTranscriber] Failed to load native module:', error);
        }
    }

    /**
     * Check if Apple transcription is available on this system
     *
     * Returns true if:
     * - macOS 10.15+ (for SFSpeechRecognizer)
     * - Speech Recognition permission granted
     * - Native module loaded successfully
     */
    public isAvailable(): boolean {
        if (this.availabilityChecked) {
            return this.available;
        }

        this.availabilityChecked = true;

        if (!this.nativeModule) {
            console.log('[AppleTranscriber] Not available: native module not loaded');
            this.available = false;
            return false;
        }

        try {
            this.available = this.nativeModule.isSpeechTranscriptionAvailable();
            console.log('[AppleTranscriber] Availability check:', this.available);
            return this.available;
        } catch (error) {
            console.error('[AppleTranscriber] Availability check failed:', error);
            this.available = false;
            return false;
        }
    }

    /**
     * Reset the availability cache (useful after permission changes)
     */
    public resetAvailabilityCache(): void {
        this.availabilityChecked = false;
    }

    /**
     * Get supported language codes
     */
    public getSupportedLanguages(): string[] {
        if (!this.nativeModule) {
            return [];
        }

        try {
            return this.nativeModule.getSupportedTranscriptionLanguages();
        } catch (error) {
            console.error('[AppleTranscriber] Failed to get supported languages:', error);
            return [];
        }
    }

    /**
     * Transcribe audio from a file path
     *
     * @param filePath - Path to audio file (wav, m4a, mp3, etc.)
     * @param entryId - ID of the time entry for tracking
     * @param language - Optional language hint (ISO 639-1)
     * @returns TranscriptionResult
     */
    public async transcribeFile(
        filePath: string,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[AppleTranscriber] Transcribing file:', filePath);

        if (!this.nativeModule) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Native module not loaded',
            };
        }

        if (!this.isAvailable()) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Apple Speech Recognition not available on this system',
            };
        }

        try {
            const result = this.nativeModule.transcribeAudioFile(filePath, language);

            if (!result.success) {
                return {
                    success: false,
                    transcriptionId: '',
                    segments: [],
                    fullText: '',
                    language: '',
                    duration: 0,
                    wordCount: 0,
                    error: result.error || 'Transcription failed',
                };
            }

            const segments: TranscriptionSegment[] = (result.segments || []).map(seg => ({
                id: seg.id,
                start: seg.start,
                end: seg.end,
                text: seg.text,
            }));

            const fullText = result.text || '';
            const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

            return {
                success: true,
                transcriptionId: `apple-${entryId}-${Date.now()}`,
                segments,
                fullText,
                language: result.language || language || 'en',
                duration: result.duration || 0,
                wordCount,
            };
        } catch (error) {
            console.error('[AppleTranscriber] Transcription error:', error);
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Transcribe audio from a buffer
     *
     * @param audioBuffer - Float32Array of audio samples (mono)
     * @param sampleRate - Sample rate of the audio
     * @param entryId - ID of the time entry for tracking
     * @param language - Optional language hint (ISO 639-1)
     * @returns TranscriptionResult
     */
    public async transcribeBuffer(
        audioBuffer: Float32Array,
        sampleRate: number,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[AppleTranscriber] Transcribing buffer:', audioBuffer.length, 'samples at', sampleRate, 'Hz');

        if (!this.nativeModule) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Native module not loaded',
            };
        }

        if (!this.isAvailable()) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Apple Speech Recognition not available on this system',
            };
        }

        try {
            const result = this.nativeModule.transcribeAudioBuffer(audioBuffer, sampleRate, language);

            if (!result.success) {
                return {
                    success: false,
                    transcriptionId: '',
                    segments: [],
                    fullText: '',
                    language: '',
                    duration: 0,
                    wordCount: 0,
                    error: result.error || 'Transcription failed',
                };
            }

            const segments: TranscriptionSegment[] = (result.segments || []).map(seg => ({
                id: seg.id,
                start: seg.start,
                end: seg.end,
                text: seg.text,
            }));

            const fullText = result.text || '';
            const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

            return {
                success: true,
                transcriptionId: `apple-${entryId}-${Date.now()}`,
                segments,
                fullText,
                language: result.language || language || 'en',
                duration: result.duration || 0,
                wordCount,
            };
        } catch (error) {
            console.error('[AppleTranscriber] Transcription error:', error);
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

/**
 * Get the singleton Apple Transcriber instance
 */
export function getAppleTranscriber(): AppleTranscriber {
    return AppleTranscriber.getInstance();
}
