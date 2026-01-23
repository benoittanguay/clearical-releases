/**
 * Transcription Service
 *
 * Sends audio to the Groq Whisper API via Supabase Edge Function
 * and returns transcription results.
 */

import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptionResult, TranscriptionSegment, MEETING_EVENTS } from './types.js';
import { EventEmitter } from 'events';
import { getConfig } from '../config.js';

/**
 * Transcription usage information
 */
export interface TranscriptionUsage {
    monthlyUsedSeconds: number;
    monthlyLimitSeconds: number;
    remainingSeconds: number;
    isPremium: boolean;
}

/**
 * Result from transcription API
 */
export interface TranscriptionApiResult {
    success: boolean;
    transcription?: {
        text: string;
        segments: TranscriptionSegment[];
        language: string;
        duration: number;
    };
    usage?: {
        durationSeconds: number;
        monthlyUsedSeconds: number;
        monthlyLimitSeconds: number;
        remainingSeconds: number;
    };
    error?: string;
}

/**
 * Transcription Service
 *
 * Singleton service that handles audio transcription via Supabase Edge Function.
 */
export class TranscriptionService extends EventEmitter {
    private static instance: TranscriptionService | null = null;
    private supabase: SupabaseClient | null = null;
    private session: Session | null = null;
    private supabaseUrl: string = '';

    private constructor() {
        super();
        this.initializeSupabase();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): TranscriptionService {
        if (!TranscriptionService.instance) {
            TranscriptionService.instance = new TranscriptionService();
        }
        return TranscriptionService.instance;
    }

    /**
     * Initialize Supabase client using app config
     */
    private initializeSupabase(): void {
        const config = getConfig();

        if (!config.supabase.url || !config.supabase.anonKey) {
            console.warn('[TranscriptionService] Supabase not configured in app config');
            return;
        }

        this.supabaseUrl = config.supabase.url;
        this.supabase = createClient(config.supabase.url, config.supabase.anonKey);
        console.log('[TranscriptionService] Supabase client initialized');
    }

    /**
     * Set the current auth session
     * This should be called when the user logs in
     */
    public setSession(session: Session | null): void {
        this.session = session;
    }

    /**
     * Transcribe audio from a file path
     *
     * @param filePath - Path to the audio file
     * @param entryId - ID of the time entry this transcription belongs to
     * @param language - Optional language hint (ISO 639-1 code)
     * @returns Transcription result
     */
    public async transcribeFile(
        filePath: string,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Transcribing file:', filePath);

        // Read the audio file
        if (!fs.existsSync(filePath)) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Audio file not found',
            };
        }

        const audioBuffer = await fs.promises.readFile(filePath);
        const audioBase64 = audioBuffer.toString('base64');

        // Determine MIME type from extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = this.getMimeType(ext);

        return this.transcribe(audioBase64, entryId, mimeType, language);
    }

    /**
     * Transcribe audio from base64 data
     *
     * @param audioBase64 - Base64 encoded audio data
     * @param entryId - ID of the time entry this transcription belongs to
     * @param mimeType - MIME type of the audio (default: audio/webm)
     * @param language - Optional language hint (ISO 639-1 code)
     * @returns Transcription result
     */
    public async transcribe(
        audioBase64: string,
        entryId: string,
        mimeType: string = 'audio/webm',
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Starting transcription for entry:', entryId);

        if (!this.supabase) {
            console.error('[TranscriptionService] ERROR: Supabase client not initialized');
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Supabase not configured',
            };
        }

        if (!this.session?.access_token) {
            console.error('[TranscriptionService] ERROR: No authenticated session');
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Not authenticated',
            };
        }

        try {
            // Call the Supabase Edge Function
            const response = await fetch(`${this.supabaseUrl}/functions/v1/groq-transcribe`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    audioBase64,
                    mimeType,
                    entryId,
                    language,
                }),
            });

            const result = await response.json() as TranscriptionApiResult;

            if (!result.success || !result.transcription) {
                console.error('[TranscriptionService] Transcription failed:', result.error);
                this.emit(MEETING_EVENTS.TRANSCRIPTION_ERROR, {
                    entryId,
                    error: result.error || 'Transcription failed',
                });
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

            const transcription = result.transcription;
            const wordCount = transcription.text.split(/\s+/).filter(w => w.length > 0).length;
            const transcriptionId = `${entryId}-${Date.now()}`;

            console.log('[TranscriptionService] Transcription complete:', {
                language: transcription.language,
                duration: transcription.duration,
                wordCount,
            });

            const transcriptionResult: TranscriptionResult = {
                success: true,
                transcriptionId,
                segments: transcription.segments || [],
                fullText: transcription.text,
                language: transcription.language,
                duration: transcription.duration,
                wordCount,
            };

            this.emit(MEETING_EVENTS.TRANSCRIPTION_COMPLETE, {
                entryId,
                transcription: transcriptionResult,
                usage: result.usage,
            });

            return transcriptionResult;
        } catch (error) {
            console.error('[TranscriptionService] Error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.emit(MEETING_EVENTS.TRANSCRIPTION_ERROR, {
                entryId,
                error: errorMessage,
            });
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: errorMessage,
            };
        }
    }

    /**
     * Get current transcription usage for the user
     */
    public async getUsage(): Promise<TranscriptionUsage | null> {
        if (!this.supabase || !this.session?.access_token) {
            console.warn('[TranscriptionService] Cannot get usage: not authenticated');
            return null;
        }

        try {
            // We'll need to add an endpoint for this, or calculate from DB
            // For now, return a mock response indicating we need to implement this
            console.log('[TranscriptionService] Usage tracking not yet implemented');
            return {
                monthlyUsedSeconds: 0,
                monthlyLimitSeconds: 36000, // 10 hours for free tier
                remainingSeconds: 36000,
                isPremium: false,
            };
        } catch (error) {
            console.error('[TranscriptionService] Failed to get usage:', error);
            return null;
        }
    }

    /**
     * Get MIME type from file extension
     */
    private getMimeType(ext: string): string {
        const mimeTypes: Record<string, string> = {
            '.webm': 'audio/webm',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
        };
        return mimeTypes[ext] || 'audio/webm';
    }
}

// Export singleton getter for convenience
export function getTranscriptionService(): TranscriptionService {
    return TranscriptionService.getInstance();
}
