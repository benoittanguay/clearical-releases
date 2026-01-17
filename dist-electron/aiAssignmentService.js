import { HistoricalMatchingService } from './historicalMatchingService.js';
import { aiService } from './ai/aiService.js';
/**
 * Technology keyword mappings for matching
 */
const TECH_KEYWORDS = {
    'react': ['react', 'jsx', 'component', 'hook', 'useeffect', 'usestate', 'tsx'],
    'typescript': ['typescript', 'interface', 'type', 'generic', 'ts'],
    'javascript': ['javascript', 'js', 'node', 'npm', 'yarn'],
    'electron': ['electron', 'ipc', 'main process', 'renderer', 'preload'],
    'swift': ['swift', 'swiftui', 'appkit', 'foundation', 'vision framework'],
    'python': ['python', 'django', 'flask', 'pandas', 'numpy', 'pip'],
    'jira': ['jira', 'issue', 'ticket', 'sprint', 'backlog'],
    'tempo': ['tempo', 'timesheet', 'worklog', 'time tracking'],
    'git': ['git', 'github', 'commit', 'branch', 'merge', 'pull request'],
    'docker': ['docker', 'container', 'dockerfile', 'compose'],
    'api': ['api', 'rest', 'graphql', 'endpoint', 'http'],
};
/**
 * Activity type keyword mappings
 */
const ACTIVITY_KEYWORDS = {
    'development': ['coding', 'programming', 'implementation', 'function', 'class', 'code', 'developing'],
    'debugging': ['debug', 'error', 'bug', 'fix', 'troubleshoot', 'exception', 'stack trace'],
    'research': ['research', 'reading', 'documentation', 'learning', 'tutorial', 'docs'],
    'design': ['design', 'ui', 'ux', 'interface', 'mockup', 'wireframe', 'figma'],
    'testing': ['test', 'testing', 'qa', 'validation', 'spec', 'jest', 'cypress'],
    'meeting': ['meeting', 'call', 'discussion', 'standup', 'review', 'zoom'],
    'planning': ['planning', 'architecture', 'design document', 'requirements', 'spec'],
    'refactoring': ['refactor', 'refactoring', 'cleanup', 'restructure', 'optimize'],
};
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
 * AI Assignment Service
 * Analyzes activity context to suggest the best bucket or Jira issue assignment
 * Now enhanced with sophisticated historical learning
 */
