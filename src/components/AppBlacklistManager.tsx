import { useState, useEffect, useMemo } from 'react';
import type { BlacklistedApp, InstalledApp } from '../types/electron';

interface AppBlacklistManagerProps {
    className?: string;
}

/**
 * Clean category name from macOS format to human-readable format
 * Example: "public.app-category.developer-tools" -> "Developer Tools"
 */
function cleanCategoryName(category?: string): string {
    if (!category) {
        return 'Other';
    }

    // Already cleaned by backend
    if (!category.startsWith('public.app-category.')) {
        return category;
    }

    // Remove prefix and convert to title case
    const cleaned = category
        .replace('public.app-category.', '')
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return cleaned || 'Other';
}

/**
 * AppIcon component - Displays app icon or fallback
 */
function AppIcon({ app, size = 32 }: { app: InstalledApp; size?: number }) {
    const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        let mounted = true;

        async function loadIcon() {
            if (!app.iconPath) {
                setLoadError(true);
                return;
            }

            try {
                const response = await window.electron.ipcRenderer.appBlacklist.getAppIconBase64(app.iconPath);
                if (mounted && response.success && response.dataUrl) {
                    setIconDataUrl(response.dataUrl);
                } else {
                    setLoadError(true);
                }
            } catch (err) {
                console.error('[AppIcon] Failed to load icon:', err);
                if (mounted) {
                    setLoadError(true);
                }
            }
        }

        loadIcon();

        return () => {
            mounted = false;
        };
    }, [app.iconPath]);

    if (iconDataUrl && !loadError) {
        return (
            <img
                src={iconDataUrl}
                alt={app.name}
                className="flex-shrink-0 rounded"
                style={{ width: size, height: size }}
            />
        );
    }

    // Fallback icon
    return (
        <div
            className="bg-gray-700 rounded flex items-center justify-center flex-shrink-0"
            style={{ width: size, height: size }}
        >
            <svg className="text-gray-500" style={{ width: size * 0.625, height: size * 0.625 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
        </div>
    );
}

export function AppBlacklistManager({ className = '' }: AppBlacklistManagerProps) {
    const [blacklistedApps, setBlacklistedApps] = useState<BlacklistedApp[]>([]);
    const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load data on mount
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);

            const [blacklistedResponse, installedResponse] = await Promise.all([
                window.electron.ipcRenderer.appBlacklist.getBlacklistedApps(),
                window.electron.ipcRenderer.appBlacklist.getInstalledApps(),
            ]);

            if (blacklistedResponse.success) {
                setBlacklistedApps(blacklistedResponse.data || []);
            } else {
                console.error('[AppBlacklistManager] Failed to load blacklisted apps:', blacklistedResponse.error);
                setError('Failed to load blacklisted apps');
            }

            if (installedResponse.success) {
                setInstalledApps(installedResponse.data || []);
            } else {
                console.error('[AppBlacklistManager] Failed to load installed apps:', installedResponse.error);
                setError('Failed to load installed apps');
            }
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to load data:', err);
            setError('Failed to load app data');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleApp = async (app: InstalledApp, isBlacklisted: boolean) => {
        try {
            if (isBlacklisted) {
                await window.electron.ipcRenderer.appBlacklist.removeBlacklistedApp(app.bundleId);
            } else {
                await window.electron.ipcRenderer.appBlacklist.addBlacklistedApp(
                    app.bundleId,
                    app.name,
                    app.category
                );
            }
            await loadData();
        } catch (err) {
            console.error('[AppBlacklistManager] Failed to toggle app:', err);
            setError('Failed to update app blacklist');
        }
    };

    const toggleCategory = (category: string) => {
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
            const allCategories = new Set<string>();
            groupedApps.forEach(group => allCategories.add(group.category));
            setExpandedCategories(allCategories);
        } else {
            setExpandedCategories(new Set());
        }
    };

    // Create a map for quick blacklist lookup
    const blacklistedBundleIds = useMemo(() => {
        return new Set(blacklistedApps.map(app => app.bundleId));
    }, [blacklistedApps]);

    // Filter and group all apps by category
    const groupedApps = useMemo(() => {
        const filtered = installedApps.filter(app => {
            const matchesSearch = searchQuery === '' ||
                app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                app.bundleId.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesSearch;
        });

        const grouped = filtered.reduce((acc, app) => {
            const category = cleanCategoryName(app.categoryName || app.category);
            const existingGroup = acc.find(g => g.category === category);
            if (existingGroup) {
                existingGroup.apps.push(app);
            } else {
                acc.push({ category, apps: [app] });
            }
            return acc;
        }, [] as { category: string; apps: InstalledApp[] }[]);

        // Sort categories and apps within each category
        return grouped
            .sort((a, b) => a.category.localeCompare(b.category))
            .map(group => ({
                ...group,
                apps: group.apps.sort((a, b) => a.name.localeCompare(b.name))
            }));
    }, [installedApps, searchQuery]);

    // Calculate statistics
    const stats = useMemo(() => {
        const total = installedApps.length;
        const blacklisted = blacklistedApps.length;
        const visible = groupedApps.reduce((sum, group) => sum + group.apps.length, 0);
        return { total, blacklisted, visible };
    }, [installedApps, blacklistedApps, groupedApps]);

    return (
        <div className={className}>
            {/* Header with description */}
            <div className="mb-4">
                <p className="text-xs text-gray-500">
                    Exclude specific apps from being tracked. Screenshots from blacklisted apps will not be captured.
                </p>
            </div>

            {/* Error message */}
            {error && (
                <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-xs text-red-400">
                    {error}
                </div>
            )}

            {/* Statistics */}
            {!loading && (
                <div className="mb-4 flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Total apps:</span>
                        <span className="font-medium text-white">{stats.total}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">Blacklisted:</span>
                        <span className="font-medium text-red-400">{stats.blacklisted}</span>
                    </div>
                </div>
            )}

            {/* Search Bar */}
            <div className="mb-4">
                <div className="relative">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search apps by name or bundle ID..."
                        className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                    />
                    <svg className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>

                {/* Expand/Collapse All */}
                {groupedApps.length > 0 && (
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
            {loading ? (
                <div className="bg-gray-900 p-8 rounded-lg border border-gray-700 text-center">
                    <div className="text-sm text-gray-500">Loading apps...</div>
                </div>
            ) : groupedApps.length === 0 ? (
                <div className="bg-gray-900 p-8 rounded-lg border border-gray-700 text-center">
                    <div className="text-sm text-gray-500">No apps found</div>
                    {searchQuery && (
                        <div className="text-xs text-gray-600 mt-1">
                            Try a different search term
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {groupedApps.map(({ category, apps }) => {
                        const isExpanded = expandedCategories.has(category);
                        const blacklistedCount = apps.filter(app => blacklistedBundleIds.has(app.bundleId)).length;

                        return (
                            <div key={category} className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                                {/* Category Header */}
                                <button
                                    onClick={() => toggleCategory(category)}
                                    className="w-full p-3 flex items-center justify-between hover:bg-gray-800 transition-colors group"
                                >
                                    <div className="flex items-center gap-2.5">
                                        <svg
                                            className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${
                                                isExpanded ? 'rotate-90' : ''
                                            }`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                        <div className="text-sm font-semibold text-white">
                                            {category}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            ({apps.length} {apps.length === 1 ? 'app' : 'apps'})
                                        </div>
                                        {blacklistedCount > 0 && (
                                            <div className="text-xs px-2 py-0.5 bg-red-900/30 text-red-400 rounded">
                                                {blacklistedCount} blocked
                                            </div>
                                        )}
                                    </div>
                                </button>

                                {/* Apps in Category */}
                                {isExpanded && (
                                    <div className="border-t border-gray-700">
                                        {apps.map(app => {
                                            const isBlacklisted = blacklistedBundleIds.has(app.bundleId);

                                            return (
                                                <label
                                                    key={app.bundleId}
                                                    className="flex items-center gap-3 p-3 hover:bg-gray-800 transition-colors cursor-pointer border-b border-gray-700 last:border-b-0 group"
                                                >
                                                    {/* Checkbox */}
                                                    <input
                                                        type="checkbox"
                                                        checked={isBlacklisted}
                                                        onChange={() => handleToggleApp(app, isBlacklisted)}
                                                        className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-red-600 focus:ring-2 focus:ring-red-500 focus:ring-offset-0 cursor-pointer transition-colors"
                                                    />

                                                    {/* App Icon */}
                                                    <AppIcon app={app} size={32} />

                                                    {/* App Info */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium text-white truncate">
                                                            {app.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500 truncate">
                                                            {app.bundleId}
                                                        </div>
                                                    </div>

                                                    {/* Status Badge */}
                                                    {isBlacklisted && (
                                                        <div className="text-xs px-2 py-1 bg-red-900/30 text-red-400 rounded flex-shrink-0">
                                                            BLOCKED
                                                        </div>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
