/**
 * Jira Metadata Cache Service
 * Caches comprehensive Jira metadata for AI features and performance optimization
 */

interface CachedMetadata {
    timestamp: number;
    ttl: number; // Time to live in milliseconds
    data: any;
}

interface JiraMetadataCache {
    projects?: CachedMetadata;
    issueTypes?: CachedMetadata;
    priorities?: CachedMetadata;
    fields?: CachedMetadata;
    comprehensive?: CachedMetadata;
}

const CACHE_KEY = 'timeportal-jira-metadata-cache';
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes default TTL

export class JiraMetadataCacheService {
    private static instance: JiraMetadataCacheService;
    private cache: JiraMetadataCache = {};

    private constructor() {
        this.loadFromStorage();
    }

    static getInstance(): JiraMetadataCacheService {
        if (!JiraMetadataCacheService.instance) {
            JiraMetadataCacheService.instance = new JiraMetadataCacheService();
        }
        return JiraMetadataCacheService.instance;
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(CACHE_KEY);
            if (stored) {
                this.cache = JSON.parse(stored);
            }
        } catch (error) {
            console.warn('[JiraMetadataCache] Failed to load cache from storage:', error);
            this.cache = {};
        }
    }

    private saveToStorage(): void {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache));
        } catch (error) {
            console.warn('[JiraMetadataCache] Failed to save cache to storage:', error);
        }
    }

    private isExpired(cached: CachedMetadata): boolean {
        return Date.now() - cached.timestamp > cached.ttl;
    }

    /**
     * Get cached data if valid, null if expired or not found
     */
    get(key: keyof JiraMetadataCache): any | null {
        const cached = this.cache[key];
        if (!cached) {
            return null;
        }

        if (this.isExpired(cached)) {
            delete this.cache[key];
            this.saveToStorage();
            return null;
        }

        return cached.data;
    }

    /**
     * Set cached data with TTL
     */
    set(key: keyof JiraMetadataCache, data: any, ttl: number = DEFAULT_TTL): void {
        this.cache[key] = {
            timestamp: Date.now(),
            ttl,
            data
        };
        this.saveToStorage();
    }

    /**
     * Clear specific cache entry
     */
    invalidate(key: keyof JiraMetadataCache): void {
        delete this.cache[key];
        this.saveToStorage();
    }

    /**
     * Clear all cache
     */
    clear(): void {
        this.cache = {};
        this.saveToStorage();
    }

    /**
     * Get cache statistics for debugging
     */
    getStats(): {
        totalEntries: number;
        entries: Array<{
            key: string;
            size: number;
            age: number;
            expired: boolean;
        }>;
    } {
        const entries = Object.entries(this.cache).map(([key, cached]) => ({
            key,
            size: JSON.stringify(cached.data).length,
            age: Date.now() - cached.timestamp,
            expired: this.isExpired(cached)
        }));

        return {
            totalEntries: entries.length,
            entries
        };
    }

    /**
     * Cache comprehensive metadata with longer TTL for AI features
     */
    setComprehensiveMetadata(data: any, selectedProjects: string[]): void {
        const cacheKey = `comprehensive-${selectedProjects.sort().join(',')}`;
        const COMPREHENSIVE_TTL = 60 * 60 * 1000; // 1 hour for comprehensive data
        
        this.cache[cacheKey as keyof JiraMetadataCache] = {
            timestamp: Date.now(),
            ttl: COMPREHENSIVE_TTL,
            data: {
                ...data,
                selectedProjects
            }
        };
        this.saveToStorage();
    }

    /**
     * Get cached comprehensive metadata for specific project selection
     */
    getComprehensiveMetadata(selectedProjects: string[]): any | null {
        const cacheKey = `comprehensive-${selectedProjects.sort().join(',')}`;
        return this.get(cacheKey as keyof JiraMetadataCache);
    }
}