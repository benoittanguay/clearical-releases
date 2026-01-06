import { useState, useEffect, useMemo } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';
import { DeleteButton } from './DeleteButton';
import { useStorage } from '../context/StorageContext';

interface HistoryDetailProps {
    entry: TimeEntry;
    buckets: TimeBucket[];
    onBack: () => void;
    onUpdate: (id: string, updates: Partial<TimeEntry>) => void;
    formatTime: (ms: number) => string;
}

interface AppGroup {
    appName: string;
    totalDuration: number;
    activities: WindowActivity[];
    icon?: string;
}

export function HistoryDetail({ entry, buckets, onBack, onUpdate, formatTime }: HistoryDetailProps) {
    const { removeActivityFromEntry, removeAllActivitiesForApp, removeScreenshotFromEntry } = useStorage();
    const [isEditing, setIsEditing] = useState(false);
    const [description, setDescription] = useState(entry.description || '');
    const [selectedBucketId, setSelectedBucketId] = useState(entry.bucketId || '');
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
    const [appIcons, setAppIcons] = useState<Map<string, string>>(new Map());
    const [selectedScreenshots, setSelectedScreenshots] = useState<string[] | null>(null);

    // Update local state when entry changes
    useEffect(() => {
        setDescription(entry.description || '');
        setSelectedBucketId(entry.bucketId || '');
    }, [entry.id, entry.description, entry.bucketId]);

    const handleSave = () => {
        onUpdate(entry.id, {
            description: description.trim() || undefined,
            bucketId: selectedBucketId || null
        });
        setIsEditing(false);
    };

    const handleCancel = () => {
        setDescription(entry.description || '');
        setSelectedBucketId(entry.bucketId || '');
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleCancel();
        } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
        }
    };

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

    const currentBucket = buckets.find(b => b.id === selectedBucketId);

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
        <div className="w-full h-full flex flex-col" onKeyDown={handleKeyDown}>
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
                        {isEditing ? (
                            <select
                                value={selectedBucketId}
                                onChange={(e) => setSelectedBucketId(e.target.value)}
                                className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                autoFocus
                            >
                                <option value="">Select a bucket</option>
                                {buckets.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        ) : (
                            <>
                                {currentBucket && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: currentBucket.color }}></div>}
                                <span className="text-lg font-medium">{currentBucket?.name || 'Unknown'}</span>
                            </>
                        )}
                    </div>
                    <div className="text-2xl font-mono font-bold text-green-400">
                        {formatTime(entry.duration)}
                    </div>
                </div>
                <div className="text-sm text-gray-500 mb-3">
                    {new Date(entry.startTime).toLocaleString()}
                </div>
                {/* Description Field */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-gray-400 uppercase font-semibold">Description</label>
                        {!isEditing ? (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                Edit
                            </button>
                        ) : (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCancel}
                                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    Save
                                </button>
                            </div>
                        )}
                    </div>
                    {isEditing ? (
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a description for this time entry..."
                            className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                            rows={3}
                        />
                    ) : (
                        <div className="text-sm text-gray-300 min-h-[3rem]">
                            {entry.description ? (
                                <p className="whitespace-pre-wrap">{entry.description}</p>
                            ) : (
                                <p className="text-gray-500 italic">No description</p>
                            )}
                        </div>
                    )}
                </div>
                </div>

                {/* Window Activity - Grouped by App */}
                <div>
                    <h3 className="text-lg font-semibold mb-3 text-gray-300">Window Activity</h3>
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
                                            {icon ? (
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
