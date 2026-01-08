import { useState, useEffect, useMemo } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';

interface AppGroup {
    appName: string;
    totalDuration: number;
    activities: Array<{
        activity: WindowActivity;
        entry: TimeEntry;
        bucket: TimeBucket | undefined;
    }>;
    icon?: string;
}

interface AppGroupedHistoryProps {
    entries: TimeEntry[];
    buckets: TimeBucket[];
    formatTime: (ms: number) => string;
    onEntryClick?: (entryId: string) => void;
}

export function AppGroupedHistory({ entries, buckets, formatTime, onEntryClick }: AppGroupedHistoryProps) {
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
    const [appIcons, setAppIcons] = useState<Map<string, string>>(new Map());
    const [selectedScreenshots, setSelectedScreenshots] = useState<string[] | null>(null);
    const [selectedScreenshotMetadata, setSelectedScreenshotMetadata] = useState<Array<{ path: string; timestamp: number; appName?: string; windowTitle?: string; aiDescription?: string; }> | null>(null);

    // Group activities by app
    const appGroups = useMemo(() => {
        const groups = new Map<string, AppGroup>();

        entries.forEach(entry => {
            const bucket = buckets.find(b => b.id === entry.bucketId);
            
            entry.windowActivity?.forEach(activity => {
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
                group.activities.push({
                    activity,
                    entry,
                    bucket
                });
            });
        });

        // Sort activities within each group by timestamp
        groups.forEach(group => {
            group.activities.sort((a, b) => b.activity.timestamp - a.activity.timestamp);
        });

        // Convert to array and sort by total duration (descending)
        return Array.from(groups.values()).sort((a, b) => b.totalDuration - a.totalDuration);
    }, [entries, buckets]);

    // Load app icons
    useEffect(() => {
        const loadIcons = async () => {
            const uniqueApps = new Set(appGroups.map(g => g.appName));
            const iconPromises = Array.from(uniqueApps).map(async (appName) => {
                // @ts-ignore
                if (window.electron?.ipcRenderer) {
                    try {
                        // @ts-ignore
                        const icon = await window.electron.ipcRenderer.invoke('get-app-icon', appName);
                        if (icon) {
                            setAppIcons(prev => new Map(prev).set(appName, icon));
                        }
                    } catch (error) {
                        console.error(`Failed to load icon for ${appName}:`, error);
                    }
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

    if (appGroups.length === 0) {
        return (
            <div className="text-gray-500 text-sm py-12 text-center animate-fade-in">
                <svg className="w-16 h-16 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-base mb-1">No window activities recorded yet</p>
                <p className="text-xs text-gray-600">Start working and your activity will appear here</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {appGroups.map(group => {
                const isExpanded = expandedApps.has(group.appName);
                const icon = appIcons.get(group.appName);

                return (
                    <div key={group.appName} className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition-all animate-fade-in" style={{ transitionDuration: 'var(--duration-base)', transitionTimingFunction: 'var(--ease-out)', boxShadow: 'var(--shadow-sm)' }}>
                        {/* App Header */}
                        <button
                            onClick={() => toggleApp(group.appName)}
                            className="w-full flex items-center justify-between p-4 hover:bg-gray-800/80 active:bg-gray-800 transition-all"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                {icon ? (
                                    <img 
                                        src={icon} 
                                        alt={group.appName}
                                        className="w-8 h-8 rounded"
                                        onError={(e) => {
                                            // Fallback to default icon if image fails to load
                                            e.currentTarget.style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div className="w-8 h-8 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
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
                                <div className="font-mono text-green-400 font-bold text-lg">
                                    {formatTime(group.totalDuration)}
                                </div>
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                    style={{ transitionDuration: 'var(--duration-base)', transitionTimingFunction: 'var(--ease-out)' }}
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </div>
                        </button>

                        {/* Activities List */}
                        {isExpanded && (
                            <div className="border-t border-gray-700 animate-slide-down">
                                {group.activities.map((item, index) => (
                                    <div
                                        key={`${item.entry.id}-${item.activity.timestamp}-${index}`}
                                        className="p-3 border-b border-gray-800/50 last:border-b-0 hover:bg-gray-800/30 transition-all"
                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    {item.bucket && (
                                                        <div 
                                                            className="w-2 h-2 rounded-full flex-shrink-0" 
                                                            style={{ backgroundColor: item.bucket.color }}
                                                        />
                                                    )}
                                                    <span className="text-sm font-medium text-gray-200 truncate">
                                                        {item.activity.windowTitle || '(No title)'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-500 mb-1">
                                                    {new Date(item.activity.timestamp).toLocaleString()}
                                                </div>
                                                {item.entry.description && (
                                                    <div className="text-xs text-gray-400 truncate mt-1">
                                                        {item.entry.description}
                                                    </div>
                                                )}
                                                {item.activity.screenshotPaths && item.activity.screenshotPaths.length > 0 && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();

                                                            const screenshots = item.activity.screenshotPaths || [];
                                                            const metadata = screenshots.map(path => ({
                                                                path,
                                                                timestamp: item.activity.timestamp,
                                                                appName: item.activity.appName,
                                                                windowTitle: item.activity.windowTitle,
                                                                aiDescription: item.activity.screenshotDescriptions?.[path]
                                                            }));

                                                            setSelectedScreenshots(screenshots);
                                                            setSelectedScreenshotMetadata(metadata);
                                                        }}
                                                        className="text-xs text-green-400 hover:text-green-300 active:text-green-200 mt-1 flex items-center gap-1 hover:bg-green-500/10 active:bg-green-500/20 px-1.5 py-0.5 rounded transition-all"
                                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                            <circle cx="8.5" cy="8.5" r="1.5" />
                                                            <polyline points="21 15 16 10 5 21" />
                                                        </svg>
                                                        {item.activity.screenshotPaths.length} screenshot{item.activity.screenshotPaths.length !== 1 ? 's' : ''}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <div className="font-mono text-green-400 font-semibold text-sm">
                                                    {formatTime(item.activity.duration)}
                                                </div>
                                                {onEntryClick && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onEntryClick(item.entry.id);
                                                        }}
                                                        className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 active:bg-gray-600 active:scale-95 transition-all"
                                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                                    >
                                                        View Entry
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Screenshot Gallery Modal */}
            {selectedScreenshots && (
                <ScreenshotGallery
                    screenshotPaths={selectedScreenshots}
                    metadata={selectedScreenshotMetadata || undefined}
                    onClose={() => {
                        setSelectedScreenshots(null);
                        setSelectedScreenshotMetadata(null);
                    }}
                />
            )}
        </div>
    );
}

