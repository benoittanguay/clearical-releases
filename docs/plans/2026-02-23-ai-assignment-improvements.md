# AI Assignment Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bucket/Jira AI assignment to prioritize Jira issues when configured, strengthen historical learning influence, and eliminate the "defaults to first bucket" bug.

**Architecture:** Three targeted changes to `electron/aiAssignmentService.ts` and a one-line plumbing change in `electron/main.ts` + `src/components/HistoryDetail.tsx`. The core AI service gains a `jiraEnabled` flag, improved keyword matching, historical pattern context for the AI prompt, and a minimum confidence threshold.

**Tech Stack:** TypeScript, Electron IPC, Supabase Edge Function (cloud AI proxy)

---

### Task 1: Add `jiraEnabled` flag to constructor and IPC plumbing

**Files:**
- Modify: `electron/aiAssignmentService.ts:87-93`
- Modify: `electron/main.ts:2479-2498`
- Modify: `src/components/HistoryDetail.tsx:645-662`
- Modify: `src/types/electron.d.ts:227` (the `suggestAssignment` type)

**Step 1: Update AIAssignmentService constructor to accept `jiraEnabled`**

In `electron/aiAssignmentService.ts`, change the constructor:

```typescript
constructor(
    private buckets: TimeBucket[] = [],
    private jiraIssues: LinkedJiraIssue[] = [],
    private historicalEntries: TimeEntry[] = [],
    private jiraEnabled: boolean = false
) {
    this.historicalMatcher = new HistoricalMatchingService();
}
```

**Step 2: Pass `jiraEnabled` from IPC handler**

In `electron/main.ts:2479-2498`, update the handler to accept and pass `jiraEnabled`:

```typescript
ipcMain.handle('suggest-assignment', requirePremium('AI Analysis', async (event, request: {
    context: ActivityContext;
    buckets: any[];
    jiraIssues: LinkedJiraIssue[];
    historicalEntries: any[];
    jiraEnabled?: boolean;
}) => {
    // ...
    const service = new AIAssignmentService(
        request.buckets,
        request.jiraIssues,
        request.historicalEntries,
        request.jiraEnabled ?? false
    );
```

**Step 3: Pass `jiraEnabled` from renderer**

In `src/components/HistoryDetail.tsx:645-662`, add `jiraEnabled` to the IPC call:

```typescript
const result = await window.electron?.ipcRenderer?.suggestAssignment({
    context: { /* unchanged */ },
    buckets: buckets,
    jiraIssues: jiraIssues,
    historicalEntries: entries.slice(0, 50),
    jiraEnabled: !!settings.jira?.enabled
});
```

**Step 4: Update TypeScript type**

In `src/types/electron.d.ts`, add `jiraEnabled?: boolean` to the suggestAssignment request type.

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add electron/aiAssignmentService.ts electron/main.ts src/components/HistoryDetail.tsx src/types/electron.d.ts
git commit -m "feat(assignment): add jiraEnabled flag to AI assignment service"
```

---

### Task 2: Fix keyword matching (token overlap ratio)

**Files:**
- Modify: `electron/aiAssignmentService.ts:403-415` (the `keywordMatch` method)

**Step 1: Change keywordMatch to use token overlap ratio**

Replace the current `keywordMatch` method with:

```typescript
/**
 * Calculate keyword match score between source and target text.
 * Uses token overlap ratio: what fraction of source keywords appear in target.
 * This avoids penalizing matches against long descriptions (the old Jaccard
 * approach divided by the union, making short bucket names score near-zero).
 */
