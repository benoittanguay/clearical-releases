import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { BucketBreakdown } from '../../hooks/useReportData';

interface ReportTimeByBucketProps {
    bucketBreakdowns: BucketBreakdown[];
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function msToHours(ms: number): number {
    return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

export function ReportTimeByBucket({ bucketBreakdowns }: ReportTimeByBucketProps) {
    if (bucketBreakdowns.length === 0) {
        return (
            <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Time by Assignment</h3>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No data available</div>
            </div>
        );
    }

    const chartData = bucketBreakdowns.map(b => ({
        name: b.bucketName,
        hours: msToHours(b.totalTime),
        color: b.bucketColor,
        ms: b.totalTime,
    }));

    return (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Time by Assignment</h3>

            <div style={{ width: '100%', height: Math.max(bucketBreakdowns.length * 36, 100) }}>
                <ResponsiveContainer>
                    <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                        <XAxis
                            type="number"
                            tickFormatter={(v) => `${v}h`}
                            tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-secondary)' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis
                            dataKey="name"
                            type="category"
                            width={160}
                            tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-secondary)' }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <Tooltip
                            content={({ active, payload }) => {
                                if (!active || !payload?.[0]) return null;
                                const data = payload[0].payload;
                                return (
                                    <div className="rounded-lg p-2 border text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', fontFamily: 'var(--font-mono)' }}>
                                        <div style={{ color: 'var(--color-text-primary)' }}>{data.name}</div>
                                        <div style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(data.ms)}</div>
                                    </div>
                                );
                            }}
                        />
                        <Bar dataKey="hours" radius={[0, 4, 4, 0]} barSize={20}>
                            {chartData.map((entry, index) => (
                                <Cell key={index} fill={entry.color} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="mt-4 space-y-1.5">
                {bucketBreakdowns.map((b) => (
                    <div key={b.bucketId || 'unassigned'} className="flex items-center gap-3 text-xs py-1">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.bucketColor }} />
                        <span className="flex-1 truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{b.bucketName}</span>
                        <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(b.totalTime)}</span>
                        <span className="w-10 text-right" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{b.entryCount}</span>
                        <span className="w-12 text-right" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{b.percentage.toFixed(1)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
