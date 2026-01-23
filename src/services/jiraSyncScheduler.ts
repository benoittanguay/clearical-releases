import type { JiraCache } from './jiraCache';

/**
 * Sync status information
 */
export interface SyncStatus {
    isEnabled: boolean;
    isSyncing: boolean;
    lastSyncTimestamp: number;
    nextSyncTimestamp: number | null;
    syncInterval: number; // in minutes
    lastSyncError: string | null;
}

/**
 * Configuration for the sync scheduler
 */
export interface SyncSchedulerConfig {
    enabled: boolean;
    intervalMinutes: number; // Sync interval in minutes (15, 30, 60, 120)
    selectedProjects: string[]; // Projects to sync
    startupDelayMs?: number; // Delay before first sync after startup (default: 10 seconds)
}

/**
 * JiraSyncScheduler - Manages periodic background synchronization of Jira data
 *
 * Features:
 * - Configurable sync intervals (15min, 30min, 1hr, 2hr)
 * - Automatic sync on app startup (with delay)
 * - Manual sync trigger
 * - Prevents concurrent syncs
 * - Respects rate limits through JiraCache
 * - Status callbacks for UI updates
 */
export class JiraSyncScheduler {
    private jiraCache: JiraCache | null = null;
    private config: SyncSchedulerConfig;
    private syncInterval: number | null = null;
    private isSyncing: boolean = false;
    private lastSyncTimestamp: number = 0;
    private lastSyncError: string | null = null;
    private statusCallbacks: ((status: SyncStatus) => void)[] = [];
    private startupSyncTimeout: number | null = null;

    constructor(config: SyncSchedulerConfig) {
        this.config = config;
    }

    /**
     * Initialize with JiraCache instance
     */
    public setJiraCache(jiraCache: JiraCache): void {
        this.jiraCache = jiraCache;
    }

    /**
     * Start the sync scheduler
     * - Schedules initial sync after startup delay (only if no recent sync)
     * - Sets up periodic sync interval
     */
    public start(): void {
        if (!this.config.enabled || !this.jiraCache) {
            console.log('[JiraSyncScheduler] Sync disabled or JiraCache not available');
            return;
        }

        console.log(`[JiraSyncScheduler] Starting scheduler with ${this.config.intervalMinutes}min interval`);

        // Clear any existing intervals/timeouts
        this.stop();

        // Check if we need a startup sync based on last sync time
        const intervalMs = this.config.intervalMinutes * 60 * 1000;
        const timeSinceLastSync = Date.now() - this.lastSyncTimestamp;
        const needsStartupSync = this.lastSyncTimestamp === 0 || timeSinceLastSync >= intervalMs;

        if (needsStartupSync) {
            // Schedule startup sync after delay
            const startupDelay = this.config.startupDelayMs ?? 10000; // Default 10 seconds
            console.log(`[JiraSyncScheduler] Scheduling startup sync in ${startupDelay}ms (last sync was ${Math.round(timeSinceLastSync / 1000)}s ago)`);
            this.startupSyncTimeout = window.setTimeout(() => {
                console.log('[JiraSyncScheduler] Triggering startup sync');
                this.syncNow().catch(error => {
                    console.error('[JiraSyncScheduler] Startup sync failed:', error);
                });
            }, startupDelay);
        } else {
            console.log(`[JiraSyncScheduler] Skipping startup sync - last sync was ${Math.round(timeSinceLastSync / 1000)}s ago (interval is ${this.config.intervalMinutes}min)`);
        }

        // Set up periodic sync
        this.syncInterval = window.setInterval(() => {
            if (!this.isSyncing) {
                console.log('[JiraSyncScheduler] Triggering periodic sync');
                this.syncNow().catch(error => {
                    console.error('[JiraSyncScheduler] Periodic sync failed:', error);
                });
            } else {
                console.log('[JiraSyncScheduler] Skipping periodic sync - sync already in progress');
            }
        }, intervalMs);

        this.emitStatus();
    }

