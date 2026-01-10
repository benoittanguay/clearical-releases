/**
 * BlacklistService - Efficient app blacklist management
 *
 * Provides O(1) lookups for blacklisted applications by caching
 * the blacklist in memory as a Set. Automatically refreshes when
 * the database is updated.
 *
 * Integration points:
 * - Active window detection: Skip tracking time for blacklisted apps
 * - Screenshot capture: Don't take screenshots of blacklisted apps
 * - Activity logging: Filter out blacklisted app entries
 */

import { DatabaseService } from './databaseService.js';

export class BlacklistService {
    private static instance: BlacklistService | null = null;
    private blacklistedBundleIds: Set<string> = new Set();
    private db: DatabaseService;

    private constructor() {
        this.db = DatabaseService.getInstance();
        this.loadBlacklist();
    }

    public static getInstance(): BlacklistService {
        if (!BlacklistService.instance) {
            BlacklistService.instance = new BlacklistService();
        }
        return BlacklistService.instance;
    }

    /**
     * Load blacklist from database into memory cache
     * Called on initialization and when blacklist changes
     */
    private loadBlacklist(): void {
        console.log('[BlacklistService] Loading blacklist from database...');
        const blacklistedApps = this.db.getAllBlacklistedApps();

        this.blacklistedBundleIds.clear();
        for (const app of blacklistedApps) {
            this.blacklistedBundleIds.add(app.bundleId);
        }

        console.log(`[BlacklistService] Loaded ${this.blacklistedBundleIds.size} blacklisted apps`);
    }

    /**
     * Check if an app is blacklisted (O(1) lookup)
     * @param bundleId - The app's bundle identifier (e.g., com.google.Chrome)
     * @returns true if the app is blacklisted
     */
    public isAppBlacklisted(bundleId: string): boolean {
        return this.blacklistedBundleIds.has(bundleId);
    }

    /**
     * Add an app to the blacklist
     * @param bundleId - The app's bundle identifier
     * @param name - Display name of the app
     * @param category - Optional category
     */
    public addApp(bundleId: string, name: string, category?: string): void {
        console.log(`[BlacklistService] Adding app to blacklist: ${name} (${bundleId})`);
        this.db.addBlacklistedApp(bundleId, name, category);
        this.blacklistedBundleIds.add(bundleId);
    }

    /**
     * Remove an app from the blacklist
     * @param bundleId - The app's bundle identifier
     */
    public removeApp(bundleId: string): void {
        console.log(`[BlacklistService] Removing app from blacklist: ${bundleId}`);
        this.db.removeBlacklistedApp(bundleId);
        this.blacklistedBundleIds.delete(bundleId);
    }

    /**
     * Get all blacklisted apps
     * @returns Array of blacklisted apps with bundleId, name, and category
     */
    public getAllBlacklistedApps(): Array<{ bundleId: string; name: string; category?: string }> {
        return this.db.getAllBlacklistedApps();
    }

    /**
     * Clear all blacklisted apps
     */
    public clearAll(): void {
        console.log('[BlacklistService] Clearing all blacklisted apps');
        this.db.clearBlacklistedApps();
        this.blacklistedBundleIds.clear();
    }

    /**
     * Refresh the in-memory cache from database
     * Call this when blacklist is modified externally
     */
    public refreshBlacklist(): void {
        console.log('[BlacklistService] Refreshing blacklist cache...');
        this.loadBlacklist();
    }

    /**
     * Get the size of the blacklist
     */
    public getBlacklistSize(): number {
        return this.blacklistedBundleIds.size;
    }
}
