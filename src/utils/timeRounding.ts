/**
 * Time rounding utilities for Clearical
 *
 * Provides functions to round time entries up to configurable increments
 * for billing and time tracking purposes.
 */

/**
 * Round elapsed time UP to the next increment
 *
 * Examples with 15-minute increment:
 * - 0:01 to 0:15 → 0:15
 * - 0:16 to 0:30 → 0:30
 * - 1:01 to 1:15 → 1:15
 *
 * @param seconds - The elapsed time in seconds
 * @param incrementMinutes - The rounding increment in minutes (e.g., 15 for 15-minute increments)
 * @returns Rounded time in seconds
 */
export function roundTimeToIncrement(seconds: number, incrementMinutes: number): number {
    // Handle edge cases
    if (seconds <= 0) return 0;
    if (incrementMinutes <= 0) return seconds; // No rounding if increment is invalid

    // Convert increment to seconds
    const incrementSeconds = incrementMinutes * 60;

    // Round up to the nearest increment
    // Math.ceil ensures we always round UP
    return Math.ceil(seconds / incrementSeconds) * incrementSeconds;
}

/**
 * Format the difference between original and rounded time
 *
 * @param originalSeconds - Original time in seconds
 * @param roundedSeconds - Rounded time in seconds
 * @returns Formatted string showing the difference (e.g., "+5m" or "+15s")
 */
export function formatRoundingDifference(originalSeconds: number, roundedSeconds: number): string {
    const diffSeconds = roundedSeconds - originalSeconds;

    if (diffSeconds === 0) return '';

    const diffMinutes = Math.floor(diffSeconds / 60);
    const remainingSeconds = diffSeconds % 60;

    if (diffMinutes > 0 && remainingSeconds > 0) {
        return `+${diffMinutes}m ${remainingSeconds}s`;
    } else if (diffMinutes > 0) {
        return `+${diffMinutes}m`;
    } else {
        return `+${remainingSeconds}s`;
    }
}

/**
 * Format time in HH:MM format
 *
 * @param seconds - Time in seconds
 * @returns Formatted time string (e.g., "1:45" or "0:15")
 */
export function formatTimeHHMM(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Get available time increment options
 * Returns an array of common time increments in minutes
 */
export function getTimeIncrementOptions(): Array<{ value: number; label: string }> {
    return [
        { value: 1, label: 'No rounding (1 minute)' },
        { value: 5, label: '5 minutes' },
        { value: 10, label: '10 minutes' },
        { value: 15, label: '15 minutes' },
        { value: 30, label: '30 minutes' },
        { value: 60, label: '1 hour' }
    ];
}

/**
 * Convert milliseconds to seconds (for compatibility with time entry durations)
 */
export function millisecondsToSeconds(ms: number): number {
    return Math.floor(ms / 1000);
}

/**
 * Convert seconds to milliseconds (for compatibility with time entry durations)
 */
export function secondsToMilliseconds(seconds: number): number {
    return seconds * 1000;
}
