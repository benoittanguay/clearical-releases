import { useState, useEffect, useMemo } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity, WorkAssignment } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';
import { DeleteButton } from './DeleteButton';
import { AssignmentPicker } from './AssignmentPicker';
import { TempoValidationModal } from './TempoValidationModal';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';

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
    const { removeActivityFromEntry, removeAllActivitiesForApp, removeScreenshotFromEntry, addManualActivityToEntry, setEntryAssignment } = useStorage();
    const { settings } = useSettings();
    const [description, setDescription] = useState(entry.description || '');
    const [selectedAssignment, setSelectedAssignment] = useState<WorkAssignment | null>(() => {
        // Get assignment from unified model or fallback to legacy fields
        return entry.assignment || 
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : entry.bucketId ? {
                type: 'bucket' as const,
                bucket: buckets.find(b => b.id === entry.bucketId)
            } : null);
    });
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
    const [appIcons, setAppIcons] = useState<Map<string, string>>(new Map());
    const [selectedScreenshots, setSelectedScreenshots] = useState<string[] | null>(null);
    const [selectedScreenshotMetadata, setSelectedScreenshotMetadata] = useState<Array<{ path: string; timestamp: number; appName?: string; windowTitle?: string; aiDescription?: string; }> | null>(null);
    const [saveTimeoutId, setSaveTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [showManualEntryForm, setShowManualEntryForm] = useState(false);
    const [manualDescription, setManualDescription] = useState('');
    const [manualDuration, setManualDuration] = useState('');
    const [showTempoValidationModal, setShowTempoValidationModal] = useState(false);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

    // Update local state when entry changes
    useEffect(() => {
        setDescription(entry.description || '');
        setSelectedAssignment(entry.assignment || 
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : entry.bucketId ? {
                type: 'bucket' as const,
                bucket: buckets.find(b => b.id === entry.bucketId)
            } : null));
    }, [entry.id, entry.description, entry.assignment, entry.bucketId, entry.linkedJiraIssue, buckets]);

    // Auto-save function with debouncing
    const autoSave = () => {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }
        
        const timeoutId = setTimeout(() => {
            onUpdate(entry.id, {
                description: description.trim() || undefined
            });
        }, 500); // 500ms debounce
        
        setSaveTimeoutId(timeoutId);
    };

    // Auto-save when description or bucket changes
    useEffect(() => {
        // Only auto-save if description is different from the original entry
        if (description !== (entry.description || '')) {
            autoSave();
        }
        
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, [description]);

    // Handle assignment changes separately
    const handleAssignmentChange = (assignment: WorkAssignment | null) => {
        setSelectedAssignment(assignment);
        setEntryAssignment(entry.id, assignment);
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, []);

    // Update metadata when entry changes and gallery is open
    useEffect(() => {
        if (selectedScreenshots && entry.windowActivity) {
            // Find activities that have the selected screenshots and rebuild metadata
            const updatedMetadata = selectedScreenshots.map(path => {
                // Find the activity that contains this screenshot
                const activity = entry.windowActivity?.find(act =>
                    act.screenshotPaths?.includes(path)
                );

                return {
                    path,
                    timestamp: activity?.timestamp || Date.now(),
                    appName: activity?.appName,
                    windowTitle: activity?.windowTitle,
                    aiDescription: activity?.screenshotDescriptions?.[path]
                };
            });

            setSelectedScreenshotMetadata(updatedMetadata);
        }
    }, [entry.windowActivity, selectedScreenshots]);

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
            const updatedMetadata = selectedScreenshotMetadata?.filter(meta => meta.path !== screenshotPath);
            
            if (updatedScreenshots.length === 0) {
                setSelectedScreenshots(null);
                setSelectedScreenshotMetadata(null);
            } else {
                setSelectedScreenshots(updatedScreenshots);
                setSelectedScreenshotMetadata(updatedMetadata || null);
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

    const handleOpenTempoModal = () => {
        // Check if Tempo is configured
        if (!settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
            onNavigateToSettings();
            return;
        }

        // Check if there's an assignment
        if (!selectedAssignment) {
            alert('Please select an assignment (bucket or Jira issue) before logging to Tempo.');
            return;
        }

        // Open the validation modal
        setShowTempoValidationModal(true);
    };

    const handleTempoSuccess = () => {
        setShowTempoValidationModal(false);
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

    // Calculate screenshot analysis statistics
    const screenshotStats = useMemo(() => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            return { total: 0, analyzed: 0 };
        }

        let totalScreenshots = 0;
        let analyzedScreenshots = 0;

        entry.windowActivity.forEach(activity => {
            if (activity.screenshotPaths) {
                totalScreenshots += activity.screenshotPaths.length;

                // Count how many have AI descriptions
                if (activity.screenshotDescriptions) {
                    activity.screenshotPaths.forEach(path => {
                        if (activity.screenshotDescriptions?.[path]) {
                            analyzedScreenshots++;
                        }
                    });
                }
            }
        });

        return { total: totalScreenshots, analyzed: analyzedScreenshots };
    }, [entry.windowActivity]);

    // Handler for generating AI summary
    const handleGenerateSummary = async () => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            alert('No activity data available to generate summary.');
            return;
        }

        setIsGeneratingSummary(true);

        try {
            // Collect all context data
            const screenshotDescriptions: string[] = [];
            const windowTitles: string[] = [];
            const appNames: string[] = [];

            entry.windowActivity.forEach(activity => {
                // Collect app names and window titles
                if (activity.appName && !appNames.includes(activity.appName)) {
                    appNames.push(activity.appName);
                }
                if (activity.windowTitle && !windowTitles.includes(activity.windowTitle)) {
                    windowTitles.push(activity.windowTitle);
                }

                // Collect screenshot descriptions
                if (activity.screenshotDescriptions) {
                    Object.values(activity.screenshotDescriptions).forEach(desc => {
                        if (desc && desc.trim()) {
                            screenshotDescriptions.push(desc);
                        }
                    });
                }
            });

            // Call the IPC handler to generate summary
            // @ts-ignore
            const result = await window.electron?.ipcRenderer?.generateActivitySummary?.({
                screenshotDescriptions,
                windowTitles,
                appNames,
                duration: entry.duration,
                startTime: entry.startTime,
                endTime: entry.endTime
            });

            if (result?.success && result.summary) {
                // Populate the description field with the generated summary
                setDescription(result.summary);
                // The auto-save mechanism will handle saving
            } else {
                throw new Error(result?.error || 'Failed to generate summary');
            }

        } catch (error) {
            console.error('Failed to generate summary:', error);
            alert(`Failed to generate summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    const currentAssignment = selectedAssignment;

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
            {/* Header with Back Button and Log to Tempo Button */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-gray-800 active:bg-gray-700 rounded-lg transition-all text-gray-400 hover:text-white active:scale-95"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h2 className="text-2xl font-bold">Activity Details</h2>
                </div>

                {/* Log to Tempo Button - moved to header */}
                <div>
                    <button
                        onClick={handleOpenTempoModal}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm rounded-lg transition-all active:scale-[0.99] flex items-center justify-center gap-2"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 6v6l4 2"/>
                        </svg>
                        Log to Tempo
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pb-6">
                {/* Entry Summary - Reorganized */}
                <div className="bg-gray-800/50 rounded-lg border border-gray-700">
                    {/* Time Summary Section - Start/End times and Duration counter */}
                    <div className="flex items-center justify-between p-4 border-b border-gray-700">
                        <div className="flex flex-col gap-0.5">
                            <div className="text-xs text-gray-400">
                                <span className="font-semibold">Start:</span> {new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                            <div className="text-xs text-gray-400">
                                <span className="font-semibold">End:</span> {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                        </div>
                        <div className="text-3xl font-mono font-bold text-green-400">
                            {formatTime(entry.duration)}
                        </div>
                    </div>

                    {/* Assignment Section */}
                    <div className="p-4 border-b border-gray-700">
                        <label className="text-xs text-gray-400 uppercase font-semibold mb-2 block">Assignment</label>
                        <AssignmentPicker
                            value={currentAssignment}
                            onChange={handleAssignmentChange}
                            placeholder="Select assignment..."
                            className="w-full"
                        />
                    </div>

                    {/* Description Section */}
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <label className="text-xs text-gray-400 uppercase font-semibold">Description</label>
                                {screenshotStats.total > 0 && (
                                    <div className="text-xs text-gray-500">
                                        {screenshotStats.analyzed}/{screenshotStats.total} screenshots analyzed
                                    </div>
                                )}
                            </div>
                            {screenshotStats.analyzed > 0 && (
                                <button
                                    onClick={handleGenerateSummary}
                                    disabled={isGeneratingSummary}
                                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded-md transition-all active:scale-[0.98] flex items-center gap-1.5"
                                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                >
                                    {isGeneratingSummary ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                                <path d="M2 17l10 5 10-5"/>
                                                <path d="M2 12l10 5 10-5"/>
                                            </svg>
                                            Generate Summary
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a description for this time entry..."
                            className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                            rows={3}
                        />
                    </div>
                </div>

                {/* Window Activity - Grouped by App */}
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold text-gray-300">Window Activity</h3>
                        <button
                            onClick={() => setShowManualEntryForm(!showManualEntryForm)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm rounded-md transition-all active:scale-95 flex items-center gap-1"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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
                    <div className="text-gray-500 text-sm py-8 text-center animate-fade-in">
                        <svg className="w-12 h-12 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p>No window activity recorded for this session</p>
                        <p className="text-xs text-gray-600 mt-1">Click "Add Manual Entry" to add time manually</p>
                    </div>
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
                                        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/80 active:bg-gray-800 transition-all"
                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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

                                                                        const screenshots = activity.screenshotPaths || [];
                                                                        const metadata = screenshots.map(path => ({
                                                                            path,
                                                                            timestamp: activity.timestamp,
                                                                            appName: activity.appName,
                                                                            windowTitle: activity.windowTitle,
                                                                            aiDescription: activity.screenshotDescriptions?.[path]
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
                    metadata={selectedScreenshotMetadata || undefined}
                    onClose={() => {
                        setSelectedScreenshots(null);
                        setSelectedScreenshotMetadata(null);
                    }}
                    onScreenshotDeleted={handleScreenshotDeleted}
                />
            )}

            {/* Tempo Validation Modal */}
            {showTempoValidationModal && settings.tempo?.enabled && settings.tempo?.apiToken && settings.tempo?.baseUrl && (
                <TempoValidationModal
                    entry={entry}
                    assignment={selectedAssignment}
                    buckets={buckets}
                    onClose={() => setShowTempoValidationModal(false)}
                    onSuccess={handleTempoSuccess}
                    formatTime={formatTime}
                    tempoBaseUrl={settings.tempo.baseUrl}
                    tempoApiToken={settings.tempo.apiToken}
                    defaultDescription={description}
                />
            )}
        </div>
    );
}
