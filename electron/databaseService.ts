/**
 * DatabaseService - SQLite database management for TimePortal
 *
 * Handles all persistent storage using better-sqlite3:
 * - Time entries and worklogs
 * - Bucket configurations
 * - Jira issue cache
 * - Jira crawler state
 * - Application settings
 *
 * Features:
 * - ACID compliance
 * - Automatic schema migrations
 * - Transaction support
 * - Type-safe queries
 */

import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import type {
    TimeEntry,
    TimeBucket,
    WorkAssignment,
    WindowActivity,
    LinkedJiraIssue
} from '../src/types/shared.js';

interface JiraIssue {
    key: string;
    summary: string;
    issueType: string;
    status: string;
    projectKey: string;
    projectName: string;
    data: string; // JSON stringified full issue data
    cached_at: number;
}

interface CrawlerState {
    projectKey: string;
    state: string; // JSON stringified state
    updated_at: number;
}

interface Setting {
    key: string;
    value: string; // JSON stringified value
    updated_at: number;
}

export interface CalendarEvent {
    id: string;
    provider: string;
    providerEventId: string;
    title: string;
    startTime: number;
    endTime: number;
    isAllDay: boolean;
    syncedAt?: number;
}

export class DatabaseService {
    private db: Database.Database;
    private static instance: DatabaseService | null = null;

