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
            return { success: false, error: 'Not authenticated' };
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
     */
    async analyzeScreenshot(
        imagePath: string,
        appName?: string,
        windowTitle?: string,
        requestId?: string
    ): Promise<AnalysisResponse> {
        console.log('[AIService] Analyzing screenshot:', imagePath);

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
            windowTitle
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
     * Summarize multiple activity descriptions into a cohesive narrative
     *
     * @param descriptions - Array of activity descriptions
     * @param appNames - Optional array of app names used
     */
    async summarizeActivities(
        descriptions: string[],
        appNames?: string[]
    ): Promise<SummarizeResponse> {
        console.log('[AIService] Summarizing', descriptions.length, 'activities');

        const result = await this.makeRequest({
            operation: 'summarize',
            descriptions,
            appNames
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
        const fallbackSummary = this.generateFallbackSummary(descriptions, appNames);
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
