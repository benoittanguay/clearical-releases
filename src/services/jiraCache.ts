import { JiraService } from './jiraService';
import type { JiraIssue } from './jiraService';
import { JiraIssueCrawler } from './jiraIssueCrawler';
import type { CrawlStatus } from './jiraIssueCrawler';
import { JiraSyncScheduler } from './jiraSyncScheduler';
import type { SyncStatus } from './jiraSyncScheduler';

interface CacheEntry {
    data: JiraIssue[];
    timestamp: number;
    query: string;
}

export class JiraCache {
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    private jiraService: JiraService | null = null;
    private crawler: JiraIssueCrawler;
    private syncScheduler: JiraSyncScheduler;
    private selectedProjects: string[] = [];
    private crawlStatusCallbacks: ((status: CrawlStatus) => void)[] = [];

    constructor() {
        this.crawler = new JiraIssueCrawler({
            consecutiveNotFoundThreshold: 50,
            requestDelayMs: 200,
            batchSize: 10
        });
        this.syncScheduler = new JiraSyncScheduler({
            enabled: false, // Will be enabled when configured
            intervalMinutes: 30,
            selectedProjects: [],
            startupDelayMs: 10000,
        });
        this.syncScheduler.setJiraCache(this);
    }

    private async getCachedData(key: string): Promise<CacheEntry | null> {
        try {
            const result = await window.electron.ipcRenderer.db.getJiraCacheMeta(key);
            if (result.success && result.data) {
                return result.data as CacheEntry;
            }
        } catch (error) {
            console.error('[JiraCache] Failed to get cached data:', error);
        }
        return null;
    }

    private async setCachedData(key: string, data: JiraIssue[], query: string): Promise<void> {
        try {
            await window.electron.ipcRenderer.db.setJiraCacheMeta(key, { data, timestamp: Date.now() }, query);
        } catch (error) {
            console.error('[JiraCache] Failed to set cached data:', error);
        }
    }

    private isExpired(entry: CacheEntry | null): boolean {
        if (!entry) return true;
        return Date.now() - entry.timestamp > JiraCache.CACHE_DURATION;
    }

    public initializeService(baseUrl: string, email: string, apiToken: string): void {
        this.jiraService = new JiraService(baseUrl, email, apiToken);
        this.crawler.initializeService(baseUrl, email, apiToken);

        // Subscribe to crawler status updates
        this.crawler.onStatusUpdate((status) => {
            console.log(`[JiraCache] Crawler update: ${status.projectKey} ${status.direction} at ${status.currentIssueNumber} (${status.issuesFound} found, ${status.consecutive404s} 404s)`);
            this.crawlStatusCallbacks.forEach(callback => callback(status));
        });
    }

