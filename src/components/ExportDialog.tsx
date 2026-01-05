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
            // Validate we have entries
            if (entries.length === 0) {
                throw new Error('No entries to export');
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div 
                className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Export Timesheet</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
                        {error}
                    </div>
                )}

                <div className="space-y-4 mb-6">
                    {/* Date Range */}
                    <div>
                        <label className="text-sm font-semibold text-gray-300 mb-2 block">Date Range</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-gray-400 mb-1 block">From</label>
                                <input
                                    type="date"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 mb-1 block">To</label>
                                <input
                                    type="date"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Bucket Filter */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-semibold text-gray-300">Buckets</label>
                            <button
                                onClick={handleSelectAllBuckets}
                                className="text-xs text-green-400 hover:text-green-300"
                            >
                                {selectedBucketIds.length === buckets.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-2">
                            {buckets.map(bucket => (
                                <label
                                    key={bucket.id}
                                    className="flex items-center gap-2 p-2 rounded hover:bg-gray-700/50 cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedBucketIds.includes(bucket.id)}
                                        onChange={() => handleBucketToggle(bucket.id)}
                                        className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                                    />
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: bucket.color }}></div>
                                    <span className="text-sm text-gray-300">{bucket.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Options */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-gray-300 block">Options</label>
                        
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeDescription}
                                onChange={(e) => setIncludeDescription(e.target.checked)}
                                className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-300">Include descriptions</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={includeIssueKey}
                                onChange={(e) => setIncludeIssueKey(e.target.checked)}
                                className="w-4 h-4 text-green-600 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-300">Include issue key</span>
                        </label>

                        {includeIssueKey && (
                            <input
                                type="text"
                                value={issueKey}
                                onChange={(e) => setIssueKey(e.target.value)}
                                placeholder="Default issue key (e.g., PROJ-123)"
                                className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 mt-2"
                            />
                        )}
                    </div>

                    {/* Preview */}
                    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                        <div className="text-xs text-gray-400 mb-1">Export Preview</div>
                        <div className="text-sm text-gray-300">
                            {filteredCount} {filteredCount === 1 ? 'entry' : 'entries'} will be exported
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={isExporting}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || filteredCount === 0}
                        className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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

