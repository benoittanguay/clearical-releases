import { useState, useEffect } from 'react';
import { JiraCache } from '../services/jiraCache';
import type { CrawlStatus } from '../services/jiraIssueCrawler';

interface JiraCrawlerStatusProps {
    jiraCache: JiraCache;
    className?: string;
}

export function JiraCrawlerStatus({ jiraCache, className = '' }: JiraCrawlerStatusProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [statistics, setStatistics] = useState<any>(null);
    const [latestStatus, setLatestStatus] = useState<CrawlStatus | null>(null);
    const [isEnabled, setIsEnabled] = useState<boolean>(false);

    // Load initial crawler enabled state
    useEffect(() => {
        jiraCache.isCrawlerEnabled().then(setIsEnabled);
    }, [jiraCache]);

    // Subscribe to crawl status updates
    useEffect(() => {
        const unsubscribe = jiraCache.onCrawlStatus((status) => {
            setLatestStatus(status);
            // Refresh statistics when crawl updates
            refreshStatistics();
        });

        return unsubscribe;
    }, [jiraCache]);

    // Refresh statistics periodically
    useEffect(() => {
        refreshStatistics();
        const interval = setInterval(refreshStatistics, 5000); // Every 5 seconds
        return () => clearInterval(interval);
    }, [jiraCache]);

    const refreshStatistics = () => {
        const stats = jiraCache.getCrawlerStatistics();
        setStatistics(stats);
    };

    const handleToggleCrawler = async () => {
        const newState = !isEnabled;
        await jiraCache.setCrawlerEnabled(newState);
        setIsEnabled(newState);
    };

    const handleClearCache = () => {
        if (confirm('Are you sure you want to clear all crawler cache? This will require re-crawling all projects.')) {
            jiraCache.clearCache();
            refreshStatistics();
        }
    };

    if (!statistics) {
        return null;
    }

    const getCrawlProgress = (projectKey: string): { progress: number; status: string } => {
        const projectStats = statistics.projects[projectKey];
        if (!projectStats) {
            return { progress: 0, status: 'Not started' };
        }

        if (projectStats.complete) {
            return { progress: 100, status: 'Complete' };
        }

        // Estimate progress based on issues found and range
        const rangeMatch = projectStats.range.match(/(\d+)-(\d+)/);
        if (!rangeMatch) {
            return { progress: 0, status: 'In progress...' };
        }

        const [, low, high] = rangeMatch;
        const rangeSize = parseInt(high) - parseInt(low) + 1;
        const progress = Math.min(95, (projectStats.issuesFound / rangeSize) * 100); // Cap at 95% until complete

        return {
            progress,
            status: `Crawling... ${projectStats.issuesFound} issues found`
        };
    };

    return (
        <div className={`bg-gray-800 border border-gray-600 rounded-lg overflow-hidden ${className}`}>
            {/* Header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div
                        className={`w-2 h-2 rounded-full ${
                            isEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
                        }`}
                    />
                    <div>
                        <h3 className="text-sm font-medium text-white">Jira Issue Crawler</h3>
                        <p className="text-xs text-gray-400">
                            {statistics.totalIssues.toLocaleString()} issues • {statistics.completeProjects}/{statistics.totalProjects} projects complete
                        </p>
                    </div>
                </div>
                <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Expanded details */}
            {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-700">
                    {/* Controls */}
                    <div className="mt-3 flex items-center gap-2">
                        <button
                            onClick={handleToggleCrawler}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                                isEnabled
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-gray-600 hover:bg-gray-700 text-gray-300'
                            }`}
                        >
                            {isEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button
                            onClick={handleClearCache}
                            className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition-all"
                        >
                            Clear Cache
                        </button>
                        <button
                            onClick={refreshStatistics}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded transition-all"
                        >
                            Refresh
                        </button>
                    </div>

                    {/* Latest crawl status */}
                    {latestStatus && !latestStatus.isComplete && (
                        <div className="mt-3 p-2 bg-gray-750 rounded border border-gray-600">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-400">
                                    Crawling {latestStatus.projectKey} {latestStatus.direction}...
                                </span>
                                <span className="text-blue-400 font-mono">
                                    {latestStatus.projectKey}-{latestStatus.currentIssueNumber}
                                </span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                                Found: {latestStatus.issuesFound} • 404s: {latestStatus.consecutive404s}/50
                            </div>
                        </div>
                    )}

                    {/* Project statistics */}
                    {Object.keys(statistics.projects).length > 0 && (
                        <div className="mt-3 space-y-2">
                            <h4 className="text-xs font-medium text-gray-400">Projects</h4>
                            {Object.entries(statistics.projects).map(([projectKey, projectStats]: [string, any]) => {
                                const { progress, status } = getCrawlProgress(projectKey);
                                return (
                                    <div key={projectKey} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <div className="flex items-center gap-2">
                                                <span className="text-white font-medium">{projectKey}</span>
                                                {projectStats.complete && (
                                                    <span className="text-green-500">✓</span>
                                                )}
                                            </div>
                                            <span className="text-gray-400">
                                                {projectStats.issuesFound.toLocaleString()} issues
                                            </span>
                                        </div>
                                        {!projectStats.complete && (
                                            <div className="space-y-1">
                                                <div className="flex items-center justify-between text-xs text-gray-500">
                                                    <span>{status}</span>
                                                    <span>{Math.round(progress)}%</span>
                                                </div>
                                                <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-blue-500 transition-all duration-300"
                                                        style={{ width: `${progress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        <div className="text-xs text-gray-600">
                                            Range: {projectStats.range}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Information */}
                    <div className="mt-3 p-2 bg-gray-750 rounded text-xs text-gray-400">
                        <p className="font-medium text-gray-300 mb-1">About the Crawler</p>
                        <p>
                            The crawler discovers all issues by incrementing/decrementing issue numbers,
                            finding issues that JQL queries might miss (deleted, restricted access, etc.).
                        </p>
                        <p className="mt-1">
                            Rate: ~5 requests/second • Stops after 50 consecutive 404s
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
