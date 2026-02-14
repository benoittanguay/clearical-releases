/**
 * Transcription Service
 *
 * Handles audio transcription via Groq Whisper API.
 * Automatically chunks large files (>24MB) using bundled ffmpeg for transcription.
 */

import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptionResult, TranscriptionSegment, MEETING_EVENTS } from './types.js';
import { EventEmitter } from 'events';
import { getConfig } from '../config.js';
import {
    splitAudioFile,
    cleanupChunks,
    needsChunking,
    getFileSizeBytes,
    MAX_CHUNK_SIZE_BYTES,
    isFfmpegAvailable,
    AudioChunk
} from './audioChunker.js';

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
    private refreshAuthCallback: (() => Promise<void>) | null = null;

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
     * Set the auth refresh callback
     * Called on 401 errors to refresh the auth token
     */
    public setRefreshAuthCallback(callback: () => Promise<void>): void {
        this.refreshAuthCallback = callback;
        console.log('[TranscriptionService] Auth refresh callback registered');
    }

    /**
     * Groq usage tracking (for display purposes)
     */
    private groqUsageSeconds: number = 0;

    /**
     * Set the current Groq usage (loaded from database on startup)
     */
    public setGroqUsage(usageSeconds: number): void {
        this.groqUsageSeconds = usageSeconds;
        console.log('[TranscriptionService] Groq usage set:', Math.round(usageSeconds / 3600 * 10) / 10, 'hours');
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

        // Check if file is too large for Groq (25MB limit)
        const fileSize = getFileSizeBytes(filePath);
        const fileSizeMB = Math.round(fileSize / 1024 / 1024);
        console.log('[TranscriptionService] File size:', fileSizeMB, 'MB');

        if (needsChunking(filePath)) {
            console.log('[TranscriptionService] File exceeds 24MB, attempting chunked transcription');
            return this.transcribeFileWithChunking(filePath, entryId, language);
        }

        // Use Groq for transcription
        const audioBuffer = await fs.promises.readFile(filePath);
        const audioBase64 = audioBuffer.toString('base64');

        // Determine MIME type from extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = this.getMimeType(ext);

        return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
    }

    /**
     * Transcribe a large audio file by splitting into chunks
     *
     * @param filePath - Path to the large audio file
     * @param entryId - ID of the time entry
     * @param language - Optional language hint
     * @returns Combined transcription result from all chunks
     */
    private async transcribeFileWithChunking(
        filePath: string,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Starting chunked transcription for:', filePath);

        // Check if ffmpeg is available for chunking
        const ffmpegAvailable = await isFfmpegAvailable();
        if (!ffmpegAvailable) {
            console.log('[TranscriptionService] ffmpeg not available for chunking large files');

            // No options available without ffmpeg
            const fileSizeMB = Math.round(getFileSizeBytes(filePath) / 1024 / 1024);
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: `Audio file too large (${fileSizeMB}MB). Maximum is 25MB. Audio splitting is unavailable - please use shorter recordings.`,
            };
        }

        // Split the audio file into chunks
        const chunkingResult = await splitAudioFile(filePath);
        if (!chunkingResult.success || !chunkingResult.chunks) {
            console.error('[TranscriptionService] Failed to split audio:', chunkingResult.error);
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: chunkingResult.error || 'Failed to split audio file',
            };
        }

        const chunks = chunkingResult.chunks;
        console.log('[TranscriptionService] Split into', chunks.length, 'chunks');

        // Determine MIME type from extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = this.getMimeType(ext);

        // Transcribe chunks with parallel processing
        const chunkResults: (TranscriptionResult | null)[] = new Array(chunks.length).fill(null);
        let detectedLanguage = language || 'en';

        // First chunk processes alone to detect language
        if (chunks.length > 0) {
            console.log(`[TranscriptionService] Transcribing chunk 1/${chunks.length} (language detection)`);
            const firstChunkBuffer = await fs.promises.readFile(chunks[0].filePath);
            const firstChunkBase64 = firstChunkBuffer.toString('base64');

            const firstResult = await this.transcribeWithGroq(
                firstChunkBase64,
                `${entryId}-chunk-0`,
                mimeType,
                detectedLanguage
            );

            if (firstResult.success) {
                detectedLanguage = firstResult.language || detectedLanguage;
                chunkResults[0] = firstResult;
                console.log(`[TranscriptionService] Chunk 1 complete, detected language: ${detectedLanguage}`);
            } else {
                console.error('[TranscriptionService] Chunk 1 failed:', firstResult.error);
            }
        }

        // Process remaining chunks in parallel batches of 3
        if (chunks.length > 1) {
            await this.processChunksInParallel(
                chunks.slice(1),
                chunkResults,
                1, // Start index offset
                entryId,
                mimeType,
                detectedLanguage
            );
        }

        // Clean up chunk files
        cleanupChunks(chunks);

        // Filter out failed chunks and merge results
        const successfulResults: TranscriptionResult[] = chunkResults.filter((r): r is TranscriptionResult => r !== null && r.success);

        if (successfulResults.length === 0) {
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: 'All chunks failed to transcribe',
            };
        }

        // Map successful results back to their original indices for proper time offsetting
        const resultChunkPairs = chunkResults
            .map((result, index) => ({ result, chunk: chunks[index] }))
            .filter((pair): pair is { result: TranscriptionResult; chunk: AudioChunk } =>
                pair.result !== null && pair.result.success
            );

        const successfulChunks = resultChunkPairs.map(p => p.chunk);

        // Log partial failure warning if applicable
        if (successfulResults.length < chunks.length) {
            const failedCount = chunks.length - successfulResults.length;
            console.warn(`[TranscriptionService] ${failedCount} of ${chunks.length} chunks failed - returning partial transcription`);
        }

        const mergedResult = this.mergeChunkResults(successfulResults, successfulChunks, entryId);

        this.emit(MEETING_EVENTS.TRANSCRIPTION_COMPLETE, {
            entryId,
            transcription: mergedResult,
            usage: null, // Usage tracking happens per-chunk
        });

        return mergedResult;
    }

    /**
     * Process chunks in parallel with concurrency limit of 3
     */
    private async processChunksInParallel(
        chunks: AudioChunk[],
        resultsArray: (TranscriptionResult | null)[],
        startIndex: number,
        entryId: string,
        mimeType: string,
        language: string
    ): Promise<void> {
        const CONCURRENCY_LIMIT = 3;
        const totalChunks = chunks.length;

        // Process in batches
        for (let batchStart = 0; batchStart < totalChunks; batchStart += CONCURRENCY_LIMIT) {
            const batchEnd = Math.min(batchStart + CONCURRENCY_LIMIT, totalChunks);
            const batchSize = batchEnd - batchStart;

            console.log(`[TranscriptionService] Processing batch: chunks ${batchStart + 1}-${batchEnd} of ${totalChunks} (batch size: ${batchSize})`);

            // Create promises for this batch
            const batchPromises = [];
            for (let i = batchStart; i < batchEnd; i++) {
                const chunk = chunks[i];
                const chunkIndex = startIndex + i;

                const promise = (async () => {
                    try {
                        console.log(`[TranscriptionService] Transcribing chunk ${chunkIndex + 1}/${startIndex + totalChunks}: ${chunk.filePath}`);

                        // Read chunk and convert to base64
                        const chunkBuffer = await fs.promises.readFile(chunk.filePath);
                        const chunkBase64 = chunkBuffer.toString('base64');

                        // Transcribe chunk
                        const result = await this.transcribeWithGroq(
                            chunkBase64,
                            `${entryId}-chunk-${chunkIndex}`,
                            mimeType,
                            language
                        );

                        if (result.success) {
                            resultsArray[chunkIndex] = result;
                            console.log(`[TranscriptionService] Chunk ${chunkIndex + 1} complete`);
                        } else {
                            console.error(`[TranscriptionService] Chunk ${chunkIndex + 1} failed:`, result.error);
                        }
                    } catch (error) {
                        console.error(`[TranscriptionService] Chunk ${chunkIndex + 1} error:`, error);
                    }
                })();

                batchPromises.push(promise);
            }

            // Wait for all chunks in this batch to complete
            await Promise.all(batchPromises);

            console.log(`[TranscriptionService] Batch complete: ${batchEnd} of ${totalChunks} chunks processed`);
        }
    }

    /**
     * Merge transcription results from multiple chunks
     */
    private mergeChunkResults(
        results: TranscriptionResult[],
        chunks: AudioChunk[],
        entryId: string
    ): TranscriptionResult {
        console.log('[TranscriptionService] Merging', results.length, 'chunk results');

        // Build merged text
        const mergedText = results.map(r => r.fullText).join(' ');

        // Build merged segments with time offset adjustments
        const mergedSegments: TranscriptionSegment[] = [];
        let segmentIdOffset = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const chunk = chunks[i];
            const timeOffset = chunk?.startTime || 0;

            for (const segment of result.segments) {
                mergedSegments.push({
                    id: segment.id + segmentIdOffset,
                    start: segment.start + timeOffset,
                    end: segment.end + timeOffset,
                    text: segment.text,
                });
            }

            segmentIdOffset += result.segments.length;
        }

        // Calculate totals
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const totalWordCount = results.reduce((sum, r) => sum + r.wordCount, 0);

        // Use language from first successful result
        const language = results.find(r => r.language)?.language || 'en';

        return {
            success: true,
            transcriptionId: `${entryId}-merged-${Date.now()}`,
            segments: mergedSegments,
            fullText: mergedText,
            language,
            duration: totalDuration,
            wordCount: totalWordCount,
        };
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

        // Calculate approximate file size from base64 (base64 adds ~37% overhead)
        const estimatedSizeBytes = Math.round(audioBase64.length * 0.73);
        const estimatedSizeMB = Math.round(estimatedSizeBytes / 1024 / 1024);
        console.log('[TranscriptionService] Estimated audio size:', estimatedSizeMB, 'MB');

        // Check if file is too large for Groq (25MB limit)
        if (estimatedSizeBytes > MAX_CHUNK_SIZE_BYTES) {
            console.log('[TranscriptionService] Audio exceeds 24MB, using chunked transcription');
            return this.transcribeBase64WithChunking(audioBase64, entryId, mimeType, language);
        }

        // Use Groq for transcription
        return this.transcribeWithGroq(audioBase64, entryId, mimeType, language);
    }

    /**
     * Transcribe large base64 audio by saving to file and chunking
     */
    private async transcribeBase64WithChunking(
        audioBase64: string,
        entryId: string,
        mimeType: string,
        language?: string
    ): Promise<TranscriptionResult> {
        console.log('[TranscriptionService] Saving large audio to temp file for chunking');

        // Save to temp file first
        const ext = this.getExtensionFromMimeType(mimeType);
        const tempDir = app.getPath('temp');
        const tempFile = path.join(tempDir, `transcribe-large-${entryId}-${Date.now()}.${ext}`);

        try {
            const audioBuffer = Buffer.from(audioBase64, 'base64');
            await fs.promises.writeFile(tempFile, audioBuffer);
            console.log('[TranscriptionService] Saved temp file:', tempFile, 'size:', Math.round(audioBuffer.length / 1024 / 1024), 'MB');

            // Use the file-based chunking transcription
            const result = await this.transcribeFileWithChunking(tempFile, entryId, language);

            // Clean up temp file
            fs.promises.unlink(tempFile).catch(() => {});

            return result;
        } catch (error) {
            // Clean up on error
            fs.promises.unlink(tempFile).catch(() => {});

            console.error('[TranscriptionService] Failed to process large audio:', error);
            return {
                success: false,
                transcriptionId: '',
                segments: [],
                fullText: '',
                language: '',
                duration: 0,
                wordCount: 0,
                error: error instanceof Error ? error.message : 'Failed to process large audio file',
            };
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
            // Call the API with retry on 401
            const result = await this.callGroqApiWithRetry(audioBase64, mimeType, entryId, language);
            return result;
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
     * Call Groq API with retry on 401 (token expiration)
     */
    private async callGroqApiWithRetry(
        audioBase64: string,
        mimeType: string,
        entryId: string,
        language?: string
    ): Promise<TranscriptionResult> {
        // First attempt
        let response = await this.callGroqApi(audioBase64, mimeType, entryId, language);

        // If 401 and we have a refresh callback, try refreshing once
        if (response.status === 401 && this.refreshAuthCallback) {
            console.log('[TranscriptionService] Got 401, attempting token refresh...');
            try {
                await this.refreshAuthCallback();
                console.log('[TranscriptionService] Token refreshed, retrying transcription...');

                // Retry once after refresh
                response = await this.callGroqApi(audioBase64, mimeType, entryId, language);
            } catch (refreshError) {
                console.error('[TranscriptionService] Token refresh failed:', refreshError);
                // Continue with the original 401 response handling
            }
        }

        // Parse and return the response
        return this.parseGroqResponse(response, entryId);
    }

    /**
     * Make a single API call to Groq transcription service
     */
    private async callGroqApi(
        audioBase64: string,
        mimeType: string,
        entryId: string,
        language?: string
    ): Promise<Response> {
        console.log('[TranscriptionService] Calling edge function, audio size:', Math.round(audioBase64.length / 1024), 'KB');

        if (!this.session?.access_token) {
            throw new Error('No access token available');
        }

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

        console.log('[TranscriptionService] Edge function response status:', response.status, response.statusText);
        return response;
    }

    /**
     * Parse Groq API response into TranscriptionResult
     */
    private async parseGroqResponse(response: Response, entryId: string): Promise<TranscriptionResult> {
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
        console.log('[TranscriptionService] Edge function result:', {
            success: result.success,
            hasTranscription: !!result.transcription,
            error: result.error
        });

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
