import { JiraService } from './jiraService';
import type { JiraIssue } from './jiraService';

interface CacheEntry {
    data: JiraIssue[];
    timestamp: number;
    query: string;
}

interface JiraCacheData {
    assignedIssues: CacheEntry | null;
    projectIssues: Record<string, CacheEntry | null>;
    epics: Record<string, CacheEntry | null>;
    lastSync: number;
}

export class JiraCache {
    private static readonly CACHE_KEY = 'jira-issues-cache';
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private static readonly SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

    private cache: JiraCacheData;
    private jiraService: JiraService | null = null;
    private syncInterval: number | null = null;
    private selectedProjects: string[] = [];

    constructor() {
        this.cache = this.loadFromStorage();
        this.startBackgroundSync();
    }

    private loadFromStorage(): JiraCacheData {
        try {
            const stored = localStorage.getItem(JiraCache.CACHE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('[JiraCache] Failed to load cache:', error);
        }
        
        return {
            assignedIssues: null,
            projectIssues: {},
            epics: {},
            lastSync: 0
        };
    }

    private saveToStorage(): void {
        try {
            localStorage.setItem(JiraCache.CACHE_KEY, JSON.stringify(this.cache));
        } catch (error) {
            console.error('[JiraCache] Failed to save cache:', error);
        }
    }

    private isExpired(entry: CacheEntry | null): boolean {
        if (!entry) return true;
        return Date.now() - entry.timestamp > JiraCache.CACHE_DURATION;
    }

    private shouldSync(): boolean {
        return Date.now() - this.cache.lastSync > JiraCache.SYNC_INTERVAL;
    }

    public initializeService(baseUrl: string, email: string, apiToken: string): void {
        this.jiraService = new JiraService(baseUrl, email, apiToken);
    }

    public setSelectedProjects(projects: string[]): void {
        this.selectedProjects = projects;
        // Clear assigned issues cache when projects change to force refetch with new filter
        this.cache.assignedIssues = null;
        this.saveToStorage();
    }

    public async getAssignedIssues(forceRefresh: boolean = false): Promise<JiraIssue[]> {
        const cacheEntry = this.cache.assignedIssues;
        
        if (!forceRefresh && !this.isExpired(cacheEntry)) {
            console.log('[JiraCache] Returning cached assigned issues:', cacheEntry!.data.length);
            return cacheEntry!.data;
        }

        if (!this.jiraService) {
            console.log('[JiraCache] No Jira service available for assigned issues');
            return cacheEntry?.data || [];
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
            
            this.cache.assignedIssues = {
                data: response.issues,
                timestamp: Date.now(),
                query: jql
            };
            
            this.saveToStorage();
            console.log('[JiraCache] Cached', response.issues.length, 'assigned issues from selected projects');
            return response.issues;
        } catch (error) {
            console.error('[JiraCache] Failed to fetch assigned issues:', error);
            return cacheEntry?.data || [];
        }
    }

    public async getProjectIssues(projectKey: string, forceRefresh: boolean = false): Promise<JiraIssue[]> {
        const cacheEntry = this.cache.projectIssues[projectKey];
        
        if (!forceRefresh && !this.isExpired(cacheEntry)) {
            console.log(`[JiraCache] Returning cached ${projectKey} issues:`, cacheEntry!.data.length);
            return cacheEntry!.data;
        }

        if (!this.jiraService) {
            console.log(`[JiraCache] No Jira service available for ${projectKey} issues`);
            return cacheEntry?.data || [];
        }

        try {
            console.log(`[JiraCache] Fetching fresh ${projectKey} issues from API`);
            const response = await this.jiraService.getProjectIssues(projectKey);
            
            this.cache.projectIssues[projectKey] = {
                data: response.issues,
                timestamp: Date.now(),
                query: `project = "${projectKey}"`
            };
            
            this.saveToStorage();
            console.log(`[JiraCache] Cached ${response.issues.length} issues for project ${projectKey}`);
            return response.issues;
        } catch (error) {
            console.error(`[JiraCache] Failed to fetch ${projectKey} issues:`, error);
            return cacheEntry?.data || [];
        }
    }

    public async getProjectEpics(projectKey: string, forceRefresh: boolean = false): Promise<JiraIssue[]> {
        const cacheEntry = this.cache.epics[projectKey];
        
        if (!forceRefresh && !this.isExpired(cacheEntry)) {
            console.log(`[JiraCache] Returning cached ${projectKey} epics:`, cacheEntry!.data.length);
            return cacheEntry!.data;
        }

        if (!this.jiraService) {
            console.log(`[JiraCache] No Jira service available for ${projectKey} epics`);
            return cacheEntry?.data || [];
        }

        try {
            console.log(`[JiraCache] Fetching fresh ${projectKey} epics from API`);
            // Use search with Epic issue type filter
            const jql = `project = "${projectKey}" AND issuetype = Epic ORDER BY updated DESC`;
            const response = await this.jiraService.searchIssues(jql);
            
            this.cache.epics[projectKey] = {
                data: response.issues,
                timestamp: Date.now(),
                query: jql
            };
            
            this.saveToStorage();
            console.log(`[JiraCache] Cached ${response.issues.length} epics for project ${projectKey}`);
            return response.issues;
        } catch (error) {
            console.error(`[JiraCache] Failed to fetch ${projectKey} epics:`, error);
            return cacheEntry?.data || [];
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
            // Sync assigned issues
            await this.getAssignedIssues(true);
            
            // Sync all selected project issues and epics
            for (const projectKey of selectedProjects) {
                await this.getProjectIssues(projectKey, true);
                await this.getProjectEpics(projectKey, true);
            }
            
            this.cache.lastSync = Date.now();
            this.saveToStorage();
            console.log('[JiraCache] Background sync completed');
        } catch (error) {
            console.error('[JiraCache] Background sync failed:', error);
        }
    }

    public startBackgroundSync(): void {
        // Clear existing interval
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // Start background sync every 30 minutes
        this.syncInterval = window.setInterval(async () => {
            if (this.shouldSync() && this.jiraService && this.selectedProjects.length > 0) {
                console.log('[JiraCache] Background sync triggered by interval for projects:', this.selectedProjects);
                await this.syncAllData(this.selectedProjects);
            }
        }, JiraCache.SYNC_INTERVAL);
    }

    public stopBackgroundSync(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    public getCacheInfo() {
        const info = {
            assignedIssues: this.cache.assignedIssues?.data.length || 0,
            projectIssues: {},
            epics: {},
            lastSync: new Date(this.cache.lastSync).toLocaleString()
        };

        for (const [project, entry] of Object.entries(this.cache.projectIssues)) {
            // @ts-ignore
            info.projectIssues[project] = entry?.data.length || 0;
        }

        for (const [project, entry] of Object.entries(this.cache.epics)) {
            // @ts-ignore
            info.epics[project] = entry?.data.length || 0;
        }

        return info;
    }

    public clearCache(): void {
        this.cache = {
            assignedIssues: null,
            projectIssues: {},
            epics: {},
            lastSync: 0
        };
        this.saveToStorage();
        console.log('[JiraCache] Cache cleared');
    }

    public destroy(): void {
        this.stopBackgroundSync();
    }
}