import React from 'react';
import type { TimeEntry, TimeBucket, LinkedJiraIssue } from '../context/StorageContext';
import { WorklogEntryList } from './WorklogEntryList';

interface JiraDetailViewProps {
    jiraIssue: LinkedJiraIssue;
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    onBack: () => void;
    onEntryClick: (entryId: string) => void;
    onDeleteEntry: (entryId: string) => void;
    onBulkLogToTempo?: (dateKey: string) => void;
    tempoEnabled?: boolean;
}

export const JiraDetailView: React.FC<JiraDetailViewProps> = ({
    jiraIssue,
    entries,
    buckets,
    formatTime,
    onBack,
    onEntryClick,
    onDeleteEntry,
    onBulkLogToTempo,
    tempoEnabled = false
}) => {
    // Filter entries that are assigned to this Jira issue
    const filteredEntries = entries.filter(entry => {
        // Check unified assignment model
        if (entry.assignment?.type === 'jira' && entry.assignment.jiraIssue?.key === jiraIssue.key) {
            return true;
        }
        // Fallback to legacy linkedJiraIssue field
        if (entry.linkedJiraIssue?.key === jiraIssue.key) {
            return true;
        }
        return false;
    });

    // Calculate total time for this Jira issue
    const totalDuration = filteredEntries.reduce((sum, entry) => sum + entry.duration, 0);

    return (
        <>
            {/* Fixed Header */}
            <div
                className="flex-shrink-0 px-6 py-4 z-20 drag-handle"
                style={{
                    backgroundColor: 'var(--color-bg-primary)',
                    borderBottom: '1px solid var(--color-border-primary)'
                }}
            >
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="no-drag p-1.5 rounded-lg transition-all active:scale-95"
                        style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-secondary)',
                            transitionDuration: 'var(--duration-fast)',
                            transitionTimingFunction: 'var(--ease-out)',
                            border: '1px solid var(--color-border-primary)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-accent)';
                            e.currentTarget.style.color = 'var(--color-text-primary)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                            e.currentTarget.style.color = 'var(--color-text-secondary)';
                        }}
                        title="Back to list"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: '#3b82f6' }}
                            />
                            <span
                                className="font-mono text-lg font-bold"
                                style={{
                                    color: 'var(--color-info)',
                                    fontFamily: 'var(--font-mono)'
                                }}
                            >
                                {jiraIssue.key}
                            </span>
                            <span
                                className="text-sm"
                                style={{
                                    color: 'var(--color-text-tertiary)',
                                    fontFamily: 'var(--font-body)'
                                }}
                            >
                                {jiraIssue.projectName}
                            </span>
                            <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{
                                    backgroundColor: 'var(--color-bg-tertiary)',
                                    color: 'var(--color-text-secondary)',
                                    fontFamily: 'var(--font-body)'
                                }}
                            >
                                {jiraIssue.issueType}
                            </span>
                        </div>
                        <p
                            className="text-sm mt-1 truncate"
                            style={{
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-body)'
                            }}
                        >
                            {jiraIssue.summary}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span
                            className="text-sm font-mono"
                            style={{
                                color: 'var(--color-text-secondary)',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
                        </span>
                        <span
                            className="text-sm font-mono font-bold"
                            style={{
                                color: 'var(--color-accent)',
                                fontFamily: 'var(--font-mono)'
                            }}
                        >
                            {formatTime(totalDuration)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div
                className="flex-1 overflow-y-auto px-4 pb-4"
                style={{ backgroundColor: 'var(--color-bg-primary)' }}
            >
                <WorklogEntryList
                    entries={filteredEntries}
                    buckets={buckets}
                    formatTime={formatTime}
                    onEntryClick={onEntryClick}
                    onDeleteEntry={onDeleteEntry}
                    onBulkLogToTempo={onBulkLogToTempo}
                    tempoEnabled={tempoEnabled}
                />
            </div>
        </>
    );
};