private keywordMatch(source: string, target: string): number {
    if (!source || !target) return 0;

    const sourceWords = this.extractKeywords(source.toLowerCase());
    const targetWords = new Set(this.extractKeywords(target.toLowerCase()));

    if (sourceWords.length === 0 || targetWords.size === 0) return 0;

    const matchCount = sourceWords.filter(w => targetWords.has(w)).length;
    return matchCount / sourceWords.length;
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add electron/aiAssignmentService.ts
git commit -m "fix(assignment): use token overlap ratio instead of Jaccard for keyword matching"
```

---

### Task 3: Expand bucket scoring to include window titles and app names

**Files:**
- Modify: `electron/aiAssignmentService.ts:332-360` (`calculateBucketScore`)
- Modify: `electron/aiAssignmentService.ts:370-398` (`calculateJiraScore`)

**Step 1: Update `calculateBucketScore` to match against more context**

Replace the method with:

```typescript
/**
 * Calculate score for a bucket assignment (FALLBACK ONLY)
 * - 35% Historical usage pattern
 * - 30% Keyword matching bucket name vs description
 * - 10% Keyword matching bucket name vs window titles
 * - 25% Linked Jira issue relevance
 */
private calculateBucketScore(
    bucket: TimeBucket,
    context: ActivityContext,
    aiClassification: { selectedId: string | null; confidence: number; available: boolean }
): number {
    let score = 0;

    // 1. Historical usage pattern (35%)
    const historicalMatch = this.calculateHistoricalBucketMatch(bucket.id, context);
    score += historicalMatch * 0.35;

    // 2. Keyword matching in bucket name vs description (30%)
    const nameMatch = this.keywordMatch(bucket.name, context.description);
    score += nameMatch * 0.30;

    // 3. Keyword matching bucket name vs window titles + app names (10%)
    const contextText = [...context.windowTitles, ...context.appNames].join(' ');
    const contextMatch = this.keywordMatch(bucket.name, contextText);
    score += contextMatch * 0.10;

    // 4. Linked Jira issue relevance (25%)
    if (bucket.linkedIssue) {
        const issueMatch = this.keywordMatch(
            bucket.linkedIssue.summary,
            context.description
        );
        score += issueMatch * 0.25;
    }

    return Math.min(score, 1.0);
}
```

**Step 2: Update `calculateJiraScore` to match against window titles**

Replace the method with:

```typescript
/**
 * Calculate score for a Jira issue assignment (FALLBACK ONLY)
 * - 30% Historical usage pattern
 * - 25% Summary keyword match vs description
 * - 10% Summary keyword match vs window titles
 * - 20% Technology/domain match
 * - 15% Project affinity
 */
private calculateJiraScore(
    issue: LinkedJiraIssue,
    context: ActivityContext,
    aiClassification: { selectedId: string | null; confidence: number; available: boolean }
): number {
    let score = 0;

    // 1. Historical usage (30%)
    const historicalMatch = this.calculateHistoricalJiraMatch(issue.key, context);
    score += historicalMatch * 0.30;

    // 2. Summary keyword match vs description (25%)
    const summaryMatch = this.keywordMatch(issue.summary, context.description);
    score += summaryMatch * 0.25;

    // 3. Summary keyword match vs window titles (10%)
    const titleText = context.windowTitles.join(' ');
    const titleMatch = this.keywordMatch(issue.summary, titleText);
    score += titleMatch * 0.10;

    // 4. Technology/domain match (20%)
    const techMatch = this.technologyMatch(issue, context.detectedTechnologies);
    score += techMatch * 0.20;

    // 5. Project affinity (15%)
    const projectMatch = this.projectAffinityMatch(issue.projectKey);
    score += projectMatch * 0.15;

    // 6. Jira priority boost when Jira is enabled
    if (this.jiraEnabled) {
        score += 0.15;
    }

    return Math.min(score, 1.0);
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add electron/aiAssignmentService.ts
git commit -m "feat(assignment): expand scoring to include window titles, app names, and Jira boost"
```

---

### Task 4: Add minimum confidence threshold and recency tiebreaker

**Files:**
- Modify: `electron/aiAssignmentService.ts:100-184` (`suggestAssignment` method)

**Step 1: Add recency helper method**

Add this new method to the class (after `projectAffinityMatch`):

```typescript
/**
 * Get the most recent manual assignment timestamp for a given assignment key.
 * Used as tiebreaker when scores are equal.
 */
private getLastManualAssignmentTime(assignmentKey: string): number {
    for (const entry of this.historicalEntries) {
        if (entry.assignmentAutoSelected === true) continue;
        if (!entry.assignment) continue;

        const key = entry.assignment.type === 'bucket'
            ? `bucket:${entry.assignment.bucket?.id}`
            : `jira:${entry.assignment.jiraIssue?.key}`;

        if (key === assignmentKey) {
            return entry.startTime || 0;
        }
    }
    return 0;
}
```

**Step 2: Update `suggestAssignment` fallback path with threshold and tiebreaker**

In the fallback path of `suggestAssignment()`, change the sort and add threshold check. Replace lines 150-183 with:

```typescript
// Combine and sort by score, then by recency as tiebreaker
const allCandidates = [...bucketScores, ...jiraScores]
    .sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
        // Tiebreaker: prefer most recently manually assigned
        const aKey = a.assignment.type === 'bucket'
            ? `bucket:${a.assignment.bucket?.id}`
            : `jira:${a.assignment.jiraIssue?.key}`;
        const bKey = b.assignment.type === 'bucket'
            ? `bucket:${b.assignment.bucket?.id}`
            : `jira:${b.assignment.jiraIssue?.key}`;
        return this.getLastManualAssignmentTime(bKey) - this.getLastManualAssignmentTime(aKey);
    });

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

