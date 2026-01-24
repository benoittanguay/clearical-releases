/**
 * Shared constants used across the TimePortal application
 */

/**
 * Fallback description used when AI screenshot analysis fails.
 * This string is displayed in place of an AI-generated description when:
 * - The AI service is unavailable
 * - The user is not authenticated
 * - Rate limits are exceeded
 * - Analysis encounters an error
 */
export const FALLBACK_SCREENSHOT_DESCRIPTION = 'Screenshot captured during work session';
