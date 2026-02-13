interface ReportSummaryCardsProps {
    totalTime: number;
    avgDaily: number;
    totalEntries: number;
    mostUsedApp: string | null;
    meetingTime: number;
    focusScore: number;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

interface CardProps {
    label: string;
    value: string;
    sub?: string;
}

function Card({ label, value, sub }: CardProps) {
    return (
        <div
            className="rounded-xl p-4 border"
            style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)',
            }}
        >
            <div
                className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}
            >
                {label}
            </div>
            <div
                className="text-2xl font-bold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
            >
                {value}
            </div>
            {sub && (
                <div
                    className="text-[10px] mt-1"
                    style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-body)' }}
                >
                    {sub}
                </div>
            )}
        </div>
    );
}

export function ReportSummaryCards({ totalTime, avgDaily, totalEntries, mostUsedApp, meetingTime, focusScore }: ReportSummaryCardsProps) {
    return (
        <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <Card label="Total Time" value={formatDuration(totalTime)} />
            <Card label="Avg Daily" value={formatDuration(avgDaily)} />
            <Card label="Total Entries" value={String(totalEntries)} />
            <Card label="Top App" value={mostUsedApp || 'N/A'} />
            <Card label="Meeting Time" value={formatDuration(meetingTime)} />
            <Card label="Focus Score" value={focusScore > 0 ? `${focusScore}m` : 'N/A'} sub={focusScore > 0 ? 'avg session length' : undefined} />
        </div>
    );
}
