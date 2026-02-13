import type { MeetingData } from '../../hooks/useReportData';

interface ReportMeetingTimeProps {
    meetings: MeetingData[];
    totalMeetingTime: number;
    totalMeetingCount: number;
    avgMeetingDuration: number;
    totalTranscriptionWords: number;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

export function ReportMeetingTime({ meetings, totalMeetingTime, totalMeetingCount, avgMeetingDuration, totalTranscriptionWords }: ReportMeetingTimeProps) {
    if (meetings.length === 0) return null;

    return (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Meeting Time</h3>

            {/* Stat pills */}
            <div className="grid grid-cols-2 gap-3 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-display)' }}>Total</div>
                    <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(totalMeetingTime)}</div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-display)' }}>Count</div>
                    <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{totalMeetingCount}</div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-display)' }}>Avg Duration</div>
                    <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(avgMeetingDuration)}</div>
                </div>
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-display)' }}>Words</div>
                    <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{totalTranscriptionWords.toLocaleString()}</div>
                </div>
            </div>

            {/* Meeting list */}
            <div className="space-y-1.5">
                {meetings.map((m) => (
                    <div key={m.entryId} className="flex items-center gap-3 text-xs py-1">
                        <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            {new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span className="flex-1" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {formatDuration(m.duration)}
                        </span>
                        {m.wordCount > 0 && (
                            <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                {m.wordCount.toLocaleString()} words
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
