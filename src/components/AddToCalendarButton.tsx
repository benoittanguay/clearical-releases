import { useState } from 'react';
import type { TimeEntry } from '../types/shared';
import { analytics } from '../services/analytics';

interface AddToCalendarButtonProps {
    entry: TimeEntry;
    bucketName?: string;
    onNavigateToSettings?: () => void;
    jiraBaseUrl?: string;
}

export function AddToCalendarButton({ entry, bucketName, onNavigateToSettings, jiraBaseUrl }: AddToCalendarButtonProps) {
    const [isChecking, setIsChecking] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [isAdded, setIsAdded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAddToCalendar = async () => {
        setIsChecking(true);
        setError(null);

        try {
            // Check if calendar is connected
            const connectionResult = await window.electron.ipcRenderer.calendar.isConnected();

            if (!connectionResult.success) {
                setError('Failed to check calendar connection');
                analytics.track('calendar.add_focus_time_failed', {
                    error: 'connection_check_failed',
                    entryId: entry.id
                });
                return;
            }

            if (!connectionResult.connected) {
                // Not connected - prompt user to connect
                if (onNavigateToSettings) {
                    analytics.track('calendar.add_focus_time_prompt_connect', {
                        entryId: entry.id
                    });
                    if (window.confirm('Calendar is not connected. Would you like to go to settings to connect your calendar?')) {
                        onNavigateToSettings();
                    }
                } else {
                    setError('Calendar not connected');
                }
                return;
            }

            // Calendar is connected - create the focus time event
            setIsChecking(false);
            setIsAdding(true);

            // Build event title
            let title = 'Focus Time';
            if (entry.assignment?.type === 'jira' && entry.assignment.jiraIssue) {
                title = `Focus Time: ${entry.assignment.jiraIssue.key}`;
            } else if (entry.assignment?.type === 'bucket' && entry.assignment.bucket) {
                title = `Focus Time: ${entry.assignment.bucket.name}`;
            } else if (bucketName) {
                title = `Focus Time: ${bucketName}`;
            }

            // Build event description
            const descriptionParts: string[] = [];

            if (entry.description) {
                descriptionParts.push(entry.description);
            }

            if (entry.assignment?.type === 'jira' && entry.assignment.jiraIssue) {
                const jiraIssue = entry.assignment.jiraIssue;
                descriptionParts.push(`\nJira Issue: ${jiraIssue.key} - ${jiraIssue.summary}`);
                if (jiraBaseUrl) {
                    descriptionParts.push(`Link: ${jiraBaseUrl}/browse/${jiraIssue.key}`);
                }
            }

            const durationMinutes = Math.round(entry.duration / (1000 * 60));
            descriptionParts.push(`\nDuration: ${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`);

            const description = descriptionParts.join('\n');

            // Create the event
            analytics.track('calendar.add_focus_time_initiated', {
                entryId: entry.id,
                title,
                duration: entry.duration
            });

            const result = await window.electron.ipcRenderer.calendar.createFocusTime({
                title,
                description,
                startTime: entry.startTime,
                endTime: entry.startTime + entry.duration
            });

            if (result.success && result.eventId) {
                setIsAdded(true);
                analytics.track('calendar.add_focus_time_success', {
                    entryId: entry.id,
                    eventId: result.eventId
                });

                // Keep the success state visible for a few seconds
                setTimeout(() => {
                    setIsAdded(false);
                }, 3000);
            } else {
                setError(result.error || 'Failed to create calendar event');
                analytics.track('calendar.add_focus_time_failed', {
                    entryId: entry.id,
                    error: result.error || 'unknown_error'
                });
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setError(errorMessage);
            analytics.track('calendar.add_focus_time_failed', {
                entryId: entry.id,
                error: errorMessage
            });
        } finally {
            setIsChecking(false);
            setIsAdding(false);
        }
    };

    const isLoading = isChecking || isAdding;

    return (
        <div className="flex flex-col gap-2">
            <button
                onClick={handleAddToCalendar}
                disabled={isLoading || isAdded}
                className="px-3 py-1.5 text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:cursor-not-allowed"
                style={{
                    backgroundColor: isAdded ? 'var(--color-success)' : isLoading ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
                    color: isAdded ? '#FFFFFF' : 'var(--color-text-primary)',
                    borderRadius: 'var(--btn-radius)',
                    transitionDuration: 'var(--duration-fast)',
                    transitionTimingFunction: 'var(--ease-out)',
                    boxShadow: isAdded ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                    border: isAdded ? 'none' : '1px solid var(--color-border-primary)',
                    opacity: isLoading ? 0.6 : 1
                }}
                onMouseEnter={(e) => {
                    if (!isLoading && !isAdded) {
                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (!isLoading && !isAdded) {
                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                    }
                }}
            >
                {isLoading ? (
                    <>
                        <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                        </svg>
                        {isChecking ? 'Checking...' : 'Adding...'}
                    </>
                ) : isAdded ? (
                    <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Added to Calendar
                    </>
                ) : (
                    <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        Add to Calendar
                    </>
                )}
            </button>

            {error && (
                <div className="text-xs px-2 py-1 rounded" style={{
                    color: 'var(--color-error)',
                    backgroundColor: 'var(--color-error-bg)',
                    border: '1px solid var(--color-error)'
                }}>
                    {error}
                </div>
            )}
        </div>
    );
}
