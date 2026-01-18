import React from 'react';
import type { TimeEntry, TimeBucket } from '../context/StorageContext';
import { WorklogEntryList } from './WorklogEntryList';

interface BucketDetailViewProps {
    bucket: TimeBucket;
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    onBack: () => void;
    onEntryClick: (entryId: string) => void;
    onDeleteEntry: (entryId: string) => void;
    onBulkLogToTempo?: (dateKey: string) => void;
    tempoEnabled?: boolean;
}

export const BucketDetailView: React.FC<BucketDetailViewProps> = ({
    bucket,
    entries,
    buckets,
    formatTime,
    onBack,
    onEntryClick,
    onDeleteEntry,
    onBulkLogToTempo,
    tempoEnabled = false
}) => {
    // Filter entries that are assigned to this bucket
    const filteredEntries = entries.filter(entry => {
        // Check unified assignment model
        if (entry.assignment?.type === 'bucket' && entry.assignment.bucket?.id === bucket.id) {
            return true;
        }
        // Fallback to legacy bucketId field
        if (entry.bucketId === bucket.id) {
            return true;
        }
        return false;
    });

    // Calculate total time for this bucket
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
                    <div className="flex items-center gap-3">
                        <div
                            className="w-4 h-4 rounded-full"
                            style={{
                                backgroundColor: bucket.color,
                                boxShadow: `0 0 12px ${bucket.color}60, 0 2px 8px ${bucket.color}40`
                            }}
                        />
                        <h2
                            className="text-2xl font-bold"
                            style={{
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-display)'
                            }}
                        >
                            {bucket.name}
                        </h2>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
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
