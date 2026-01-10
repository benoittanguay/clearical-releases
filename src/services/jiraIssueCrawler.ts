import { JiraService } from './jiraService';
import type { JiraIssue } from './jiraService';

/**
 * Progress tracking for a single project's crawl
 */
interface ProjectCrawlProgress {
    projectKey: string;
    highestKnownIssueNumber: number;  // Highest issue number discovered
    lowestKnownIssueNumber: number;   // Lowest issue number discovered
    upwardsCrawlComplete: boolean;    // Have we hit 50 consecutive 404s going up?
    downwardsCrawlComplete: boolean;  // Have we hit 50 consecutive 404s going down or reached 0?
    lastCrawlTimestamp: number;       // When did we last crawl this project
    totalIssuesFound: number;         // Total count of issues cached
    consecutiveUpward404s: number;    // Current streak of 404s going upward
    consecutiveDownward404s: number;  // Current streak of 404s going downward
}

/**
 * Storage structure for all crawler state
 * Note: Issues are now stored in the database, not in memory
 */
interface CrawlerState {
    projects: Record<string, ProjectCrawlProgress>;
    lastGlobalUpdate: number;
}

/**
 * Configuration for the crawler behavior
 */
interface CrawlerConfig {
    consecutiveNotFoundThreshold: number;  // How many 404s before stopping (default: 50)
    requestDelayMs: number;                // Delay between requests (default: 200ms)
    batchSize: number;                     // How many issues to crawl before saving progress
    maxIssueNumber: number;                // Safety limit to prevent infinite loops
}

/**
 * Status update emitted during crawling
 */
export interface CrawlStatus {
    projectKey: string;
    direction: 'upward' | 'downward';
    currentIssueNumber: number;
    issuesFound: number;
    consecutive404s: number;
    isComplete: boolean;
    error?: string;
    // Range information for progress calculation
    startIssueNumber: number;  // Where this direction started
    highestKnownIssue?: number;  // Highest issue number discovered (for context)
    lowestKnownIssue?: number;   // Lowest issue number discovered (for context)
}

/**
 * JiraIssueCrawler - Intelligent bi-directional issue discovery system
 *
 * This service crawls Jira projects by incrementing/decrementing issue numbers
 * to discover all issues, including those not returned by JQL queries.
 *
 * Key features:
 * - Bi-directional crawling (up from known issue, down to issue #1)
 * - Persistent progress tracking (survives app restarts)
 * - Rate limiting to avoid API abuse
 * - Independent per-project crawlers
 * - Handles deleted issues (gaps in numbering)
 */
export class JiraIssueCrawler {
    private static readonly DEFAULT_CONFIG: CrawlerConfig = {
        consecutiveNotFoundThreshold: 50,
        requestDelayMs: 200,  // 5 requests per second max
        batchSize: 10,
        maxIssueNumber: 999999
    };

    private jiraService: JiraService | null = null;
    private state: CrawlerState;
    private config: CrawlerConfig;
    private statusCallbacks: ((status: CrawlStatus) => void)[] = [];
    private activeCrawls: Set<string> = new Set();
    private stateLoaded: boolean = false;

    constructor(config?: Partial<CrawlerConfig>) {
        this.config = { ...JiraIssueCrawler.DEFAULT_CONFIG, ...config };
        this.state = {
            projects: {},
            lastGlobalUpdate: 0
        };
        // Load state asynchronously
        this.loadState();
    }

    /**
     * Initialize with Jira service credentials
     */
    public initializeService(baseUrl: string, email: string, apiToken: string): void {
        this.jiraService = new JiraService(baseUrl, email, apiToken);
    }

