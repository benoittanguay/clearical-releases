/**
 * TempoCache - Persistent caching layer for Tempo accounts
 *
 * PERSISTENCE ARCHITECTURE:
 * ========================
 *
 * This service provides TWO layers of persistence:
 *
 * 1. CACHE METADATA (tempo_cache_meta table in SQLite)
 *    - Stores query results with timestamps for cache validation
 *    - Used to determine if cached data is fresh or stale
 *    - Contains the actual account data as JSON for quick access
 *    - Survives app restarts and updates
 *
 * 2. INDIVIDUAL ACCOUNTS (tempo_accounts table in SQLite)
 *    - Each account is stored separately with full data
 *    - Indexed by status for efficient queries
 *    - Persists across app restarts and updates
 *
 * CACHE STRATEGY (Stale-While-Revalidate):
 * ========================================
 *
 * - Cache TTL: 24 hours
 * - On cache hit: Return cached data immediately
 * - On cache miss (expired):
 *   - If we have stale data: Return it immediately + refresh in background
 *   - If no data at all: Fetch fresh data (blocking)
 * - This ensures the UI shows data instantly on app startup
 *
 * DATA FLOW ON APP STARTUP:
 * ==========================
 *
 * 1. User opens app
 * 2. TempoAccountSelector loads accounts
 * 3. tempoCache.getAllAccounts() called
 * 4. Check cache metadata (tempo_cache_meta table)
 * 5. If cached data exists (even if stale): Return it immediately
 * 6. Trigger background refresh to update with fresh data from Tempo API
 * 7. UI updates when fresh data arrives
 *
 * This approach ensures:
 * - Instant UI feedback (no loading spinners on startup)
 * - Data persists across app restarts and updates
 * - Fresh data is fetched in background
 * - Reduced API calls (24h cache)
 */

import { TempoService } from './tempoService';
import type { TempoAccount } from './tempoService';

interface CacheEntry {
    data: TempoAccount[];
    timestamp: number;
    query?: string;
}

export class TempoCache {
    // Cache duration: 24 hours - data persists in SQLite anyway
    // This prevents unnecessary API calls on every app restart
    private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

    private tempoService: TempoService | null = null;
    private refreshCallbacks: ((accounts: TempoAccount[]) => void)[] = [];

    constructor() {}

    private async getCachedData(key: string): Promise<CacheEntry | null> {
        try {
            const result = await window.electron.ipcRenderer.db.getTempoCacheMeta(key);
            if (result.success && result.data) {
                return result.data as CacheEntry;
            }
        } catch (error) {
            console.error('[TempoCache] Failed to get cached data:', error);
        }
        return null;
    }

    private async setCachedData(key: string, data: TempoAccount[], query?: string): Promise<void> {
        try {
            await window.electron.ipcRenderer.db.setTempoCacheMeta(key, { data, timestamp: Date.now() }, query);
        } catch (error) {
            console.error('[TempoCache] Failed to set cached data:', error);
        }
    }

    private isExpired(entry: CacheEntry | null): boolean {
        if (!entry) return true;
        return Date.now() - entry.timestamp > TempoCache.CACHE_DURATION;
    }

    public initializeService(baseUrl: string, apiToken: string): void {
        this.tempoService = new TempoService(baseUrl, apiToken);
        console.log('[TempoCache] Service initialized');
    }

