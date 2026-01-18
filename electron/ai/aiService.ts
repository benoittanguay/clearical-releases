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
    requestId?: string;
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
}

/**
 * AI Service - Cloud-based AI via Supabase Edge Function
 */
class AIService {
    private config = getConfig();

    /**
     * Get the Gemini proxy endpoint URL
     */
    private getProxyUrl(): string {
        return `${this.config.supabase.url}/functions/v1/gemini-proxy`;
    }

    /**
     * Make an authenticated request to the Gemini proxy
     */
    private async makeRequest(body: Record<string, unknown>): Promise<GeminiProxyResponse> {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            console.log('[AIService] No active session, AI features unavailable');
            return { success: false, error: 'Not authenticated. Please sign in again.' };
        }

        try {
            const response = await fetch(this.getProxyUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.accessToken}`,
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as GeminiProxyResponse;
                console.error('[AIService] Proxy request failed:', response.status, errorData);

                // If server says token is invalid/expired, clear local session and prompt re-auth
                if (response.status === 401 && errorData.error?.includes('Invalid or expired')) {
                    console.log('[AIService] Server rejected token, clearing local session');
                    await authService.signOut();
                    return {
                        success: false,
                        error: 'Session expired. Please sign in again from Settings.'
                    };
                }

                return {
                    success: false,
                    error: errorData.error || `Request failed with status ${response.status}`
                };
            }

            return await response.json() as GeminiProxyResponse;
        } catch (error) {
            console.error('[AIService] Request error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Network error'
            };
        }
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

        // Read and encode the image
        let imageBase64: string;
        try {
            const imageBuffer = await fs.promises.readFile(imagePath);
            imageBase64 = imageBuffer.toString('base64');
        } catch (error) {
            console.error('[AIService] Failed to read image:', error);
            return {
                success: false,
                description: this.generateFallbackDescription(appName, windowTitle),
                error: 'Failed to read image file',
                requestId
            };
        }

        const result = await this.makeRequest({
            operation: 'analyze',
            imageBase64,
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

        // Return fallback on failure
        console.warn('[AIService] Analysis failed:', result.error);
        return {
            success: false,
            description: this.generateFallbackDescription(appName, windowTitle),
            error: result.error || 'Analysis failed',
            requestId
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
}

// Export singleton instance
export const aiService = new AIService();
