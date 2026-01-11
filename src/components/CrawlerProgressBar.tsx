import { useState } from 'react';
import { useCrawlerProgress } from '../context/CrawlerProgressContext';

export function CrawlerProgressBar() {
    const { isActive, projects, overallProgress, totalIssuesFound } = useCrawlerProgress();
    const [isExpanded, setIsExpanded] = useState(false);

    // Don't render if not active
    if (!isActive) {
        return null;
    }

    const projectList = Object.values(projects);
    const activeProjects = projectList.filter(p => !p.isComplete);
    const completedProjects = projectList.filter(p => p.isComplete);

    // Format project status for display
    const getProjectStatusText = () => {
        if (activeProjects.length === 0) {
            return 'Sync complete';
        }

        const parts: string[] = [];
        activeProjects.forEach(p => {
            parts.push(p.projectKey);
        });

        return `Syncing: ${parts.join(', ')}`;
    };

    return (
        <div className="fixed top-0 left-0 right-0 z-50">
            {/* Collapsed view - thin bar at top */}
            <div
                className="bg-gray-800 border-b border-gray-700 shadow-lg cursor-pointer select-none"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="px-4 py-2 flex items-center">
                    <div className="flex items-center gap-3 flex-1">
                        {/* Animated sync icon */}
                        <div className="relative">
                            <svg
                                className={`w-4 h-4 text-green-400 ${isActive ? 'animate-spin' : ''}`}
                                style={{ animationDuration: '2s' }}
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                            </svg>
                        </div>

                        {/* Status text */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-300 truncate">
                                    {getProjectStatusText()}
                                </span>
                                <span className="text-xs text-gray-500">
                                    ({totalIssuesFound} issues)
                                </span>
                            </div>

                            {/* Progress bar */}
                            <div className="mt-1 w-full bg-gray-700 rounded-full h-1 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-300 ease-out relative"
                                    style={{ width: `${overallProgress}%` }}
                                >
                                    {/* Animated shimmer effect */}
                                    {isActive && (
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Expand indicator */}
                        <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Expanded view - detailed per-project progress */}
            {isExpanded && (
                <div className="absolute top-full left-0 right-0 bg-gray-800 border-b border-gray-700 shadow-xl z-[60] animate-fade-in">
                    <div className="px-4 py-3 max-h-64 overflow-y-auto">
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            Project Details
                        </div>

                        {/* Active projects */}
                        {activeProjects.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {activeProjects.map(project => (
                                    <div key={project.projectKey} className="bg-gray-750 rounded p-2 border border-gray-600">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-sm font-medium text-white">
                                                {project.projectKey}
                                            </span>
                                            <span className="text-xs text-gray-400">
                                                {project.issuesFound} issues
                                            </span>
                                        </div>

                                        {/* Unified progress bar */}
                                        <div className="bg-gray-700 rounded-full h-1.5 overflow-hidden">
                                            <div
                                                className="h-full bg-green-500 transition-all duration-300"
                                                style={{ width: `${project.totalProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Completed projects (if any) */}
                        {completedProjects.length > 0 && (
                            <div className="border-t border-gray-700 pt-2">
                                <div className="text-xs text-gray-500 mb-1.5">Completed</div>
                                <div className="flex flex-wrap gap-2">
                                    {completedProjects.map(project => (
                                        <div
                                            key={project.projectKey}
                                            className="px-2 py-1 bg-green-600/10 border border-green-600/30 rounded text-xs text-green-400"
                                        >
                                            {project.projectKey} ({project.issuesFound})
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Info note */}
                        <div className="mt-3 pt-2 border-t border-gray-700">
                            <p className="text-xs text-gray-500">
                                The crawler discovers all issues in your projects by scanning issue numbers.
                                This runs in the background and updates automatically.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Shimmer animation */}
            <style>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-shimmer {
                    animation: shimmer 2s infinite;
                }
            `}</style>
        </div>
    );
}
