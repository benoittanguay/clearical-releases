import React from 'react';
import type { TimeEntry, TimeBucket } from '../context/StorageContext';
import { DeleteButton } from './DeleteButton';

interface WorklogEntryListProps {
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    onEntryClick: (entryId: string) => void;
    onDeleteEntry: (entryId: string) => void;
    onBulkLogToTempo?: (dateKey: string) => void;
    tempoEnabled?: boolean;
    /** When true, simplifies the UI for detail views (hides redundant Jira info, shows only day-level Log to Tempo) */
    isDetailView?: boolean;
}

export const WorklogEntryList: React.FC<WorklogEntryListProps> = ({
    entries,
    buckets,
    formatTime,
    onEntryClick,
    onDeleteEntry,
    onBulkLogToTempo,
    tempoEnabled = false,
    isDetailView = false
}) => {
    // Helper function to get the start of week (Monday) for a given date
    const getWeekStart = (date: Date): Date => {
        const d = new Date(date);
        const day = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);
        return weekStart;
    };

    // Helper function to get the end of week (Sunday) for a given date
    const getWeekEnd = (date: Date): Date => {
        const weekStart = getWeekStart(date);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        return weekEnd;
    };

    // Group entries by date first
    const sortedEntries = [...entries].sort((a, b) => b.startTime - a.startTime);
    const groupedByDate = new Map<string, TimeEntry[]>();

    sortedEntries.forEach(entry => {
        const date = new Date(entry.startTime);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.getTime().toString();

        if (!groupedByDate.has(dateKey)) {
            groupedByDate.set(dateKey, []);
        }
        groupedByDate.get(dateKey)!.push(entry);
    });

    // Group dates by week
    const groupedByWeek = new Map<string, Array<[string, TimeEntry[]]>>();

    Array.from(groupedByDate.entries()).forEach(([dateKey, dateEntries]) => {
        const date = new Date(parseInt(dateKey));
        const weekStart = getWeekStart(date);
        const weekKey = weekStart.getTime().toString();

        if (!groupedByWeek.has(weekKey)) {
            groupedByWeek.set(weekKey, []);
        }
        groupedByWeek.get(weekKey)!.push([dateKey, dateEntries]);
    });

    // Format date labels
    const formatDateLabel = (timestamp: number): string => {
        const date = new Date(timestamp);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.getTime() === today.getTime()) {
            return 'Today';
        } else if (date.getTime() === yesterday.getTime()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        }
    };

    // Format week range label
    const formatWeekLabel = (weekStartTimestamp: number): string => {
        const weekStart = new Date(weekStartTimestamp);
        const weekEnd = getWeekEnd(weekStart);

        const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        const startStr = weekStart.toLocaleDateString('en-US', formatOptions);
        const endStr = weekEnd.toLocaleDateString('en-US', formatOptions);

        return `Week of ${startStr} - ${endStr}`;
    };

    if (entries.length === 0) {
        return (
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                No activities recorded yet.
            </div>
        );
    }

    return (
        <div>
            {Array.from(groupedByWeek.entries()).map(([weekKey, weekDays]) => {
                // Helper to calculate rounded duration (15-minute increments)
                const getRoundedDuration = (duration: number) =>
                    Math.ceil(duration / (15 * 60 * 1000)) * (15 * 60 * 1000);

                // Calculate total duration for the week using rounded values
                const weekTotalDuration = weekDays.reduce((weekSum, [, dateEntries]) =>
                    weekSum + dateEntries.reduce((daySum, entry) => daySum + getRoundedDuration(entry.duration), 0), 0
                );

                // Check if this week has any Jira activities
                const weekHasLoggableJiraActivities = weekDays.some(([, dateEntries]) =>
                    dateEntries.some(entry => {
                        const assignment = entry.assignment ||
                            (entry.linkedJiraIssue ? {
                                type: 'jira' as const,
                                jiraIssue: entry.linkedJiraIssue
                            } : null);

                        return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
                    })
                );

                return (
                    <div key={weekKey} className="mb-6 last:mb-0">
                        {/* Week Header - Sticky and more prominent */}
                        <div
                            className="sticky top-0 z-20 px-2.5 py-2 flex items-center justify-between"
                            style={{
                                backgroundColor: 'var(--color-bg-primary)',
                                backdropFilter: 'blur(8px)',
                                borderBottom: '1px solid var(--color-border-primary)'
                            }}
                        >
                            <h2
                                className="text-xs font-bold uppercase tracking-wider"
                                style={{
                                    color: 'var(--color-text-secondary)',
                                    fontFamily: 'var(--font-display)'
                                }}
                            >
                                {formatWeekLabel(parseInt(weekKey))}
                            </h2>
                            <div className="flex items-center gap-3">
                                {/* Hide week-level Log to Tempo in detail view - only show at day level */}
                                {!isDetailView && tempoEnabled && weekHasLoggableJiraActivities && onBulkLogToTempo && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onBulkLogToTempo(weekKey);
                                        }}
                                        className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs transition-all active:scale-95"
                                        style={{
                                            backgroundColor: 'var(--color-accent)',
                                            color: '#FFFFFF',
                                            borderRadius: 'var(--btn-radius)',
                                            transitionDuration: 'var(--duration-fast)',
                                            transitionTimingFunction: 'var(--ease-out)',
                                            boxShadow: 'var(--shadow-accent)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = '#E64000';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                        }}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10"/>
                                            <path d="M12 6v6l4 2"/>
                                        </svg>
                                        Log to Tempo
                                    </button>
                                )}
                                <span
                                    className="text-sm font-mono font-bold mr-10"
                                    style={{
                                        color: 'var(--color-accent)',
                                        fontFamily: 'var(--font-mono)'
                                    }}
                                >
                                    {formatTime(weekTotalDuration)}
                                </span>
                            </div>
                        </div>

                        {/* Days within the week - no gap from week header */}
                        <div>
                            {weekDays.map(([dateKey, dateEntries], dayIndex) => {
                                // Calculate total using rounded durations
                                const totalDuration = dateEntries.reduce((sum, entry) => sum + getRoundedDuration(entry.duration), 0);

                                // Check if this day has any Jira activities with all required info
                                const hasLoggableJiraActivities = dateEntries.some(entry => {
                                    const assignment = entry.assignment ||
                                        (entry.linkedJiraIssue ? {
                                            type: 'jira' as const,
                                            jiraIssue: entry.linkedJiraIssue
                                        } : null);

                                    return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
                                });

                                return (
                                    <div key={dateKey} className={dayIndex > 0 ? 'mt-3' : ''}>
                                        {/* Date Separator Header - Sticky below week header */}
                                        <div
                                            className="sticky z-10 px-2.5 py-2 flex items-center justify-between"
                                            style={{
                                                backgroundColor: 'var(--color-bg-secondary)',
                                                borderBottom: '1px solid var(--color-border-primary)',
                                                top: '33px', // Height of week header (py-2 = 16px + text ~16px + border 1px)
                                                marginTop: dayIndex === 0 ? '-1px' : undefined
                                            }}
                                        >
                                            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                                                {formatDateLabel(parseInt(dateKey))}
                                            </h3>
                                            <div className="flex items-center gap-3">
                                                {tempoEnabled && hasLoggableJiraActivities && onBulkLogToTempo && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onBulkLogToTempo(dateKey);
                                                        }}
                                                        className="no-drag flex items-center gap-1.5 px-2 py-1 text-xs transition-all active:scale-95"
                                                        style={{
                                                            backgroundColor: 'var(--color-accent)',
                                                            color: '#FFFFFF',
                                                            borderRadius: 'var(--btn-radius)',
                                                            transitionDuration: 'var(--duration-fast)',
                                                            transitionTimingFunction: 'var(--ease-out)',
                                                            boxShadow: 'var(--shadow-accent)'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = '#E64000';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                                        }}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <circle cx="12" cy="12" r="10"/>
                                                            <path d="M12 6v6l4 2"/>
                                                        </svg>
                                                        Log to Tempo
                                                    </button>
                                                )}
                                                <span className="text-xs font-mono mr-10" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                                                    {formatTime(totalDuration)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Activities for this date */}
                                        <div className="space-y-2 mt-4">
                                            {dateEntries.map(entry => {
                                                // Get assignment info from unified model or fallback to legacy fields
                                                const assignment = entry.assignment ||
                                                    (entry.linkedJiraIssue ? {
                                                        type: 'jira' as const,
                                                        jiraIssue: entry.linkedJiraIssue
                                                    } : entry.bucketId ? {
                                                        type: 'bucket' as const,
                                                        bucket: buckets.find(b => b.id === entry.bucketId)
                                                    } : null);

                                                // Calculate rounded time
                                                const actualDuration = entry.duration;
                                                const roundedDuration = Math.ceil(actualDuration / (15 * 60 * 1000)) * (15 * 60 * 1000);
                                                const roundedDiff = roundedDuration - actualDuration;

                                                return (
                                                    <div
                                                        key={entry.id}
                                                        onClick={() => onEntryClick(entry.id)}
                                                        className="flex justify-between items-center p-2.5 rounded-lg cursor-pointer"
                                                        data-hoverable
                                                        data-default-bg="white"
                                                        data-default-border="var(--color-border-primary)"
                                                        data-hover-bg="#FAF5EE"
                                                        data-hover-border="var(--color-border-secondary)"
                                                        style={{
                                                            backgroundColor: 'white',
                                                            border: '1px solid var(--color-border-primary)',
                                                            transition: 'all var(--duration-base) var(--ease-out)'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = '#FAF5EE';
                                                            e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = 'white';
                                                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                                        }}
                                                    >
                                                        <div className="flex flex-col flex-1 min-w-0">
                                                            {/* Display assignment info - hide Jira info in detail view since it's in the header */}
                                                            {assignment && !(isDetailView && assignment.type === 'jira') && (
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <div
                                                                        className="w-2 h-2 rounded-full"
                                                                        style={{
                                                                            backgroundColor: assignment.type === 'bucket'
                                                                                ? assignment.bucket?.color || '#6b7280'
                                                                                : '#3b82f6' // Blue for Jira issues
                                                                        }}
                                                                    />
                                                                    <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                                                                        {assignment.type === 'bucket'
                                                                            ? assignment.bucket?.name || 'Unknown Bucket'
                                                                            : assignment.jiraIssue?.key || 'Unknown Issue'
                                                                        }
                                                                    </span>
                                                                    {assignment.type === 'jira' && assignment.jiraIssue && (
                                                                        <>
                                                                            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                                                                {assignment.jiraIssue.projectName}
                                                                            </span>
                                                                            <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
                                                                                {assignment.jiraIssue.issueType}
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {/* Secondary info for Jira issues - hide in detail view */}
                                                            {!isDetailView && assignment?.type === 'jira' && assignment.jiraIssue && (
                                                                <div className="text-xs mb-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                                                    {assignment.jiraIssue.summary}
                                                                </div>
                                                            )}
                                                            {entry.description && (
                                                                <p className="text-xs mb-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{entry.description}</p>
                                                            )}
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-xs" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                                                                    {new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} - {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                                                                </span>
                                                                {roundedDiff > 0 && (
                                                                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                                                        +{formatTime(roundedDiff)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="font-mono font-bold" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                                                                {formatTime(roundedDuration)}
                                                            </div>
                                                            <DeleteButton
                                                                onDelete={() => onDeleteEntry(entry.id)}
                                                                confirmMessage="Delete this activity?"
                                                                size="sm"
                                                                variant="subtle"
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
