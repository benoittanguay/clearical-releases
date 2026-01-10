import { useState, useEffect } from 'react';
import type { BlacklistedApp, InstalledApp } from '../types/electron';

// App categories for organization
export type AppCategory =
    | 'Productivity'
    | 'Developer Tools'
    | 'Music & Audio'
    | 'Video'
    | 'Games'
    | 'Social'
    | 'Browsers'
    | 'Communication'
    | 'Utilities'
    | 'Other'
    | string;  // Allow any string for flexibility

interface AppBlacklistManagerProps {
    className?: string;
}

export function AppBlacklistManager({ className = '' }: AppBlacklistManagerProps) {
    const [blacklistedApps, setBlacklistedApps] = useState<BlacklistedApp[]>([]);
    const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<AppCategory>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load blacklisted apps on mount
    useEffect(() => {
        loadBlacklistedApps();
    }, []);

    // Load installed apps when modal opens
    useEffect(() => {
        if (showAddModal) {
            loadInstalledApps();
        }
    }, [showAddModal]);

    const loadBlacklistedApps = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await window.electron.ipcRenderer.appBlacklist.getBlacklistedApps();

            if (response.success) {
                setBlacklistedApps(response.data || []);
            } else {
                console.error('[AppBlacklistManager] Failed to load blacklisted apps:', response.error);
                setError('Failed to load blacklisted apps');
                setBlacklistedApps([]);
            }
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to load blacklisted apps:', err);
            setError('Failed to load blacklisted apps');
            setBlacklistedApps([]);
        } finally {
            setLoading(false);
        }
    };

    const loadInstalledApps = async () => {
        try {
            const response = await window.electron.ipcRenderer.appBlacklist.getInstalledApps();
            if (response.success) {
                setInstalledApps(response.data || []);
            } else {
                console.error('[AppBlacklistManager] Failed to load installed apps:', response.error);
            }
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to load installed apps:', err);
        }
    };

    const handleAddApp = async (app: InstalledApp) => {
        try {
            await window.electron.ipcRenderer.appBlacklist.addBlacklistedApp(
                app.bundleId,
                app.name,
                app.category
            );
            await loadBlacklistedApps();
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to add app to blacklist:', err);
            setError('Failed to add app to blacklist');
        }
    };

    const handleRemoveApp = async (bundleId: string) => {
        try {
            await window.electron.ipcRenderer.appBlacklist.removeBlacklistedApp(bundleId);
            await loadBlacklistedApps();
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to remove app from blacklist:', err);
            setError('Failed to remove app from blacklist');
        }
    };

    const toggleCategory = (category: AppCategory) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
                next.delete(category);
            } else {
                next.add(category);
            }
            return next;
        });
    };

    const toggleAllCategories = (expand: boolean) => {
        if (expand) {
            const allCategories = new Set<AppCategory>();
            groupedInstalledApps.forEach(group => allCategories.add(group.category));
            setExpandedCategories(allCategories);
        } else {
            setExpandedCategories(new Set());
        }
    };

    // Group blacklisted apps by category
    const groupedBlacklistedApps = blacklistedApps.reduce((acc, app) => {
        const category = app.category || 'Other';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(app);
        return acc;
    }, {} as Record<AppCategory, BlacklistedApp[]>);

    // Filter and group installed apps by category
    const filteredInstalledApps = installedApps.filter(app => {
        const matchesSearch = searchQuery === '' ||
            app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            app.bundleId.toLowerCase().includes(searchQuery.toLowerCase());
        const notBlacklisted = !blacklistedApps.some(b => b.bundleId === app.bundleId);
        return matchesSearch && notBlacklisted;
    });

    const groupedInstalledApps = filteredInstalledApps
        .reduce((acc, app) => {
            const category = app.category || 'Other';
            const existingGroup = acc.find(g => g.category === category);
            if (existingGroup) {
                existingGroup.apps.push(app);
            } else {
                acc.push({ category, apps: [app] });
            }
            return acc;
        }, [] as { category: AppCategory; apps: InstalledApp[] }[])
        .sort((a, b) => a.category.localeCompare(b.category));

    const sortedCategories = Object.keys(groupedBlacklistedApps).sort() as AppCategory[];

    return (
        <div className={className}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div>
                    <p className="text-xs text-gray-500">
                        Exclude specific apps from being tracked. Screenshots from blacklisted apps will not be captured.
                    </p>
                </div>
            </div>

            {/* Error message */}
            {error && (
                <div className="mb-3 p-2.5 bg-red-900/30 border border-red-700 rounded text-xs text-red-400">
                    {error}
                </div>
            )}

            {/* Blacklisted Apps List */}
            <div className="space-y-2 mb-3">
                {loading ? (
                    <div className="bg-gray-900 p-4 rounded border border-gray-700 text-center">
                        <div className="text-sm text-gray-500">Loading blacklisted apps...</div>
                    </div>
                ) : blacklistedApps.length === 0 ? (
                    <div className="bg-gray-900 p-4 rounded border border-gray-700 text-center">
                        <div className="text-sm text-gray-500 mb-2">No apps blacklisted</div>
                        <div className="text-xs text-gray-600">
                            Click "Add Apps" to exclude apps from tracking
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Summary */}
                        <div className="bg-gray-900 p-2.5 rounded border border-gray-700">
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-white">
                                    {blacklistedApps.length} {blacklistedApps.length === 1 ? 'app' : 'apps'} blacklisted
                                </div>
                                <span className="text-xs px-2 py-1 bg-red-900/30 text-red-400 rounded">
                                    EXCLUDED
                                </span>
                            </div>
                        </div>

                        {/* Apps grouped by category */}
                        {sortedCategories.map(category => (
                            <div key={category} className="bg-gray-900 rounded border border-gray-700">
                                <div className="p-2.5 border-b border-gray-700">
                                    <div className="text-xs font-semibold text-gray-400 uppercase">
                                        {category}
                                    </div>
                                </div>
                                <div className="divide-y divide-gray-700">
                                    {groupedBlacklistedApps[category].map(app => (
                                        <div
                                            key={app.bundleId}
                                            className="flex items-center justify-between p-2.5 hover:bg-gray-800 transition-colors"
                                        >
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-white truncate">{app.name}</div>
                                                    <div className="text-xs text-gray-500 truncate">{app.bundleId}</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveApp(app.bundleId)}
                                                className="ml-2 p-1.5 hover:bg-red-900/30 text-red-400 rounded transition-colors flex-shrink-0"
                                                title="Remove from blacklist"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            {/* Add Apps Button */}
            <button
                onClick={() => setShowAddModal(true)}
                className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Apps to Blacklist
            </button>

            {/* Add Apps Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
                        {/* Modal Header */}
                        <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
                            <h3 className="text-lg font-semibold text-white">Add Apps to Blacklist</h3>
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    setSearchQuery('');
                                }}
                                className="p-1 hover:bg-gray-700 rounded transition-colors"
                            >
                                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Search Bar */}
                        <div className="p-4 border-b border-gray-700 flex-shrink-0">
                            <div className="relative">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search apps by name or bundle ID..."
                                    className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>

                            {/* Expand/Collapse All */}
                            {groupedInstalledApps.length > 0 && (
                                <div className="flex gap-2 mt-2">
                                    <button
                                        onClick={() => toggleAllCategories(true)}
                                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                        Expand All
                                    </button>
                                    <span className="text-gray-600">•</span>
                                    <button
                                        onClick={() => toggleAllCategories(false)}
                                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                        Collapse All
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Apps List */}
                        <div className="flex-1 overflow-y-auto p-4">
                            {installedApps.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="text-sm text-gray-500">Loading installed apps...</div>
                                </div>
                            ) : groupedInstalledApps.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="text-sm text-gray-500">No apps found</div>
                                    <div className="text-xs text-gray-600 mt-1">
                                        {searchQuery ? 'Try a different search term' : 'All apps are already blacklisted'}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {groupedInstalledApps.map(({ category, apps }) => (
                                        <div key={category} className="bg-gray-900 rounded border border-gray-700 overflow-hidden">
                                            {/* Category Header */}
                                            <button
                                                onClick={() => toggleCategory(category)}
                                                className="w-full p-2.5 flex items-center justify-between hover:bg-gray-800 transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <svg
                                                        className={`w-4 h-4 text-gray-500 transition-transform ${
                                                            expandedCategories.has(category) ? 'rotate-90' : ''
                                                        }`}
                                                        fill="none"
                                                        stroke="currentColor"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                    </svg>
                                                    <div className="text-xs font-semibold text-gray-400 uppercase">
                                                        {category}
                                                    </div>
                                                    <div className="text-xs text-gray-600">
                                                        ({apps.length})
                                                    </div>
                                                </div>
                                            </button>

                                            {/* Apps in Category */}
                                            {expandedCategories.has(category) && (
                                                <div className="border-t border-gray-700 divide-y divide-gray-700">
                                                    {apps.map(app => (
                                                        <div
                                                            key={app.bundleId}
                                                            className="flex items-center justify-between p-2.5 hover:bg-gray-800 transition-colors"
                                                        >
                                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                                                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                                    </svg>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-sm font-medium text-white truncate">{app.name}</div>
                                                                    <div className="text-xs text-gray-500 truncate">{app.bundleId}</div>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleAddApp(app)}
                                                                className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors flex-shrink-0"
                                                            >
                                                                Add
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-gray-700 flex justify-end flex-shrink-0">
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    setSearchQuery('');
                                }}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