    /**
     * Stop the sync scheduler
     */
    public stop(): void {
        console.log('[JiraSyncScheduler] Stopping scheduler');

        if (this.syncInterval !== null) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        if (this.startupSyncTimeout !== null) {
            clearTimeout(this.startupSyncTimeout);
            this.startupSyncTimeout = null;
        }

        this.emitStatus();
    }

    /**
     * Trigger manual sync immediately
     * Returns promise that resolves when sync completes
     */
    public async syncNow(): Promise<void> {
        if (!this.jiraCache) {
            throw new Error('JiraCache not initialized');
        }

        if (this.isSyncing) {
            console.log('[JiraSyncScheduler] Sync already in progress, skipping');
            return;
        }

        if (this.config.selectedProjects.length === 0) {
            console.log('[JiraSyncScheduler] No projects selected, skipping sync');
            return;
        }

        console.log('[JiraSyncScheduler] Starting manual sync for projects:', this.config.selectedProjects);

        this.isSyncing = true;
        this.lastSyncError = null;
        this.emitStatus();

        try {
            await this.jiraCache.syncAllData(this.config.selectedProjects);
            this.lastSyncTimestamp = Date.now();
            console.log('[JiraSyncScheduler] Sync completed successfully');
        } catch (error) {
            this.lastSyncError = error instanceof Error ? error.message : 'Unknown error';
            console.error('[JiraSyncScheduler] Sync failed:', error);
            throw error;
        } finally {
            this.isSyncing = false;
            this.emitStatus();
        }
    }

    /**
     * Update scheduler configuration
     * Automatically restarts if running
     */
    public updateConfig(config: Partial<SyncSchedulerConfig>): void {
        const wasRunning = this.syncInterval !== null;

        // Update config
        this.config = {
            ...this.config,
            ...config,
        };

        console.log('[JiraSyncScheduler] Config updated:', this.config);

        // Restart if it was running
        if (wasRunning) {
            this.stop();
            this.start();
        }

        this.emitStatus();
    }

    /**
     * Get current sync status
     */
    public getStatus(): SyncStatus {
        const nextSyncTimestamp = this.calculateNextSyncTime();

        return {
            isEnabled: this.config.enabled,
            isSyncing: this.isSyncing,
            lastSyncTimestamp: this.lastSyncTimestamp,
            nextSyncTimestamp,
            syncInterval: this.config.intervalMinutes,
            lastSyncError: this.lastSyncError,
        };
    }

    /**
     * Subscribe to status updates
     */
    public onStatusUpdate(callback: (status: SyncStatus) => void): () => void {
        this.statusCallbacks.push(callback);
        // Immediately emit current status to new subscriber
        callback(this.getStatus());

        return () => {
            const index = this.statusCallbacks.indexOf(callback);
            if (index > -1) {
                this.statusCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Check if sync is currently enabled
     */
    public isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Check if sync is currently running
     */
    public isSyncInProgress(): boolean {
        return this.isSyncing;
    }

    /**
     * Get last sync timestamp
     */
    public getLastSyncTimestamp(): number {
        return this.lastSyncTimestamp;
    }

    /**
     * Set last sync timestamp (for restoring from storage)
     */
    public setLastSyncTimestamp(timestamp: number): void {
        this.lastSyncTimestamp = timestamp;
        this.emitStatus();
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Calculate when the next sync will occur
     */
    private calculateNextSyncTime(): number | null {
        if (!this.config.enabled || this.syncInterval === null) {
            return null;
        }

        if (this.lastSyncTimestamp === 0) {
            // No sync yet, next sync is startup sync
            const startupDelay = this.config.startupDelayMs ?? 10000;
            return Date.now() + startupDelay;
        }

        const intervalMs = this.config.intervalMinutes * 60 * 1000;
        return this.lastSyncTimestamp + intervalMs;
    }

    /**
     * Emit status update to all subscribers
     */
    private emitStatus(): void {
        const status = this.getStatus();
        this.statusCallbacks.forEach(callback => {
            try {
                callback(status);
            } catch (error) {
                console.error('[JiraSyncScheduler] Error in status callback:', error);
            }
        });
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        this.stop();
        this.statusCallbacks = [];
        this.jiraCache = null;
    }
}