    /**
     * Subscribe to crawl status updates
     */
    public onStatusUpdate(callback: (status: CrawlStatus) => void): () => void {
        this.statusCallbacks.push(callback);
        return () => {
            const index = this.statusCallbacks.indexOf(callback);
            if (index > -1) {
                this.statusCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Get cached issues for a project from database
     * @deprecated Use getProjectIssuesAsync instead
     */
    public getProjectIssues(_projectKey: string): JiraIssue[] {
        // This is a synchronous method but data comes from database
        // We'll need to make this async in a future iteration
        // For now, return empty and rely on the async methods
        console.warn('[JiraIssueCrawler] getProjectIssues is deprecated - use async database methods');
        return [];
    }

    /**
     * Get all cached issues from database
     */
    public async getAllIssuesAsync(): Promise<JiraIssue[]> {
        const result = await window.electron.ipcRenderer.db.getAllJiraIssues();
        if (result.success && result.data) {
            return result.data;
        }
        return [];
    }

    /**
     * Get cached issues for a project from database (async)
     */
    public async getProjectIssuesAsync(projectKey: string): Promise<JiraIssue[]> {
        const result = await window.electron.ipcRenderer.db.getJiraIssuesByProject(projectKey);
        if (result.success && result.data) {
            return result.data.sort((a, b) => {
                // Sort by issue number descending (most recent first)
                const aNum = this.extractIssueNumber(a.key);
                const bNum = this.extractIssueNumber(b.key);
                return bNum - aNum;
            });
        }
        return [];
    }

    /**
     * Get crawl progress for a project
     */
    public async getProjectProgress(projectKey: string): Promise<ProjectCrawlProgress | null> {
        await this.ensureStateLoaded();
        return this.state.projects[projectKey] || null;
    }

    /**
     * Ensure state is loaded from database before accessing
     */
    private async ensureStateLoaded(): Promise<void> {
        if (!this.stateLoaded) {
            await this.loadState();
        }
    }

    /**
     * Check if a project's crawl is complete
     */
    public async isProjectComplete(projectKey: string): Promise<boolean> {
        await this.ensureStateLoaded();
        const progress = this.state.projects[projectKey];
        if (!progress) return false;
        return progress.upwardsCrawlComplete && progress.downwardsCrawlComplete;
    }

    /**
     * Start crawling a project (bi-directional from starting issue)
     * @param projectKey - The project key (e.g., "DES")
     * @param startingIssueNumber - Issue number to start from (defaults to 1)
     * @returns Promise that resolves when both directions complete
     */
    public async crawlProject(
        projectKey: string,
        startingIssueNumber?: number
    ): Promise<void> {
        if (!this.jiraService) {
            throw new Error('JiraService not initialized. Call initializeService() first.');
        }

        // Prevent concurrent crawls of the same project
        if (this.activeCrawls.has(projectKey)) {
            console.log(`[JiraIssueCrawler] Crawl already in progress for ${projectKey}`);
            return;
        }

        this.activeCrawls.add(projectKey);

        try {
            // Initialize or resume progress
            await this.ensureStateLoaded();
            let progress: ProjectCrawlProgress | undefined = this.state.projects[projectKey];

            // Try to load from database if not in memory
            if (!progress) {
                const loadedProgress = await this.loadProjectState(projectKey);
                if (loadedProgress) {
                    progress = loadedProgress;
                }
            }

            if (!progress) {
                // First time crawling this project
                const startNum = startingIssueNumber || await this.findStartingIssue(projectKey);
                progress = {
                    projectKey,
                    highestKnownIssueNumber: startNum,
                    lowestKnownIssueNumber: startNum,
                    upwardsCrawlComplete: false,
                    downwardsCrawlComplete: false,
                    lastCrawlTimestamp: Date.now(),
                    totalIssuesFound: 0,
                    consecutiveUpward404s: 0,
                    consecutiveDownward404s: 0
                };
                this.state.projects[projectKey] = progress;
                await this.saveState();
            } else {
                // Load progress into memory state
                this.state.projects[projectKey] = progress;
            }

            console.log(`[JiraIssueCrawler] Starting bi-directional crawl for ${projectKey}`);
            console.log(`[JiraIssueCrawler] Range: ${progress.lowestKnownIssueNumber} ← → ${progress.highestKnownIssueNumber}`);

            // Crawl both directions concurrently
            await Promise.all([
                this.crawlUpward(projectKey),
                this.crawlDownward(projectKey)
            ]);

            console.log(`[JiraIssueCrawler] Crawl complete for ${projectKey}. Found ${progress.totalIssuesFound} issues.`);
        } finally {
            this.activeCrawls.delete(projectKey);
        }
    }

    /**
     * Crawl multiple projects concurrently
     */
    public async crawlProjects(projectKeys: string[]): Promise<void> {
        console.log(`[JiraIssueCrawler] Starting crawl for ${projectKeys.length} projects:`, projectKeys);

        await Promise.all(
            projectKeys.map(projectKey =>
                this.crawlProject(projectKey).catch(error => {
                    console.error(`[JiraIssueCrawler] Failed to crawl ${projectKey}:`, error);
                })
            )
        );

        console.log(`[JiraIssueCrawler] All project crawls completed`);
    }

    /**
     * Resume incomplete crawls for projects
     */
    public async resumeCrawls(projectKeys: string[]): Promise<void> {
        await this.ensureStateLoaded();
        const incompleteCrawls: string[] = [];
        for (const pk of projectKeys) {
            if (!(await this.isProjectComplete(pk))) {
                incompleteCrawls.push(pk);
            }
        }

        if (incompleteCrawls.length > 0) {
            console.log(`[JiraIssueCrawler] Resuming ${incompleteCrawls.length} incomplete crawls`);
            await this.crawlProjects(incompleteCrawls);
        } else {
            console.log(`[JiraIssueCrawler] All projects already crawled`);
        }
    }

    /**
     * Clear cache and reset progress for a project
     */
    public async resetProject(projectKey: string): Promise<void> {
        await this.ensureStateLoaded();
        delete this.state.projects[projectKey];

        // Clear crawler state for this project in database
        await window.electron.ipcRenderer.db.setCrawlerState(projectKey, null);

        // Note: Issues are kept in the database for historical purposes
        // If you want to delete them, call db.clearJiraCache()

        await this.saveState();
        console.log(`[JiraIssueCrawler] Reset project: ${projectKey}`);
    }

    /**
     * Clear all cache and progress
     */
    public async clearAll(): Promise<void> {
        this.state = {
            projects: {},
            lastGlobalUpdate: 0
        };

        // Clear all crawler states in database
        await window.electron.ipcRenderer.db.clearCrawlerState();

        await this.saveState();
        console.log(`[JiraIssueCrawler] Cleared all cached data`);
    }

    /**
     * Get summary statistics
     */
    public getStatistics() {
        // Calculate total issues from project progress data (issues are now in database)
        let totalIssuesCount = 0;
        Object.values(this.state.projects).forEach(progress => {
            totalIssuesCount += progress.totalIssuesFound;
        });

        const stats = {
            totalProjects: Object.keys(this.state.projects).length,
            totalIssues: totalIssuesCount,
            completeProjects: 0,
            incompleteProjects: 0,
            projects: {} as Record<string, {
                issuesFound: number;
                range: string;
                complete: boolean;
            }>
        };

        Object.values(this.state.projects).forEach(progress => {
            const isComplete = progress.upwardsCrawlComplete && progress.downwardsCrawlComplete;
            if (isComplete) {
                stats.completeProjects++;
            } else {
                stats.incompleteProjects++;
            }

            stats.projects[progress.projectKey] = {
                issuesFound: progress.totalIssuesFound,
                range: `${progress.lowestKnownIssueNumber}-${progress.highestKnownIssueNumber}`,
                complete: isComplete
            };
        });

        return stats;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Crawl upward from highest known issue
     */
    private async crawlUpward(projectKey: string): Promise<void> {
        const progress = this.state.projects[projectKey];
        if (!progress || progress.upwardsCrawlComplete) {
            return;
        }

        console.log(`[JiraIssueCrawler] 🚀 Crawling ${projectKey} UPWARD from ${progress.highestKnownIssueNumber}`);
        console.log(`[JiraIssueCrawler] 📋 Starting conditions: 404s=${progress.consecutiveUpward404s}, threshold=${this.config.consecutiveNotFoundThreshold}`);

        const startNumber = progress.highestKnownIssueNumber;
        let currentNumber = progress.highestKnownIssueNumber;
        let consecutive404s = progress.consecutiveUpward404s;
        let batchCount = 0;
        let loopIterations = 0;

        while (consecutive404s < this.config.consecutiveNotFoundThreshold
               && currentNumber < this.config.maxIssueNumber) {

            loopIterations++;
            if (loopIterations % 10 === 0) {
                console.log(`[JiraIssueCrawler] 🔄 Upward loop iteration ${loopIterations}: ${projectKey}-${currentNumber}, 404s=${consecutive404s}`);
            }

            currentNumber++;
            const issueKey = `${projectKey}-${currentNumber}`;

            try {
                // Rate limiting
                await this.delay(this.config.requestDelayMs);

                console.log(`[JiraIssueCrawler] 🔍 Fetching ${issueKey}...`);
                const issue = await this.jiraService!.getIssue(issueKey);

                // Success - reset 404 counter
                consecutive404s = 0;
                progress.highestKnownIssueNumber = currentNumber;
                progress.totalIssuesFound++;

                // Cache the issue in database
                await window.electron.ipcRenderer.db.upsertJiraIssue(issue);

                console.log(`[JiraIssueCrawler] ✅ Found ${issueKey} (total: ${progress.totalIssuesFound})`);

                this.emitStatus({
                    projectKey,
                    direction: 'upward',
                    currentIssueNumber: currentNumber,
                    issuesFound: progress.totalIssuesFound,
                    consecutive404s,
                    isComplete: false,
                    startIssueNumber: startNumber,
                    highestKnownIssue: progress.highestKnownIssueNumber,
                    lowestKnownIssue: progress.lowestKnownIssueNumber
                });

                batchCount++;
                if (batchCount >= this.config.batchSize) {
                    progress.consecutiveUpward404s = consecutive404s;
                    this.saveState();
                    batchCount = 0;
                }

            } catch (error: any) {
                // Check if it's a 404 (issue doesn't exist)
                if (error.message?.includes('404') || error.message?.includes('not found')) {
                    consecutive404s++;
                    console.log(`[JiraIssueCrawler] ❌ ${issueKey} not found (${consecutive404s}/${this.config.consecutiveNotFoundThreshold})`);

                    // EMIT STATUS ON 404s TOO - so UI stays responsive
                    this.emitStatus({
                        projectKey,
                        direction: 'upward',
                        currentIssueNumber: currentNumber,
                        issuesFound: progress.totalIssuesFound,
                        consecutive404s,
                        isComplete: false,
                        startIssueNumber: startNumber,
                        highestKnownIssue: progress.highestKnownIssueNumber,
                        lowestKnownIssue: progress.lowestKnownIssueNumber
                    });
                } else {
                    // Other error - log and continue (might be rate limit, network issue, etc.)
                    console.error(`[JiraIssueCrawler] ⚠️ Error fetching ${issueKey}:`, error.message);
                    // Don't increment consecutive404s for non-404 errors
                    await this.delay(1000); // Back off a bit
                }
            }
        }

        // Mark upward crawl as complete
        progress.upwardsCrawlComplete = true;
        progress.consecutiveUpward404s = consecutive404s;
        this.saveState();

        console.log(`[JiraIssueCrawler] 🏁 ${projectKey} UPWARD crawl complete!`);
        console.log(`[JiraIssueCrawler] 📊 Total loop iterations: ${loopIterations}`);
        console.log(`[JiraIssueCrawler] 📊 Ended at: ${currentNumber} with ${consecutive404s} consecutive 404s`);

        this.emitStatus({
            projectKey,
            direction: 'upward',
            currentIssueNumber: currentNumber,
            issuesFound: progress.totalIssuesFound,
            consecutive404s,
            isComplete: true,
            startIssueNumber: startNumber,
            highestKnownIssue: progress.highestKnownIssueNumber,
            lowestKnownIssue: progress.lowestKnownIssueNumber
        });
    }

    /**
     * Crawl downward from lowest known issue to issue #1
     */
    private async crawlDownward(projectKey: string): Promise<void> {
        const progress = this.state.projects[projectKey];
        if (!progress || progress.downwardsCrawlComplete) {
            return;
        }

        console.log(`[JiraIssueCrawler] 🚀 Crawling ${projectKey} DOWNWARD from ${progress.lowestKnownIssueNumber}`);
        console.log(`[JiraIssueCrawler] 📋 Starting conditions: 404s=${progress.consecutiveDownward404s}, threshold=${this.config.consecutiveNotFoundThreshold}`);

        const startNumber = progress.lowestKnownIssueNumber;
        let currentNumber = progress.lowestKnownIssueNumber;
        let consecutive404s = progress.consecutiveDownward404s;
        let batchCount = 0;
        let loopIterations = 0;

        while (consecutive404s < this.config.consecutiveNotFoundThreshold && currentNumber > 0) {

            loopIterations++;
            if (loopIterations % 10 === 0) {
                console.log(`[JiraIssueCrawler] 🔄 Downward loop iteration ${loopIterations}: ${projectKey}-${currentNumber}, 404s=${consecutive404s}`);
            }

            currentNumber--;
            if (currentNumber <= 0) break;

            const issueKey = `${projectKey}-${currentNumber}`;

            try {
                // Rate limiting
                await this.delay(this.config.requestDelayMs);

                console.log(`[JiraIssueCrawler] 🔍 Fetching ${issueKey}...`);
                const issue = await this.jiraService!.getIssue(issueKey);

                // Success - reset 404 counter
                consecutive404s = 0;
                progress.lowestKnownIssueNumber = currentNumber;
                progress.totalIssuesFound++;

                // Cache the issue in database
                await window.electron.ipcRenderer.db.upsertJiraIssue(issue);

                console.log(`[JiraIssueCrawler] ✅ Found ${issueKey} (total: ${progress.totalIssuesFound})`);

                this.emitStatus({
                    projectKey,
                    direction: 'downward',
                    currentIssueNumber: currentNumber,
                    issuesFound: progress.totalIssuesFound,
                    consecutive404s,
                    isComplete: false,
                    startIssueNumber: startNumber,
                    highestKnownIssue: progress.highestKnownIssueNumber,
                    lowestKnownIssue: progress.lowestKnownIssueNumber
                });

                batchCount++;
                if (batchCount >= this.config.batchSize) {
                    progress.consecutiveDownward404s = consecutive404s;
                    this.saveState();
                    batchCount = 0;
                }

            } catch (error: any) {
                // Check if it's a 404 (issue doesn't exist)
                if (error.message?.includes('404') || error.message?.includes('not found')) {
                    consecutive404s++;
                    console.log(`[JiraIssueCrawler] ❌ ${issueKey} not found (${consecutive404s}/${this.config.consecutiveNotFoundThreshold})`);

                    // EMIT STATUS ON 404s TOO - so UI stays responsive
                    this.emitStatus({
                        projectKey,
                        direction: 'downward',
                        currentIssueNumber: currentNumber,
                        issuesFound: progress.totalIssuesFound,
                        consecutive404s,
                        isComplete: false,
                        startIssueNumber: startNumber,
                        highestKnownIssue: progress.highestKnownIssueNumber,
                        lowestKnownIssue: progress.lowestKnownIssueNumber
                    });
                } else {
                    // Other error - log and continue
                    console.error(`[JiraIssueCrawler] ⚠️ Error fetching ${issueKey}:`, error.message);
                    await this.delay(1000); // Back off
                }
            }
        }

        // Mark downward crawl as complete
        progress.downwardsCrawlComplete = true;
        progress.consecutiveDownward404s = consecutive404s;
        this.saveState();

        console.log(`[JiraIssueCrawler] 🏁 ${projectKey} DOWNWARD crawl complete!`);
        console.log(`[JiraIssueCrawler] 📊 Total loop iterations: ${loopIterations}`);
        console.log(`[JiraIssueCrawler] 📊 Ended at: ${currentNumber} with ${consecutive404s} consecutive 404s`);

        this.emitStatus({
            projectKey,
            direction: 'downward',
            currentIssueNumber: currentNumber,
            issuesFound: progress.totalIssuesFound,
            consecutive404s,
            isComplete: true,
            startIssueNumber: startNumber,
            highestKnownIssue: progress.highestKnownIssueNumber,
            lowestKnownIssue: progress.lowestKnownIssueNumber
        });
    }

    /**
     * Find a good starting issue number for a project
     * Tries to get a recent issue from the project to start crawling
     */
    private async findStartingIssue(projectKey: string): Promise<number> {
        try {
            console.log(`[JiraIssueCrawler] Finding starting issue for ${projectKey}...`);

            // Get the most recent issue from the project
            const response = await this.jiraService!.getProjectIssues(projectKey, 1);

            if (response.issues.length > 0) {
                const recentIssue = response.issues[0];
                const issueNumber = this.extractIssueNumber(recentIssue.key);
                console.log(`[JiraIssueCrawler] Starting from recent issue: ${recentIssue.key} (${issueNumber})`);

                // Cache this issue in database
                await window.electron.ipcRenderer.db.upsertJiraIssue(recentIssue);

                return issueNumber;
            }
        } catch (error) {
            console.error(`[JiraIssueCrawler] Failed to find starting issue for ${projectKey}:`, error);
        }

        // Default to issue #1 if we can't find a recent issue
        console.log(`[JiraIssueCrawler] Defaulting to issue #1 for ${projectKey}`);
        return 1;
    }

    /**
     * Extract the numeric part from an issue key (e.g., "DES-123" → 123)
     */
    private extractIssueNumber(issueKey: string): number {
        const match = issueKey.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
    }

    /**
     * Delay helper for rate limiting
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Emit status update to all subscribers
     */
    private emitStatus(status: CrawlStatus): void {
        console.log(`[JiraIssueCrawler] 🔔 EMITTING STATUS: ${status.projectKey} ${status.direction} | Issue: ${status.currentIssueNumber} | Found: ${status.issuesFound} | 404s: ${status.consecutive404s} | Complete: ${status.isComplete} | Callbacks: ${this.statusCallbacks.length}`);

        this.statusCallbacks.forEach((callback, index) => {
            try {
                console.log(`[JiraIssueCrawler] 📞 Calling callback #${index + 1}...`);
                callback(status);
                console.log(`[JiraIssueCrawler] ✅ Callback #${index + 1} completed`);
            } catch (error) {
                console.error(`[JiraIssueCrawler] ❌ Error in callback #${index + 1}:`, error);
            }
        });

        console.log(`[JiraIssueCrawler] ✅ All callbacks notified for ${status.projectKey} ${status.direction}`);
    }

    /**
     * Load state from database
     */
    private async loadState(): Promise<void> {
        try {
            const projects: Record<string, ProjectCrawlProgress> = {};

            // Load crawler state for all projects
            // Note: We need to get all project keys first - for now we'll just load on demand
            // This is a trade-off: we could store a list of all projects being crawled in settings

            this.state = {
                projects,
                lastGlobalUpdate: Date.now()
            };

            this.stateLoaded = true;
            console.log(`[JiraIssueCrawler] State loaded from database`);
        } catch (error) {
            console.error('[JiraIssueCrawler] Failed to load state:', error);
            this.state = {
                projects: {},
                lastGlobalUpdate: 0
            };
            this.stateLoaded = true;
        }
    }

    /**
     * Save state to database
     */
    private async saveState(): Promise<void> {
        try {
            this.state.lastGlobalUpdate = Date.now();

            // Save crawler state for each project
            for (const [projectKey, progress] of Object.entries(this.state.projects)) {
                await window.electron.ipcRenderer.db.setCrawlerState(projectKey, progress);
            }

            console.log(`[JiraIssueCrawler] State saved to database`);
        } catch (error) {
            console.error('[JiraIssueCrawler] Failed to save state:', error);
        }
    }

    /**
     * Load project state from database
     */
    private async loadProjectState(projectKey: string): Promise<ProjectCrawlProgress | null> {
        try {
            const result = await window.electron.ipcRenderer.db.getCrawlerState(projectKey);
            if (result.success && result.data) {
                return result.data as ProjectCrawlProgress;
            }
        } catch (error) {
            console.error(`[JiraIssueCrawler] Failed to load project state for ${projectKey}:`, error);
        }
        return null;
    }
}
