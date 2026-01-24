/**
 * AI Service - Gemini Cloud Integration
 *
 * Provides AI capabilities through the Supabase Edge Function proxy to Gemini 1.5 Flash.
 * Replaces the local FastVLM server with cloud-based AI.
 *
 * Benefits:
 * - No local model download required
 * - Works on all platforms (not Apple Silicon dependent)
 * - API key managed securely in Supabase secrets
 * - Per-user rate limiting and usage tracking
 */

import { getConfig } from '../config.js';
import { getAuthService } from '../auth/supabaseAuth.js';
import fs from 'fs';
import { nativeImage } from 'electron';
import {
    AnyContextSignal,
    AITaskType,
    AITaskRequest,
    SummarizeRequest,
    SignalCategory,
    hasSignalData,
    getSignalSummary,
    filterSignalsForTask
} from './contextSignals.js';

// Image processing configuration
const IMAGE_CONFIG = {
    maxFileSizeMB: 4,           // Max file size before compression (Gemini limit is ~4MB for inline)
    maxDimension: 1920,         // Max width/height in pixels
    jpegQuality: 85,            // JPEG quality for compression (0-100)
    warningSizeMB: 2,           // Log warning if image exceeds this size
};

// Re-export signal types and utilities for convenience
export {
    AnyContextSignal,
    AITaskType,
    AITaskRequest,
    SummarizeRequest,
    SignalCategory,
    createScreenshotSignal,
    createWindowActivitySignal,
    createCalendarSignal,
    createUserProfileSignal,
    createTechnologiesSignal,
    createTimeContextSignal,
    createHistoricalPatternsSignal,
    createJiraContextSignal,
    hasSignalData,
    getSignalSummary,
    filterSignalsForTask,
    filterSignalsByCategory,
    groupSignalsByCategory,
    getRequiredCategories
} from './contextSignals.js';

// Re-export the signal aggregator
export { signalAggregator } from './signalAggregator.js';

// Response types matching the FastVLM interface for compatibility
export interface AnalysisResponse {
    success: boolean;
    description: string | null;
    confidence?: number;
    error?: string;
    errorCode?: AIErrorCode;
    requestId?: string;
    isRateLimited?: boolean;
    retryAfterSeconds?: number;
}

export interface ClassifyResponse {
    success: boolean;
    selected_id?: string;
    selected_name?: string;
    confidence?: number;
    error?: string;
}

export interface SummarizeResponse {
    success: boolean;
    summary?: string;
    error?: string;
}

// Error codes for client-side handling
export const AI_ERROR_CODES = {
    // Authentication errors
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    AUTH_EXPIRED: 'AUTH_EXPIRED',
    // Rate limiting
    RATE_LIMIT_MINUTE: 'RATE_LIMIT_MINUTE',
    RATE_LIMIT_DAILY: 'RATE_LIMIT_DAILY',
    // Service errors
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    CIRCUIT_OPEN: 'CIRCUIT_OPEN',
    // Request errors
    INVALID_IMAGE: 'INVALID_IMAGE',
    IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
    INVALID_REQUEST: 'INVALID_REQUEST',
    // Gemini errors
    GEMINI_ERROR: 'GEMINI_ERROR',
    GEMINI_RATE_LIMIT: 'GEMINI_RATE_LIMIT',
    // Generic
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type AIErrorCode = typeof AI_ERROR_CODES[keyof typeof AI_ERROR_CODES];

// Edge function response types
interface GeminiProxyResponse {
    success: boolean;
    // Analyze
    description?: string;
    confidence?: number;
    // Classify
    selectedId?: string;
    selectedName?: string;
    // Summarize
    summary?: string;
    // Error
    error?: string;
    errorCode?: string;
    // Rate limit info
    isRateLimited?: boolean;
    retryAfter?: number;
    // Rate limit details
    limits?: {
        daily: { used: number; limit: number };
        minute: { used: number; limit: number };
    };
}

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 502, 503, 504],
};

// Token refresh threshold (refresh if token expires within this time)
const TOKEN_REFRESH_THRESHOLD_MS = 60 * 1000; // 1 minute

// Circuit breaker configuration
const CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,        // Open circuit after 5 consecutive failures
    resetTimeoutMs: 60 * 1000,  // Try again after 1 minute
    halfOpenMaxAttempts: 2,     // Allow 2 requests in half-open state
};

