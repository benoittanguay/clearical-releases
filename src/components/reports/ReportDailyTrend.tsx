import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { DailyData } from '../../hooks/useReportData';

interface ReportDailyTrendProps {
    dailyData: DailyData[];
    bucketNames: string[];
    bucketColors: Record<string, string>;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function aggregateByWeek(data: DailyData[]): DailyData[] {
    const weekMap = new Map<string, DailyData>();
    for (const d of data) {
        const date = new Date(d.date);
        // Get Monday of the week
        const day = date.getDay();
        const monday = new Date(date);
        monday.setDate(date.getDate() - ((day + 6) % 7));
        const weekKey = monday.toISOString().split('T')[0];

        const existing = weekMap.get(weekKey);
        if (existing) {
            existing.total += d.total;
            for (const [bucket, time] of Object.entries(d.byBucket)) {
                existing.byBucket[bucket] = (existing.byBucket[bucket] || 0) + time;
            }
        } else {
            weekMap.set(weekKey, { date: weekKey, total: d.total, byBucket: { ...d.byBucket } });
        }
    }
    return Array.from(weekMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function ReportDailyTrend({ dailyData, bucketNames, bucketColors }: ReportDailyTrendProps) {
    if (dailyData.length === 0) {
        return (
            <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Daily Trend</h3>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No data available</div>
            </div>
        );
    }

    const useWeekly = dailyData.length > 60;
    const displayData = useWeekly ? aggregateByWeek(dailyData) : dailyData;

    // Convert to hours for chart
    const chartData = displayData.map(d => {
        const row: Record<string, number | string> = { date: d.date };
        for (const name of bucketNames) {
            row[name] = Math.round(((d.byBucket[name] || 0) / (1000 * 60 * 60)) * 100) / 100;
        }
        return row;
    });

    const formatDate = (date: string) => {
        const d = new Date(date + 'T00:00:00');
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    return (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                    {useWeekly ? 'Weekly Trend' : 'Daily Trend'}
                </h3>
                {useWeekly && (
                    <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        Aggregated by week (60+ days)
                    </span>
                )}
            </div>

            <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <XAxis
                            dataKey="date"
                            tickFormatter={formatDate}
                            tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-secondary)' }}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tickFormatter={(v) => `${v}h`}
                            tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-secondary)' }}
                            axisLine={false}
                            tickLine={false}
                            width={40}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                return (
                                    <div className="rounded-lg p-3 border text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
                                        <div className="mb-1.5 font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{formatDate(String(label ?? ''))}</div>
                                        {payload.filter(p => (p.value as number) > 0).map((p, i) => (
                                            <div key={i} className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                                                <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{p.name}: {formatDuration((p.value as number) * 1000 * 60 * 60)}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            }}
                        />
                        {bucketNames.map((name) => (
                            <Area
                                key={name}
                                type="monotone"
                                dataKey={name}
                                stackId="1"
                                stroke={bucketColors[name] || '#9CA3AF'}
                                fill={bucketColors[name] || '#9CA3AF'}
                                fillOpacity={0.6}
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
