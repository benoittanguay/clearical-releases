import type { TimeEntry, TimeBucket } from '../context/StorageContext';

export interface ExportOptions {
    dateFrom?: Date;
    dateTo?: Date;
    bucketIds?: string[];
    includeDescription?: boolean;
    includeIssueKey?: boolean;
    issueKey?: string; // Default issue key if not set per entry
}

interface TempoWorklogRow {
    issueKey?: string;
    timeSpentSeconds: number;
    startDate: string; // YYYY-MM-DD
    startTime?: string; // HH:mm:ss
    description?: string;
    authorAccountId?: string;
    workAttribute?: string; // Bucket name
}

/**
 * Escape CSV field value - handles commas, quotes, and newlines
 */
function escapeCSVField(value: string): string {
    if (value === null || value === undefined) return '';
    
    const stringValue = String(value);
    
    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
}

/**
 * Convert TimeEntry to Tempo worklog row format
 */
function entryToWorklogRow(entry: TimeEntry, bucket: TimeBucket | undefined, options: ExportOptions): TempoWorklogRow {
    const startDate = new Date(entry.startTime);
    const dateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = startDate.toTimeString().split(' ')[0]; // HH:mm:ss
    const durationSeconds = Math.floor(entry.duration / 1000); // Convert ms to seconds
    
    const row: TempoWorklogRow = {
        timeSpentSeconds: durationSeconds,
        startDate: dateStr,
        startTime: timeStr,
    };
    
    // Add optional fields based on options
    if (options.includeDescription && entry.description) {
        row.description = entry.description;
    }
    
    if (options.includeIssueKey) {
        row.issueKey = options.issueKey || '';
    }
    
    // Add bucket as work attribute
    if (bucket) {
        row.workAttribute = bucket.name;
    }
    
    return row;
}

/**
 * Convert worklog row to CSV line
 */
function worklogRowToCSVLine(row: TempoWorklogRow, headers: string[]): string {
    return headers.map(header => {
        const key = header as keyof TempoWorklogRow;
        const value = row[key];
        return escapeCSVField(value !== undefined && value !== null ? String(value) : '');
    }).join(',');
}

/**
 * Filter entries based on export options
 */
function filterEntries(entries: TimeEntry[], options: ExportOptions): TimeEntry[] {
    let filtered = [...entries];
    
    // Filter by date range
    if (options.dateFrom) {
        const fromDate = new Date(options.dateFrom);
        fromDate.setHours(0, 0, 0, 0); // Start of day in local time
        const fromTimestamp = fromDate.getTime();
        filtered = filtered.filter(entry => entry.startTime >= fromTimestamp);
    }
    
    if (options.dateTo) {
        // Include entries that start before or on the end date
        const toDate = new Date(options.dateTo);
        toDate.setHours(23, 59, 59, 999); // End of day in local time
        const toTimestamp = toDate.getTime();
        filtered = filtered.filter(entry => entry.startTime <= toTimestamp);
    }
    
    // Filter by buckets
    if (options.bucketIds && options.bucketIds.length > 0) {
        filtered = filtered.filter(entry => 
            entry.bucketId && options.bucketIds!.includes(entry.bucketId)
        );
    }
    
    return filtered;
}

/**
 * Generate CSV content from time entries
 */
export function generateCSV(
    entries: TimeEntry[],
    buckets: TimeBucket[],
    options: ExportOptions = {}
): string {
    // Filter entries based on options
    const filteredEntries = filterEntries(entries, options);
    
    if (filteredEntries.length === 0) {
        throw new Error('No entries match the selected filters');
    }
    
    // Build headers based on options
    const headers: string[] = [];
    
    if (options.includeIssueKey) {
        headers.push('issueKey');
    }
    
    headers.push('timeSpentSeconds', 'startDate', 'startTime');
    
    if (options.includeDescription) {
        headers.push('description');
    }
    
    headers.push('workAttribute'); // Bucket name
    
    // Generate CSV rows
    const rows = filteredEntries.map(entry => {
        const bucket = buckets.find(b => b.id === entry.bucketId);
        const worklogRow = entryToWorklogRow(entry, bucket, options);
        return worklogRowToCSVLine(worklogRow, headers);
    });
    
    // Combine header and rows
    const csvLines = [
        headers.join(','),
        ...rows
    ];
    
    // Use CRLF for better Excel compatibility
    return csvLines.join('\r\n');
}

/**
 * Get default filename for export
 */
export function getDefaultFilename(): string {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return `timesheet-${dateStr}.csv`;
}

