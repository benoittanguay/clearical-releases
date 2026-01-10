import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { CrawlStatus } from '../services/jiraIssueCrawler';
import { useJiraCache } from './JiraCacheContext';

interface ProjectProgress {
    projectKey: string;
    upwardProgress: number;  // 0-100
    downwardProgress: number; // 0-100
    totalProgress: number; // 0-100
    issuesFound: number;
    isComplete: boolean;
    currentDirection: 'upward' | 'downward' | 'idle';
}

interface CrawlerProgressContextValue {
    isActive: boolean;
    projects: Record<string, ProjectProgress>;
    overallProgress: number;
    totalIssuesFound: number;
    isDismissed: boolean;
    dismiss: () => void;
    restore: () => void;
}

const CrawlerProgressContext = createContext<CrawlerProgressContextValue | null>(null);

export function CrawlerProgressProvider({ children }: { children: ReactNode }) {
    const jiraCache = useJiraCache();
    const [projects, setProjects] = useState<Record<string, ProjectProgress>>({});
    const [isDismissed, setIsDismissed] = useState(false);

    // Subscribe to crawler updates
    useEffect(() => {
        // Subscribe to crawler status updates
        const unsubscribe = jiraCache.onCrawlStatus((status: CrawlStatus) => {
            handleCrawlStatusUpdate(status);
        });

        // Initialize project progress states from crawler statistics (async)
        const initializeProjects = async () => {
            try {
                const stats = jiraCache.getCrawlerStatistics();
                if (!stats || !stats.projects) {
                    console.log('[CrawlerProgressContext] No crawler statistics available');
                    return;
                }

                const initialProjects: Record<string, ProjectProgress> = {};

                for (const [projectKey, projectStats] of Object.entries(stats.projects)) {
                    try {
                        // Get actual progress from crawler state (async)
                        const progress = await jiraCache.getCrawler().getProjectProgress(projectKey);

                        let upwardProgress = 0;
                        let downwardProgress = 0;

                        if (progress) {
                            // Calculate upward progress based on consecutive 404s
                            if (progress.upwardsCrawlComplete) {
                                upwardProgress = 100;
                            } else if (progress.consecutiveUpward404s > 0) {
                                // Show progress based on how close we are to the threshold
                                upwardProgress = Math.min(95, (progress.consecutiveUpward404s / 50) * 100);
                            }

                            // Calculate downward progress
                            if (progress.downwardsCrawlComplete) {
                                downwardProgress = 100;
                            } else if (progress.consecutiveDownward404s > 0) {
                                downwardProgress = Math.min(95, (progress.consecutiveDownward404s / 50) * 100);
                            }
                        }

                        const totalProgress = projectStats.complete ? 100 : (upwardProgress + downwardProgress) / 2;

                        initialProjects[projectKey] = {
                            projectKey,
                            upwardProgress,
                            downwardProgress,
                            totalProgress,
                            issuesFound: projectStats.issuesFound,
                            isComplete: projectStats.complete,
                            currentDirection: 'idle'
                        };
                    } catch (projectError) {
                        console.error(`[CrawlerProgressContext] Error loading progress for ${projectKey}:`, projectError);
                    }
                }

                setProjects(initialProjects);
            } catch (error) {
                console.error('[CrawlerProgressContext] Error initializing projects:', error);
            }
        };

        initializeProjects();

        return () => {
            unsubscribe();
        };
    }, [jiraCache]);

    const handleCrawlStatusUpdate = (status: CrawlStatus) => {
        console.log(`[CrawlerProgressContext] 📥 RECEIVED STATUS: ${status.projectKey} ${status.direction} | Issue: ${status.currentIssueNumber} | Found: ${status.issuesFound} | 404s: ${status.consecutive404s}`);

        setProjects(prev => {
            console.log(`[CrawlerProgressContext] 📊 Current project state BEFORE update:`, prev[status.projectKey]);

            const project = prev[status.projectKey] || {
                projectKey: status.projectKey,
                upwardProgress: 0,
                downwardProgress: 0,
                totalProgress: 0,
                issuesFound: 0,
                isComplete: false,
                currentDirection: status.direction
            };

            // Calculate progress for a direction based on:
            // 1. Distance traveled from start
            // 2. Consecutive 404s (indicates nearing completion)
            const calculateDirectionProgress = (
                currentNumber: number,
                startNumber: number,
                consecutive404s: number,
                isComplete: boolean,
                direction: 'upward' | 'downward'
            ): number => {
                if (isComplete) return 100;

                // Calculate how far we've traveled
                const distance = Math.abs(currentNumber - startNumber);

                // If we're hitting consecutive 404s, we're in completion phase
                // Show progress based on 404 count toward threshold (50)
                if (consecutive404s > 0) {
                    const baseProgress = 50; // Assume we're at least 50% done if hitting 404s
                    const completionProgress = (consecutive404s / 50) * 50; // Scale remaining 50%
                    return Math.min(95, baseProgress + completionProgress);
                }

                // In active discovery phase, show progress based on distance traveled
                // This is a heuristic - we don't know total range yet
                // Cap at 50% during active discovery to leave room for completion phase
                const estimatedRange = direction === 'downward' ? startNumber : 1000;
                const discoveryProgress = Math.min(50, (distance / estimatedRange) * 50);
                return discoveryProgress;
            };

            let upwardProgress = project.upwardProgress;
            let downwardProgress = project.downwardProgress;

            if (status.direction === 'upward') {
                upwardProgress = calculateDirectionProgress(
                    status.currentIssueNumber,
                    status.startIssueNumber,
                    status.consecutive404s,
                    status.isComplete,
                    'upward'
                );
            } else {
                downwardProgress = calculateDirectionProgress(
                    status.currentIssueNumber,
                    status.startIssueNumber,
                    status.consecutive404s,
                    status.isComplete,
                    'downward'
                );
            }

            const totalProgress = (upwardProgress + downwardProgress) / 2;
            const isComplete = upwardProgress === 100 && downwardProgress === 100;

            const updatedProject: ProjectProgress = {
                projectKey: status.projectKey,
                upwardProgress,
                downwardProgress,
                totalProgress,
                issuesFound: status.issuesFound,
                isComplete,
                currentDirection: status.isComplete ? 'idle' : status.direction
            };

            console.log(`[CrawlerProgressContext] 📊 NEW project state:`, updatedProject);
            console.log(`[CrawlerProgressContext] 📈 Progress update: ${status.direction} = ${status.direction === 'upward' ? upwardProgress : downwardProgress}%, total = ${totalProgress}%`);

            return {
                ...prev,
                [status.projectKey]: updatedProject
            };
        });

        // If a new crawl starts, un-dismiss the progress bar
        if (!status.isComplete) {
            setIsDismissed(false);
        }
    };

    // Calculate overall metrics
    const projectList = Object.values(projects);
    const isActive = projectList.some(p => !p.isComplete);
    const overallProgress = projectList.length > 0
        ? projectList.reduce((sum, p) => sum + p.totalProgress, 0) / projectList.length
        : 0;
    const totalIssuesFound = projectList.reduce((sum, p) => sum + p.issuesFound, 0);

    const dismiss = () => setIsDismissed(true);
    const restore = () => setIsDismissed(false);

    return (
        <CrawlerProgressContext.Provider
            value={{
                isActive,
                projects,
                overallProgress,
                totalIssuesFound,
                isDismissed,
                dismiss,
                restore
            }}
        >
            {children}
        </CrawlerProgressContext.Provider>
    );
}

export function useCrawlerProgress() {
    const context = useContext(CrawlerProgressContext);
    if (!context) {
        throw new Error('useCrawlerProgress must be used within CrawlerProgressProvider');
    }
    return context;
}