export class AIAssignmentService {
    buckets;
    jiraIssues;
    historicalEntries;
    historicalMatcher;
    // Dependencies injected via constructor for testability
    constructor(buckets = [], jiraIssues = [], historicalEntries = []) {
        this.buckets = buckets;
        this.jiraIssues = jiraIssues;
        this.historicalEntries = historicalEntries;
        this.historicalMatcher = new HistoricalMatchingService();
    }
    /**
     * Suggest the best assignment based on activity context
     * PRIMARY: Uses Qwen3 reasoning model for direct selection
     * FALLBACK: Uses scoring system when AI is unavailable
     */
    async suggestAssignment(context) {
        console.log('[AIAssignmentService] Analyzing context for assignment suggestion');
        console.log('[AIAssignmentService] Available buckets:', this.buckets.length);
        console.log('[AIAssignmentService] Available Jira issues:', this.jiraIssues.length);
        // Get AI classification from Qwen3 reasoning model
        const aiClassification = await this.getAIClassification(context);
        // PRIMARY PATH: If AI made a selection, use it directly
        if (aiClassification.available && aiClassification.selectedId) {
            console.log('[AIAssignmentService] Using AI direct selection:', aiClassification.selectedId);
            // Find the selected assignment
            const assignment = this.findAssignmentById(aiClassification.selectedId);
            if (assignment) {
                const reason = `AI selected (${Math.round(aiClassification.confidence * 100)}% confidence)`;
                console.log('[AIAssignmentService] AI selection successful:', reason);
                // Still calculate alternatives using scoring for context
                const alternatives = this.calculateAlternatives(context, aiClassification);
                return {
                    assignment,
                    confidence: aiClassification.confidence,
                    reason,
                    alternatives: alternatives.slice(0, 3)
                };
            }
            console.log('[AIAssignmentService] Warning: AI selected ID not found, falling back to scoring');
        }
        else {
            console.log('[AIAssignmentService] AI unavailable or no selection, using fallback scoring');
        }
        // FALLBACK PATH: Use scoring system when AI is unavailable
        const bucketScores = this.buckets
            .filter(b => !b.isFolder) // Only consider actual buckets, not folders
            .map(bucket => ({
            assignment: this.bucketToAssignment(bucket),
            score: this.calculateBucketScore(bucket, context, aiClassification),
            reason: this.explainBucketScore(bucket, context, aiClassification)
        }));
        const jiraScores = this.jiraIssues.map(issue => ({
            assignment: this.jiraToAssignment(issue),
            score: this.calculateJiraScore(issue, context, aiClassification),
            reason: this.explainJiraScore(issue, context, aiClassification)
        }));
        // Combine and sort by score
        const allCandidates = [...bucketScores, ...jiraScores]
            .sort((a, b) => b.score - a.score);
        console.log('[AIAssignmentService] Top 3 fallback candidates:');
        allCandidates.slice(0, 3).forEach((candidate, idx) => {
            const name = candidate.assignment.type === 'bucket'
                ? candidate.assignment.bucket?.name
                : candidate.assignment.jiraIssue?.key;
            console.log(`  ${idx + 1}. ${name} (${candidate.assignment.type}): ${(candidate.score * 100).toFixed(1)}% - ${candidate.reason}`);
        });
        if (allCandidates.length === 0) {
            console.log('[AIAssignmentService] No assignments available');
            return {
                assignment: null,
                confidence: 0,
                reason: 'No assignments available'
            };
        }
        const best = allCandidates[0];
        console.log('[AIAssignmentService] Suggesting fallback assignment with confidence:', (best.score * 100).toFixed(1) + '%');
        return {
            assignment: best.assignment,
            confidence: best.score,
            reason: best.reason,
            alternatives: allCandidates.slice(1, 4).map(c => ({
                assignment: c.assignment,
                confidence: c.score,
                reason: c.reason
            }))
        };
    }
    /**
     * Find assignment by its ID (bucket:id or jira:key)
     */
    findAssignmentById(id) {
        if (id.startsWith('bucket:')) {
            const bucketId = id.replace('bucket:', '');
            const bucket = this.buckets.find(b => b.id === bucketId && !b.isFolder);
            return bucket ? this.bucketToAssignment(bucket) : null;
        }
        else if (id.startsWith('jira:')) {
            const issueKey = id.replace('jira:', '');
            const issue = this.jiraIssues.find(i => i.key === issueKey);
            return issue ? this.jiraToAssignment(issue) : null;
        }
        return null;
    }
    /**
     * Calculate alternative suggestions using scoring system
     * Excludes the AI-selected option to provide different choices
     */
    calculateAlternatives(context, aiClassification) {
        const bucketScores = this.buckets
            .filter(b => !b.isFolder && `bucket:${b.id}` !== aiClassification.selectedId)
            .map(bucket => ({
            assignment: this.bucketToAssignment(bucket),
            score: this.calculateBucketScore(bucket, context, aiClassification),
            reason: this.explainBucketScore(bucket, context, aiClassification)
        }));
        const jiraScores = this.jiraIssues
            .filter(i => `jira:${i.key}` !== aiClassification.selectedId)
            .map(issue => ({
            assignment: this.jiraToAssignment(issue),
            score: this.calculateJiraScore(issue, context, aiClassification),
            reason: this.explainJiraScore(issue, context, aiClassification)
        }));
        return [...bucketScores, ...jiraScores]
            .sort((a, b) => b.score - a.score)
            .map(c => ({
            assignment: c.assignment,
            confidence: c.score,
            reason: c.reason
        }));
    }
    /**
     * Get AI classification from Qwen3 reasoning model
     * Returns the top choice with confidence
     */
    async getAIClassification(context) {
        try {
            // Build options list from buckets and Jira issues
            const options = [];
            // Add buckets
            for (const bucket of this.buckets.filter(b => !b.isFolder)) {
                options.push({
                    id: `bucket:${bucket.id}`,
                    name: bucket.name
                });
            }
            // Add Jira issues
            for (const issue of this.jiraIssues) {
                options.push({
                    id: `jira:${issue.key}`,
                    name: `${issue.key}: ${issue.summary}`
                });
            }
            if (options.length === 0) {
                console.log('[AIAssignmentService] No options available for AI classification');
                return { selectedId: null, confidence: 0, available: false };
            }
            // Build context string from activity metadata
            const contextParts = [];
            if (context.appNames.length > 0) {
                contextParts.push(`Applications: ${context.appNames.join(', ')}`);
            }
            if (context.windowTitles.length > 0) {
                contextParts.push(`Windows: ${context.windowTitles.slice(0, 3).join(', ')}`);
            }
            if (context.detectedTechnologies.length > 0) {
                contextParts.push(`Technologies: ${context.detectedTechnologies.join(', ')}`);
            }
            if (context.detectedActivities.length > 0) {
                contextParts.push(`Activities: ${context.detectedActivities.join(', ')}`);
            }
            const contextStr = contextParts.join('. ');
            console.log('[AIAssignmentService] Calling AI classification with', options.length, 'options');
            console.log('[AIAssignmentService] Description:', context.description.substring(0, 100));
            // Call the Gemini classification endpoint
            const result = await aiService.classifyActivity(context.description, options, contextStr);
            if (result.success && result.selected_id) {
                console.log('[AIAssignmentService] AI selected:', result.selected_name, 'confidence:', result.confidence);
                return {
                    selectedId: result.selected_id,
                    confidence: result.confidence || 0.8,
                    available: true
                };
            }
            console.log('[AIAssignmentService] AI classification failed or returned no selection');
            return { selectedId: null, confidence: 0, available: false };
        }
        catch (error) {
            console.error('[AIAssignmentService] AI classification error:', error);
            return { selectedId: null, confidence: 0, available: false };
        }
    }
    /**
     * Calculate score for a bucket assignment (FALLBACK ONLY)
     * Used only when AI is unavailable:
     * - 60% Historical usage pattern
     * - 25% Keyword matching in bucket name
     * - 15% Linked Jira issue relevance
     */
    calculateBucketScore(bucket, context, aiClassification) {
        let score = 0;
        // 1. Historical usage pattern (60%) - strongest signal in fallback mode
        const historicalMatch = this.calculateHistoricalBucketMatch(bucket.id, context);
        score += historicalMatch * 0.6;
        // 2. Keyword matching in bucket name (25%)
        const nameMatch = this.keywordMatch(bucket.name, context.description);
        score += nameMatch * 0.25;
        // 3. Linked Jira issue relevance (15%)
        if (bucket.linkedIssue) {
            const issueMatch = this.keywordMatch(bucket.linkedIssue.summary, context.description);
            score += issueMatch * 0.15;
        }
        return Math.min(score, 1.0);
    }
    /**
     * Calculate score for a Jira issue assignment (FALLBACK ONLY)
     * Used only when AI is unavailable:
     * - 60% Historical usage pattern
     * - 20% Summary keyword match
     * - 10% Technology/domain match
     * - 10% Project affinity
     */
    calculateJiraScore(issue, context, aiClassification) {
        let score = 0;
        // 1. Historical usage (60%) - strongest signal in fallback mode
        const historicalMatch = this.calculateHistoricalJiraMatch(issue.key, context);
        score += historicalMatch * 0.6;
        // 2. Summary keyword match (20%)
        const summaryMatch = this.keywordMatch(issue.summary, context.description);
        score += summaryMatch * 0.2;
        // 3. Technology/domain match (10%)
        const techMatch = this.technologyMatch(issue, context.detectedTechnologies);
        score += techMatch * 0.1;
        // 4. Project affinity (10%) - prefer recently used projects
        const projectMatch = this.projectAffinityMatch(issue.projectKey);
        score += projectMatch * 0.1;
        return Math.min(score, 1.0);
    }
    /**
     * Calculate keyword match score between two text strings
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
     * Extract meaningful keywords from text
     */
    extractKeywords(text) {
        return text
            .split(/\s+/)
            .map(word => word.replace(/[^a-z0-9]/g, ''))
            .filter(word => word.length > 2 && !STOP_WORDS.has(word));
    }
    /**
     * Calculate technology match score
     */
    technologyMatch(issue, detectedTechnologies) {
        if (detectedTechnologies.length === 0)
            return 0;
        const issueLower = (issue.summary + ' ' + issue.projectName).toLowerCase();
        let matches = 0;
        for (const tech of detectedTechnologies) {
            const techLower = tech.toLowerCase();
            const keywords = TECH_KEYWORDS[techLower] || [techLower];
            if (keywords.some(keyword => issueLower.includes(keyword))) {
                matches++;
            }
        }
        return matches / detectedTechnologies.length;
    }
    /**
     * Calculate enhanced historical bucket usage match
     * Uses sophisticated similarity matching across multiple factors
     */
    calculateHistoricalBucketMatch(bucketId, context) {
        if (this.historicalEntries.length === 0)
            return 0;
        // Find similar historical entries using the enhanced matching service
        const similarEntries = this.historicalMatcher.findSimilarEntries(context, this.historicalEntries, {
            minScore: 0.05, // Very low threshold to catch all potential matches
            maxResults: 20,
            requireAssignment: true
        });
        // Filter to entries that used this specific bucket
        const bucketEntries = similarEntries.filter(match => match.entry.assignment?.type === 'bucket' &&
            match.entry.assignment.bucket?.id === bucketId);
        if (bucketEntries.length === 0)
            return 0;
        // Calculate weighted score based on similarity and frequency
        // Higher similarity matches count more
        const totalWeight = bucketEntries.reduce((sum, match) => sum + match.score, 0);
        const avgScore = totalWeight / bucketEntries.length;
        // Frequency boost: more uses = higher confidence
        const frequencyBoost = Math.min(bucketEntries.length / 10, 0.3); // Max 30% boost
        return Math.min(avgScore + frequencyBoost, 1.0);
    }
    /**
     * Calculate enhanced historical Jira issue usage match
     * Uses sophisticated similarity matching across multiple factors
     */
    calculateHistoricalJiraMatch(issueKey, context) {
        if (this.historicalEntries.length === 0)
            return 0;
        // Find similar historical entries using the enhanced matching service
        const similarEntries = this.historicalMatcher.findSimilarEntries(context, this.historicalEntries, {
            minScore: 0.05, // Very low threshold to catch all potential matches
            maxResults: 20,
            requireAssignment: true
        });
        // Filter to entries that used this specific issue
        const issueEntries = similarEntries.filter(match => match.entry.assignment?.type === 'jira' &&
            match.entry.assignment.jiraIssue?.key === issueKey);
        if (issueEntries.length === 0)
            return 0;
        // Calculate weighted score based on similarity and frequency
        const totalWeight = issueEntries.reduce((sum, match) => sum + match.score, 0);
        const avgScore = totalWeight / issueEntries.length;
        // Frequency boost: more uses = higher confidence
        const frequencyBoost = Math.min(issueEntries.length / 8, 0.3); // Max 30% boost
        return Math.min(avgScore + frequencyBoost, 1.0);
    }
    /**
     * Calculate project affinity based on recent usage
     */
    projectAffinityMatch(projectKey) {
        if (this.historicalEntries.length === 0)
            return 0;
        const recentEntries = this.historicalEntries.slice(0, 10); // Last 10 entries
        const projectEntries = recentEntries.filter(entry => entry.assignment?.type === 'jira' &&
            entry.assignment.jiraIssue?.projectKey === projectKey);
        return projectEntries.length / Math.max(recentEntries.length, 1);
    }
    /**
     * Explain why a bucket was scored a certain way (FALLBACK mode)
     */
    explainBucketScore(bucket, context, aiClassification) {
        const reasons = [];
        // Enhanced historical matching with detailed reasons
        const historicalMatch = this.calculateHistoricalBucketMatch(bucket.id, context);
        if (historicalMatch > 0.4) {
            // Get detailed similarity info from matcher
            const similarEntries = this.historicalMatcher.findSimilarEntries(context, this.historicalEntries, { minScore: 0.05, maxResults: 5, requireAssignment: true });
            const bucketEntries = similarEntries.filter(match => match.entry.assignment?.type === 'bucket' &&
                match.entry.assignment.bucket?.id === bucket.id);
            if (bucketEntries.length > 0 && bucketEntries[0].reasons.length > 0) {
                const topReason = bucketEntries[0].reasons[0];
                reasons.push(`learned from history: ${topReason}`);
            }
            else {
                reasons.push(`frequently used for similar work`);
            }
        }
        else if (historicalMatch > 0.2) {
            reasons.push(`sometimes used for similar work`);
        }
        const nameMatch = this.keywordMatch(bucket.name, context.description);
        if (nameMatch > 0.5) {
            reasons.push(`matches bucket name keywords`);
        }
        if (bucket.linkedIssue) {
            const issueMatch = this.keywordMatch(bucket.linkedIssue.summary, context.description);
            if (issueMatch > 0.3) {
                reasons.push(`similar to linked Jira issue ${bucket.linkedIssue.key}`);
            }
        }
        return reasons.length > 0
            ? reasons.join(', ')
            : 'no strong indicators';
    }
    /**
     * Explain why a Jira issue was scored a certain way (FALLBACK mode)
     */
    explainJiraScore(issue, context, aiClassification) {
        const reasons = [];
        // Enhanced historical matching with detailed reasons
        const historicalMatch = this.calculateHistoricalJiraMatch(issue.key, context);
        if (historicalMatch > 0.4) {
            // Get detailed similarity info from matcher
            const similarEntries = this.historicalMatcher.findSimilarEntries(context, this.historicalEntries, { minScore: 0.05, maxResults: 5, requireAssignment: true });
            const issueEntries = similarEntries.filter(match => match.entry.assignment?.type === 'jira' &&
                match.entry.assignment.jiraIssue?.key === issue.key);
            if (issueEntries.length > 0 && issueEntries[0].reasons.length > 0) {
                const topReason = issueEntries[0].reasons[0];
                reasons.push(`learned from history: ${topReason}`);
            }
            else {
                reasons.push(`frequently used for this type of work`);
            }
        }
        else if (historicalMatch > 0.2) {
            reasons.push(`used before for similar work`);
        }
        const summaryMatch = this.keywordMatch(issue.summary, context.description);
        if (summaryMatch > 0.4) {
            reasons.push(`high keyword match with issue summary`);
        }
        if (context.detectedTechnologies.length > 0) {
            const techMatch = this.technologyMatch(issue, context.detectedTechnologies);
            if (techMatch > 0.3) {
                reasons.push(`matches detected technologies`);
            }
        }
        const projectMatch = this.projectAffinityMatch(issue.projectKey);
        if (projectMatch > 0.3) {
            reasons.push(`active project`);
        }
        return reasons.length > 0
            ? reasons.join(', ')
            : 'general match';
    }
    /**
     * Convert bucket to WorkAssignment
     */
    bucketToAssignment(bucket) {
        return {
            type: 'bucket',
            bucket: {
                id: bucket.id,
                name: bucket.name,
                color: bucket.color
            }
        };
    }
    /**
     * Convert Jira issue to WorkAssignment
     */
    jiraToAssignment(issue) {
        return {
            type: 'jira',
            jiraIssue: issue
        };
    }
}