    private constructor(dbPath: string) {
        console.log('[DatabaseService] Initializing database at:', dbPath);
        this.db = new Database(dbPath);

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');

        // Initialize schema
        this.initializeSchema();

        console.log('[DatabaseService] Database initialized successfully');
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            const dbPath = path.join(app.getPath('userData'), 'timeportal.db');
            DatabaseService.instance = new DatabaseService(dbPath);
        }
        return DatabaseService.instance;
    }

    /**
     * Initialize database schema with all required tables
     */
    private initializeSchema(): void {
        // Create entries table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                duration INTEGER NOT NULL,
                assignment TEXT, -- JSON stringified WorkAssignment
                assignment_auto_selected INTEGER DEFAULT 0,
                bucket_id TEXT, -- Legacy field
                linked_jira_issue TEXT, -- Legacy field, JSON stringified
                description TEXT,
                description_auto_generated INTEGER DEFAULT 0,
                detected_technologies TEXT, -- JSON array
                detected_activities TEXT, -- JSON array
                window_activity TEXT, -- JSON array of WindowActivity
                screenshot_path TEXT,
                tempo_account TEXT, -- JSON stringified account
                tempo_account_auto_selected INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_entries_start_time ON entries(start_time);
            CREATE INDEX IF NOT EXISTS idx_entries_end_time ON entries(end_time);
            CREATE INDEX IF NOT EXISTS idx_entries_bucket_id ON entries(bucket_id);
        `);

        // Create buckets table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS buckets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                parent_id TEXT,
                is_folder INTEGER DEFAULT 0,
                linked_issue TEXT, -- JSON stringified LinkedJiraIssue
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (parent_id) REFERENCES buckets(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_buckets_parent_id ON buckets(parent_id);
        `);

        // Create jira_issues table (cache)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS jira_issues (
                key TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                issue_type TEXT NOT NULL,
                status TEXT NOT NULL,
                project_key TEXT NOT NULL,
                project_name TEXT NOT NULL,
                data TEXT NOT NULL, -- Full JSON data
                cached_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_jira_issues_project ON jira_issues(project_key);
            CREATE INDEX IF NOT EXISTS idx_jira_issues_cached_at ON jira_issues(cached_at);
        `);

        // Create crawler_state table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS crawler_state (
                project_key TEXT PRIMARY KEY,
                state TEXT NOT NULL, -- JSON stringified ProjectCrawlProgress
                updated_at INTEGER NOT NULL
            );
        `);

        // Create settings table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL, -- JSON stringified value
                updated_at INTEGER NOT NULL
            );
        `);

        // Create jira_cache_meta table for cache metadata
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS jira_cache_meta (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL, -- JSON stringified cache entry
                timestamp INTEGER NOT NULL,
                query TEXT
            );
        `);

        // Create blacklisted_apps table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS blacklisted_apps (
                bundle_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_blacklisted_apps_name ON blacklisted_apps(name);
        `);

        // Create blacklisted_tempo_accounts table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS blacklisted_tempo_accounts (
                account_key TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_blacklisted_tempo_accounts_name ON blacklisted_tempo_accounts(name);
        `);

        // Create tempo_cache_meta table for cache metadata
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tempo_cache_meta (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                query TEXT
            );
        `);

        // Create tempo_accounts table for individual account caching
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tempo_accounts (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                global INTEGER DEFAULT 0,
                data TEXT NOT NULL,
                cached_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tempo_accounts_status ON tempo_accounts(status);
            CREATE INDEX IF NOT EXISTS idx_tempo_accounts_cached_at ON tempo_accounts(cached_at);
        `);

        // Calendar events cache
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS calendar_events (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'google',
                provider_event_id TEXT NOT NULL,
                title TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                is_all_day INTEGER DEFAULT 0,
                synced_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_calendar_events_time
                ON calendar_events(start_time, end_time);
        `);

        console.log('[DatabaseService] Schema initialized');
    }

    // ========================================================================
    // ENTRIES CRUD
    // ========================================================================

    public getAllEntries(): TimeEntry[] {
        const stmt = this.db.prepare('SELECT * FROM entries ORDER BY start_time DESC');
        const rows = stmt.all();
        return rows.map(row => this.rowToEntry(row));
    }

    public getEntry(id: string): TimeEntry | null {
        const stmt = this.db.prepare('SELECT * FROM entries WHERE id = ?');
        const row = stmt.get(id);
        return row ? this.rowToEntry(row) : null;
    }

    public insertEntry(entry: TimeEntry): void {
        const stmt = this.db.prepare(`
            INSERT INTO entries (
                id, start_time, end_time, duration, assignment, assignment_auto_selected,
                bucket_id, linked_jira_issue, description, description_auto_generated,
                detected_technologies, detected_activities, window_activity, screenshot_path,
                tempo_account, tempo_account_auto_selected, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            entry.id,
            entry.startTime,
            entry.endTime,
            entry.duration,
            entry.assignment ? JSON.stringify(entry.assignment) : null,
            entry.assignmentAutoSelected ? 1 : 0,
            entry.bucketId || null,
            entry.linkedJiraIssue ? JSON.stringify(entry.linkedJiraIssue) : null,
            entry.description || null,
            entry.descriptionAutoGenerated ? 1 : 0,
            entry.detectedTechnologies ? JSON.stringify(entry.detectedTechnologies) : null,
            entry.detectedActivities ? JSON.stringify(entry.detectedActivities) : null,
            entry.windowActivity ? JSON.stringify(entry.windowActivity) : null,
            entry.screenshotPath || null,
            entry.tempoAccount ? JSON.stringify(entry.tempoAccount) : null,
            entry.tempoAccountAutoSelected ? 1 : 0,
            Date.now(),
            Date.now()
        );
    }

    public updateEntry(id: string, updates: Partial<TimeEntry>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.startTime !== undefined) {
            fields.push('start_time = ?');
            values.push(updates.startTime);
        }
        if (updates.endTime !== undefined) {
            fields.push('end_time = ?');
            values.push(updates.endTime);
        }
        if (updates.duration !== undefined) {
            fields.push('duration = ?');
            values.push(updates.duration);
        }
        if (updates.assignment !== undefined) {
            fields.push('assignment = ?');
            values.push(updates.assignment ? JSON.stringify(updates.assignment) : null);
        }
        if (updates.assignmentAutoSelected !== undefined) {
            fields.push('assignment_auto_selected = ?');
            values.push(updates.assignmentAutoSelected ? 1 : 0);
        }
        if (updates.bucketId !== undefined) {
            fields.push('bucket_id = ?');
            values.push(updates.bucketId);
        }
        if (updates.linkedJiraIssue !== undefined) {
            fields.push('linked_jira_issue = ?');
            values.push(updates.linkedJiraIssue ? JSON.stringify(updates.linkedJiraIssue) : null);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }
        if (updates.descriptionAutoGenerated !== undefined) {
            fields.push('description_auto_generated = ?');
            values.push(updates.descriptionAutoGenerated ? 1 : 0);
        }
        if (updates.detectedTechnologies !== undefined) {
            fields.push('detected_technologies = ?');
            values.push(updates.detectedTechnologies ? JSON.stringify(updates.detectedTechnologies) : null);
        }
        if (updates.detectedActivities !== undefined) {
            fields.push('detected_activities = ?');
            values.push(updates.detectedActivities ? JSON.stringify(updates.detectedActivities) : null);
        }
        if (updates.windowActivity !== undefined) {
            fields.push('window_activity = ?');
            values.push(updates.windowActivity ? JSON.stringify(updates.windowActivity) : null);
        }
        if (updates.screenshotPath !== undefined) {
            fields.push('screenshot_path = ?');
            values.push(updates.screenshotPath);
        }
        if (updates.tempoAccount !== undefined) {
            fields.push('tempo_account = ?');
            values.push(updates.tempoAccount ? JSON.stringify(updates.tempoAccount) : null);
        }
        if (updates.tempoAccountAutoSelected !== undefined) {
            fields.push('tempo_account_auto_selected = ?');
            values.push(updates.tempoAccountAutoSelected ? 1 : 0);
        }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const stmt = this.db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...values);
    }

    public deleteEntry(id: string): void {
        const stmt = this.db.prepare('DELETE FROM entries WHERE id = ?');
        stmt.run(id);
    }

    public deleteAllEntries(): void {
        this.db.exec('DELETE FROM entries');
    }

    // ========================================================================
    // BUCKETS CRUD
    // ========================================================================

    public getAllBuckets(): TimeBucket[] {
        const stmt = this.db.prepare('SELECT * FROM buckets ORDER BY created_at ASC');
        const rows = stmt.all();
        return rows.map(row => this.rowToBucket(row));
    }

    public getBucket(id: string): TimeBucket | null {
        const stmt = this.db.prepare('SELECT * FROM buckets WHERE id = ?');
        const row = stmt.get(id);
        return row ? this.rowToBucket(row) : null;
    }

    public insertBucket(bucket: TimeBucket): void {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO buckets (id, name, color, parent_id, is_folder, linked_issue, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            bucket.id,
            bucket.name,
            bucket.color,
            bucket.parentId || null,
            bucket.isFolder ? 1 : 0,
            bucket.linkedIssue ? JSON.stringify(bucket.linkedIssue) : null,
            Date.now(),
            Date.now()
        );
    }

    public updateBucket(id: string, updates: Partial<TimeBucket>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.color !== undefined) {
            fields.push('color = ?');
            values.push(updates.color);
        }
        if (updates.parentId !== undefined) {
            fields.push('parent_id = ?');
            values.push(updates.parentId);
        }
        if (updates.isFolder !== undefined) {
            fields.push('is_folder = ?');
            values.push(updates.isFolder ? 1 : 0);
        }
        if (updates.linkedIssue !== undefined) {
            fields.push('linked_issue = ?');
            values.push(updates.linkedIssue ? JSON.stringify(updates.linkedIssue) : null);
        }

        if (fields.length === 0) return;

        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        const stmt = this.db.prepare(`UPDATE buckets SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...values);
    }

    public deleteBucket(id: string): void {
        const stmt = this.db.prepare('DELETE FROM buckets WHERE id = ?');
        stmt.run(id);
    }

    // ========================================================================
    // JIRA ISSUES CACHE
    // ========================================================================

    public getAllJiraIssues(): any[] {
        const stmt = this.db.prepare('SELECT * FROM jira_issues');
        const rows = stmt.all();
        return rows.map((row: any) => JSON.parse(row.data));
    }

    public getJiraIssuesByProject(projectKey: string): any[] {
        const stmt = this.db.prepare('SELECT * FROM jira_issues WHERE project_key = ? ORDER BY cached_at DESC');
        const rows = stmt.all(projectKey);
        return rows.map((row: any) => JSON.parse(row.data));
    }

    public getJiraIssue(key: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM jira_issues WHERE key = ?');
        const row: any = stmt.get(key);
        return row ? JSON.parse(row.data) : null;
    }

    public upsertJiraIssue(issue: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO jira_issues (key, summary, issue_type, status, project_key, project_name, data, cached_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                summary = excluded.summary,
                issue_type = excluded.issue_type,
                status = excluded.status,
                project_key = excluded.project_key,
                project_name = excluded.project_name,
                data = excluded.data,
                cached_at = excluded.cached_at
        `);

        stmt.run(
            issue.key,
            issue.fields?.summary || '',
            issue.fields?.issuetype?.name || '',
            issue.fields?.status?.name || '',
            issue.fields?.project?.key || '',
            issue.fields?.project?.name || '',
            JSON.stringify(issue),
            Date.now()
        );
    }

    public deleteJiraIssue(key: string): void {
        const stmt = this.db.prepare('DELETE FROM jira_issues WHERE key = ?');
        stmt.run(key);
    }

    public deleteJiraIssuesByProject(projectKey: string): void {
        const stmt = this.db.prepare('DELETE FROM jira_issues WHERE project_key = ?');
        stmt.run(projectKey);
    }

    public clearJiraCache(): void {
        this.db.exec('DELETE FROM jira_issues');
        this.db.exec('DELETE FROM jira_cache_meta');
    }

    public cleanOldJiraCache(olderThanMs: number): void {
        const cutoff = Date.now() - olderThanMs;
        const stmt = this.db.prepare('DELETE FROM jira_issues WHERE cached_at < ?');
        stmt.run(cutoff);
    }

    // ========================================================================
    // JIRA CACHE METADATA
    // ========================================================================

    public getJiraCacheMeta(key: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM jira_cache_meta WHERE key = ?');
        const row: any = stmt.get(key);
        if (!row) return null;

        return {
            data: JSON.parse(row.data),
            timestamp: row.timestamp,
            query: row.query
        };
    }

    public setJiraCacheMeta(key: string, data: any, query?: string): void {
        const stmt = this.db.prepare(`
            INSERT INTO jira_cache_meta (key, data, timestamp, query)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                data = excluded.data,
                timestamp = excluded.timestamp,
                query = excluded.query
        `);

        stmt.run(key, JSON.stringify(data), Date.now(), query || null);
    }

    public deleteJiraCacheMeta(key: string): void {
        const stmt = this.db.prepare('DELETE FROM jira_cache_meta WHERE key = ?');
        stmt.run(key);
    }

    // ========================================================================
    // CRAWLER STATE
    // ========================================================================

    public getCrawlerState(projectKey: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM crawler_state WHERE project_key = ?');
        const row: any = stmt.get(projectKey);
        return row ? JSON.parse(row.state) : null;
    }

    public setCrawlerState(projectKey: string, state: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO crawler_state (project_key, state, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(project_key) DO UPDATE SET
                state = excluded.state,
                updated_at = excluded.updated_at
        `);

        stmt.run(projectKey, JSON.stringify(state), Date.now());
    }

    public deleteCrawlerState(projectKey: string): void {
        const stmt = this.db.prepare('DELETE FROM crawler_state WHERE project_key = ?');
        stmt.run(projectKey);
    }

    public clearCrawlerState(): void {
        this.db.exec('DELETE FROM crawler_state');
    }

    // ========================================================================
    // SETTINGS
    // ========================================================================

    public getSetting(key: string): any | null {
        const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
        const row: any = stmt.get(key);
        return row ? JSON.parse(row.value) : null;
    }

    public setSetting(key: string, value: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `);

        stmt.run(key, JSON.stringify(value), Date.now());
    }

    public deleteSetting(key: string): void {
        const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
        stmt.run(key);
    }

    public getAllSettings(): Record<string, any> {
        const stmt = this.db.prepare('SELECT key, value FROM settings');
        const rows = stmt.all();
        const settings: Record<string, any> = {};

        for (const row of rows as any[]) {
            settings[row.key] = JSON.parse(row.value);
        }

        return settings;
    }

    // ========================================================================
    // BLACKLISTED APPS CRUD
    // ========================================================================

    public getAllBlacklistedApps(): Array<{ bundleId: string; name: string; category?: string }> {
        const stmt = this.db.prepare('SELECT bundle_id, name, category FROM blacklisted_apps ORDER BY name ASC');
        const rows = stmt.all() as any[];
        return rows.map(row => ({
            bundleId: row.bundle_id,
            name: row.name,
            category: row.category || undefined
        }));
    }

    public isAppBlacklisted(bundleId: string): boolean {
        const stmt = this.db.prepare('SELECT 1 FROM blacklisted_apps WHERE bundle_id = ?');
        const row = stmt.get(bundleId);
        return !!row;
    }

    public addBlacklistedApp(bundleId: string, name: string, category?: string): void {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO blacklisted_apps (bundle_id, name, category, created_at)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(bundleId, name, category || null, Date.now());
    }

    public removeBlacklistedApp(bundleId: string): void {
        const stmt = this.db.prepare('DELETE FROM blacklisted_apps WHERE bundle_id = ?');
        stmt.run(bundleId);
    }

    public clearBlacklistedApps(): void {
        this.db.exec('DELETE FROM blacklisted_apps');
    }

    // ========================================================================
    // BLACKLISTED TEMPO ACCOUNTS CRUD
    // ========================================================================

    public getAllBlacklistedTempoAccounts(): Array<{ accountKey: string; accountId: string; name: string }> {
        const stmt = this.db.prepare('SELECT account_key, account_id, name FROM blacklisted_tempo_accounts ORDER BY name ASC');
        const rows = stmt.all() as any[];
        return rows.map(row => ({
            accountKey: row.account_key,
            accountId: row.account_id,
            name: row.name
        }));
    }

    public isTempoAccountBlacklisted(accountKey: string): boolean {
        const stmt = this.db.prepare('SELECT 1 FROM blacklisted_tempo_accounts WHERE account_key = ?');
        const row = stmt.get(accountKey);
        return !!row;
    }

    public addBlacklistedTempoAccount(accountKey: string, accountId: string, name: string): void {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO blacklisted_tempo_accounts (account_key, account_id, name, created_at)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(accountKey, accountId, name, Date.now());
    }

    public removeBlacklistedTempoAccount(accountKey: string): void {
        const stmt = this.db.prepare('DELETE FROM blacklisted_tempo_accounts WHERE account_key = ?');
        stmt.run(accountKey);
    }

    public clearBlacklistedTempoAccounts(): void {
        this.db.exec('DELETE FROM blacklisted_tempo_accounts');
    }

    // ========================================================================
    // TEMPO CACHE METADATA
    // ========================================================================

    public getTempoCacheMeta(key: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM tempo_cache_meta WHERE key = ?');
        const row: any = stmt.get(key);
        if (!row) return null;

        return {
            data: JSON.parse(row.data),
            timestamp: row.timestamp,
            query: row.query
        };
    }

    public setTempoCacheMeta(key: string, data: any, query?: string): void {
        const stmt = this.db.prepare(`
            INSERT INTO tempo_cache_meta (key, data, timestamp, query)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                data = excluded.data,
                timestamp = excluded.timestamp,
                query = excluded.query
        `);

        stmt.run(key, JSON.stringify(data), Date.now(), query || null);
    }

    public deleteTempoCacheMeta(key: string): void {
        const stmt = this.db.prepare('DELETE FROM tempo_cache_meta WHERE key = ?');
        stmt.run(key);
    }

    // ========================================================================
    // TEMPO ACCOUNTS CACHE
    // ========================================================================

    public getAllTempoAccounts(): any[] {
        const stmt = this.db.prepare('SELECT * FROM tempo_accounts ORDER BY name ASC');
        const rows = stmt.all();
        return rows.map((row: any) => JSON.parse(row.data));
    }

    public getTempoAccountsByStatus(status: string): any[] {
        const stmt = this.db.prepare('SELECT * FROM tempo_accounts WHERE status = ? ORDER BY name ASC');
        const rows = stmt.all(status);
        return rows.map((row: any) => JSON.parse(row.data));
    }

    public getTempoAccount(id: string): any | null {
        const stmt = this.db.prepare('SELECT * FROM tempo_accounts WHERE id = ?');
        const row: any = stmt.get(id);
        return row ? JSON.parse(row.data) : null;
    }

    public upsertTempoAccount(account: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO tempo_accounts (id, key, name, status, global, data, cached_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                key = excluded.key,
                name = excluded.name,
                status = excluded.status,
                global = excluded.global,
                data = excluded.data,
                cached_at = excluded.cached_at
        `);

        stmt.run(
            account.id,
            account.key || '',
            account.name || '',
            account.status || 'OPEN',
            account.global ? 1 : 0,
            JSON.stringify(account),
            Date.now()
        );
    }

    public deleteTempoAccount(id: string): void {
        const stmt = this.db.prepare('DELETE FROM tempo_accounts WHERE id = ?');
        stmt.run(id);
    }

    public clearTempoCache(): void {
        this.db.exec('DELETE FROM tempo_accounts');
        this.db.exec('DELETE FROM tempo_cache_meta');
    }

    public cleanOldTempoCache(olderThanMs: number): void {
        const cutoff = Date.now() - olderThanMs;
        const stmt = this.db.prepare('DELETE FROM tempo_accounts WHERE cached_at < ?');
        stmt.run(cutoff);
    }

    // ========================================================================
    // CALENDAR EVENTS
    // ========================================================================

    public getCalendarEvents(startTime: number, endTime: number): CalendarEvent[] {
        const stmt = this.db.prepare(`
            SELECT * FROM calendar_events
            WHERE start_time <= ? AND end_time >= ?
            ORDER BY start_time ASC
        `);
        const rows = stmt.all(endTime, startTime) as any[];
        return rows.map(row => this.rowToCalendarEvent(row));
    }

    public upsertCalendarEvents(events: CalendarEvent[]): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO calendar_events
            (id, provider, provider_event_id, title, start_time, end_time, is_all_day, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        const upsertMany = this.db.transaction((events: CalendarEvent[]) => {
            for (const event of events) {
                stmt.run(
                    event.id,
                    event.provider,
                    event.providerEventId,
                    event.title,
                    event.startTime,
                    event.endTime,
                    event.isAllDay ? 1 : 0,
                    now
                );
            }
        });
        upsertMany(events);
    }

    public deleteStaleCalendarEvents(olderThan: number): void {
        const stmt = this.db.prepare(`
            DELETE FROM calendar_events WHERE synced_at < ?
        `);
        stmt.run(olderThan);
    }

    public clearCalendarEvents(): void {
        this.db.exec('DELETE FROM calendar_events');
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    private rowToEntry(row: any): TimeEntry {
        return {
            id: row.id,
            startTime: row.start_time,
            endTime: row.end_time,
            duration: row.duration,
            assignment: row.assignment ? JSON.parse(row.assignment) : undefined,
            assignmentAutoSelected: row.assignment_auto_selected === 1,
            bucketId: row.bucket_id,
            linkedJiraIssue: row.linked_jira_issue ? JSON.parse(row.linked_jira_issue) : undefined,
            description: row.description,
            descriptionAutoGenerated: row.description_auto_generated === 1,
            detectedTechnologies: row.detected_technologies ? JSON.parse(row.detected_technologies) : undefined,
            detectedActivities: row.detected_activities ? JSON.parse(row.detected_activities) : undefined,
            windowActivity: row.window_activity ? JSON.parse(row.window_activity) : undefined,
            screenshotPath: row.screenshot_path,
            tempoAccount: row.tempo_account ? JSON.parse(row.tempo_account) : undefined,
            tempoAccountAutoSelected: row.tempo_account_auto_selected === 1
        };
    }

    private rowToBucket(row: any): TimeBucket {
        return {
            id: row.id,
            name: row.name,
            color: row.color,
            parentId: row.parent_id,
            isFolder: row.is_folder === 1,
            linkedIssue: row.linked_issue ? JSON.parse(row.linked_issue) : undefined
        };
    }

    private rowToCalendarEvent(row: any): CalendarEvent {
        return {
            id: row.id,
            provider: row.provider,
            providerEventId: row.provider_event_id,
            title: row.title,
            startTime: row.start_time,
            endTime: row.end_time,
            isAllDay: row.is_all_day === 1,
            syncedAt: row.synced_at
        };
    }

    /**
     * Run migrations from localStorage to SQLite
     * This is called automatically on first run
     */
    public async migrateFromLocalStorage(): Promise<void> {
        console.log('[DatabaseService] Checking for localStorage data to migrate...');

        // Check if migration already happened
        const migrationFlag = this.getSetting('migration_completed');
        if (migrationFlag) {
            console.log('[DatabaseService] Migration already completed');
            return;
        }

        // Migration logic will be implemented here
        // This will be called from the main process on startup

        console.log('[DatabaseService] Migration completed');
        this.setSetting('migration_completed', true);
    }

    public close(): void {
        if (this.db) {
            this.db.close();
            console.log('[DatabaseService] Database closed');
        }
    }

    /**
     * Execute in transaction for atomic operations
     */
    public transaction<T>(fn: () => T): T {
        return this.db.transaction(fn)();
    }

    /**
     * Get database statistics
     */
    public getStats() {
        const entriesCount = this.db.prepare('SELECT COUNT(*) as count FROM entries').get() as any;
        const bucketsCount = this.db.prepare('SELECT COUNT(*) as count FROM buckets').get() as any;
        const jiraIssuesCount = this.db.prepare('SELECT COUNT(*) as count FROM jira_issues').get() as any;
        const crawlerStatesCount = this.db.prepare('SELECT COUNT(*) as count FROM crawler_state').get() as any;

        return {
            entries: entriesCount.count,
            buckets: bucketsCount.count,
            jiraIssues: jiraIssuesCount.count,
            crawlerStates: crawlerStatesCount.count,
            dbPath: this.db.name
        };
    }
}
