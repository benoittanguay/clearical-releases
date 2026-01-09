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
 */
export class AIAccountService {
    /**
     * Select the best Tempo account for a Jira issue
     *
     * @param issue - The Jira issue requiring an account
     * @param availableAccounts - List of accounts available for this issue/project
     * @param context - Additional context (description, historical usage)
     * @returns Account selection with confidence and reasoning
     */
    async selectAccount(issue, availableAccounts, context) {
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
        // Case 3: Multiple accounts - use scoring logic
        console.log('[AIAccountService] Multiple accounts, analyzing...');
        const scores = availableAccounts.map(account => ({
            account,
            score: this.calculateAccountScore(account, issue, context),
            reason: this.explainAccountScore(account, issue, context)
        }));
        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);
        console.log('[AIAccountService] Account scores:');
        scores.forEach((s, idx) => {
            console.log(`  ${idx + 1}. ${s.account.name}: ${(s.score * 100).toFixed(1)}% - ${s.reason}`);
        });
        const best = scores[0];
        const secondBest = scores[1];
        // Only auto-select if there's a clear winner
        // Criteria: best score > 0.6 AND difference from second best > 0.2
        const scoreDifference = secondBest ? best.score - secondBest.score : 1.0;
        if (best.score > 0.6 && scoreDifference > 0.2) {
            console.log('[AIAccountService] Clear winner found:', best.account.name);
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
        // Ambiguous - let user choose
        console.log('[AIAccountService] No clear winner, user selection required');
        return {
            account: null,
            confidence: 0,
            reason: scoreDifference <= 0.2
                ? 'Multiple accounts have similar relevance, please select manually'
                : 'Low confidence in account match, please select manually',
            suggestions: scores.slice(0, 3).map(s => ({
                account: s.account,
                score: s.score,
                reason: s.reason
            }))
        };
    }
    /**
     * Calculate score for an account based on various factors
     */
    calculateAccountScore(account, issue, context) {
        let score = 0;
        // 1. Historical usage - strongest signal (50%)
        const historicalScore = this.calculateHistoricalScore(account.key, issue.projectKey, context.historicalAccounts);
        score += historicalScore * 0.5;
        // 2. Account name matches issue summary (25%)
        const keywordScore = this.keywordMatch(account.name, issue.summary);
        score += keywordScore * 0.25;
        // 3. Account name matches project name (15%)
        if (this.containsKeywords(account.name, issue.projectName)) {
            score += 0.15;
        }
        // 4. Account name matches description (10%)
        if (context.description) {
            const descScore = this.keywordMatch(account.name, context.description);
            score += descScore * 0.1;
        }
        return Math.min(score, 1.0);
    }
    /**
     * Calculate historical usage score
     * Heavily weight accounts that have been used with this project before
     */
    calculateHistoricalScore(accountKey, projectKey, historicalAccounts) {
        if (historicalAccounts.length === 0)
            return 0;
        // Filter to this project's issues
        const projectIssues = historicalAccounts.filter(h => h.issueKey.startsWith(projectKey + '-'));
        if (projectIssues.length === 0)
            return 0;
        // Count how many times this account was used with this project
        const accountUsage = projectIssues.filter(h => h.accountKey === accountKey).length;
        // Return ratio of usage
        return accountUsage / projectIssues.length;
    }
    /**
     * Calculate keyword match between two strings
     */
    keywordMatch(source, target) {
        if (!source || !target)
            return 0;
        const sourceWords = this.extractKeywords(source.toLowerCase());
        const targetWords = this.extractKeywords(target.toLowerCase());
        if (sourceWords.length === 0 || targetWords.length === 0)
            return 0;
        const matchCount = sourceWords.filter(w => targetWords.includes(w)).length;
        const maxWords = Math.max(sourceWords.length, targetWords.length);
        return matchCount / maxWords;
    }
    /**
     * Check if source contains any keywords from target
     */
    containsKeywords(source, target) {
        const sourceLower = source.toLowerCase();
        const targetWords = this.extractKeywords(target.toLowerCase());
        return targetWords.some(word => sourceLower.includes(word));
    }
    /**
     * Extract meaningful keywords from text
     */
    extractKeywords(text) {
        return text
            .split(/\s+/)
            .map(word => word.replace(/[^a-z0-9]/g, ''))
            .filter(word => word.length > 2 && !STOP_WORDS.has(word));
    }
    /**
     * Generate human-readable explanation for account score
     */
    explainAccountScore(account, issue, context) {
        const reasons = [];
        // Check historical usage
        const historicalScore = this.calculateHistoricalScore(account.key, issue.projectKey, context.historicalAccounts);
        if (historicalScore > 0.5) {
            reasons.push('frequently used for this project');
        }
        else if (historicalScore > 0.2) {
            reasons.push('occasionally used for this project');
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
