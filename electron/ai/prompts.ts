/**
 * AI Prompts Reference
 *
 * The actual prompts are defined in the Supabase Edge Function (gemini-proxy).
 * This file contains operation types and any client-side prompt helpers.
 *
 * Note: Previously, prompts were loaded from JSON files and sent to the local
 * FastVLM server. With the cloud-based Gemini integration, prompts are managed
 * server-side for better security and easier updates.
 */

/**
 * AI operation types supported by the Gemini proxy
 */
export const AI_OPERATIONS = {
    /**
     * Analyze a screenshot image and describe the user's activity
     * Input: imageBase64, appName?, windowTitle?
     * Output: description, confidence
     */
    ANALYZE: 'analyze',

    /**
     * Classify an activity description to one of the provided options
     * Input: description, options[], context?
     * Output: selectedId, selectedName, confidence
     */
    CLASSIFY: 'classify',

    /**
     * Summarize multiple activity descriptions into a narrative
     * Input: descriptions[], appNames?
     * Output: summary
     */
    SUMMARIZE: 'summarize',
} as const;

export type AIOperation = typeof AI_OPERATIONS[keyof typeof AI_OPERATIONS];

/**
 * Fallback description templates for when AI is unavailable
 */
export const FALLBACK_TEMPLATES = {
    /**
     * Generate description when we have both app and window
     */
    withAppAndWindow: (appName: string, windowTitle: string) =>
        `Working in ${appName}: ${windowTitle}`,

    /**
     * Generate description when we only have app name
     */
    withAppOnly: (appName: string) =>
        `Working in ${appName}`,

    /**
     * Generate description when we only have window title
     */
    withWindowOnly: (windowTitle: string) =>
        `Working on: ${windowTitle}`,

    /**
     * Default fallback when no context available
     */
    default: 'Working on computer',

    /**
     * Generate summary fallback
     */
    summary: (count: number, apps?: string[]) => {
        const appText = apps && apps.length > 0
            ? ` using ${[...new Set(apps)].join(', ')}`
            : '';
        return `Completed ${count} activities${appText}.`;
    },
};

/**
 * Rate limits for reference (actual enforcement is server-side)
 */
export const RATE_LIMITS = {
    FREE_TIER: 50,      // requests per day
    PREMIUM_TIER: 500,  // requests per day
} as const;