// Circuit breaker states
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process and optimize image for AI analysis
 * - Validates file size
 * - Resizes large images
 * - Compresses if needed
 */
async function processImageForAnalysis(imagePath: string): Promise<{
    success: boolean;
    base64?: string;
    mimeType?: string;
    originalSize?: number;
    processedSize?: number;
    wasResized?: boolean;
    wasCompressed?: boolean;
    error?: string;
}> {
    try {
        // Check file exists and get size
        const stats = await fs.promises.stat(imagePath);
        const originalSizeMB = stats.size / (1024 * 1024);

        console.log(`[AIService] Processing image: ${imagePath} (${originalSizeMB.toFixed(2)} MB)`);

        if (originalSizeMB > IMAGE_CONFIG.warningSizeMB) {
            console.warn(`[AIService] ⚠️ Large image detected: ${originalSizeMB.toFixed(2)} MB`);
        }

        // Load image with nativeImage
        const image = nativeImage.createFromPath(imagePath);
        if (image.isEmpty()) {
            return { success: false, error: 'Failed to load image - file may be corrupted' };
        }

        const originalSize = image.getSize();
        let processedImage = image;
        let wasResized = false;
        let wasCompressed = false;

        // Check if resize is needed
        const maxDim = Math.max(originalSize.width, originalSize.height);
        if (maxDim > IMAGE_CONFIG.maxDimension) {
            const scale = IMAGE_CONFIG.maxDimension / maxDim;
            const newWidth = Math.round(originalSize.width * scale);
            const newHeight = Math.round(originalSize.height * scale);

            console.log(`[AIService] Resizing image from ${originalSize.width}x${originalSize.height} to ${newWidth}x${newHeight}`);
            processedImage = image.resize({ width: newWidth, height: newHeight, quality: 'better' });
            wasResized = true;
        }

        // Get PNG buffer first to check size
        let buffer = processedImage.toPNG();
        let mimeType = 'image/png';

        // If still too large, convert to JPEG with compression
        const bufferSizeMB = buffer.length / (1024 * 1024);
        if (bufferSizeMB > IMAGE_CONFIG.maxFileSizeMB) {
            console.log(`[AIService] Image still large (${bufferSizeMB.toFixed(2)} MB), converting to JPEG`);
            buffer = processedImage.toJPEG(IMAGE_CONFIG.jpegQuality);
            mimeType = 'image/jpeg';
            wasCompressed = true;

            const jpegSizeMB = buffer.length / (1024 * 1024);
            console.log(`[AIService] JPEG size: ${jpegSizeMB.toFixed(2)} MB`);

            // If still too large after JPEG, try lower quality
            if (jpegSizeMB > IMAGE_CONFIG.maxFileSizeMB) {
                console.log('[AIService] Still too large, trying lower quality JPEG');
                buffer = processedImage.toJPEG(60);
                const finalSizeMB = buffer.length / (1024 * 1024);
                console.log(`[AIService] Final JPEG size: ${finalSizeMB.toFixed(2)} MB`);

                if (finalSizeMB > IMAGE_CONFIG.maxFileSizeMB) {
                    console.warn(`[AIService] ⚠️ Image still exceeds limit after compression: ${finalSizeMB.toFixed(2)} MB`);
                    // Continue anyway - Gemini might handle it or return an error
                }
            }
        }

        const base64 = buffer.toString('base64');

        console.log(`[AIService] Image processed: ${wasResized ? 'resized' : 'no resize'}, ${wasCompressed ? 'compressed' : 'no compression'}, final size: ${(buffer.length / 1024).toFixed(1)} KB`);

        return {
            success: true,
            base64,
            mimeType,
            originalSize: stats.size,
            processedSize: buffer.length,
            wasResized,
            wasCompressed
        };
    } catch (error) {
        console.error('[AIService] Image processing error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Image processing failed'
        };
    }
}

/**
 * AI Service - Cloud-based AI via Supabase Edge Function
 */
class AIService {
    private config = getConfig();

    // Track consecutive failures for queue pause logic
    private consecutiveFailures = 0;
    private rateLimitedUntil = 0;