// Minimum confidence threshold: don't suggest low-confidence assignments
if (best.score < 0.15) {
    console.log('[AIAssignmentService] Best score too low:', (best.score * 100).toFixed(1) + '%, returning no suggestion');
    return {
        assignment: null,
        confidence: best.score,
        reason: 'No strong match found',
        alternatives: allCandidates.slice(0, 3).map(c => ({
            assignment: c.assignment,
            confidence: c.score,
            reason: c.reason
        }))
    };
}

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
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add electron/aiAssignmentService.ts
git commit -m "fix(assignment): add minimum confidence threshold and recency tiebreaker"
```

---

### Task 5: Feed historical patterns into AI prompt

**Files:**
- Modify: `electron/aiAssignmentService.ts:239-323` (`getAIClassification` method)

**Step 1: Add historical pattern context to AI classification**

Replace `getAIClassification` with the version that computes and injects historical patterns:

```typescript
private async getAIClassification(context: ActivityContext): Promise<{
    selectedId: string | null;
    confidence: number;
    available: boolean;
}> {
    try {
        // Build options list - Jira issues FIRST when enabled (AI prompt ordering matters)
        const options: Array<{ id: string; name: string }> = [];

        if (this.jiraEnabled) {
            // Add Jira issues first for priority
            for (const issue of this.jiraIssues) {
                options.push({
                    id: `jira:${issue.key}`,
                    name: `${issue.key}: ${issue.summary}`
                });
            }
            // Then buckets
            for (const bucket of this.buckets.filter(b => !b.isFolder)) {
                options.push({
                    id: `bucket:${bucket.id}`,
                    name: bucket.name
                });
            }
        } else {
            // No Jira: buckets first, then any Jira issues
            for (const bucket of this.buckets.filter(b => !b.isFolder)) {
                options.push({
                    id: `bucket:${bucket.id}`,
                    name: bucket.name
                });
            }
            for (const issue of this.jiraIssues) {
                options.push({
                    id: `jira:${issue.key}`,
                    name: `${issue.key}: ${issue.summary}`
                });
            }
        }

        if (options.length === 0) {
            console.log('[AIAssignmentService] No options available for AI classification');
            return { selectedId: null, confidence: 0, available: false };
        }

        // Build context string from activity metadata
        const contextParts: string[] = [];
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

        // Add calendar context if available
        if (context.currentCalendarEvent) {
            contextParts.push(`Current calendar event: ${context.currentCalendarEvent}`);
        }
        if (context.recentCalendarEvents && context.recentCalendarEvents.length > 0) {
            contextParts.push(`Recent events: ${context.recentCalendarEvents.join(', ')}`);
        }
        if (context.upcomingCalendarEvents && context.upcomingCalendarEvents.length > 0) {
            contextParts.push(`Upcoming events: ${context.upcomingCalendarEvents.join(', ')}`);
        }

        // Compute and include historical patterns
        if (this.historicalEntries.length > 0) {
            const similarEntries = this.historicalMatcher.findSimilarEntries(
                context,
                this.historicalEntries,
                { minScore: 0.1, maxResults: 20, requireAssignment: true }
            );
            const patterns = this.historicalMatcher.extractAssignmentPatterns(similarEntries);

            if (patterns.length > 0) {
                const patternDescriptions = patterns.slice(0, 5).map(p => {
                    // Resolve pattern key to readable name
                    const option = options.find(o => o.id === p.assignmentKey);
                    const name = option?.name || p.assignmentKey;
                    return `${name} (${p.usageCount} times, ${Math.round(p.matchScore * 100)}% match)`;
                });
                contextParts.push(`User history: Previously assigned similar work to: ${patternDescriptions.join('; ')}`);
            }
        }

        // Add Jira priority instruction
        if (this.jiraEnabled && this.jiraIssues.length > 0) {
            contextParts.push('Prefer Jira issues over generic buckets when a relevant Jira issue exists');
        }

        const contextStr = contextParts.join('. ');

        console.log('[AIAssignmentService] Calling AI classification with', options.length, 'options');
        console.log('[AIAssignmentService] Description:', context.description.substring(0, 100));

        // Call the Gemini classification endpoint
        const result = await aiService.classifyActivity(
            context.description,
            options,
            contextStr
        );

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

    } catch (error) {
        console.error('[AIAssignmentService] AI classification error:', error);
        return { selectedId: null, confidence: 0, available: false };
    }
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add electron/aiAssignmentService.ts
git commit -m "feat(assignment): feed historical patterns into AI prompt and prioritize Jira in ordering"
```

---

### Task 6: Final verification and commit

**Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run dev build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Manual smoke test**

Launch the app with `npm run dev:electron` and test:
1. Open a time entry in HistoryDetail
2. Trigger "Suggest Assignment"
3. Verify that with Jira enabled, Jira issues are favored over buckets
4. Verify that with no matching context, assignment returns null instead of first bucket
5. Check console logs for historical pattern context being sent to AI

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "feat(assignment): improve AI assignment with Jira priority, historical learning, and confidence threshold"
```
