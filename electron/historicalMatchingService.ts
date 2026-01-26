import { TimeEntry, WorkAssignment, LinkedJiraIssue } from '../src/types/shared.js';
import { ActivityContext } from './aiAssignmentService.js';

/**
 * Similarity match result for a historical entry
 */
export interface SimilarityMatch {
    entry: TimeEntry;
    score: number;
    reasons: string[];
}

/**
 * Historical pattern for an assignment (bucket or Jira issue)
 */
export interface AssignmentPattern {
    assignmentKey: string;  // bucket ID or Jira issue key
    assignmentType: 'bucket' | 'jira';
    usageCount: number;
    matchScore: number;  // How well it matches the current context
    reasons: string[];
}

/**
 * Historical pattern for a Tempo account
 */
export interface AccountPattern {
    accountKey: string;
    issueKey: string;
    projectKey: string;
    usageCount: number;
    matchScore: number;
    reasons: string[];
}

/**
 * Common stop words to exclude from keyword matching
 */
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her',
    'its', 'our', 'their', 'me', 'him', 'us', 'them'
]);

/**
 * Historical Matching Service
 *
 * Provides sophisticated similarity matching between current activity context
 * and historical time entries to enable learning from past assignments.
 *
 * Key features:
 * - Multi-factor similarity scoring (text, apps, window titles, technologies)
 * - Efficient caching and indexing for performance
 * - Weighted scoring with configurable thresholds
 * - Human-readable explanations for matches
 */
export class HistoricalMatchingService {
    // Cache for extracted keywords to avoid recomputation
    private keywordCache = new Map<string, string[]>();

    // Maximum number of historical entries to consider (for performance)
    private readonly MAX_HISTORICAL_ENTRIES = 50;

    /**
     * Find similar historical entries based on activity context
     *
     * @param context Current activity context
     * @param historicalEntries Historical time entries
     * @param options Filtering and scoring options
     * @returns Sorted array of similarity matches (highest score first)
     */
    findSimilarEntries(
        context: ActivityContext,
        historicalEntries: TimeEntry[],
        options: {
            minScore?: number;
            maxResults?: number;
            requireDescription?: boolean;
            requireAssignment?: boolean;
        } = {}
    ): SimilarityMatch[] {
        const minScore = options.minScore ?? 0.1;
        const maxResults = options.maxResults ?? 10;

        // Take only recent entries for performance
        const recentEntries = historicalEntries.slice(0, this.MAX_HISTORICAL_ENTRIES);

        const matches: SimilarityMatch[] = [];

        for (const entry of recentEntries) {
            // Skip entries without required data
            if (options.requireDescription && !entry.description) continue;
            if (options.requireAssignment && !entry.assignment) continue;

            // Skip AI-selected assignments - only learn from user-confirmed selections
            // This ensures historical patterns are based on user intent, not AI guesses
            if (entry.assignmentAutoSelected === true) continue;

            const result = this.calculateSimilarity(context, entry);

            if (result.score >= minScore) {
                matches.push(result);
            }
        }

        // Sort by score descending
        matches.sort((a, b) => b.score - a.score);

        return matches.slice(0, maxResults);
    }

