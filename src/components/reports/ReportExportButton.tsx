import { useState } from 'react';
import type { ReportData } from '../../hooks/useReportData';

interface ReportExportButtonProps {
    reportData: ReportData;
    dateFrom: string;
    dateTo: string;
}

function escapeCSVField(value: string): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

function formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

function generateReportCSV(data: ReportData, dateFrom: string, dateTo: string): string {
    const lines: string[] = [];

    // Summary section
    lines.push('Report Summary');
    lines.push(`Date Range,${escapeCSVField(dateFrom)} to ${escapeCSVField(dateTo)}`);
    lines.push(`Total Time,${escapeCSVField(formatDuration(data.totalTime))}`);
    lines.push(`Average Daily,${escapeCSVField(formatDuration(data.avgDaily))}`);
    lines.push(`Total Entries,${data.totalEntries}`);
    lines.push(`Most Used App,${escapeCSVField(data.mostUsedApp || 'N/A')}`);
    lines.push(`Meeting Time,${escapeCSVField(formatDuration(data.meetingTime))}`);
    lines.push('');

    // Bucket breakdown
    lines.push('Time by Bucket');
    lines.push('Bucket,Time,Entries,Percentage');
    for (const b of data.bucketBreakdowns) {
        lines.push(`${escapeCSVField(b.bucketName)},${escapeCSVField(formatDuration(b.totalTime))},${b.entryCount},${b.percentage.toFixed(1)}%`);
    }
    lines.push('');

    // Daily data
    lines.push('Daily Breakdown');
    const bucketHeaders = data.bucketNames.map(n => escapeCSVField(n)).join(',');
    lines.push(`Date,Total${bucketHeaders ? ',' + bucketHeaders : ''}`);
    for (const d of data.dailyData) {
        const bucketVals = data.bucketNames.map(n => escapeCSVField(formatDuration(d.byBucket[n] || 0))).join(',');
        lines.push(`${d.date},${escapeCSVField(formatDuration(d.total))}${bucketVals ? ',' + bucketVals : ''}`);
    }
    lines.push('');

    // App usage
    lines.push('App Usage');
    lines.push('App,Time,Percentage');
    for (const a of data.appUsage) {
        lines.push(`${escapeCSVField(a.appName)},${escapeCSVField(formatDuration(a.totalTime))},${a.percentage.toFixed(1)}%`);
    }

    return lines.join('\r\n');
}

export function ReportExportButton({ reportData, dateFrom, dateTo }: ReportExportButtonProps) {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const csv = generateReportCSV(reportData, dateFrom, dateTo);

            // @ts-ignore
            if (!window.electron) {
                throw new Error('Electron API not available');
            }

            const dateStr = new Date().toISOString().split('T')[0];
            // @ts-ignore
            const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
                defaultFilename: `report-${dateStr}.csv`
            });

            if (result.canceled || !result.filePath) {
                return;
            }

            // @ts-ignore
            const writeResult = await window.electron.ipcRenderer.invoke('write-file', result.filePath, csv);
            if (!writeResult?.success) {
                console.error('Failed to write report:', writeResult?.error);
            }
        } catch (err) {
            console.error('Export error:', err);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <button
            onClick={handleExport}
            disabled={isExporting || reportData.totalEntries === 0}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 no-drag disabled:opacity-50"
            style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-body)',
                border: '1px solid var(--color-border-primary)',
            }}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
    );
}
