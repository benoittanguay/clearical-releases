/**
 * Transcription Service
 *
 * Routes transcription requests based on user tier:
 * - Premium/Trial users → Groq Whisper (cloud, higher quality)
 * - Free users → Apple Speech (on-device, free)
 * - Free users (Apple unavailable) → Groq Whisper (with 10hr/month limit)
 */

import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptionResult, TranscriptionSegment, MEETING_EVENTS } from './types.js';
import { EventEmitter } from 'events';
import { getConfig } from '../config.js';
import { getAppleTranscriber } from './appleTranscriber.js';

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
    private isPremium: boolean = false;

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
     * Set the user's premium status
     * This should be called when the user's subscription status is known
     */
    public setPremiumStatus(isPremium: boolean): void {
        this.isPremium = isPremium;
        console.log('[TranscriptionService] Premium status set:', isPremium);
    }

    /**
     * Groq usage tracking for premium users (20 hour limit before Apple fallback)
     */
    private groqUsageSeconds: number = 0;
    private static readonly PREMIUM_GROQ_LIMIT_SECONDS = 20 * 60 * 60; // 20 hours

    /**
     * Set the current Groq usage (loaded from database on startup)
     */
    public setGroqUsage(usageSeconds: number): void {
        this.groqUsageSeconds = usageSeconds;
        console.log('[TranscriptionService] Groq usage set:', Math.round(usageSeconds / 3600 * 10) / 10, 'hours');
    }

    /**
     * Add to Groq usage tracking
     */
    private addGroqUsage(durationSeconds: number): void {
        this.groqUsageSeconds += durationSeconds;
        console.log('[TranscriptionService] Groq usage updated:', Math.round(this.groqUsageSeconds / 3600 * 10) / 10, 'hours');
    }

    /**
     * Check if premium user has exceeded Groq quota (20 hours)
     */
    private isPremiumGroqQuotaExceeded(): boolean {
        return this.groqUsageSeconds >= TranscriptionService.PREMIUM_GROQ_LIMIT_SECONDS;
    }

    /**
     * Determine which transcription engine to use based on tier and usage
     *
     * TEMPORARY: Always use Groq for all users until we integrate a better
     * on-device solution (e.g., whisper.cpp). Apple's SFSpeechRecognizer
     * quality is insufficient for meeting transcription.
     *
     * Original logic (disabled):
     * - Free users: Always Apple on-device (with 8hr/month limit enforced elsewhere)
     * - Premium/Trial users: Groq for first 20 hours, then Apple
     */
    private shouldUseAppleTranscription(): boolean {
        // Always use Groq for better transcription quality
        console.log('[TranscriptionService] Using Groq (Apple transcription disabled due to quality issues)');
        return false;
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

        // Route based on user tier
        if (this.shouldUseAppleTranscription()) {
            return this.transcribeWithApple(filePath, entryId, language);
        }

        // Use Groq (premium users or Apple not available)
        const audioBuffer = await fs.promises.readFile(filePath);
        const audioBase64 = audioBuffer.toString('base64');

        // Determine MIME type from extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = this.getMimeType(ext);

        return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
    }

    /**
     * Transcribe using Apple's on-device Speech Recognition
     */
    private async transcribeWithApple(
        filePath: string,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Using Apple transcription for:', filePath);

        const appleTranscriber = getAppleTranscriber();
        const result = await appleTranscriber.transcribeFile(filePath, entryId, language);

        if (result.success) {
            this.emit(MEETING_EVENTS.TRANSCRIPTION_COMPLETE, {
                entryId,
                transcription: result,
                usage: null, // Apple transcription doesn't have usage tracking
            });
        } else {
            // Apple failed, try Groq as fallback
            console.warn('[TranscriptionService] Apple transcription failed, falling back to Groq:', result.error);

            // Check if we have session for Groq fallback
            if (!this.session?.access_token) {
                this.emit(MEETING_EVENTS.TRANSCRIPTION_ERROR, {
                    entryId,
                    error: result.error || 'Apple transcription failed and Groq fallback unavailable (not signed in)',
                });
                return result;
            }

            // Try Groq fallback
            const audioBuffer = await fs.promises.readFile(filePath);
            const audioBase64 = audioBuffer.toString('base64');
            const ext = path.extname(filePath).toLowerCase();
            const mimeType = this.getMimeType(ext);

            return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
        }

        return result;
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

        // Route based on user tier
        if (this.shouldUseAppleTranscription()) {
            // Apple needs a file, so save to temp file first
            return this.transcribeBase64WithApple(audioBase64, entryId, mimeType, language);
        }

        // Use Groq
        return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
    }

    /**
     * Transcribe base64 audio using Apple (saves to temp file first)
     */
    private async transcribeBase64WithApple(
        audioBase64: string,
        entryId: string,
        mimeType: string,
        language?: string
    ): Promise<TranscriptionResult> {
        // Save to temp file
        const ext = this.getExtensionFromMimeType(mimeType);
        const tempDir = app.getPath('temp');
        const tempFile = path.join(tempDir, `transcribe-${entryId}-${Date.now()}.${ext}`);

        try {
            const audioBuffer = Buffer.from(audioBase64, 'base64');
            await fs.promises.writeFile(tempFile, audioBuffer);

            const result = await this.transcribeWithApple(tempFile, entryId, language);

            // Clean up temp file
            fs.promises.unlink(tempFile).catch(() => {});

            return result;
        } catch (error) {
            // Clean up on error
            fs.promises.unlink(tempFile).catch(() => {});

            console.error('[TranscriptionService] Failed to write temp file for Apple transcription:', error);
            // Fall back to Groq
            return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
        }
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMimeType(mimeType: string): string {
        const baseMimeType = mimeType.split(';')[0].trim();
        const mimeToExt: Record<string, string> = {
            'audio/webm': 'webm',
            'audio/mp4': 'm4a',
            'audio/mpeg': 'mp3',
            'audio/wav': 'wav',
            'audio/ogg': 'ogg',
            'audio/flac': 'flac',
        };
        return mimeToExt[baseMimeType] || 'webm';
    }

    /**
     * Transcribe audio using Groq Whisper API
     */
    private async transcribeWithGroq(
        audioBase64: string,
        entryId: string,
        mimeType: string = 'audio/webm',
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Using Groq transcription for entry:', entryId);

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
            console.error('[TranscriptionService] ERROR: No authenticated session', {
                hasSession: !!this.session,
                hasToken: !!this.session?.access_token,
            });
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Not authenticated - please sign in from Settings',
            };
        }

        // Check if token is expired
        const tokenExpiresAt = this.session.expires_at ? this.session.expires_at * 1000 : 0;
        const isTokenExpired = tokenExpiresAt > 0 && Date.now() > tokenExpiresAt;
        console.log('[TranscriptionService] Session state:', {
            tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : 'unknown',
            isExpired: isTokenExpired,
            userId: this.session.user?.id?.substring(0, 8),
        });

        if (isTokenExpired) {
            console.error('[TranscriptionService] ERROR: Access token has expired');
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'Session expired - please sign in again from Settings',
            };
        }

        try {
            // Call the Supabase Edge Function
            console.log('[TranscriptionService] Calling edge function, audio size:', Math.round(audioBase64.length / 1024), 'KB');
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

            // Log response status for debugging
            console.log('[TranscriptionService] Edge function response status:', response.status, response.statusText);

            // Handle non-OK responses
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorBody = await response.json() as { error?: string };
                    if (errorBody && typeof errorBody.error === 'string') {
                        errorMessage = errorBody.error;
                    }
                } catch {
                    // Response wasn't JSON, use the status message
                }
                console.error('[TranscriptionService] Edge function error:', errorMessage);
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

            const result = await response.json() as TranscriptionApiResult;
            console.log('[TranscriptionService] Edge function result:', { success: result.success, hasTranscription: !!result.transcription, error: result.error });

            if (!result.success || !result.transcription) {
                const errorMessage = result.error || 'Transcription failed (no transcription in response)';
                console.error('[TranscriptionService] Transcription failed:', errorMessage);
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
