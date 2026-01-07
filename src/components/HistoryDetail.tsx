import { useState, useEffect, useMemo } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';
import { DeleteButton } from './DeleteButton';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { TempoService } from '../services/tempoService';

interface HistoryDetailProps {
    entry: TimeEntry;
    buckets: TimeBucket[];
    onBack: () => void;
    onUpdate: (id: string, updates: Partial<TimeEntry>) => void;
    onNavigateToSettings: () => void;
    formatTime: (ms: number) => string;
}

interface AppGroup {
    appName: string;
    totalDuration: number;
    activities: WindowActivity[];
    icon?: string;
}

export function HistoryDetail({ entry, buckets, onBack, onUpdate, onNavigateToSettings, formatTime }: HistoryDetailProps) {
    const { removeActivityFromEntry, removeAllActivitiesForApp, removeScreenshotFromEntry, addManualActivityToEntry } = useStorage();
    const { settings } = useSettings();
    const [description, setDescription] = useState(entry.description || '');
    const [selectedBucketId, setSelectedBucketId] = useState(entry.bucketId || '');
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
    const [appIcons, setAppIcons] = useState<Map<string, string>>(new Map());
    const [selectedScreenshots, setSelectedScreenshots] = useState<string[] | null>(null);
    const [saveTimeoutId, setSaveTimeoutId] = useState<NodeJS.Timeout | null>(null);
    const [showManualEntryForm, setShowManualEntryForm] = useState(false);
    const [manualDescription, setManualDescription] = useState('');
    const [manualDuration, setManualDuration] = useState('');
    const [showTempoForm, setShowTempoForm] = useState(false);
    const [tempoIssueKey, setTempoIssueKey] = useState(settings.tempo?.defaultIssueKey || '');
    const [tempoDescription, setTempoDescription] = useState(description || '');
    const [isLoggingToTempo, setIsLoggingToTempo] = useState(false);

    // Update local state when entry changes
    useEffect(() => {
        setDescription(entry.description || '');
        setSelectedBucketId(entry.bucketId || '');
    }, [entry.id, entry.description, entry.bucketId]);

    // Auto-save function with debouncing
    const autoSave = () => {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }
        
        const timeoutId = setTimeout(() => {
            onUpdate(entry.id, {
                description: description.trim() || undefined,
                bucketId: selectedBucketId || null
            });
        }, 500); // 500ms debounce
        
        setSaveTimeoutId(timeoutId);
    };

    // Auto-save when description or bucket changes
    useEffect(() => {
        // Only auto-save if the values are different from the original entry
        if (description !== (entry.description || '') || selectedBucketId !== entry.bucketId) {
            autoSave();
        }
        
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, [description, selectedBucketId]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, []);

    const handleDeleteActivity = async (activityIndex: number) => {
        removeActivityFromEntry(entry.id, activityIndex);
    };

    const handleDeleteApp = async (appName: string) => {
        removeAllActivitiesForApp(entry.id, appName);
    };

    const handleScreenshotDeleted = (screenshotPath: string) => {
        removeScreenshotFromEntry(screenshotPath);
        // Update selected screenshots if needed
        if (selectedScreenshots) {
            const updatedScreenshots = selectedScreenshots.filter(path => path !== screenshotPath);
            if (updatedScreenshots.length === 0) {
                setSelectedScreenshots(null);
            } else {
                setSelectedScreenshots(updatedScreenshots);
            }
        }
    };

    const handleAddManualEntry = () => {
        if (!manualDescription.trim() || !manualDuration.trim()) return;
        
        // Parse duration from user input (supports formats like "1h 30m", "90m", "1.5h", "90")
        const duration = parseDuration(manualDuration);
        if (duration <= 0) return;
        
        addManualActivityToEntry(entry.id, manualDescription.trim(), duration);
        
        // Reset form
        setManualDescription('');
        setManualDuration('');
        setShowManualEntryForm(false);
    };

    const handleLogToTempo = async () => {
        if (!tempoIssueKey.trim() || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) return;
        
        setIsLoggingToTempo(true);
        
        try {
            const tempoService = new TempoService(settings.tempo.baseUrl, settings.tempo.apiToken);
            
            const worklog = {
                issueKey: tempoIssueKey.trim(),
                timeSpentSeconds: TempoService.durationMsToSeconds(entry.duration),
                startDate: TempoService.formatDate(entry.startTime),
                startTime: TempoService.formatTime(entry.startTime),
                description: tempoDescription.trim() || description || `Time logged from TimePortal for ${formatTime(entry.duration)}`,
            };
            
            const response = await tempoService.createWorklog(worklog);
            
            // Show success message
            alert(`Successfully logged ${formatTime(entry.duration)} to Tempo!\nWorklog ID: ${response.tempoWorklogId}`);
            
            // Reset form and close
            setShowTempoForm(false);
            setTempoIssueKey(settings.tempo?.defaultIssueKey || '');
            setTempoDescription(description || '');
            
        } catch (error) {
            console.error('Failed to log time to Tempo:', error);
            alert(`Failed to log time to Tempo: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your Tempo configuration in settings.`);
        } finally {
            setIsLoggingToTempo(false);
        }
    };

    const parseDuration = (input: string): number => {
        const str = input.toLowerCase().trim();
        let totalMinutes = 0;
        
        // Parse "1h 30m" format
        const hoursMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
        const minutesMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);
        
        if (hoursMatch) {
            totalMinutes += parseFloat(hoursMatch[1]) * 60;
        }
        if (minutesMatch) {
            totalMinutes += parseFloat(minutesMatch[1]);
        }
        
        // If no h/m found, treat as minutes
        if (!hoursMatch && !minutesMatch) {
            const numMatch = str.match(/^(\d+(?:\.\d+)?)$/);
            if (numMatch) {
                totalMinutes = parseFloat(numMatch[1]);
            }
        }
        
        return Math.round(totalMinutes * 60 * 1000); // Convert to milliseconds
    };

    const currentBucket = buckets.find(b => b.id === selectedBucketId);

    // Calculate total activity time for debugging
    const totalActivityTime = useMemo(() => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            return 0;
        }
        return entry.windowActivity.reduce((total, activity) => total + activity.duration, 0);
    }, [entry.windowActivity]);

    // Group activities by app
    const appGroups = useMemo(() => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            return [];
        }

        const groups = new Map<string, AppGroup>();

        entry.windowActivity.forEach(activity => {
            const appName = activity.appName;
            
            if (!groups.has(appName)) {
                groups.set(appName, {
                    appName,
                    totalDuration: 0,
                    activities: [],
                    icon: undefined
                });
            }

            const group = groups.get(appName)!;
            group.totalDuration += activity.duration;
            group.activities.push(activity);
        });

        // Sort activities within each group by timestamp
        groups.forEach(group => {
            group.activities.sort((a, b) => b.timestamp - a.timestamp);
        });

        // Convert to array and sort by total duration (descending)
        return Array.from(groups.values()).sort((a, b) => b.totalDuration - a.totalDuration);
    }, [entry.windowActivity]);

    // Load app icons
    useEffect(() => {
        const loadIcons = async () => {
            const uniqueApps = new Set(appGroups.map(g => g.appName));
            const iconPromises = Array.from(uniqueApps).map(async (appName) => {
                // @ts-ignore
                if (window.electron?.ipcRenderer?.getAppIcon) {
                    try {
                        console.log(`[Renderer] Loading icon for app: ${appName}`);
                        // @ts-ignore
                        const icon = await window.electron.ipcRenderer.getAppIcon(appName);
                        console.log(`[Renderer] Icon result for ${appName}:`, icon ? 'Found' : 'Not found');
                        if (icon) {
                            setAppIcons(prev => new Map(prev).set(appName, icon));
                        }
                    } catch (error) {
                        console.error(`[Renderer] Failed to load icon for ${appName}:`, error);
                    }
                } else {
                    console.warn(`[Renderer] getAppIcon not available in electron API`);
                }
            });

            await Promise.all(iconPromises);
        };

        if (appGroups.length > 0) {
            loadIcons();
        }
    }, [appGroups]);

    const toggleApp = (appName: string) => {
        setExpandedApps(prev => {
            const next = new Set(prev);
            if (next.has(appName)) {
                next.delete(appName);
            } else {
                next.add(appName);
            }
            return next;
        });
    };

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex items-center gap-3 mb-6 flex-shrink-0">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <h2 className="text-2xl font-bold">Activity Details</h2>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pb-6">
                {/* Entry Summary */}
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <select
                            value={selectedBucketId}
                            onChange={(e) => setSelectedBucketId(e.target.value)}
                            className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        >
                            <option value="">Select a bucket</option>
                            {buckets.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                        {currentBucket && <div className="w-3 h-3 rounded-full ml-2" style={{ backgroundColor: currentBucket.color }}></div>}
                    </div>
                    <div className="flex flex-col items-end">
                        <div className="text-2xl font-mono font-bold text-green-400">
                            {formatTime(entry.duration)}
                        </div>
                    </div>
                </div>
                <div className="text-sm text-gray-500 mb-3">
                    {new Date(entry.startTime).toLocaleString()}
                </div>
                {/* Description Field */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-gray-400 uppercase font-semibold">Description</label>
                        <div className="text-xs text-gray-500">
                            Auto-saved
                        </div>
                    </div>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Add a description for this time entry..."
                        className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                        rows={3}
                    />
                </div>

                {/* Tempo Integration */}
                <div className="pt-3 border-t border-gray-700">
                    {settings.tempo?.enabled ? (
                        <button
                            onClick={() => setShowTempoForm(!showTempoForm)}
                            disabled={isLoggingToTempo}
                            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M12 6v6l4 2"/>
                            </svg>
                            {isLoggingToTempo ? (
                                <>
                                    <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                    Logging to Tempo...
                                </>
                            ) : (
                                'Log to Tempo'
                            )}
                        </button>
                    ) : (
                        <button
                            onClick={onNavigateToSettings}
                            className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                <circle cx="12" cy="12" r="4"/>
                            </svg>
                            Connect Tempo
                        </button>
                    )}
                </div>
                </div>

                {/* Tempo Form */}
                {showTempoForm && (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <h4 className="text-sm font-semibold text-gray-300 mb-3">Log Time to Tempo</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Jira Issue Key *</label>
                                <input
                                    type="text"
                                    value={tempoIssueKey}
                                    onChange={(e) => setTempoIssueKey(e.target.value)}
                                    placeholder="e.g. PROJECT-123"
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <div className="text-xs text-gray-500 mt-1">Enter the Jira issue key to log time against</div>
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={tempoDescription}
                                    onChange={(e) => setTempoDescription(e.target.value)}
                                    placeholder="Work description..."
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="bg-gray-700/50 rounded p-3">
                                <div className="text-xs text-gray-400 mb-1">Time to Log</div>
                                <div className="text-sm text-white">
                                    <strong>{formatTime(entry.duration)}</strong> 
                                    <span className="text-gray-400 ml-2">({TempoService.durationMsToSeconds(entry.duration)} seconds)</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Date: {new Date(entry.startTime).toLocaleDateString()}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button
                                    onClick={() => {
                                        setShowTempoForm(false);
                                        setTempoIssueKey(settings.tempo?.defaultIssueKey || '');
                                        setTempoDescription(description || '');
                                    }}
                                    className="px-3 py-1 text-gray-400 hover:text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleLogToTempo}
                                    disabled={!tempoIssueKey.trim() || isLoggingToTempo}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors flex items-center gap-1"
                                >
                                    {isLoggingToTempo ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Logging...
                                        </>
                                    ) : (
                                        'Log to Tempo'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Window Activity - Grouped by App */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-300">Window Activity</h3>
                        <button
                            onClick={() => setShowManualEntryForm(!showManualEntryForm)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md transition-colors flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Manual Entry
                        </button>
                    </div>
                {/* Manual Entry Form */}
                {showManualEntryForm && (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 mb-4">
                        <h4 className="text-sm font-semibold text-gray-300 mb-3">Add Manual Entry</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={manualDescription}
                                    onChange={(e) => setManualDescription(e.target.value)}
                                    placeholder="Enter activity description..."
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Duration</label>
                                <input
                                    type="text"
                                    value={manualDuration}
                                    onChange={(e) => setManualDuration(e.target.value)}
                                    placeholder="e.g. 30m, 1h 30m, 90"
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button
                                    onClick={() => {
                                        setShowManualEntryForm(false);
                                        setManualDescription('');
                                        setManualDuration('');
                                    }}
                                    className="px-3 py-1 text-gray-400 hover:text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddManualEntry}
                                    disabled={!manualDescription.trim() || !manualDuration.trim()}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
                                >
                                    Add Entry
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {appGroups.length === 0 ? (
                    <div className="text-gray-500 text-sm">No window activity recorded for this session.</div>
                ) : (
                    <div className="space-y-3">
                        {appGroups.map(group => {
                            const isExpanded = expandedApps.has(group.appName);
                            const icon = appIcons.get(group.appName);

                            return (
                                <div key={group.appName} className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                                    {/* App Header */}
                                    <button
                                        onClick={() => toggleApp(group.appName)}
                                        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/80 transition-colors"
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <svg 
                                                xmlns="http://www.w3.org/2000/svg" 
                                                width="16" 
                                                height="16" 
                                                viewBox="0 0 24 24" 
                                                fill="none" 
                                                stroke="currentColor" 
                                                strokeWidth="2" 
                                                strokeLinecap="round" 
                                                strokeLinejoin="round"
                                                className={`text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                                            >
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                            {group.appName === 'Manual Entry' ? (
                                                <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                                    </svg>
                                                </div>
                                            ) : icon ? (
                                                <img 
                                                    src={icon} 
                                                    alt={group.appName}
                                                    className="w-6 h-6 rounded flex-shrink-0"
                                                    onError={(e) => {
                                                        console.error(`[Renderer] Failed to load icon image for ${group.appName}`);
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                    onLoad={() => {
                                                        console.log(`[Renderer] Successfully loaded icon for ${group.appName}`);
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                        <line x1="9" y1="3" x2="9" y2="21" />
                                                    </svg>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-white truncate">{group.appName}</div>
                                                <div className="text-xs text-gray-400">
                                                    {group.activities.length} {group.activities.length === 1 ? 'activity' : 'activities'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 ml-4">
                                            <div className="font-mono text-green-400 font-bold">
                                                {formatTime(group.totalDuration)}
                                            </div>
                                            <DeleteButton
                                                onDelete={() => handleDeleteApp(group.appName)}
                                                confirmMessage={`Delete all ${group.appName} activities?`}
                                                size="sm"
                                                variant="subtle"
                                            />
                                        </div>
                                    </button>

                                    {/* Activities List */}
                                    {isExpanded && (
                                        <div className="border-t border-gray-700">
                                            {group.activities.map((activity, index) => (
                                                <div
                                                    key={`${activity.timestamp}-${index}`}
                                                    className="p-3 border-b border-gray-800/50 last:border-b-0 hover:bg-gray-800/30 transition-colors"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-medium text-gray-200 truncate mb-1">
                                                                {activity.windowTitle || '(No window title available)'}
                                                            </div>
                                                            <div className="text-xs text-gray-500 mb-1">
                                                                {new Date(activity.timestamp).toLocaleTimeString()}
                                                            </div>
                                                            {activity.screenshotPaths && activity.screenshotPaths.length > 0 && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        console.log('[HistoryDetail] Opening screenshots:', activity.screenshotPaths);
                                                                        setSelectedScreenshots(activity.screenshotPaths || []);
                                                                    }}
                                                                    className="text-xs text-green-400 hover:text-green-300 mt-1 flex items-center gap-1"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                                                        <polyline points="21 15 16 10 5 21" />
                                                                    </svg>
                                                                    {activity.screenshotPaths.length} screenshot{activity.screenshotPaths.length !== 1 ? 's' : ''}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="font-mono text-green-400 font-semibold text-sm">
                                                                {formatTime(activity.duration)}
                                                            </div>
                                                            <DeleteButton
                                                                onDelete={() => handleDeleteActivity(group.activities.findIndex(act => 
                                                                    act.timestamp === activity.timestamp && 
                                                                    act.appName === activity.appName && 
                                                                    act.windowTitle === activity.windowTitle
                                                                ))}
                                                                confirmMessage="Delete this activity?"
                                                                size="sm"
                                                                variant="subtle"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                </div>
            </div>

            {/* Screenshot Gallery Modal */}
            {selectedScreenshots && (
                <ScreenshotGallery
                    screenshotPaths={selectedScreenshots}
                    onClose={() => setSelectedScreenshots(null)}
                    onScreenshotDeleted={handleScreenshotDeleted}
                />
            )}
        </div>
    );
}