    /**
     * Calculate similarity between activity context and a historical entry
     *
     * Scoring breakdown:
     * - App name exact match: 30%
     * - Description keyword match: 25%
     * - Window title keyword match: 20%
     * - Technology match: 15%
     * - Activity type match: 10%
     */
    calculateSimilarity(context: ActivityContext, entry: TimeEntry): SimilarityMatch {
        const reasons: string[] = [];
        let score = 0;

        // 1. App name matching (30%) - strongest signal for similar work
        if (context.appNames.length > 0 && entry.windowActivity && entry.windowActivity.length > 0) {
            const entryAppNames = entry.windowActivity.map(wa => wa.appName.toLowerCase());
            const contextApps = context.appNames.map(app => app.toLowerCase());

            const matchingApps = contextApps.filter(app => entryAppNames.includes(app));
            const appMatchRatio = matchingApps.length / Math.max(contextApps.length, entryAppNames.length);

            score += appMatchRatio * 0.3;

            if (appMatchRatio > 0.5) {
                reasons.push(`same apps used (${matchingApps.slice(0, 2).join(', ')})`);
            }
        }

        // 2. Description keyword matching (25%)
        if (context.description && entry.description) {
            const descScore = this.keywordSimilarity(context.description, entry.description);
            score += descScore * 0.25;

            if (descScore > 0.4) {
                reasons.push('similar work description');
            }
        }

        // 3. Window title keyword matching (20%)
        if (context.windowTitles.length > 0 && entry.windowActivity && entry.windowActivity.length > 0) {
            const entryTitles = entry.windowActivity.map(wa => wa.windowTitle).join(' ');
            const contextTitles = context.windowTitles.join(' ');

            const titleScore = this.keywordSimilarity(contextTitles, entryTitles);
            score += titleScore * 0.2;

            if (titleScore > 0.3) {
                reasons.push('similar window titles');
            }
        }

        // 4. Technology matching (15%)
        if (context.detectedTechnologies.length > 0 && entry.detectedTechnologies && entry.detectedTechnologies.length > 0) {
            const matchingTechs = context.detectedTechnologies.filter(tech =>
                entry.detectedTechnologies!.some(entryTech =>
                    tech.toLowerCase() === entryTech.toLowerCase()
                )
            );

            const techMatchRatio = matchingTechs.length / Math.max(
                context.detectedTechnologies.length,
                entry.detectedTechnologies.length
            );

            score += techMatchRatio * 0.15;

            if (techMatchRatio > 0.4) {
                reasons.push(`same technologies (${matchingTechs.slice(0, 2).join(', ')})`);
            }
        }

        // 5. Activity type matching (10%)
        if (context.detectedActivities.length > 0 && entry.detectedActivities && entry.detectedActivities.length > 0) {
            const matchingActivities = context.detectedActivities.filter(activity =>
                entry.detectedActivities!.some(entryActivity =>
                    activity.toLowerCase() === entryActivity.toLowerCase()
                )
            );

            const activityMatchRatio = matchingActivities.length / Math.max(
                context.detectedActivities.length,
                entry.detectedActivities.length
            );

            score += activityMatchRatio * 0.1;

            if (activityMatchRatio > 0.5) {
                reasons.push('same activity type');
            }
        }

        return {
            entry,
            score: Math.min(score, 1.0),
            reasons
        };
    }

    /**
     * Extract assignment patterns from similar historical entries
     *
     * Groups similar entries by their assignment and calculates aggregate scores
     */
    extractAssignmentPatterns(
        similarEntries: SimilarityMatch[]
    ): AssignmentPattern[] {
        const patternMap = new Map<string, {
            assignment: WorkAssignment;
            entries: SimilarityMatch[];
            totalScore: number;
        }>();

        // Group entries by assignment
        for (const match of similarEntries) {
            if (!match.entry.assignment) continue;

            const key = this.getAssignmentKey(match.entry.assignment);

            if (!patternMap.has(key)) {
                patternMap.set(key, {
                    assignment: match.entry.assignment,
                    entries: [],
                    totalScore: 0
                });
            }

            const pattern = patternMap.get(key)!;
            pattern.entries.push(match);
            pattern.totalScore += match.score;
        }

        // Convert to patterns array
        const patterns: AssignmentPattern[] = [];

        for (const [key, data] of patternMap.entries()) {
            const avgScore = data.totalScore / data.entries.length;
            const usageCount = data.entries.length;

            // Boost score based on usage frequency (more uses = more confidence)
            const frequencyBoost = Math.min(usageCount / 5, 0.3);  // Max 30% boost for 5+ uses
            const matchScore = Math.min(avgScore + frequencyBoost, 1.0);

            // Collect unique reasons
            const reasonSet = new Set<string>();
            data.entries.forEach(e => e.reasons.forEach(r => reasonSet.add(r)));
            const reasons = Array.from(reasonSet);

            if (usageCount >= 2) {
                reasons.unshift(`used ${usageCount} times for similar work`);
            }

            patterns.push({
                assignmentKey: key,
                assignmentType: data.assignment.type,
                usageCount,
                matchScore,
                reasons
            });
        }

        // Sort by match score descending
        patterns.sort((a, b) => b.matchScore - a.matchScore);

        return patterns;
    }

