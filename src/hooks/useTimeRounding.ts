/**
 * Custom hook for time rounding functionality
 *
 * Provides easy access to time rounding based on user settings
 */

import { useMemo } from 'react';
import { useSettings } from '../context/SettingsContext';
import {
    roundTimeToIncrement,
    formatRoundingDifference,
    formatTimeHHMM,
    millisecondsToSeconds,
    secondsToMilliseconds
} from '../utils/timeRounding';

export interface RoundedTime {
    original: number; // Original time in milliseconds
    rounded: number; // Rounded time in milliseconds
    originalSeconds: number; // Original time in seconds
    roundedSeconds: number; // Rounded time in seconds
    difference: number; // Difference in milliseconds
    differenceSeconds: number; // Difference in seconds
    formattedOriginal: string; // Formatted original time (HH:MM)
    formattedRounded: string; // Formatted rounded time (HH:MM)
    formattedDifference: string; // Formatted difference (e.g., "+5m")
    isRounded: boolean; // Whether rounding was applied
}

export function useTimeRounding() {
    const { settings } = useSettings();

    /**
     * Round a time entry duration based on current settings
     *
     * @param durationMs - Duration in milliseconds
     * @returns RoundedTime object with original and rounded values
     */
    const roundTime = useMemo(() => {
        return (durationMs: number): RoundedTime => {
            const originalSeconds = millisecondsToSeconds(durationMs);
            const roundedSeconds = roundTimeToIncrement(originalSeconds, settings.timeRoundingIncrement);
            const roundedMs = secondsToMilliseconds(roundedSeconds);
            const differenceSeconds = roundedSeconds - originalSeconds;
            const differenceMs = roundedMs - durationMs;

            return {
                original: durationMs,
                rounded: roundedMs,
                originalSeconds,
                roundedSeconds,
                difference: differenceMs,
                differenceSeconds,
                formattedOriginal: formatTimeHHMM(originalSeconds),
                formattedRounded: formatTimeHHMM(roundedSeconds),
                formattedDifference: formatRoundingDifference(originalSeconds, roundedSeconds),
                isRounded: differenceSeconds > 0
            };
        };
    }, [settings.timeRoundingIncrement]);

    /**
     * Get the current time rounding increment in minutes
     */
    const incrementMinutes = settings.timeRoundingIncrement;

    /**
     * Check if rounding is enabled (increment > 1 minute)
     */
    const isRoundingEnabled = settings.timeRoundingIncrement > 1;

    return {
        roundTime,
        incrementMinutes,
        isRoundingEnabled
    };
}
