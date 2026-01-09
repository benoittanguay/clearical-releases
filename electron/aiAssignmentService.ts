import { WorkAssignment, TimeBucket, LinkedJiraIssue, TimeEntry } from '../src/types/shared.js';

/**
 * Activity context for AI assignment suggestions
 */
export interface ActivityContext {
    description: string;
    appNames: string[];
    windowTitles: string[];
    detectedTechnologies: string[];
    detectedActivities: string[];
    duration: number;
    startTime: number;
}

/**
 * Assignment suggestion with confidence and reasoning
 */
export interface AssignmentSuggestion {
    assignment: WorkAssignment | null;
    confidence: number;  // 0-1
    reason: string;      // Human-readable explanation
    alternatives?: Array<{
        assignment: WorkAssignment;
        confidence: number;
        reason: string;
    }>;
}

/**
 * Technology keyword mappings for matching
 */
const TECH_KEYWORDS: Record<string, string[]> = {
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
const ACTIVITY_KEYWORDS: Record<string, string[]> = {
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
 */
export class AIAssignmentService {
    private readonly CONFIDENCE_THRESHOLD = 0.7;  // Only auto-assign if confidence >= 70%

    // Dependencies injected via constructor for testability
    constructor(
        private buckets: TimeBucket[] = [],
        private jiraIssues: LinkedJiraIssue[] = [],
        private historicalEntries: TimeEntry[] = []
    ) {}

    /**
     * Suggest the best assignment based on activity context
     */
    async suggestAssignment(context: ActivityContext): Promise<AssignmentSuggestion> {
        console.log('[AIAssignmentService] Analyzing context for assignment suggestion');
        console.log('[AIAssignmentService] Available buckets:', this.buckets.length);
        console.log('[AIAssignmentService] Available Jira issues:', this.jiraIssues.length);

        // Calculate scores for all candidates
        const bucketScores = this.buckets
            .filter(b => !b.isFolder)  // Only consider actual buckets, not folders
            .map(bucket => ({
                assignment: this.bucketToAssignment(bucket),
                score: this.calculateBucketScore(bucket, context),
                reason: this.explainBucketScore(bucket, context)
            }));

        const jiraScores = this.jiraIssues.map(issue => ({
            assignment: this.jiraToAssignment(issue),
            score: this.calculateJiraScore(issue, context),
            reason: this.explainJiraScore(issue, context)
        }));

        // Combine and sort by score
        const allCandidates = [...bucketScores, ...jiraScores]
            .sort((a, b) => b.score - a.score);

        console.log('[AIAssignmentService] Top 3 candidates:');
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

        // Only suggest if confidence meets threshold
        if (best.score >= this.CONFIDENCE_THRESHOLD) {
            console.log('[AIAssignmentService] Suggesting assignment with confidence:', (best.score * 100).toFixed(1) + '%');
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

        console.log('[AIAssignmentService] Best match below threshold:', (best.score * 100).toFixed(1) + '%');
        return {
            assignment: null,
            confidence: best.score,
            reason: `No confident match found (best: ${(best.score * 100).toFixed(0)}%)`,
            alternatives: allCandidates.slice(0, 3).map(c => ({
                assignment: c.assignment,
                confidence: c.score,
                reason: c.reason
            }))
        };
    }

    /**
     * Calculate score for a bucket assignment
     */
    private calculateBucketScore(bucket: TimeBucket, context: ActivityContext): number {
        let score = 0;

        // 1. Keyword matching in bucket name (40%)
        const nameMatch = this.keywordMatch(bucket.name, context.description);
        score += nameMatch * 0.4;

        // 2. Linked Jira issue relevance (30%)
        if (bucket.linkedIssue) {
            const issueMatch = this.keywordMatch(
                bucket.linkedIssue.summary,
                context.description
            );
            score += issueMatch * 0.3;
        }

        // 3. Historical usage pattern (30%)
        const historicalMatch = this.calculateHistoricalMatch(bucket.id, context);
        score += historicalMatch * 0.3;

        return Math.min(score, 1.0);
    }

    /**
     * Calculate score for a Jira issue assignment
     */
    private calculateJiraScore(issue: LinkedJiraIssue, context: ActivityContext): number {
        let score = 0;

        // 1. Summary keyword match (40%)
        const summaryMatch = this.keywordMatch(issue.summary, context.description);
        score += summaryMatch * 0.4;

        // 2. Technology/domain match (20%)
        const techMatch = this.technologyMatch(issue, context.detectedTechnologies);
        score += techMatch * 0.2;

        // 3. Historical usage (25%)
        const historicalMatch = this.calculateHistoricalJiraMatch(issue.key, context);
        score += historicalMatch * 0.25;

        // 4. Project affinity (15%) - prefer recently used projects
        const projectMatch = this.projectAffinityMatch(issue.projectKey);
        score += projectMatch * 0.15;

        return Math.min(score, 1.0);
    }

    /**
     * Calculate keyword match score between two text strings
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
     * Extract meaningful keywords from text
     */
    private extractKeywords(text: string): string[] {
        return text
            .split(/\s+/)
            .map(word => word.replace(/[^a-z0-9]/g, ''))
            .filter(word => word.length > 2 && !STOP_WORDS.has(word));
    }

    /**
     * Calculate technology match score
     */
    private technologyMatch(issue: LinkedJiraIssue, detectedTechnologies: string[]): number {
        if (detectedTechnologies.length === 0) return 0;

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
     * Calculate historical bucket usage match
     */
    private calculateHistoricalMatch(bucketId: string, context: ActivityContext): number {
        if (this.historicalEntries.length === 0) return 0;

        // Look for similar activities in the past
        const similarEntries = this.historicalEntries.filter(entry => {
            if (entry.assignment?.type !== 'bucket') return false;
            if (entry.assignment.bucket?.id !== bucketId) return false;

            // Must have description to compare
            if (!entry.description) return false;

            // Check for similar keywords
            const similarity = this.keywordMatch(entry.description, context.description);
            return similarity > 0.3;  // At least 30% keyword overlap
        });

        // More similar historical entries = higher score
        const recentCount = Math.min(this.historicalEntries.length, 20);  // Last 20 entries
        return Math.min(similarEntries.length / recentCount, 1.0);
    }

    /**
     * Calculate historical Jira issue usage match
     */
    private calculateHistoricalJiraMatch(issueKey: string, context: ActivityContext): number {
        if (this.historicalEntries.length === 0) return 0;

        const issueEntries = this.historicalEntries.filter(entry =>
            entry.assignment?.type === 'jira' &&
            entry.assignment.jiraIssue?.key === issueKey
        );

        // Boost score if this issue was used recently
        if (issueEntries.length > 0) {
            const recentCount = Math.min(this.historicalEntries.length, 20);
            return Math.min(issueEntries.length / recentCount * 1.5, 1.0);  // 1.5x multiplier
        }

        return 0;
    }

    /**
     * Calculate project affinity based on recent usage
     */
    private projectAffinityMatch(projectKey: string): number {
        if (this.historicalEntries.length === 0) return 0;

        const recentEntries = this.historicalEntries.slice(0, 10);  // Last 10 entries
        const projectEntries = recentEntries.filter(entry =>
            entry.assignment?.type === 'jira' &&
            entry.assignment.jiraIssue?.projectKey === projectKey
        );

        return projectEntries.length / Math.max(recentEntries.length, 1);
    }

    /**
     * Explain why a bucket was scored a certain way
     */
    private explainBucketScore(bucket: TimeBucket, context: ActivityContext): string {
        const reasons: string[] = [];

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

        const historicalMatch = this.calculateHistoricalMatch(bucket.id, context);
        if (historicalMatch > 0.2) {
            reasons.push(`frequently used for similar work`);
        }

        return reasons.length > 0
            ? reasons.join(', ')
            : 'no strong indicators';
    }

    /**
     * Explain why a Jira issue was scored a certain way
     */
    private explainJiraScore(issue: LinkedJiraIssue, context: ActivityContext): string {
        const reasons: string[] = [];

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

        const historicalMatch = this.calculateHistoricalJiraMatch(issue.key, context);
        if (historicalMatch > 0.2) {
            reasons.push(`recently used issue`);
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
    private bucketToAssignment(bucket: TimeBucket): WorkAssignment {
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
    private jiraToAssignment(issue: LinkedJiraIssue): WorkAssignment {
        return {
            type: 'jira',
            jiraIssue: issue
        };
    }
}
