/**
 * Transcription Usage Component
 *
 * Displays the user's current transcription usage and limits.
 * Shows a progress bar and remaining time for free tier users.
 */

import { useState, useEffect } from 'react';
import { useSubscription } from '../context/SubscriptionContext';

interface UsageData {
    monthlyUsedSeconds: number;
    monthlyLimitSeconds: number;
    remainingSeconds: number;
    isPremium: boolean;
}

/**
 * Format seconds to hours and minutes
 */
function formatTime(seconds: number): string {
    if (seconds < 0) return 'Unlimited';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours} hours`;
    }
    return `${minutes} minutes`;
}

interface TranscriptionUsageProps {
    compact?: boolean;
    onUpgrade?: () => void;
}

export function TranscriptionUsage({ compact = false, onUpgrade }: TranscriptionUsageProps): JSX.Element {
    const { hasFeature, upgrade } = useSubscription();
    const [usage, setUsage] = useState<UsageData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchUsage() {
            try {
                setIsLoading(true);
                const result = await window.electron.ipcRenderer.meeting.getTranscriptionUsage();
                if (result.success && result.usage) {
                    setUsage(result.usage);
                } else {
                    setError(result.error || 'Failed to load usage');
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load usage');
            } finally {
                setIsLoading(false);
            }
        }

        fetchUsage();
    }, []);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Loading usage...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                Unable to load usage data
            </div>
        );
    }

    if (!usage) {
        return null;
    }

    // Premium users have unlimited usage
    if (usage.isPremium || usage.monthlyLimitSeconds < 0) {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)' }}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="rgb(34, 197, 94)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                </div>
                <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Unlimited transcription
                </span>
            </div>
        );
    }

    // Calculate usage percentage
    const usedPercent = Math.min(100, (usage.monthlyUsedSeconds / usage.monthlyLimitSeconds) * 100);
    const isNearLimit = usedPercent >= 80;
    const isAtLimit = usedPercent >= 100;

    // Determine color based on usage
    const barColor = isAtLimit
        ? 'rgb(239, 68, 68)' // Red
        : isNearLimit
            ? 'rgb(234, 179, 8)' // Yellow
            : 'rgb(59, 130, 246)'; // Blue

    if (compact) {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="w-24 h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
                >
                    <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                            width: `${usedPercent}%`,
                            backgroundColor: barColor,
                        }}
                    />
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {formatTime(usage.remainingSeconds)} left
                </span>
            </div>
        );
    }

    return (
        <div
            className="rounded-lg border p-4"
            style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-primary)',
            }}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-text-secondary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                    <span className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>
                        Transcription Usage
                    </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    This month
                </span>
            </div>

            {/* Progress bar */}
            <div
                className="w-full h-2 rounded-full overflow-hidden mb-2"
                style={{ backgroundColor: 'var(--color-bg-quaternary)' }}
            >
                <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                        width: `${usedPercent}%`,
                        backgroundColor: barColor,
                    }}
                />
            </div>

            {/* Usage stats */}
            <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-secondary)' }}>
                    {formatTime(usage.monthlyUsedSeconds)} used
                </span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {formatTime(usage.monthlyLimitSeconds)} limit
                </span>
            </div>

            {/* Warning/upgrade prompt */}
            {isAtLimit && (
                <div
                    className="mt-3 p-3 rounded-lg flex items-center justify-between"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
                >
                    <span className="text-sm" style={{ color: 'rgb(239, 68, 68)' }}>
                        Monthly limit reached
                    </span>
                    {(onUpgrade || upgrade) && (
                        <button
                            onClick={onUpgrade || upgrade}
                            className="text-sm font-medium px-3 py-1 rounded-lg transition-colors"
                            style={{
                                backgroundColor: 'var(--color-accent)',
                                color: 'white',
                            }}
                        >
                            Upgrade
                        </button>
                    )}
                </div>
            )}

            {isNearLimit && !isAtLimit && (
                <div
                    className="mt-3 p-3 rounded-lg flex items-center justify-between"
                    style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)' }}
                >
                    <span className="text-sm" style={{ color: 'rgb(161, 128, 22)' }}>
                        {formatTime(usage.remainingSeconds)} remaining
                    </span>
                    {(onUpgrade || upgrade) && (
                        <button
                            onClick={onUpgrade || upgrade}
                            className="text-xs font-medium"
                            style={{ color: 'var(--color-accent)' }}
                        >
                            Upgrade for unlimited
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