    // Circuit breaker state
    private circuitState: CircuitState = 'closed';
    private circuitOpenedAt = 0;
    private halfOpenAttempts = 0;

    /**
     * Get the Gemini proxy endpoint URL
     */
    private getProxyUrl(): string {
        return `${this.config.supabase.url}/functions/v1/gemini-proxy`;
    }

    /**
     * Check if we should wait before making a request (rate limit cooldown)
     */
    isRateLimited(): boolean {
        return Date.now() < this.rateLimitedUntil;
    }

    /**
     * Get the time remaining until rate limit expires (in ms)
     */
    getRateLimitRemainingMs(): number {
        return Math.max(0, this.rateLimitedUntil - Date.now());
    }

    /**
     * Get consecutive failure count for queue pause decisions
     */
    getConsecutiveFailures(): number {
        return this.consecutiveFailures;
    }

    /**
     * Reset failure tracking (call after successful request)
     */
    private resetFailureTracking(): void {
        this.consecutiveFailures = 0;
    }

    /**
     * Record a failure and optionally set rate limit cooldown
     */
    private recordFailure(isRateLimited: boolean, retryAfterMs?: number): void {
        this.consecutiveFailures++;

        if (isRateLimited) {
            // Set cooldown period - use retry-after if provided, otherwise use exponential backoff
            const cooldownMs = retryAfterMs || Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, this.consecutiveFailures),
                RETRY_CONFIG.maxDelayMs
            );
            this.rateLimitedUntil = Date.now() + cooldownMs;
            console.log(`[AIService] Rate limited. Cooldown for ${cooldownMs}ms (until ${new Date(this.rateLimitedUntil).toISOString()})`);
        }

        // Update circuit breaker state
        this.updateCircuitBreaker(false);
    }

    /**
     * Update circuit breaker state based on success/failure
     */
    private updateCircuitBreaker(success: boolean): void {
        if (success) {
            // Reset on success
            if (this.circuitState === 'half-open') {
                console.log('[AIService] 🟢 Circuit breaker: half-open → closed (success)');
                this.circuitState = 'closed';
            }
            this.halfOpenAttempts = 0;
            return;
        }

        // Handle failure
        if (this.circuitState === 'half-open') {
            this.halfOpenAttempts++;
            if (this.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts) {
                console.log('[AIService] 🔴 Circuit breaker: half-open → open (failures in half-open)');
                this.circuitState = 'open';
                this.circuitOpenedAt = Date.now();
            }
        } else if (this.circuitState === 'closed' && this.consecutiveFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
            console.log(`[AIService] 🔴 Circuit breaker: closed → open (${this.consecutiveFailures} consecutive failures)`);
            this.circuitState = 'open';
            this.circuitOpenedAt = Date.now();
        }
    }

    /**
     * Check if circuit breaker allows the request
     */
    private checkCircuitBreaker(): { allowed: boolean; reason?: string } {
        if (this.circuitState === 'closed') {
            return { allowed: true };
        }

        if (this.circuitState === 'open') {
            const timeSinceOpen = Date.now() - this.circuitOpenedAt;
            if (timeSinceOpen >= CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
                // Transition to half-open
                console.log('[AIService] 🟡 Circuit breaker: open → half-open (timeout elapsed)');
                this.circuitState = 'half-open';
                this.halfOpenAttempts = 0;
                return { allowed: true };
            }
            const remainingMs = CIRCUIT_BREAKER_CONFIG.resetTimeoutMs - timeSinceOpen;
            return {
                allowed: false,
                reason: `Circuit breaker open. Service unavailable. Retry in ${Math.ceil(remainingMs / 1000)}s`
            };
        }

        // half-open state - allow limited requests
        if (this.halfOpenAttempts < CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts) {
            return { allowed: true };
        }

        return {
            allowed: false,
            reason: 'Circuit breaker half-open, max attempts reached'
        };
    }

    /**
     * Check if token is fresh enough for a request, refresh if needed
     */
    private async ensureFreshToken(): Promise<{ accessToken: string; expiresAt: number } | null> {
        const authService = getAuthService();
        let session = await authService.getSession();

        if (!session) {
            return null;
        }

        const now = Date.now();
        const timeUntilExpiry = session.expiresAt - now;

        // If token expires soon, proactively refresh it
        if (timeUntilExpiry < TOKEN_REFRESH_THRESHOLD_MS) {
            console.log(`[AIService] Token expires in ${Math.round(timeUntilExpiry / 1000)}s, refreshing proactively...`);
            try {
                // Force a token refresh by getting a new session
                session = await authService.getSession();
                if (!session) {
                    console.error('[AIService] Token refresh failed - no session returned');
                    return null;
                }
                console.log('[AIService] Token refreshed successfully, new expiry:',
                    new Date(session.expiresAt).toISOString());
            } catch (error) {
                console.error('[AIService] Token refresh error:', error);
                // If refresh fails but we still have time, use existing token
                if (timeUntilExpiry <= 0) {
                    return null;
                }
                console.log('[AIService] Using existing token despite refresh failure');
            }
        }

        // Session is guaranteed non-null here (we return null above if it was)
        return { accessToken: session!.accessToken, expiresAt: session!.expiresAt };
    }

    /**
     * Make an authenticated request to the Gemini proxy with exponential backoff
     */
    private async makeRequest(body: Record<string, unknown>): Promise<GeminiProxyResponse> {
        // Check circuit breaker first
        const circuitCheck = this.checkCircuitBreaker();
        if (!circuitCheck.allowed) {
            console.warn(`[AIService] ⛔ Request blocked: ${circuitCheck.reason}`);
            return {
                success: false,
                error: circuitCheck.reason || 'Service temporarily unavailable',
                isRateLimited: true
            };
        }

        // Ensure we have a fresh token
        const tokenInfo = await this.ensureFreshToken();
        if (!tokenInfo) {
            console.error('[AIService] ❌ No active session - AI features unavailable');
            console.error('[AIService] User needs to sign in from Settings to enable AI features');
            return { success: false, error: 'Not authenticated. Please sign in again.' };
        }

        // Check if we're in a rate limit cooldown period
        if (this.isRateLimited()) {
            const remainingMs = this.getRateLimitRemainingMs();
            console.log(`[AIService] ⏳ Rate limited, waiting ${remainingMs}ms before request`);
            await sleep(remainingMs);

            // Re-check token after waiting (it might have expired during the wait)
            const refreshedToken = await this.ensureFreshToken();
            if (!refreshedToken) {
                return { success: false, error: 'Session expired while waiting. Please sign in again.' };
            }
        }

        console.log('[AIService] Making authenticated request with token expiring at:',
            new Date(tokenInfo.expiresAt).toISOString());

        let lastError: string = 'Unknown error';
        let lastStatusCode = 0;

        // Retry loop with exponential backoff
        for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
            try {
                const response = await fetch(this.getProxyUrl(), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${tokenInfo.accessToken}`,
                    },
                    body: JSON.stringify(body),
                });

                lastStatusCode = response.status;

                if (response.ok) {
                    // Success - reset failure tracking and circuit breaker
                    this.resetFailureTracking();
                    this.updateCircuitBreaker(true);
                    return await response.json() as GeminiProxyResponse;
                }

                const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as GeminiProxyResponse;
                lastError = errorData.error || `Request failed with status ${response.status}`;

                // If server says token is invalid/expired, return error but don't sign out
                // The auth service will handle session clearing during refresh attempts
                // Calling signOut() here is too aggressive and causes cascading failures
                if (response.status === 401 && errorData.error?.includes('Invalid or expired')) {
                    console.log('[AIService] Server rejected token - user may need to re-authenticate');
                    // Note: We don't call signOut() here because:
                    // 1. The token might have expired between refresh and request (race)
                    // 2. The auth service handles clearing invalid refresh tokens
                    // 3. Aggressive sign-out causes all concurrent requests to fail
                    return {
                        success: false,
                        error: 'Session expired. Please sign in again from Settings.'
                    };
                }

                // Check if this is a retryable error
                const isRetryable = RETRY_CONFIG.retryableStatusCodes.includes(response.status);

                if (!isRetryable || attempt >= RETRY_CONFIG.maxRetries) {
                    // Non-retryable error or max retries reached
                    console.error(`[AIService] Request failed (status ${response.status}), not retrying:`, errorData);

                    // Record failure for rate limiting tracking
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('Retry-After');
                        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
                        this.recordFailure(true, retryAfterMs);
                    } else {
                        this.recordFailure(false);
                    }

                    return {
                        success: false,
                        error: lastError,
                        isRateLimited: response.status === 429
                    };
                }

                // Calculate delay for retry with exponential backoff
                const delayMs = Math.min(
                    RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                    RETRY_CONFIG.maxDelayMs
                );

                console.log(`[AIService] ⚠️ Request failed with ${response.status} (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${delayMs}ms...`);
                await sleep(delayMs);

            } catch (error) {
                lastError = error instanceof Error ? error.message : 'Network error';
                console.error(`[AIService] Request error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, error);

                // Network errors are retryable
                if (attempt >= RETRY_CONFIG.maxRetries) {
                    this.recordFailure(false);
                    return {
                        success: false,
                        error: lastError
                    };
                }

                const delayMs = Math.min(
                    RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                    RETRY_CONFIG.maxDelayMs
                );
                console.log(`[AIService] Retrying in ${delayMs}ms...`);
                await sleep(delayMs);
            }
        }

        // Should not reach here, but just in case
        this.recordFailure(lastStatusCode === 429);
        return {
            success: false,
            error: lastError,
            isRateLimited: lastStatusCode === 429
        };
    }

    /**
     * Analyze a screenshot using Gemini Vision
     *
     * @param imagePath - Path to the screenshot file (will be read and base64 encoded)
     * @param appName - Optional application name for context
     * @param windowTitle - Optional window title for context
     * @param requestId - Optional request ID for tracking
     * @param signals - Optional context signals for richer analysis (calendar, user profile, etc.)
     */
    async analyzeScreenshot(
        imagePath: string,
        appName?: string,
        windowTitle?: string,
        requestId?: string,
        signals?: AnyContextSignal[]
    ): Promise<AnalysisResponse> {
        console.log('[AIService] Analyzing screenshot:', imagePath);
        if (signals && signals.length > 0) {
            console.log('[AIService] With context signals:', getSignalSummary(signals));
        }

        // Process and optimize the image
        const imageResult = await processImageForAnalysis(imagePath);
        if (!imageResult.success || !imageResult.base64) {
            console.error('[AIService] Failed to process image:', imageResult.error);
            return {
                success: false,
                description: this.generateFallbackDescription(appName, windowTitle),
                error: imageResult.error || 'Failed to process image file',
                requestId
            };
        }

        const result = await this.makeRequest({
            operation: 'analyze',
            imageBase64: imageResult.base64,
            appName,
            windowTitle,
            signals
        });

        if (result.success && result.description) {
            console.log('[AIService] Analysis successful:', result.description.substring(0, 100));
            return {
                success: true,
                description: result.description,
                confidence: result.confidence || 0.9,
                requestId
            };
        }

        // Return fallback on failure with detailed error info
        console.warn('[AIService] Analysis failed:', result.error, 'errorCode:', result.errorCode);
        return {
            success: false,
            description: this.generateFallbackDescription(appName, windowTitle),
            error: result.error || 'Analysis failed',
            errorCode: (result.errorCode as AIErrorCode) || AI_ERROR_CODES.UNKNOWN_ERROR,
            requestId,
            isRateLimited: result.isRateLimited,
            retryAfterSeconds: result.retryAfter
        };
    }

    /**
     * Classify an activity description to one of the provided options
     *
     * @param description - Activity description to classify
     * @param options - Available options with id and name
     * @param context - Optional additional context
     */
    async classifyActivity(
        description: string,
        options: Array<{ id: string; name: string }>,
        context?: string
    ): Promise<ClassifyResponse> {
        console.log('[AIService] Classifying activity with', options.length, 'options');

        const result = await this.makeRequest({
            operation: 'classify',
            description,
            options,
            context
        });

        if (result.success && result.selectedId) {
            console.log('[AIService] Classification successful:', result.selectedName);
            return {
                success: true,
                selected_id: result.selectedId,
                selected_name: result.selectedName,
                confidence: result.confidence || 0.8
            };
        }

        console.warn('[AIService] Classification failed:', result.error);
        return {
            success: false,
            error: result.error || 'Classification failed'
        };
    }

    /**
     * Execute an AI task with proper signal filtering by category
     *
     * This is the preferred method for running AI tasks. The proxy will filter
     * signals based on the task type to prevent cross-contamination:
     * - summarization: activity + temporal signals
     * - classification: activity signals only
     * - account_selection: activity + external signals
     * - split_suggestion: activity + temporal signals
     *
     * @param request - AITaskRequest containing task type, signals, and options
     */
    async executeTask(request: AITaskRequest): Promise<SummarizeResponse> {
        const { taskType, signals, includeUserContext, duration, startTime, endTime } = request;

        // Check if we have meaningful signal data
        if (!signals || signals.length === 0 || !hasSignalData(signals)) {
            console.warn(`[AIService] No meaningful signal data available for ${taskType}`);
            return {
                success: false,
                summary: 'No activity data available.',
                error: 'No context signals available'
            };
        }

        // Log signal summary for debugging
        const summary = getSignalSummary(signals);
        console.log(`[AIService] Executing ${taskType} with signals:`, JSON.stringify(summary));

        const result = await this.makeRequest({
            operation: 'summarize',
            taskType,
            includeUserContext,
            signals,
            duration,
            startTime,
            endTime
        });

        if (result.success && result.summary) {
            console.log(`[AIService] ${taskType} task successful`);
            return {
                success: true,
                summary: result.summary
            };
        }

        // Return fallback summary on failure
        console.warn(`[AIService] ${taskType} task failed:`, result.error);

        // Filter signals locally for fallback generation
        const filteredSignals = filterSignalsForTask(signals, taskType, includeUserContext);
        return {
            success: false,
            summary: this.generateFallbackFromSignals(filteredSignals),
            error: result.error || 'Task failed'
        };
    }

    /**
     * Summarize activities using the signal-based architecture
     *
     * This is a convenience method that calls executeTask with 'summarization' task type.
     * Signals are filtered to only include activity and temporal categories.
     *
     * @param request - SummarizeRequest containing signals and optional timing info
     */
    async summarizeWithSignals(request: SummarizeRequest): Promise<SummarizeResponse> {
        return this.executeTask({
            taskType: 'summarization',
            signals: request.signals,
            includeUserContext: false,
            duration: request.duration,
            startTime: request.startTime,
            endTime: request.endTime
        });
    }

    /**
     * @deprecated Use summarizeWithSignals() instead for new code.
     * Summarize multiple activity descriptions into a cohesive narrative
     * If no descriptions are provided, generates summary from activity context (appNames, windowTitles)
     *
     * @param descriptions - Array of activity descriptions (can be empty for context-only generation)
     * @param appNames - Optional array of app names used
     * @param windowTitles - Optional array of window titles observed
     */
    async summarizeActivities(
        descriptions: string[],
        appNames?: string[],
        windowTitles?: string[]
    ): Promise<SummarizeResponse> {
        const hasDescriptions = descriptions && descriptions.length > 0;
        console.log('[AIService] Summarizing', hasDescriptions ? `${descriptions.length} activities` : 'from context only');
        console.log('[AIService] App names:', appNames?.length || 0, 'Window titles:', windowTitles?.length || 0);

        const result = await this.makeRequest({
            operation: 'summarize',
            descriptions,
            appNames,
            windowTitles
        });

        if (result.success && result.summary) {
            console.log('[AIService] Summarization successful');
            return {
                success: true,
                summary: result.summary
            };
        }

        // Return fallback summary on failure
        console.warn('[AIService] Summarization failed:', result.error);
        const fallbackSummary = hasDescriptions
            ? this.generateFallbackSummary(descriptions, appNames)
            : this.generateFallbackFromContext(appNames, windowTitles);
        return {
            success: false,
            summary: fallbackSummary,
            error: result.error || 'Summarization failed'
        };
    }

    /**
     * Generate a fallback description when AI fails
     */
    private generateFallbackDescription(appName?: string, windowTitle?: string): string {
        if (appName && windowTitle) {
            return `Working in ${appName}: ${windowTitle}`;
        }
        if (appName) {
            return `Working in ${appName}`;
        }
        if (windowTitle) {
            return `Working on: ${windowTitle}`;
        }
        return 'Working on computer';
    }

    /**
     * Generate a fallback summary when AI fails
     */
    private generateFallbackSummary(descriptions: string[], appNames?: string[]): string {
        const uniqueApps = appNames ? [...new Set(appNames)] : [];
        const appText = uniqueApps.length > 0 ? ` using ${uniqueApps.join(', ')}` : '';
        return `Completed ${descriptions.length} activities${appText}.`;
    }

    /**
     * Generate a fallback description from activity context when AI fails (no screenshots)
     */
    private generateFallbackFromContext(appNames?: string[], windowTitles?: string[]): string {
        const uniqueApps = appNames ? [...new Set(appNames)] : [];
        const uniqueTitles = windowTitles ? [...new Set(windowTitles)].filter(t => t && t !== '(No window title available)') : [];

        if (uniqueApps.length > 0 && uniqueTitles.length > 0) {
            return `Worked in ${uniqueApps.slice(0, 3).join(', ')}${uniqueApps.length > 3 ? ' and more' : ''}, viewing ${uniqueTitles[0]}${uniqueTitles.length > 1 ? ` and ${uniqueTitles.length - 1} other windows` : ''}.`;
        }
        if (uniqueApps.length > 0) {
            return `Worked in ${uniqueApps.join(', ')}.`;
        }
        if (uniqueTitles.length > 0) {
            return `Worked on ${uniqueTitles[0]}${uniqueTitles.length > 1 ? ` and ${uniqueTitles.length - 1} other items` : ''}.`;
        }
        return 'Completed work session.';
    }

    /**
     * Generate a fallback description from context signals when AI fails
     */
    private generateFallbackFromSignals(signals: AnyContextSignal[]): string {
        const parts: string[] = [];
        let screenshotCount = 0;
        let appNames: string[] = [];
        let windowTitles: string[] = [];
        let currentEvent: string | undefined;

        // Extract data from signals
        for (const signal of signals) {
            switch (signal.type) {
                case 'screenshot_analysis': {
                    const data = signal.data as { descriptions: string[]; count: number };
                    screenshotCount = data.count || data.descriptions?.length || 0;
                    break;
                }
                case 'window_activity': {
                    const data = signal.data as { appNames: string[]; windowTitles: string[] };
                    if (data.appNames) appNames = [...new Set([...appNames, ...data.appNames])];
                    if (data.windowTitles) {
                        const filtered = data.windowTitles.filter(t => t && t !== '(No window title available)');
                        windowTitles = [...new Set([...windowTitles, ...filtered])];
                    }
                    break;
                }
                case 'calendar_events': {
                    const data = signal.data as { currentEvent?: string };
                    if (data.currentEvent) currentEvent = data.currentEvent;
                    break;
                }
            }
        }

        // Build fallback description
        if (screenshotCount > 0) {
            parts.push(`Completed ${screenshotCount} activities`);
        }

        if (currentEvent) {
            parts.push(`during "${currentEvent}"`);
        }

        if (appNames.length > 0) {
            const apps = appNames.slice(0, 3).join(', ');
            const more = appNames.length > 3 ? ' and more' : '';
            if (parts.length > 0) {
                parts.push(`using ${apps}${more}`);
            } else {
                parts.push(`Worked in ${apps}${more}`);
            }
        }

        if (parts.length === 0 && windowTitles.length > 0) {
            parts.push(`Worked on ${windowTitles[0]}`);
            if (windowTitles.length > 1) {
                parts.push(`and ${windowTitles.length - 1} other items`);
            }
        }

        if (parts.length === 0) {
            return 'Completed work session.';
        }

        return parts.join(' ') + '.';
    }

    /**
     * Check if AI service is available (user is authenticated)
     */
    async isAvailable(): Promise<boolean> {
        const authService = getAuthService();
        const session = await authService.getSession();
        return session !== null;
    }

    /**
     * Get server status - for compatibility with FastVLM interface
     * Cloud service is always "running" when authenticated
     */
    getStatus(): { isRunning: boolean; url: string } {
        return {
            isRunning: true,
            url: this.getProxyUrl()
        };
    }

    /**
     * Get rate limit status for queue management
     */
    getRateLimitStatus(): {
        isRateLimited: boolean;
        remainingMs: number;
        consecutiveFailures: number;
    } {
        return {
            isRateLimited: this.isRateLimited(),
            remainingMs: this.getRateLimitRemainingMs(),
            consecutiveFailures: this.consecutiveFailures
        };
    }
}

// Export singleton instance
export const aiService = new AIService();
