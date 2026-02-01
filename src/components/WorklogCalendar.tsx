import React, { useMemo } from 'react';
import type { TimeEntry, TimeBucket } from '../context/StorageContext';
import { DeleteButton } from './DeleteButton';

interface WorklogCalendarProps {
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    selectedDay: Date | null;
    onDaySelect: (date: Date | null) => void;
    currentMonth: Date;
    onMonthChange: (date: Date) => void;
    onEntryClick: (entryId: string) => void;
    onDeleteEntry: (entryId: string) => void;
    onBulkLogToTempo?: (dateKey: string) => void;
    tempoEnabled?: boolean;
}

export const WorklogCalendar: React.FC<WorklogCalendarProps> = ({
    entries,
    buckets,
    formatTime,
    selectedDay,
    onDaySelect,
    currentMonth,
    onMonthChange,
    onEntryClick,
    onDeleteEntry,
    onBulkLogToTempo,
    tempoEnabled = false
}) => {
    // Helper to get rounded duration (15-minute increments)
    const getRoundedDuration = (duration: number) =>
        Math.ceil(duration / (15 * 60 * 1000)) * (15 * 60 * 1000);

    // Group entries by day
    const entriesByDay = useMemo(() => {
        const map = new Map<string, TimeEntry[]>();
        entries.forEach(entry => {
            const date = new Date(entry.startTime);
            date.setHours(0, 0, 0, 0);
            const key = date.toISOString().split('T')[0];
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key)!.push(entry);
        });
        return map;
    }, [entries]);

    // Calculate hours per day
    const hoursByDay = useMemo(() => {
        const map = new Map<string, number>();
        entriesByDay.forEach((dayEntries, key) => {
            const totalMs = dayEntries.reduce((sum, entry) => sum + getRoundedDuration(entry.duration), 0);
            map.set(key, totalMs / (1000 * 60 * 60)); // Convert to hours
        });
        return map;
    }, [entriesByDay]);

    // Get entries for the current month
    const currentMonthEntries = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        return entries.filter(entry => {
            const entryDate = new Date(entry.startTime);
            return entryDate.getFullYear() === year && entryDate.getMonth() === month;
        });
    }, [entries, currentMonth]);

    // Check if current month has any loggable Jira activities
    const monthHasLoggableJiraActivities = useMemo(() => {
        return currentMonthEntries.some(entry => {
            const assignment = entry.assignment ||
                (entry.linkedJiraIssue ? {
                    type: 'jira' as const,
                    jiraIssue: entry.linkedJiraIssue
                } : null);
            return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
        });
    }, [currentMonthEntries]);

    // Calculate total hours for current month
    const currentMonthTotalHours = useMemo(() => {
        const totalMs = currentMonthEntries.reduce((sum, entry) => sum + getRoundedDuration(entry.duration), 0);
        return totalMs / (1000 * 60 * 60);
    }, [currentMonthEntries]);

    // Get the dateKey for the first day of the current month (for bulk tempo logging)
    const monthDateKey = useMemo(() => {
        const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        d.setHours(0, 0, 0, 0);
        return d.getTime().toString();
    }, [currentMonth]);

    // Calendar grid helpers
    const getMonthDays = (date: Date): (Date | null)[] => {
        const year = date.getFullYear();
        const month = date.getMonth();

        // First day of month
        const firstDay = new Date(year, month, 1);
        // Last day of month
        const lastDay = new Date(year, month + 1, 0);

        // Get the day of week for first day (0 = Sunday, adjust for Monday start)
        let startPadding = firstDay.getDay() - 1;
        if (startPadding < 0) startPadding = 6; // Sunday becomes 6

        const days: (Date | null)[] = [];

        // Add padding for days before first of month
        for (let i = 0; i < startPadding; i++) {
            const prevDate = new Date(year, month, -startPadding + i + 1);
            days.push(prevDate);
        }

        // Add days of month
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push(new Date(year, month, i));
        }

        // Add padding for days after end of month to complete 6 rows
        const totalCells = 42; // 6 rows x 7 days
        const remaining = totalCells - days.length;
        for (let i = 1; i <= remaining; i++) {
            days.push(new Date(year, month + 1, i));
        }

        return days;
    };

    const isToday = (date: Date): boolean => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const isCurrentMonth = (date: Date): boolean => {
        return date.getMonth() === currentMonth.getMonth() &&
               date.getFullYear() === currentMonth.getFullYear();
    };

    const isSelected = (date: Date): boolean => {
        if (!selectedDay) return false;
        return date.toDateString() === selectedDay.toDateString();
    };

    const formatMonthYear = (date: Date): string => {
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    };

    const handlePrevMonth = () => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() - 1);
        onMonthChange(newDate);
    };

    const handleNextMonth = () => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() + 1);
        onMonthChange(newDate);
    };

    const handleDayClick = (date: Date) => {
        if (isSelected(date)) {
            onDaySelect(null);
        } else {
            onDaySelect(date);
        }
    };

    const days = getMonthDays(currentMonth);
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Get entries for selected day
    const selectedDayEntries = useMemo(() => {
        if (!selectedDay) return [];
        const key = selectedDay.toISOString().split('T')[0];
        return (entriesByDay.get(key) || []).sort((a, b) => b.startTime - a.startTime);
    }, [selectedDay, entriesByDay]);

    // Calculate total duration for selected day
    const selectedDayTotalDuration = useMemo(() => {
        return selectedDayEntries.reduce((sum, e) => sum + getRoundedDuration(e.duration), 0);
    }, [selectedDayEntries]);

    return (
        <div className="flex flex-col h-full">
            {/* Month Navigator */}
            <div className="flex items-center justify-between mb-4 px-2">
                <button
                    onClick={handlePrevMonth}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors no-drag"
                    style={{
                        color: 'var(--color-text-secondary)',
                        backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                        e.currentTarget.style.color = 'var(--color-text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
                <h3
                    className="text-lg font-bold"
                    style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-display)'
                    }}
                >
                    {formatMonthYear(currentMonth)}
                </h3>
                <button
                    onClick={handleNextMonth}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors no-drag"
                    style={{
                        color: 'var(--color-text-secondary)',
                        backgroundColor: 'transparent'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                        e.currentTarget.style.color = 'var(--color-text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
            </div>

            {/* Month Summary Row */}
            {currentMonthEntries.length > 0 && (
                <div className="flex items-center justify-between mb-3 px-2">
                    <span
                        className="text-sm font-bold"
                        style={{
                            color: 'var(--color-accent)',
                            fontFamily: 'var(--font-mono)'
                        }}
                    >
                        {currentMonthTotalHours.toFixed(1)}h total
                    </span>
                    {tempoEnabled && monthHasLoggableJiraActivities && onBulkLogToTempo && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onBulkLogToTempo(monthDateKey);
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)] no-drag"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M12 6v6l4 2"/>
                            </svg>
                            Log Month to Tempo
                        </button>
                    )}
                </div>
            )}

            {/* Weekday Header */}
            <div className="grid grid-cols-7 gap-1 mb-1 px-2">
                {weekDays.map(day => (
                    <div
                        key={day}
                        className="text-center text-xs font-medium py-2"
                        style={{ color: 'var(--color-text-tertiary)' }}
                    >
                        {day}
                    </div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1 px-2 flex-shrink-0">
                {days.map((date, index) => {
                    if (!date) return <div key={index} />;

                    const dateKey = date.toISOString().split('T')[0];
                    const hours = hoursByDay.get(dateKey) || 0;
                    const hasEntries = hours > 0;
                    const inCurrentMonth = isCurrentMonth(date);
                    const today = isToday(date);
                    const selected = isSelected(date);

                    return (
                        <button
                            key={index}
                            onClick={() => handleDayClick(date)}
                            className="relative flex flex-col items-start justify-start p-2 rounded-lg transition-all no-drag"
                            style={{
                                minHeight: '60px',
                                backgroundColor: hasEntries ? 'rgba(255, 72, 0, 0.15)' : 'transparent',
                                border: selected
                                    ? '2px solid var(--color-accent)'
                                    : '1px solid var(--color-border-primary)',
                                opacity: inCurrentMonth ? 1 : 0.4,
                                cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => {
                                if (!selected) {
                                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!selected) {
                                    e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                }
                            }}
                        >
                            {/* Day Number */}
                            <span
                                className="text-sm font-medium"
                                style={{
                                    color: today
                                        ? 'var(--color-accent)'
                                        : 'var(--color-text-primary)',
                                    fontFamily: 'var(--font-mono)'
                                }}
                            >
                                {date.getDate()}
                            </span>

                            {/* Hours Badge */}
                            {hasEntries && (
                                <span
                                    className="text-xs font-bold mt-auto"
                                    style={{
                                        color: 'var(--color-accent)',
                                        fontFamily: 'var(--font-mono)'
                                    }}
                                >
                                    {hours.toFixed(1)}h
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Selected Day Modal */}
            {selectedDay && (
                <SelectedDayModal
                    selectedDay={selectedDay}
                    entries={selectedDayEntries}
                    buckets={buckets}
                    formatTime={formatTime}
                    totalDuration={selectedDayTotalDuration}
                    onClose={() => onDaySelect(null)}
                    onEntryClick={onEntryClick}
                    onDeleteEntry={onDeleteEntry}
                    onBulkLogToTempo={onBulkLogToTempo}
                    tempoEnabled={tempoEnabled}
                />
            )}
        </div>
    );
};

// Selected Day Modal Component
const SelectedDayModal: React.FC<{
    selectedDay: Date;
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    totalDuration: number;
    onClose: () => void;
    onEntryClick: (entryId: string) => void;
    onDeleteEntry: (entryId: string) => void;
    onBulkLogToTempo?: (dateKey: string) => void;
    tempoEnabled?: boolean;
}> = ({
    selectedDay,
    entries,
    buckets,
    formatTime,
    totalDuration,
    onClose,
    onEntryClick,
    onDeleteEntry,
    onBulkLogToTempo,
    tempoEnabled = false
}) => {
    const getRoundedDuration = (duration: number) =>
        Math.ceil(duration / (15 * 60 * 1000)) * (15 * 60 * 1000);

    // Check if this day has any loggable Jira activities
    const hasLoggableJiraActivities = entries.some(entry => {
        const assignment = entry.assignment ||
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : null);
        return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
    });

    // Get the dateKey for this day
    const dateKey = (() => {
        const d = new Date(selectedDay);
        d.setHours(0, 0, 0, 0);
        return d.getTime().toString();
    })();

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in max-h-[80vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 pb-4 flex-shrink-0">
                    {/* Row 1: Date and Close Button */}
                    <div className="flex justify-between items-center mb-1">
                        <h3
                            className="text-xs font-bold uppercase tracking-wider"
                            style={{
                                color: 'var(--color-text-secondary)',
                                fontFamily: 'var(--font-display)'
                            }}
                        >
                            {selectedDay.toLocaleDateString('en-US', {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric'
                            }).toUpperCase()}
                        </h3>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[#FAF5EE] transition-all active:scale-95"
                            aria-label="Close dialog"
                            title="Close"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                    {/* Row 2: Total Time and Log to Tempo */}
                    <div className="flex justify-between items-center">
                        <span
                            className="text-lg font-bold"
                            style={{
                                color: 'var(--color-accent)',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            {formatTime(totalDuration)}
                        </span>
                        {tempoEnabled && hasLoggableJiraActivities && onBulkLogToTempo && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onBulkLogToTempo(dateKey);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)]"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M12 6v6l4 2"/>
                                </svg>
                                Log to Tempo
                            </button>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">
                    {entries.length === 0 ? (
                        <div
                            className="text-sm py-8 text-center"
                            style={{ color: 'var(--color-text-tertiary)' }}
                        >
                            No activities on this day
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map(entry => {
                                const assignment = entry.assignment ||
                                    (entry.linkedJiraIssue ? {
                                        type: 'jira' as const,
                                        jiraIssue: entry.linkedJiraIssue
                                    } : entry.bucketId ? {
                                        type: 'bucket' as const,
                                        bucket: buckets.find(b => b.id === entry.bucketId)
                                    } : null);

                                const roundedDuration = getRoundedDuration(entry.duration);

                                return (
                                    <div
                                        key={entry.id}
                                        onClick={() => {
                                            onEntryClick(entry.id);
                                            onClose();
                                        }}
                                        className="flex justify-between items-center p-3 rounded-lg cursor-pointer"
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
                                            {assignment && (
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <div
                                                        className="w-2 h-2 rounded-full flex-shrink-0"
                                                        style={{
                                                            backgroundColor: assignment.type === 'bucket'
                                                                ? assignment.bucket?.color || '#6b7280'
                                                                : '#3b82f6'
                                                        }}
                                                    />
                                                    <span
                                                        className="text-sm font-medium"
                                                        style={{ color: 'var(--color-text-primary)' }}
                                                    >
                                                        {assignment.type === 'bucket'
                                                            ? assignment.bucket?.name || 'Unknown Bucket'
                                                            : assignment.jiraIssue?.key || 'Unknown Issue'
                                                        }
                                                    </span>
                                                </div>
                                            )}
                                            {/* Jira Issue Summary */}
                                            {assignment?.type === 'jira' && assignment.jiraIssue?.summary && (
                                                <div
                                                    className="text-xs truncate mb-0.5 pl-4"
                                                    style={{ color: 'var(--color-text-tertiary)' }}
                                                >
                                                    {assignment.jiraIssue.summary}
                                                </div>
                                            )}
                                            <span
                                                className="text-xs pl-4"
                                                style={{
                                                    color: 'var(--color-text-secondary)',
                                                    fontFamily: 'var(--font-mono)'
                                                }}
                                            >
                                                {new Date(entry.startTime).toLocaleTimeString([], {
                                                    hour: 'numeric',
                                                    minute: '2-digit',
                                                    hour12: true
                                                })} - {new Date(entry.startTime + entry.duration).toLocaleTimeString([], {
                                                    hour: 'numeric',
                                                    minute: '2-digit',
                                                    hour12: true
                                                })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="font-mono font-bold"
                                                style={{
                                                    color: 'var(--color-accent)',
                                                    fontFamily: 'var(--font-mono)'
                                                }}
                                            >
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
                    )}
                </div>
            </div>
        </div>
    );
};
