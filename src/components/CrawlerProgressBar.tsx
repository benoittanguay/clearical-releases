import { useState, useEffect } from 'react';
import { useCrawlerProgress } from '../context/CrawlerProgressContext';

export function CrawlerProgressBar() {
    const { isActive, projects, totalIssuesFound } = useCrawlerProgress();
    const [isExpanded, setIsExpanded] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    const projectList = Object.values(projects);
    const activeProjects = projectList.filter(p => !p.isComplete);
    const completedProjects = projectList.filter(p => p.isComplete);

    // Show banner when syncing starts, hide 3 seconds after complete
    useEffect(() => {
        if (isActive || projectList.length > 0) {
            setIsVisible(true);
        }

        if (!isActive && projectList.length > 0 && activeProjects.length === 0) {
            // All projects complete - hide after delay
            const timer = setTimeout(() => {
                setIsVisible(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [isActive, projectList.length, activeProjects.length]);

    // Don't render if nothing to show
    if (!isVisible || projectList.length === 0) {
        return null;
    }

    const allComplete = activeProjects.length === 0;

    return (
        <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-40">
            {/* Main banner */}
            <div
                className="cursor-pointer select-none transition-all duration-300"
                style={{
                    backgroundColor: 'var(--color-surface-dark)',
                    borderTop: '1px solid var(--color-border-primary)',
                    boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.15)',
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="px-4 py-2.5 flex items-center gap-3">
                    {/* Loading indicator - pulsing dots or checkmark */}
                    <div className="flex items-center justify-center w-6">
                        {allComplete ? (
                            <svg
                                className="w-5 h-5"
                                style={{ color: 'var(--color-success)' }}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                            >
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                        ) : (
                            <div className="flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot-1" style={{ backgroundColor: 'var(--color-accent)' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot-2" style={{ backgroundColor: 'var(--color-accent)' }} />
                                <div className="w-1.5 h-1.5 rounded-full animate-pulse-dot-3" style={{ backgroundColor: 'var(--color-accent)' }} />
                            </div>
                        )}
                    </div>

                    {/* Project status chips */}
                    <div className="flex-1 flex items-center gap-2 overflow-x-auto">
                        {projectList.map(project => (
                            <div
                                key={project.projectKey}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all"
                                style={{
                                    backgroundColor: project.isComplete
                                        ? 'rgba(34, 197, 94, 0.1)'
                                        : 'rgba(255, 72, 0, 0.1)',
                                    border: `1px solid ${project.isComplete
                                        ? 'rgba(34, 197, 94, 0.3)'
                                        : 'rgba(255, 72, 0, 0.3)'}`,
                                    color: project.isComplete
                                        ? 'var(--color-success)'
                                        : 'var(--color-accent)',
                                }}
                            >
                                {project.isComplete ? (
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'currentColor' }} />
                                )}
                                <span>{project.projectKey}</span>
                                <span style={{ opacity: 0.7 }}>({project.issuesFound})</span>
                            </div>
                        ))}
                    </div>

                    {/* Total count and expand indicator */}
                    <div className="flex items-center gap-3">
                        <span
                            className="text-xs font-mono"
                            style={{ color: 'var(--color-text-secondary)' }}
                        >
                            {totalIssuesFound} total
                        </span>
                        <svg
                            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                            style={{ color: 'var(--color-text-tertiary)' }}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Expanded view - detailed per-project progress */}
            {isExpanded && (
                <div
                    className="absolute bottom-full left-0 right-0 animate-slide-up"
                    style={{
                        backgroundColor: 'var(--color-surface-dark)',
                        borderTop: '1px solid var(--color-border-primary)',
                        boxShadow: '0 -8px 30px rgba(0, 0, 0, 0.2)',
                    }}
                >
                    <div className="px-4 py-3 max-h-64 overflow-y-auto">
                        <div
                            className="text-xs font-semibold uppercase tracking-wider mb-3"
                            style={{
                                color: 'var(--color-text-secondary)',
                                fontFamily: 'var(--font-display)',
                            }}
                        >
                            Sync Progress
                        </div>

                        {/* Active projects */}
                        {activeProjects.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {activeProjects.map(project => (
                                    <div
                                        key={project.projectKey}
                                        className="rounded-lg p-3"
                                        style={{
                                            backgroundColor: 'var(--color-bg-secondary)',
                                            border: '1px solid var(--color-border-primary)',
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-0.5">
                                                    <div className="w-1 h-1 rounded-full animate-pulse-dot-1" style={{ backgroundColor: 'var(--color-accent)' }} />
                                                    <div className="w-1 h-1 rounded-full animate-pulse-dot-2" style={{ backgroundColor: 'var(--color-accent)' }} />
                                                    <div className="w-1 h-1 rounded-full animate-pulse-dot-3" style={{ backgroundColor: 'var(--color-accent)' }} />
                                                </div>
                                                <span
                                                    className="text-sm font-semibold"
                                                    style={{ color: 'var(--color-text-primary)' }}
                                                >
                                                    {project.projectKey}
                                                </span>
                                                <span
                                                    className="text-xs px-1.5 py-0.5 rounded"
                                                    style={{
                                                        backgroundColor: 'rgba(255, 72, 0, 0.1)',
                                                        color: 'var(--color-accent)',
                                                    }}
                                                >
                                                    Syncing
                                                </span>
                                            </div>
                                            <span
                                                className="text-xs font-mono"
                                                style={{ color: 'var(--color-text-secondary)' }}
                                            >
                                                {project.issuesFound} issues found
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Completed projects */}
                        {completedProjects.length > 0 && (
                            <div className={activeProjects.length > 0 ? 'pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-primary)' }}>
                                {activeProjects.length > 0 && (
                                    <div className="text-xs mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Completed</div>
                                )}
                                <div className="space-y-2">
                                    {completedProjects.map(project => (
                                        <div
                                            key={project.projectKey}
                                            className="rounded-lg p-3"
                                            style={{
                                                backgroundColor: 'rgba(34, 197, 94, 0.05)',
                                                border: '1px solid rgba(34, 197, 94, 0.2)',
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <svg
                                                        className="w-4 h-4"
                                                        style={{ color: 'var(--color-success)' }}
                                                        fill="currentColor"
                                                        viewBox="0 0 20 20"
                                                    >
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                    <span
                                                        className="text-sm font-semibold"
                                                        style={{ color: 'var(--color-success)' }}
                                                    >
                                                        {project.projectKey}
                                                    </span>
                                                </div>
                                                <span
                                                    className="text-xs font-mono"
                                                    style={{ color: 'var(--color-text-secondary)' }}
                                                >
                                                    {project.issuesFound} issues
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Animations */}
            <style>{`
                @keyframes pulse-dot-1 {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1); }
                }
                @keyframes pulse-dot-2 {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1); }
                }
                @keyframes pulse-dot-3 {
                    0%, 100% { opacity: 0.3; transform: scale(0.8); }
                    50% { opacity: 1; transform: scale(1); }
                }
                .animate-pulse-dot-1 {
                    animation: pulse-dot-1 1.4s ease-in-out infinite;
                    animation-delay: 0s;
                }
                .animate-pulse-dot-2 {
                    animation: pulse-dot-2 1.4s ease-in-out infinite;
                    animation-delay: 0.2s;
                }
                .animate-pulse-dot-3 {
                    animation: pulse-dot-3 1.4s ease-in-out infinite;
                    animation-delay: 0.4s;
                }
                @keyframes slide-up {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-slide-up {
                    animation: slide-up 0.2s ease-out;
                }
            `}</style>
        </div>
    );
}
