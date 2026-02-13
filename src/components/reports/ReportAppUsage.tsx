import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { AppUsageData } from '../../hooks/useReportData';

interface ReportAppUsageProps {
    appUsage: AppUsageData[];
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

export function ReportAppUsage({ appUsage }: ReportAppUsageProps) {
    if (appUsage.length === 0) {
        return (
            <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>App Usage</h3>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No activity data available</div>
            </div>
        );
    }

    const top10 = appUsage.slice(0, 10);

    const chartData = top10.map((a, i) => ({
        name: a.appName,
        hours: msToHours(a.totalTime),
        ms: a.totalTime,
        opacity: 1 - (i * 0.07),
    }));

    return (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>App Usage</h3>

            <div style={{ width: '100%', height: Math.max(top10.length * 36, 100) }}>
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
                            width={120}
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
                        <Bar dataKey="hours" fill="var(--color-accent)" radius={[0, 4, 4, 0]} barSize={20} fillOpacity={0.85} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Full list below chart */}
            {appUsage.length > 10 && (
                <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-display)' }}>
                        All Apps ({appUsage.length})
                    </div>
                    <div className="space-y-1">
                        {appUsage.map((a) => (
                            <div key={a.appName} className="flex items-center gap-3 text-xs py-0.5">
                                <span className="flex-1 truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{a.appName}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{formatDuration(a.totalTime)}</span>
                                <span className="w-12 text-right" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{a.percentage.toFixed(1)}%</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
