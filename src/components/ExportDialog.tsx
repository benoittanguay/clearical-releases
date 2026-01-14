import { useState, useEffect } from 'react';
import type { TimeEntry, TimeBucket } from '../context/StorageContext';
import { generateCSV, getDefaultFilename, type ExportOptions } from '../services/exportService';

interface ExportDialogProps {
    entries: TimeEntry[];
    buckets: TimeBucket[];
    onClose: () => void;
    onExport: () => void;
}

export function ExportDialog({ entries, buckets, onClose, onExport }: ExportDialogProps) {
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [selectedBucketIds, setSelectedBucketIds] = useState<string[]>([]);
    const [includeDescription, setIncludeDescription] = useState(true);
    const [includeIssueKey, setIncludeIssueKey] = useState(false);
    const [issueKey, setIssueKey] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Set default date range to last 30 days
    useEffect(() => {
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        setDateTo(today.toISOString().split('T')[0]);
        setDateFrom(thirtyDaysAgo.toISOString().split('T')[0]);
    }, []);

    const handleBucketToggle = (bucketId: string) => {
        setSelectedBucketIds(prev =>
            prev.includes(bucketId)
                ? prev.filter(id => id !== bucketId)
                : [...prev, bucketId]
        );
    };

    const handleSelectAllBuckets = () => {
        if (selectedBucketIds.length === buckets.length) {
            setSelectedBucketIds([]);
        } else {
            setSelectedBucketIds(buckets.map(b => b.id));
        }
    };

    const getFilteredCount = () => {
        let filtered = entries;

        if (dateFrom) {
            const fromDate = new Date(dateFrom + 'T00:00:00');
            fromDate.setHours(0, 0, 0, 0);
            filtered = filtered.filter(e => e.startTime >= fromDate.getTime());
        }

        if (dateTo) {
            const toDate = new Date(dateTo + 'T23:59:59.999');
            toDate.setHours(23, 59, 59, 999);
            filtered = filtered.filter(e => e.startTime <= toDate.getTime());
        }

        if (selectedBucketIds.length > 0) {
            filtered = filtered.filter(e => e.bucketId && selectedBucketIds.includes(e.bucketId));
        }

        return filtered.length;
    };

    const handleExport = async () => {
        setIsExporting(true);
        setError(null);

        try {
            // Validate we have activities
            if (entries.length === 0) {
                throw new Error('No activities to export');
            }

            // Create dates properly - date input gives YYYY-MM-DD string
            let dateFromObj: Date | undefined;
            let dateToObj: Date | undefined;

            if (dateFrom) {
                dateFromObj = new Date(dateFrom + 'T00:00:00'); // Add time to avoid timezone issues
                if (isNaN(dateFromObj.getTime())) {
                    throw new Error('Invalid start date');
                }
            }

            if (dateTo) {
                dateToObj = new Date(dateTo + 'T23:59:59.999'); // End of day
                if (isNaN(dateToObj.getTime())) {
                    throw new Error('Invalid end date');
                }
            }

            // Validate date range
            if (dateFromObj && dateToObj && dateFromObj > dateToObj) {
                throw new Error('Start date must be before end date');
            }

            const options: ExportOptions = {
                dateFrom: dateFromObj,
                dateTo: dateToObj,
                bucketIds: selectedBucketIds.length > 0 ? selectedBucketIds : undefined,
                includeDescription,
                includeIssueKey,
                issueKey: includeIssueKey ? issueKey : undefined,
            };

            const csvContent = generateCSV(entries, buckets, options);

            // Show save dialog via Electron
            // @ts-ignore
            if (!window.electron) {
                throw new Error('Electron API not available');
            }

            // @ts-ignore
            const result = await window.electron.ipcRenderer.invoke('show-save-dialog', {
                defaultFilename: getDefaultFilename()
            });

            if (result.canceled || !result.filePath) {
                setIsExporting(false);
                return;
            }

            // Write file via Electron main process
            // @ts-ignore
            const writeResult = await window.electron.ipcRenderer.invoke('write-file', result.filePath, csvContent);

            if (!writeResult || !writeResult.success) {
                throw new Error(writeResult?.error || 'Failed to write file');
            }

            onExport();
            onClose();
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage || 'Failed to export CSV');
            console.error('Export error:', err);
        } finally {
            setIsExporting(false);
        }
    };

    const filteredCount = getFilteredCount();

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
                    <h2 className="text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Export Timesheet</h2>
                    <button
                        onClick={onClose}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-200 hover:scale-110 active:scale-95"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="px-6 overflow-y-auto flex-1">
                    {error && (
                        <div className="mb-4 p-3 bg-[var(--color-error-muted)] border border-[var(--color-error)]/50 rounded-xl text-[var(--color-error)] text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                            {error}
                        </div>
                    )}

                    <div className="space-y-5 mb-6">
                    {/* Date Range */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3" style={{ fontFamily: 'var(--font-display)' }}>Date Range</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1.5" style={{ fontFamily: 'var(--font-mono)' }}>From</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className="w-full bg-white border-2 border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 hover:border-[var(--color-border-secondary)] transition-all duration-200"
                                    style={{ fontFamily: 'var(--font-mono)', colorScheme: 'light' }}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1.5" style={{ fontFamily: 'var(--font-mono)' }}>To</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className="w-full bg-white border-2 border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 hover:border-[var(--color-border-secondary)] transition-all duration-200"
                                    style={{ fontFamily: 'var(--font-mono)', colorScheme: 'light' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Bucket Filter */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider" style={{ fontFamily: 'var(--font-display)' }}>Buckets</label>
                            <button
                                onClick={handleSelectAllBuckets}
                                className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-semibold transition-colors duration-200 hover:scale-105 active:scale-95"
                            >
                                {selectedBucketIds.length === buckets.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-1.5 bg-white rounded-lg p-3 border-2 border-[var(--color-border-primary)]">
                            {buckets.map(bucket => (
                                <label
                                    key={bucket.id}
                                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[var(--color-bg-primary)] cursor-pointer transition-all duration-200 group"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedBucketIds.includes(bucket.id)}
                                        onChange={() => handleBucketToggle(bucket.id)}
                                        className="w-4 h-4 text-[var(--color-accent)] bg-white border-2 border-[var(--color-border-primary)] rounded focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all duration-200 cursor-pointer"
                                    />
                                    <div className="w-3 h-3 rounded-full transition-transform duration-200 group-hover:scale-110" style={{ backgroundColor: bucket.color }}></div>
                                    <span className="text-sm text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-mono)' }}>{bucket.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Options */}
                    <div className="space-y-2.5">
                        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3" style={{ fontFamily: 'var(--font-display)' }}>Options</label>

                        <label className="flex items-center gap-2.5 cursor-pointer group p-2 rounded-lg hover:bg-[var(--color-bg-primary)] transition-all duration-200">
                            <input
                                type="checkbox"
                                checked={includeDescription}
                                onChange={(e) => setIncludeDescription(e.target.checked)}
                                className="w-4 h-4 text-[var(--color-accent)] bg-white border-2 border-[var(--color-border-primary)] rounded focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all duration-200 cursor-pointer"
                            />
                            <span className="text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors duration-200" style={{ fontFamily: 'var(--font-body)' }}>Include descriptions</span>
                        </label>

                        <label className="flex items-center gap-2.5 cursor-pointer group p-2 rounded-lg hover:bg-[var(--color-bg-primary)] transition-all duration-200">
                            <input
                                type="checkbox"
                                checked={includeIssueKey}
                                onChange={(e) => setIncludeIssueKey(e.target.checked)}
                                className="w-4 h-4 text-[var(--color-accent)] bg-white border-2 border-[var(--color-border-primary)] rounded focus:ring-2 focus:ring-[var(--color-accent)]/20 transition-all duration-200 cursor-pointer"
                            />
                            <span className="text-sm text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition-colors duration-200" style={{ fontFamily: 'var(--font-body)' }}>Include issue key</span>
                        </label>

                        {includeIssueKey && (
                            <input
                                type="text"
                                value={issueKey}
                                onChange={(e) => setIssueKey(e.target.value)}
                                placeholder="Default issue key (e.g., PROJ-123)"
                                className="w-full bg-white border-2 border-[var(--color-border-primary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 hover:border-[var(--color-border-secondary)] mt-2 transition-all duration-200"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            />
                        )}
                    </div>

                    {/* Preview */}
                    <div className="bg-[var(--color-accent-muted)] rounded-xl p-4 border-2 border-[var(--color-accent-border)]">
                        <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider mb-1.5 font-bold" style={{ fontFamily: 'var(--font-display)' }}>Export Preview</div>
                        <div className="text-sm text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-mono)' }}>
                            <span className="text-[var(--color-accent)] font-bold text-lg">{filteredCount}</span> {filteredCount === 1 ? 'activity' : 'activities'} will be exported
                        </div>
                    </div>
                </div>
                </div>

                {/* Actions - Sticky Footer */}
                <div className="flex gap-3 p-6 pt-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        disabled={isExporting}
                        className="flex-1 px-4 py-2.5 bg-white hover:bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] text-sm font-medium rounded-full transition-all duration-200 disabled:opacity-50 hover:scale-105 active:scale-95 border-2 border-[var(--color-border-primary)] hover:border-[var(--color-text-secondary)]"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || filteredCount === 0}
                        className="flex-1 px-4 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:scale-105 active:scale-95 shadow-lg hover:shadow-[var(--shadow-accent-lg)]"
                    >
                        {isExporting ? (
                            <>
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Exporting...
                            </>
                        ) : (
                            'Export CSV'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