    /**
     * Extract Tempo account patterns from historical data
     *
     * Focuses on finding account usage patterns for specific Jira issues
     */
    extractAccountPatterns(
        issueKey: string,
        projectKey: string,
        historicalEntries: TimeEntry[]
    ): AccountPattern[] {
        const patternMap = new Map<string, {
            accountKey: string;
            count: number;
            recentUsage: number;  // Timestamp of most recent usage
        }>();

        // Find all entries with this issue or project
        for (const entry of historicalEntries) {
            if (!entry.tempoAccount) continue;

            // Skip AI-selected assignments - only learn from user-confirmed selections
            if (entry.assignmentAutoSelected === true) continue;

            // Exact issue match
            const isExactIssueMatch =
                entry.assignment?.type === 'jira' &&
                entry.assignment.jiraIssue?.key === issueKey;

            // Project match
            const isProjectMatch =
                entry.assignment?.type === 'jira' &&
                entry.assignment.jiraIssue?.projectKey === projectKey;

            if (isExactIssueMatch || isProjectMatch) {
                const accountKey = entry.tempoAccount.key;

                if (!patternMap.has(accountKey)) {
                    patternMap.set(accountKey, {
                        accountKey,
                        count: 0,
                        recentUsage: 0
                    });
                }

                const pattern = patternMap.get(accountKey)!;

                // Weight exact issue matches more heavily
                pattern.count += isExactIssueMatch ? 2 : 1;
                pattern.recentUsage = Math.max(pattern.recentUsage, entry.startTime);
            }
        }

        // Convert to patterns array
        const patterns: AccountPattern[] = [];
        const now = Date.now();

        for (const [accountKey, data] of patternMap.entries()) {
            const reasons: string[] = [];

            // Calculate recency score (0-1, where 1 is very recent)
            const daysSinceUse = (now - data.recentUsage) / (1000 * 60 * 60 * 24);
            const recencyScore = Math.max(0, 1 - (daysSinceUse / 30));  // Decay over 30 days

            // Calculate frequency score (0-1)
            const frequencyScore = Math.min(data.count / 5, 1.0);  // Normalize to 5 uses

            // Combined score: 60% frequency, 40% recency
            const matchScore = (frequencyScore * 0.6) + (recencyScore * 0.4);

            if (data.count >= 3) {
                reasons.push(`used ${data.count} times with this project`);
            } else if (data.count >= 2) {
                reasons.push('used multiple times with this project');
            }

            if (recencyScore > 0.7) {
                reasons.push('recently used');
            }

            patterns.push({
                accountKey,
                issueKey,
                projectKey,
                usageCount: data.count,
                matchScore,
                reasons
            });
        }

        // Sort by match score descending
        patterns.sort((a, b) => b.matchScore - a.matchScore);

        return patterns;
    }

    /**
     * Calculate keyword-based text similarity
     * Uses Jaccard similarity coefficient on extracted keywords
     */
    private keywordSimilarity(text1: string, text2: string): number {
        if (!text1 || !text2) return 0;

        const keywords1 = this.getCachedKeywords(text1);
        const keywords2 = this.getCachedKeywords(text2);

        if (keywords1.length === 0 || keywords2.length === 0) return 0;

        // Jaccard similarity: intersection / union
        const set1 = new Set(keywords1);
        const set2 = new Set(keywords2);

        const intersection = keywords1.filter(k => set2.has(k)).length;
        const union = new Set([...keywords1, ...keywords2]).size;

        return intersection / union;
    }

    /**
     * Get cached keywords or extract and cache them
     */
    private getCachedKeywords(text: string): string[] {
        const cacheKey = text.toLowerCase();

        if (this.keywordCache.has(cacheKey)) {
            return this.keywordCache.get(cacheKey)!;
        }

        const keywords = this.extractKeywords(cacheKey);

        // Limit cache size to prevent memory issues
        if (this.keywordCache.size > 1000) {
            const firstKey = this.keywordCache.keys().next().value;
            if (firstKey !== undefined) {
                this.keywordCache.delete(firstKey);
            }
        }

        this.keywordCache.set(cacheKey, keywords);
        return keywords;
    }

    /**
     * Extract meaningful keywords from text
     */
    private extractKeywords(text: string): string[] {
        return text
            .split(/\s+/)
            .map(word => word.replace(/[^a-z0-9]/g, ''))
            .filter(word => word.length > 2 && !STOP_WORDS.has(word));
    }

    /**
     * Generate a unique key for an assignment
     */
    private getAssignmentKey(assignment: WorkAssignment): string {
        if (assignment.type === 'bucket') {
            return `bucket:${assignment.bucket!.id}`;
        } else {
            return `jira:${assignment.jiraIssue!.key}`;
        }
    }

    /**
     * Clear the keyword cache (useful for testing or memory management)
     */
    clearCache(): void {
        this.keywordCache.clear();
    }
}
