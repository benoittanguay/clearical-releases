import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { HourlyData, FocusSession } from '../../hooks/useReportData';

interface ReportProductivityInsightsProps {
    hourlyData: HourlyData[];
    focusSessions: FocusSession[];
    contextSwitchesPerHour: number;
    focusRatio: number;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatHour(hour: number): string {
    if (hour === 0) return '12a';
    if (hour < 12) return `${hour}a`;
    if (hour === 12) return '12p';
    return `${hour - 12}p`;
}

export function ReportProductivityInsights({ hourlyData, focusSessions, contextSwitchesPerHour, focusRatio }: ReportProductivityInsightsProps) {
    const hasHourlyData = hourlyData.some(h => h.totalTime > 0);

    if (!hasHourlyData && focusSessions.length === 0) {
        return (
            <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
                <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Productivity Insights</h3>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No activity data available for insights</div>
            </div>
        );
    }

    const chartData = hourlyData.map(h => ({
        hour: formatHour(h.hour),
        hours: Math.round((h.totalTime / (1000 * 60 * 60)) * 100) / 100,
        ms: h.totalTime,
    }));

    return (
        <div className="rounded-xl p-6 border" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)' }}>
            <h3 className="text-sm font-semibold mb-4" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Productivity Insights</h3>

            {/* Stat pills */}
            <div className="flex flex-wrap gap-3 mb-5">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-muted)' }}>
                    <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>Switches/hr</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>{contextSwitchesPerHour}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-muted)' }}>
                    <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>Focus Ratio</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>{focusRatio}%</span>
                </div>
            </div>

            {/* Peak Hours Chart */}
            {hasHourlyData && (
                <>
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>Peak Hours</div>
                    <div style={{ width: '100%', height: 160 }}>
                        <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                                <XAxis
                                    dataKey="hour"
                                    tick={{ fontSize: 9, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-tertiary)' }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={2}
                                />
                                <YAxis
                                    tickFormatter={(v) => `${v}h`}
                                    tick={{ fontSize: 9, fontFamily: 'var(--font-mono)', fill: 'var(--color-text-tertiary)' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={32}
                                />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.[0]) return null;
                                        const data = payload[0].payload;
                                        return (
                                            <div className="rounded-lg p-2 border text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', fontFamily: 'var(--font-mono)' }}>
                                                <div style={{ color: 'var(--color-text-primary)' }}>{data.hour}</div>
                                                <div style={{ color: 'var(--color-text-secondary)' }}>{formatDuration(data.ms)}</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="hours" fill="var(--color-accent)" radius={[2, 2, 0, 0]} fillOpacity={0.75} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}

            {/* Top Focus Sessions */}
            {focusSessions.length > 0 && (
                <div className="mt-5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>Top Focus Sessions</div>
                    <div className="space-y-1.5">
                        {focusSessions.map((s, i) => (
                            <div key={i} className="flex items-center gap-3 text-xs py-1">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.bucketColor }} />
                                <span className="flex-1 truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{s.appName}</span>
                                <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{s.bucketName}</span>
                                <span className="font-medium" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>{formatDuration(s.duration)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