    /**
     * Subscribe to crawl status updates
     */
    public onCrawlStatus(callback: (status: CrawlStatus) => void): () => void {
        this.crawlStatusCallbacks.push(callback);
        return () => {
            const index = this.crawlStatusCallbacks.indexOf(callback);
            if (index > -1) {
                this.crawlStatusCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Enable or disable the crawler
     */
    public async setCrawlerEnabled(enabled: boolean): Promise<void> {
        await window.electron.ipcRenderer.db.setSetting('crawlerEnabled', enabled);
        console.log(`[JiraCache] Crawler ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Check if crawler is enabled
     */
    public async isCrawlerEnabled(): Promise<boolean> {
        const result = await window.electron.ipcRenderer.db.getSetting('crawlerEnabled');
        if (result.success && result.data !== null && result.data !== undefined) {
            return result.data as boolean;
        }
        return true; // Default to enabled
    }

    /**
     * Start crawling projects to build comprehensive issue cache
     */
    public async crawlProjects(projectKeys: string[]): Promise<void> {
        const crawlerEnabled = await this.isCrawlerEnabled();
        if (!crawlerEnabled) {
            console.log('[JiraCache] Crawler is disabled');
            return;
        }

        console.log('[JiraCache] Starting project crawl:', projectKeys);
        await this.crawler.crawlProjects(projectKeys);
    }

    /**
     * Resume incomplete crawls
     */
    public async resumeCrawls(projectKeys: string[]): Promise<void> {
        const crawlerEnabled = await this.isCrawlerEnabled();
        if (!crawlerEnabled) {
            console.log('[JiraCache] Crawler is disabled');
            return;
        }

        console.log('[JiraCache] Resuming incomplete crawls');
        await this.crawler.resumeCrawls(projectKeys);
    }

    /**
     * Get crawler statistics
     */
    public getCrawlerStatistics() {
        return this.crawler.getStatistics();
    }

    /**
     * Get direct access to the crawler
     */
    public getCrawler(): JiraIssueCrawler {
        return this.crawler;
    }

    public async setSelectedProjects(projects: string[]): Promise<void> {
        this.selectedProjects = projects;
        // Clear assigned issues cache when projects change to force refetch with new filter
        await window.electron.ipcRenderer.db.setJiraCacheMeta('assignedIssues', null);

        // Update sync scheduler with new project list
        this.syncScheduler.updateConfig({
            selectedProjects: projects,
        });
    }

    public async getAssignedIssues(forceRefresh: boolean = false): Promise<JiraIssue[]> {
        const cacheEntry = await this.getCachedData('assignedIssues');

        if (!forceRefresh && !this.isExpired(cacheEntry) && Array.isArray(cacheEntry?.data)) {
            console.log('[JiraCache] Returning cached assigned issues:', cacheEntry.data.length);
            return cacheEntry.data;
        }

        if (!this.jiraService) {
            console.log('[JiraCache] No Jira service available for assigned issues');
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }

        try {
            console.log('[JiraCache] Fetching fresh assigned issues from API, filtered by projects:', this.selectedProjects);

            let jql = 'assignee = currentUser()';
            if (this.selectedProjects.length > 0) {
                const projectFilter = this.selectedProjects.map(p => `"${p}"`).join(', ');
                jql = `assignee = currentUser() AND project in (${projectFilter})`;
            }
            jql += ' ORDER BY updated DESC';

            const response = await this.jiraService.searchIssues(jql);

            // Store issues in database
            for (const issue of response.issues) {
                await window.electron.ipcRenderer.db.upsertJiraIssue(issue);
            }

            await this.setCachedData('assignedIssues', response.issues, jql);

            console.log('[JiraCache] Cached', response.issues.length, 'assigned issues from selected projects');
            return response.issues;
        } catch (error) {
            console.error('[JiraCache] Failed to fetch assigned issues:', error);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }
    }

    public async getProjectIssues(projectKey: string, forceRefresh: boolean = false): Promise<JiraIssue[]> {
        // If crawler is enabled and has data, prefer that over JQL queries
        const crawlerEnabled = await this.isCrawlerEnabled();
        if (crawlerEnabled) {
            const crawlerIssues = await this.crawler.getProjectIssuesAsync(projectKey);
            if (crawlerIssues.length > 0) {
                console.log(`[JiraCache] Returning ${crawlerIssues.length} issues from crawler for ${projectKey}`);
                return crawlerIssues;
            }
        }

        // Fallback to traditional JQL-based caching
        const cacheEntry = await this.getCachedData(`projectIssues:${projectKey}`);

        if (!forceRefresh && !this.isExpired(cacheEntry) && Array.isArray(cacheEntry?.data)) {
            console.log(`[JiraCache] Returning cached ${projectKey} issues:`, cacheEntry.data.length);
            return cacheEntry.data;
        }

        if (!this.jiraService) {
            console.log(`[JiraCache] No Jira service available for ${projectKey} issues`);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }

        try {
            console.log(`[JiraCache] Fetching fresh ${projectKey} issues from API`);
            const response = await this.jiraService.getProjectIssues(projectKey);

            // Store issues in database
            for (const issue of response.issues) {
                await window.electron.ipcRenderer.db.upsertJiraIssue(issue);
            }

            await this.setCachedData(`projectIssues:${projectKey}`, response.issues, `project = "${projectKey}"`);

            console.log(`[JiraCache] Cached ${response.issues.length} issues for project ${projectKey}`);
            return response.issues;
        } catch (error) {
            console.error(`[JiraCache] Failed to fetch ${projectKey} issues:`, error);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }
    }

    public async getProjectEpics(projectKey: string, forceRefresh: boolean = false): Promise<JiraIssue[]> {
        const cacheEntry = await this.getCachedData(`epics:${projectKey}`);

        if (!forceRefresh && !this.isExpired(cacheEntry) && Array.isArray(cacheEntry?.data)) {
            console.log(`[JiraCache] Returning cached ${projectKey} epics:`, cacheEntry.data.length);
            return cacheEntry.data;
        }

        if (!this.jiraService) {
            console.log(`[JiraCache] No Jira service available for ${projectKey} epics`);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }

        try {
            console.log(`[JiraCache] Fetching fresh ${projectKey} epics from API`);
            // Use search with Epic issue type filter
            const jql = `project = "${projectKey}" AND issuetype = Epic ORDER BY updated DESC`;
            const response = await this.jiraService.searchIssues(jql);

            // Store issues in database
            for (const issue of response.issues) {
                await window.electron.ipcRenderer.db.upsertJiraIssue(issue);
            }

            await this.setCachedData(`epics:${projectKey}`, response.issues, jql);

            console.log(`[JiraCache] Cached ${response.issues.length} epics for project ${projectKey}`);
            return response.issues;
        } catch (error) {
            console.error(`[JiraCache] Failed to fetch ${projectKey} epics:`, error);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }
    }

    public async searchIssues(searchText: string): Promise<JiraIssue[]> {
        // Search is always fresh, no caching
        if (!this.jiraService) {
            console.log('[JiraCache] No Jira service available for search');
            return [];
        }

        try {
            const response = await this.jiraService.searchIssuesByText(searchText);
            return response.issues;
        } catch (error) {
            console.error('[JiraCache] Search failed:', error);
            return [];
        }
    }

    public async syncAllData(selectedProjects: string[]): Promise<void> {
        if (!this.jiraService) {
            console.log('[JiraCache] No Jira service available for sync');
            return;
        }

        console.log('[JiraCache] Starting background sync for projects:', selectedProjects);

        try {
            // Sync assigned issues (always use JQL for user-specific queries)
            await this.getAssignedIssues(true);

            // If crawler is enabled, resume/start crawling for comprehensive coverage
            const crawlerEnabled = await this.isCrawlerEnabled();
            if (crawlerEnabled && selectedProjects.length > 0) {
                console.log('[JiraCache] Resuming crawler for comprehensive issue discovery');
                // Resume crawls (non-blocking - runs in background)
                this.resumeCrawls(selectedProjects).catch(error => {
                    console.error('[JiraCache] Crawler failed during sync:', error);
                });
            }

            // Sync epics using JQL (epics are typically small in number)
            for (const projectKey of selectedProjects) {
                await this.getProjectEpics(projectKey, true);
            }

            // Update last sync timestamp
            await window.electron.ipcRenderer.db.setSetting('lastJiraSync', Date.now());
            console.log('[JiraCache] Background sync completed');
        } catch (error) {
            console.error('[JiraCache] Background sync failed:', error);
        }
    }

    /**
     * Configure and start the sync scheduler
     */
    public configureSyncScheduler(config: {
        enabled: boolean;
        intervalMinutes: number;
        lastSyncTimestamp?: number;
    }): void {
        console.log('[JiraCache] Configuring sync scheduler:', config);

        this.syncScheduler.updateConfig({
            enabled: config.enabled,
            intervalMinutes: config.intervalMinutes,
            selectedProjects: this.selectedProjects,
        });

        // Restore last sync timestamp if provided
        if (config.lastSyncTimestamp) {
            this.syncScheduler.setLastSyncTimestamp(config.lastSyncTimestamp);
        }

        // Start or stop scheduler based on enabled flag
        if (config.enabled && this.jiraService) {
            this.syncScheduler.start();
        } else {
            this.syncScheduler.stop();
        }
    }

    /**
     * Manually trigger sync now
     */
    public async syncNow(): Promise<void> {
        return this.syncScheduler.syncNow();
    }

    /**
     * Get sync scheduler status
     */
    public getSyncStatus(): SyncStatus {
        return this.syncScheduler.getStatus();
    }

    /**
     * Subscribe to sync status updates
     */
    public onSyncStatusUpdate(callback: (status: SyncStatus) => void): () => void {
        return this.syncScheduler.onStatusUpdate(callback);
    }

    /**
     * Check if sync is currently running
     */
    public isSyncInProgress(): boolean {
        return this.syncScheduler.isSyncInProgress();
    }

    public async getCacheInfo() {
        const crawlerEnabled = await this.isCrawlerEnabled();
        const lastSyncResult = await window.electron.ipcRenderer.db.getSetting('lastJiraSync');
        const lastSync = lastSyncResult.success && lastSyncResult.data ? new Date(lastSyncResult.data as number).toLocaleString() : 'Never';

        const assignedIssuesCache = await this.getCachedData('assignedIssues');

        return {
            assignedIssues: assignedIssuesCache?.data.length || 0,
            projectIssues: {},
            epics: {},
            lastSync,
            crawlerEnabled,
            crawler: crawlerEnabled ? this.getCrawlerStatistics() : null
        };
    }

    public async clearCache(): Promise<void> {
        // Clear Jira cache in database
        await window.electron.ipcRenderer.db.clearJiraCache();

        // Also clear crawler cache
        this.crawler.clearAll();

        console.log('[JiraCache] Cache cleared (including crawler)');
    }

    public destroy(): void {
        this.syncScheduler.destroy();
    }
}