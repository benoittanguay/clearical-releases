import { useState, useEffect } from 'react';
import type { TimeEntry, TimeBucket } from '../../types/shared';
import { useReportData } from '../../hooks/useReportData';
import { ReportDateRangePicker } from './ReportDateRangePicker';
import { ReportSummaryCards } from './ReportSummaryCards';
import { ReportTimeByBucket } from './ReportTimeByBucket';
import { ReportDailyTrend } from './ReportDailyTrend';
import { ReportAppUsage } from './ReportAppUsage';
import { ReportProductivityInsights } from './ReportProductivityInsights';
import { ReportMeetingTime } from './ReportMeetingTime';
import { ReportExportButton } from './ReportExportButton';

interface ReportsViewProps {
    buckets: TimeBucket[];
    fetchEntriesForExport: (startTime: number, endTime: number) => Promise<TimeEntry[]>;
}

export function ReportsView({ buckets, fetchEntriesForExport }: ReportsViewProps) {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const [dateFrom, setDateFrom] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
    const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);
    const [entries, setEntries] = useState<TimeEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!dateFrom || !dateTo) return;
        const startMs = new Date(dateFrom + 'T00:00:00').getTime();
        const endMs = new Date(dateTo + 'T23:59:59.999').getTime();
        if (isNaN(startMs) || isNaN(endMs)) return;

        setIsLoading(true);
        fetchEntriesForExport(startMs, endMs).then((data) => {
            setEntries(data);
            setIsLoading(false);
        });
    }, [dateFrom, dateTo, fetchEntriesForExport]);

    const reportData = useReportData(entries, buckets);

    return (
        <>
            {/* Fixed Header */}
            <div
                className="flex-shrink-0 px-6 py-4 z-20 drag-handle"
                style={{ backgroundColor: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-primary)' }}
            >
                <div className="flex items-center justify-between mb-3">
                    <h2
                        className="text-2xl font-bold"
                        style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}
                    >
                        Reports
                    </h2>
                    <ReportExportButton reportData={reportData} dateFrom={dateFrom} dateTo={dateTo} />
                </div>
                <ReportDateRangePicker
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                />
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                        <div
                            className="animate-spin rounded-full h-8 w-8 border-2 border-transparent"
                            style={{ borderTopColor: 'var(--color-accent)', borderRightColor: 'var(--color-accent)' }}
                        />
                        <div className="text-sm" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            Loading report data...
                        </div>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M3 9h18" />
                            <path d="M9 21V9" />
                        </svg>
                        <div className="text-sm" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-body)' }}>
                            No entries found for this date range
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        <ReportSummaryCards
                            totalTime={reportData.totalTime}
                            avgDaily={reportData.avgDaily}
                            totalEntries={reportData.totalEntries}
                            mostUsedApp={reportData.mostUsedApp}
                            meetingTime={reportData.meetingTime}
                            focusScore={reportData.focusScore}
                        />
                        <ReportTimeByBucket bucketBreakdowns={reportData.bucketBreakdowns} />
                        <ReportDailyTrend
                            dailyData={reportData.dailyData}
                            bucketNames={reportData.bucketNames}
                            bucketColors={reportData.bucketColors}
                        />
                        <ReportAppUsage appUsage={reportData.appUsage} />
                        <ReportProductivityInsights
                            hourlyData={reportData.hourlyData}
                            focusSessions={reportData.focusSessions}
                            contextSwitchesPerHour={reportData.contextSwitchesPerHour}
                            focusRatio={reportData.focusRatio}
                        />
                        <ReportMeetingTime
                            meetings={reportData.meetings}
                            totalMeetingTime={reportData.totalMeetingTime}
                            totalMeetingCount={reportData.totalMeetingCount}
                            avgMeetingDuration={reportData.avgMeetingDuration}
                            totalTranscriptionWords={reportData.totalTranscriptionWords}
                        />
                    </div>
                )}
            </div>
        </>
    );
}
