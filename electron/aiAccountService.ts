import { LinkedJiraIssue, TimeEntry } from '../src/types/shared.js';
import { HistoricalMatchingService } from './historicalMatchingService.js';
import { fastVLMServer } from './fastvlm.js';

/**
 * Tempo Account structure
 */
export interface TempoAccount {
    key: string;
    name: string;
    id: string;
}

/**
 * Account selection result with confidence and reasoning
 */
export interface AccountSelection {
    account: TempoAccount | null;
    confidence: number;  // 0-1
    reason: string;      // Human-readable explanation
    suggestions?: Array<{
        account: TempoAccount;
        score: number;
        reason: string;
    }>;
}

/**
 * Historical account usage for learning patterns
 */
export interface HistoricalAccountUsage {
    issueKey: string;
    accountKey: string;
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
 * AI Account Service
 * Intelligently selects Tempo accounts based on Jira issue context and historical patterns
 * Enhanced with sophisticated historical learning from time entries
 */
export class AIAccountService {
    private readonly historicalMatcher: HistoricalMatchingService;

    constructor() {
        this.historicalMatcher = new HistoricalMatchingService();
    }

    /**
     * Select the best Tempo account for a Jira issue
     *
     * @param issue - The Jira issue requiring an account
     * @param availableAccounts - List of accounts available for this issue/project
     * @param context - Additional context (description, historical usage, full time entries)
     * @returns Account selection with confidence and reasoning
     */
    async selectAccount(
        issue: LinkedJiraIssue,
        availableAccounts: TempoAccount[],
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];  // NEW: Full entries for enhanced matching
        }
    ): Promise<AccountSelection> {
        console.log('[AIAccountService] Selecting account for issue:', issue.key);
        console.log('[AIAccountService] Available accounts:', availableAccounts.length);
        console.log('[AIAccountService] Historical usage records:', context.historicalAccounts.length);

        // Case 1: No accounts available
        if (availableAccounts.length === 0) {
            console.log('[AIAccountService] No accounts available');
            return {
                account: null,
                confidence: 0,
                reason: 'No accounts linked to this issue or project'
            };
        }

        // Case 2: Single account - auto-select with 100% confidence
        if (availableAccounts.length === 1) {
            console.log('[AIAccountService] Single account available, auto-selecting:', availableAccounts[0].name);
            return {
                account: availableAccounts[0],
                confidence: 1.0,
                reason: 'Only one account available for this project'
            };
        }

        // Case 3: Multiple accounts - PRIMARY: use AI, FALLBACK: use scoring
        console.log('[AIAccountService] Multiple accounts, analyzing...');

        // Get AI classification from Qwen3 reasoning model
        const aiClassification = await this.getAIAccountClassification(issue, availableAccounts, context);

        // PRIMARY PATH: If AI made a selection, use it directly
        if (aiClassification.available && aiClassification.selectedKey) {
            console.log('[AIAccountService] Using AI direct selection:', aiClassification.selectedKey);

            // Find the selected account
            const selectedAccount = availableAccounts.find(a => a.key === aiClassification.selectedKey);

            if (selectedAccount) {
                const reason = `AI selected (${Math.round(aiClassification.confidence * 100)}% confidence)`;
                console.log('[AIAccountService] AI selection successful:', reason);

                // Still calculate alternatives using scoring for context
                const alternatives = this.calculateAccountAlternatives(
                    availableAccounts,
                    issue,
                    context,
                    aiClassification.selectedKey
                );

                return {
                    account: selectedAccount,
                    confidence: aiClassification.confidence,
                    reason,
                    suggestions: alternatives.slice(0, 2)
                };
            }

            console.log('[AIAccountService] Warning: AI selected account not found, falling back to scoring');
        } else {
            console.log('[AIAccountService] AI unavailable or no selection, using fallback scoring');
        }

        // FALLBACK PATH: Use scoring system when AI is unavailable
        const scores = availableAccounts.map(account => ({
            account,
            score: this.calculateAccountScore(account, issue, context, aiClassification),
            reason: this.explainAccountScore(account, issue, context, aiClassification)
        }));

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        console.log('[AIAccountService] Fallback account scores:');
        scores.forEach((s, idx) => {
            console.log(`  ${idx + 1}. ${s.account.name}: ${(s.score * 100).toFixed(1)}% - ${s.reason}`);
        });

        const best = scores[0];

        console.log('[AIAccountService] Selecting fallback account:', best.account.name);
        return {
            account: best.account,
            confidence: best.score,
            reason: best.reason,
            suggestions: scores.slice(1, 3).map(s => ({
                account: s.account,
                score: s.score,
                reason: s.reason
            }))
        };
    }

    /**
     * Calculate alternative account suggestions using scoring system
     * Excludes the AI-selected account to provide different choices
     */
    private calculateAccountAlternatives(
        availableAccounts: TempoAccount[],
        issue: LinkedJiraIssue,
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];
        },
        excludeAccountKey: string
    ): Array<{ account: TempoAccount; score: number; reason: string }> {
        // Create a dummy aiClassification since we're in fallback mode
        const aiClassification = { selectedKey: null, confidence: 0, available: false };

        const scores = availableAccounts
            .filter(a => a.key !== excludeAccountKey)
            .map(account => ({
                account,
                score: this.calculateAccountScore(account, issue, context, aiClassification),
                reason: this.explainAccountScore(account, issue, context, aiClassification)
            }));

        return scores.sort((a, b) => b.score - a.score);
    }

    /**
     * Get AI classification from Qwen3 reasoning model
     * Returns the top choice with confidence
     */
    private async getAIAccountClassification(
        issue: LinkedJiraIssue,
        availableAccounts: TempoAccount[],
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];
        }
    ): Promise<{
        selectedKey: string | null;
        confidence: number;
        available: boolean;
    }> {
        try {
            // Build options list from available accounts
            const options = availableAccounts.map(account => ({
                id: account.key,
                name: account.name
            }));

            if (options.length === 0) {
                console.log('[AIAccountService] No options available for AI classification');
                return { selectedKey: null, confidence: 0, available: false };
            }

            // Build context string from issue metadata
            const contextParts: string[] = [];
            contextParts.push(`Project: ${issue.projectName} (${issue.projectKey})`);
            contextParts.push(`Issue Type: ${issue.issueType}`);
            contextParts.push(`Status: ${issue.status}`);

            const contextStr = contextParts.join('. ');

            // Build the text to classify: issue summary + description
            const textToClassify = context.description
                ? `${issue.summary}. ${context.description}`
                : issue.summary;

            console.log('[AIAccountService] Calling AI classification with', options.length, 'accounts');
            console.log('[AIAccountService] Issue:', issue.key, '-', issue.summary.substring(0, 80));

            // Call the Qwen3 classify endpoint
            const result = await fastVLMServer.classifyActivity(
                textToClassify,
                options,
                contextStr
            );

            if (result.success && result.selected_id) {
                console.log('[AIAccountService] AI selected:', result.selected_name, 'confidence:', result.confidence);
                return {
                    selectedKey: result.selected_id,
                    confidence: result.confidence || 0.8,
                    available: true
                };
            }

            console.log('[AIAccountService] AI classification failed or returned no selection');
            return { selectedKey: null, confidence: 0, available: false };

        } catch (error) {
            console.error('[AIAccountService] AI classification error:', error);
            return { selectedKey: null, confidence: 0, available: false };
        }
    }

    /**
     * Calculate score for an account based on various factors (FALLBACK ONLY)
     * Used only when AI is unavailable:
     * - 60% Historical usage pattern
     * - 25% Keyword match on issue summary
     * - 10% Project name match
     * - 5% Description match
     */
    private calculateAccountScore(
        account: TempoAccount,
        issue: LinkedJiraIssue,
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];
        },
        aiClassification: {
            selectedKey: string | null;
            confidence: number;
            available: boolean;
        }
    ): number {
        let score = 0;

        // 1. Historical usage - strong signal (60%)
        // Use enhanced matching if full entries available, otherwise fall back to basic
        const historicalScore = context.historicalEntries
            ? this.calculateEnhancedHistoricalScore(account.key, issue, context)
            : this.calculateHistoricalScore(account.key, issue.projectKey, context.historicalAccounts);
        score += historicalScore * 0.6;

        // 2. Account name matches issue summary (25%)
        const keywordScore = this.keywordMatch(account.name, issue.summary);
        score += keywordScore * 0.25;

        // 3. Account name matches project name (10%)
        if (this.containsKeywords(account.name, issue.projectName)) {
            score += 0.1;
        }

        // 4. Account name matches description (5%)
        if (context.description) {
            const descScore = this.keywordMatch(account.name, context.description);
            score += descScore * 0.05;
        }

        return Math.min(score, 1.0);
    }

    /**
     * Enhanced historical score calculation using full context
     * Considers work similarity, not just project/issue matching
     */
    private calculateEnhancedHistoricalScore(
        accountKey: string,
        issue: LinkedJiraIssue,
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];
        }
    ): number {
        if (!context.historicalEntries || context.historicalEntries.length === 0) {
            return this.calculateHistoricalScore(accountKey, issue.projectKey, context.historicalAccounts);
        }

        // Use the historical matching service to find patterns
        const patterns = this.historicalMatcher.extractAccountPatterns(
            issue.key,
            issue.projectKey,
            context.historicalEntries
        );

        // Find the pattern for this account
        const accountPattern = patterns.find(p => p.accountKey === accountKey);

        if (!accountPattern) return 0;

        return accountPattern.matchScore;
    }

    /**
     * Calculate historical usage score (basic version)
     * Heavily weight accounts that have been used with this project before
     */
    private calculateHistoricalScore(
        accountKey: string,
        projectKey: string,
        historicalAccounts: HistoricalAccountUsage[]
    ): number {
        if (historicalAccounts.length === 0) return 0;

        // Filter to this project's issues
        const projectIssues = historicalAccounts.filter(h =>
            h.issueKey.startsWith(projectKey + '-')
        );

        if (projectIssues.length === 0) return 0;

        // Count how many times this account was used with this project
        const accountUsage = projectIssues.filter(h => h.accountKey === accountKey).length;

        // Return ratio of usage
        return accountUsage / projectIssues.length;
    }

    /**
     * Calculate keyword match between two strings
     */
    private keywordMatch(source: string, target: string): number {
        if (!source || !target) return 0;

        const sourceWords = this.extractKeywords(source.toLowerCase());
        const targetWords = this.extractKeywords(target.toLowerCase());

        if (sourceWords.length === 0 || targetWords.length === 0) return 0;

        const matchCount = sourceWords.filter(w => targetWords.includes(w)).length;
        const maxWords = Math.max(sourceWords.length, targetWords.length);

        return matchCount / maxWords;
    }

    /**
     * Check if source contains any keywords from target
     */
    private containsKeywords(source: string, target: string): boolean {
        const sourceLower = source.toLowerCase();
        const targetWords = this.extractKeywords(target.toLowerCase());

        return targetWords.some(word => sourceLower.includes(word));
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
     * Generate human-readable explanation for account score (FALLBACK mode)
     */
    private explainAccountScore(
        account: TempoAccount,
        issue: LinkedJiraIssue,
        context: {
            description?: string;
            historicalAccounts: HistoricalAccountUsage[];
            historicalEntries?: TimeEntry[];
        },
        aiClassification: {
            selectedKey: string | null;
            confidence: number;
            available: boolean;
        }
    ): string {
        const reasons: string[] = [];

        // Check enhanced historical usage if available
        if (context.historicalEntries && context.historicalEntries.length > 0) {
            const patterns = this.historicalMatcher.extractAccountPatterns(
                issue.key,
                issue.projectKey,
                context.historicalEntries
            );

            const accountPattern = patterns.find(p => p.accountKey === account.key);
            if (accountPattern && accountPattern.matchScore > 0.3) {
                // Use the learned reasons from pattern matching
                if (accountPattern.reasons.length > 0) {
                    reasons.push(`learned from history: ${accountPattern.reasons[0]}`);
                }
            }
        } else {
            // Fall back to basic historical scoring
            const historicalScore = this.calculateHistoricalScore(
                account.key,
                issue.projectKey,
                context.historicalAccounts
            );

            if (historicalScore > 0.5) {
                reasons.push('frequently used for this project');
            } else if (historicalScore > 0.2) {
                reasons.push('occasionally used for this project');
            }
        }

        // Check keyword matches
        const keywordScore = this.keywordMatch(account.name, issue.summary);
        if (keywordScore > 0.4) {
            reasons.push('matches issue keywords');
        }

        if (this.containsKeywords(account.name, issue.projectName)) {
            reasons.push('matches project name');
        }

        if (context.description) {
            const descScore = this.keywordMatch(account.name, context.description);
            if (descScore > 0.3) {
                reasons.push('matches work description');
            }
        }

        return reasons.length > 0
            ? reasons.join(', ')
            : 'general match';
    }
}
