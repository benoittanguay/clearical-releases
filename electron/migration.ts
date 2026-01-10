/**
 * Migration utility to transfer data from localStorage to SQLite
 *
 * This runs automatically on first app start after the database migration.
 * It reads all localStorage data and transfers it to the SQLite database.
 */

import { DatabaseService } from './databaseService.js';

export interface MigrationResult {
    success: boolean;
    entriesMigrated: number;
    bucketsMigrated: number;
    jiraIssuesMigrated: number;
    crawlerStatesMigrated: number;
    settingsMigrated: number;
    errors: string[];
}

export class MigrationService {
    /**
     * Migrate all data from localStorage to SQLite
     * This is triggered via IPC from the renderer process
     */
    public static async migrateFromLocalStorage(localStorageData: Record<string, string>): Promise<MigrationResult> {
        console.log('[Migration] Starting localStorage to SQLite migration...');

        const result: MigrationResult = {
            success: true,
            entriesMigrated: 0,
            bucketsMigrated: 0,
            jiraIssuesMigrated: 0,
            crawlerStatesMigrated: 0,
            settingsMigrated: 0,
            errors: []
        };

        const db = DatabaseService.getInstance();

        try {
            // Migrate entries
            const entriesData = localStorageData['timeportal-entries'];
            if (entriesData) {
                try {
                    const entries = JSON.parse(entriesData);
                    if (Array.isArray(entries)) {
                        for (const entry of entries) {
                            try {
                                db.insertEntry(entry);
                                result.entriesMigrated++;
                            } catch (error) {
                                const err = error instanceof Error ? error.message : 'Unknown error';
                                result.errors.push(`Failed to migrate entry ${entry.id}: ${err}`);
                            }
                        }
                        console.log(`[Migration] Migrated ${result.entriesMigrated} entries`);
                    }
                } catch (error) {
                    result.errors.push(`Failed to parse entries: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Migrate buckets
            const bucketsData = localStorageData['timeportal-buckets'];
            if (bucketsData) {
                try {
                    const buckets = JSON.parse(bucketsData);
                    if (Array.isArray(buckets)) {
                        for (const bucket of buckets) {
                            try {
                                db.insertBucket(bucket);
                                result.bucketsMigrated++;
                            } catch (error) {
                                const err = error instanceof Error ? error.message : 'Unknown error';
                                result.errors.push(`Failed to migrate bucket ${bucket.id}: ${err}`);
                            }
                        }
                        console.log(`[Migration] Migrated ${result.bucketsMigrated} buckets`);
                    }
                } catch (error) {
                    result.errors.push(`Failed to parse buckets: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Migrate Jira cache
            const jiraCacheData = localStorageData['jira-issues-cache'];
            if (jiraCacheData) {
                try {
                    const cache = JSON.parse(jiraCacheData);

                    // Migrate assigned issues
                    if (cache.assignedIssues?.data) {
                        for (const issue of cache.assignedIssues.data) {
                            try {
                                db.upsertJiraIssue(issue);
                                result.jiraIssuesMigrated++;
                            } catch (error) {
                                const err = error instanceof Error ? error.message : 'Unknown error';
                                result.errors.push(`Failed to migrate Jira issue ${issue.key}: ${err}`);
                            }
                        }

                        // Store cache metadata
                        db.setJiraCacheMeta('assignedIssues', {
                            timestamp: cache.assignedIssues.timestamp,
                            count: cache.assignedIssues.data.length
                        }, cache.assignedIssues.query);
                    }

                    // Migrate project issues
                    if (cache.projectIssues) {
                        for (const [projectKey, cacheEntry] of Object.entries(cache.projectIssues)) {
                            const entry = cacheEntry as any;
                            if (entry?.data) {
                                for (const issue of entry.data) {
                                    try {
                                        db.upsertJiraIssue(issue);
                                        result.jiraIssuesMigrated++;
                                    } catch (error) {
                                        const err = error instanceof Error ? error.message : 'Unknown error';
                                        result.errors.push(`Failed to migrate Jira issue ${issue.key}: ${err}`);
                                    }
                                }

                                // Store cache metadata
                                db.setJiraCacheMeta(`project:${projectKey}`, {
                                    timestamp: entry.timestamp,
                                    count: entry.data.length
                                }, entry.query);
                            }
                        }
                    }

                    // Migrate epics
                    if (cache.epics) {
                        for (const [projectKey, cacheEntry] of Object.entries(cache.epics)) {
                            const entry = cacheEntry as any;
                            if (entry?.data) {
                                for (const issue of entry.data) {
                                    try {
                                        db.upsertJiraIssue(issue);
                                        result.jiraIssuesMigrated++;
                                    } catch (error) {
                                        const err = error instanceof Error ? error.message : 'Unknown error';
                                        result.errors.push(`Failed to migrate epic ${issue.key}: ${err}`);
                                    }
                                }

                                // Store cache metadata
                                db.setJiraCacheMeta(`epics:${projectKey}`, {
                                    timestamp: entry.timestamp,
                                    count: entry.data.length
                                }, entry.query);
                            }
                        }
                    }

                    // Store cache settings
                    if (cache.lastSync) {
                        db.setJiraCacheMeta('lastSync', cache.lastSync);
                    }
                    if (cache.crawlerEnabled !== undefined) {
                        db.setJiraCacheMeta('crawlerEnabled', cache.crawlerEnabled);
                    }

                    console.log(`[Migration] Migrated ${result.jiraIssuesMigrated} Jira issues`);
                } catch (error) {
                    result.errors.push(`Failed to parse Jira cache: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Migrate crawler state
            const crawlerStateData = localStorageData['jira-crawler-state'];
            if (crawlerStateData) {
                try {
                    const crawlerState = JSON.parse(crawlerStateData);

                    // Migrate project crawl progress
                    if (crawlerState.projects) {
                        for (const [projectKey, progress] of Object.entries(crawlerState.projects)) {
                            try {
                                db.setCrawlerState(projectKey, progress);
                                result.crawlerStatesMigrated++;
                            } catch (error) {
                                const err = error instanceof Error ? error.message : 'Unknown error';
                                result.errors.push(`Failed to migrate crawler state for ${projectKey}: ${err}`);
                            }
                        }
                    }

                    // Migrate crawler issues (these should already be in Jira cache, but double-check)
                    if (crawlerState.issues) {
                        for (const [issueKey, issue] of Object.entries(crawlerState.issues)) {
                            try {
                                db.upsertJiraIssue(issue);
                            } catch (error) {
                                // Silently ignore - already counted in Jira issues migration
                            }
                        }
                    }

                    console.log(`[Migration] Migrated ${result.crawlerStatesMigrated} crawler states`);
                } catch (error) {
                    result.errors.push(`Failed to parse crawler state: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Migrate settings
            const settingsData = localStorageData['timeportal-settings'];
            if (settingsData) {
                try {
                    const settings = JSON.parse(settingsData);

                    // Store settings as structured data
                    db.setSetting('app_settings', settings);
                    result.settingsMigrated = 1;

                    console.log(`[Migration] Migrated app settings`);
                } catch (error) {
                    result.errors.push(`Failed to parse settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Migrate timer state (if needed)
            const timerStateData = localStorageData['timeportal-timer-state'];
            if (timerStateData) {
                try {
                    const timerState = JSON.parse(timerStateData);
                    db.setSetting('timer_state', timerState);
                    result.settingsMigrated++;
                    console.log(`[Migration] Migrated timer state`);
                } catch (error) {
                    result.errors.push(`Failed to parse timer state: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Mark migration as complete
            db.setSetting('migration_completed', true);
            db.setSetting('migration_date', new Date().toISOString());
            db.setSetting('migration_version', '1.0.0');

            console.log('[Migration] Migration completed successfully');
            console.log(`[Migration] Summary:
  - Entries: ${result.entriesMigrated}
  - Buckets: ${result.bucketsMigrated}
  - Jira Issues: ${result.jiraIssuesMigrated}
  - Crawler States: ${result.crawlerStatesMigrated}
  - Settings: ${result.settingsMigrated}
  - Errors: ${result.errors.length}`);

            if (result.errors.length > 0) {
                console.warn('[Migration] Migration completed with errors:', result.errors);
                result.success = false;
            }

        } catch (error) {
            console.error('[Migration] Critical migration error:', error);
            result.success = false;
            result.errors.push(`Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        return result;
    }

    /**
     * Check if migration is needed
     */
    public static needsMigration(): boolean {
        const db = DatabaseService.getInstance();
        const migrationFlag = db.getSetting('migration_completed');
        return !migrationFlag;
    }
}