    /**
     * Subscribe to account refresh updates
     */
    public onAccountsRefresh(callback: (accounts: TempoAccount[]) => void): () => void {
        this.refreshCallbacks.push(callback);
        return () => {
            const index = this.refreshCallbacks.indexOf(callback);
            if (index > -1) {
                this.refreshCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Notify subscribers when accounts are refreshed
     */
    private notifyRefresh(accounts: TempoAccount[]): void {
        this.refreshCallbacks.forEach(callback => callback(accounts));
    }

    /**
     * Get all Tempo accounts with caching
     */
    public async getAllAccounts(forceRefresh: boolean = false): Promise<TempoAccount[]> {
        const cacheEntry = await this.getCachedData('allAccounts');

        // If cache is valid, return it immediately
        if (!forceRefresh && !this.isExpired(cacheEntry) && Array.isArray(cacheEntry?.data)) {
            console.log('[TempoCache] Returning cached accounts:', cacheEntry.data.length);
            return cacheEntry.data;
        }

        // If cache is expired but we have data, return it while refreshing in background
        // This provides instant UI feedback on app startup
        if (!forceRefresh && Array.isArray(cacheEntry?.data) && cacheEntry.data.length > 0) {
            console.log('[TempoCache] Returning stale cache while refreshing in background:', cacheEntry.data.length);

            // Trigger background refresh (non-blocking)
            this.refreshAllAccountsInBackground();

            return cacheEntry.data;
        }

        // No cache available - need to fetch fresh data
        if (!this.tempoService) {
            console.log('[TempoCache] No Tempo service available for accounts');
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }

        try {
            console.log('[TempoCache] Fetching fresh accounts from API');

            const accounts = await this.tempoService.getAllAccounts();

            // Store accounts in database
            for (const account of accounts) {
                await window.electron.ipcRenderer.db.upsertTempoAccount(account);
            }

            await this.setCachedData('allAccounts', accounts, 'getAllAccounts');

            console.log('[TempoCache] Cached', accounts.length, 'accounts');
            return accounts;
        } catch (error) {
            console.error('[TempoCache] Failed to fetch accounts:', error);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }
    }

    /**
     * Refresh all accounts in the background without blocking the UI
     */
    private async refreshAllAccountsInBackground(): Promise<void> {
        if (!this.tempoService) return;

        try {
            console.log('[TempoCache] Background refresh: Fetching accounts from API');

            const accounts = await this.tempoService.getAllAccounts();

            // Store accounts in database
            for (const account of accounts) {
                await window.electron.ipcRenderer.db.upsertTempoAccount(account);
            }

            await this.setCachedData('allAccounts', accounts, 'getAllAccounts');

            console.log('[TempoCache] Background refresh complete:', accounts.length, 'accounts');

            // Notify subscribers
            this.notifyRefresh(accounts);
        } catch (error) {
            console.error('[TempoCache] Background refresh failed:', error);
        }
    }

    /**
     * Get accounts linked to a specific Jira project
     * @param projectId - The numeric Jira project ID (required for Tempo API v4)
     */
    public async getAccountsForProject(projectId: number | string, forceRefresh: boolean = false): Promise<TempoAccount[]> {
        const cacheKey = `projectAccounts:${projectId}`;
        const cacheEntry = await this.getCachedData(cacheKey);

        // If cache is valid, return it immediately
        if (!forceRefresh && !this.isExpired(cacheEntry) && Array.isArray(cacheEntry?.data)) {
            console.log(`[TempoCache] Returning cached accounts for project ${projectId}:`, cacheEntry.data.length);
            return cacheEntry.data;
        }

        // If cache is expired but we have data, return it while refreshing in background
        if (!forceRefresh && Array.isArray(cacheEntry?.data) && cacheEntry.data.length > 0) {
            console.log(`[TempoCache] Returning stale cache for project ${projectId} while refreshing:`, cacheEntry.data.length);

            // Trigger background refresh (non-blocking)
            this.refreshProjectAccountsInBackground(projectId);

            return cacheEntry.data;
        }

        // No cache available - need to fetch fresh data
        if (!this.tempoService) {
            console.log(`[TempoCache] No Tempo service available for project ${projectId} accounts`);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }

        try {
            console.log(`[TempoCache] Fetching fresh accounts for project ${projectId} from API`);

            const accounts = await this.tempoService.getAccountsForProject(projectId);

            // Store accounts in database
            for (const account of accounts) {
                await window.electron.ipcRenderer.db.upsertTempoAccount(account);
            }

            await this.setCachedData(cacheKey, accounts, `getAccountsForProject:${projectId}`);

            console.log(`[TempoCache] Cached ${accounts.length} accounts for project ${projectId}`);
            return accounts;
        } catch (error) {
            console.error(`[TempoCache] Failed to fetch accounts for project ${projectId}:`, error);
            return Array.isArray(cacheEntry?.data) ? cacheEntry.data : [];
        }
    }

    /**
     * Refresh project accounts in the background without blocking the UI
     */
    private async refreshProjectAccountsInBackground(projectId: number | string): Promise<void> {
        if (!this.tempoService) return;

        const cacheKey = `projectAccounts:${projectId}`;

        try {
            console.log(`[TempoCache] Background refresh: Fetching accounts for project ${projectId} from API`);

            const accounts = await this.tempoService.getAccountsForProject(projectId);

            // Store accounts in database
            for (const account of accounts) {
                await window.electron.ipcRenderer.db.upsertTempoAccount(account);
            }

            await this.setCachedData(cacheKey, accounts, `getAccountsForProject:${projectId}`);

            console.log(`[TempoCache] Background refresh complete: ${accounts.length} accounts for project ${projectId}`);
        } catch (error) {
            console.error(`[TempoCache] Background refresh failed for project ${projectId}:`, error);
        }
    }

    /**
     * Get accounts by status from local cache
     */
    public async getAccountsByStatus(status: string): Promise<TempoAccount[]> {
        try {
            const result = await window.electron.ipcRenderer.db.getTempoAccountsByStatus(status);
            if (result.success && result.data) {
                return result.data;
            }
        } catch (error) {
            console.error('[TempoCache] Failed to get accounts by status:', error);
        }
        return [];
    }

    /**
     * Sync all Tempo data
     */
    public async syncAllData(): Promise<void> {
        if (!this.tempoService) {
            console.log('[TempoCache] No Tempo service available for sync');
            return;
        }

        console.log('[TempoCache] Starting background sync');

        try {
            // Sync all accounts
            await this.getAllAccounts(true);

            // Update last sync timestamp
            await window.electron.ipcRenderer.db.setSetting('lastTempoSync', Date.now());
            console.log('[TempoCache] Background sync completed');
        } catch (error) {
            console.error('[TempoCache] Background sync failed:', error);
        }
    }

    public async getCacheInfo() {
        const lastSyncResult = await window.electron.ipcRenderer.db.getSetting('lastTempoSync');
        const lastSync = lastSyncResult.success && lastSyncResult.data ? new Date(lastSyncResult.data as number).toLocaleString() : 'Never';

        const allAccountsCache = await this.getCachedData('allAccounts');

        return {
            totalAccounts: allAccountsCache?.data?.length || 0,
            lastSync,
            cacheExpired: this.isExpired(allAccountsCache)
        };
    }

    public async clearCache(): Promise<void> {
        // Clear Tempo cache in database
        await window.electron.ipcRenderer.db.clearTempoCache();

        console.log('[TempoCache] Cache cleared');
    }
}

// Singleton instance
let tempoCacheInstance: TempoCache | null = null;

export function getTempoCache(): TempoCache {
    if (!tempoCacheInstance) {
        tempoCacheInstance = new TempoCache();
    }
    return tempoCacheInstance;
}
