# AI Assignment Improvements Design

## Problem Statement

The bucket/Jira issue AI assignment has three issues:
1. **Defaults to first bucket**: When AI classification fails, fallback scoring produces near-zero scores for all options (Jaccard similarity on short bucket names vs long descriptions). The first bucket in array order wins.
2. **Jira not prioritized**: When Jira integration is configured, Jira issues should be preferred over plain buckets, but currently they compete equally.
3. **Weak historical learning**: User's manual selections only influence 30-35% of fallback scoring, and are not sent to the AI prompt at all.

## Changes

### 1. Jira Prioritization

**In `aiAssignmentService.ts`:**
- Add `jiraEnabled` flag to constructor (passed from caller)
- When `jiraEnabled`, add +0.15 scoring boost to all Jira issue scores in fallback path
- In `getAIClassification()`, list Jira issues before buckets in the options array
- Append "Prefer Jira issues over generic buckets when a relevant Jira issue exists" to the context string sent to the AI

### 2. Historical Patterns in AI Prompt

**In `aiAssignmentService.ts` `getAIClassification()`:**
- Before calling `classifyActivity()`, compute top historical patterns using `HistoricalMatchingService.findSimilarEntries()` + `extractAssignmentPatterns()`
- Include top 5 patterns in the context string, e.g.: `"User history: Previously assigned similar work to PROJ-123 'Fix login bug' (5 times, 87% match), 'Development' bucket (2 times, 45% match)"`
- Resolve pattern keys back to option names for readability

### 3. Fix "Defaults to First" Problem

**Minimum confidence threshold:**
- In `suggestAssignment()`, if best fallback score < 0.15, return `{ assignment: null, confidence: 0, reason: 'No strong match found' }`

**Improve keyword matching:**
- Change `keywordMatch()` to use token overlap ratio: `matchCount / sourceWords.length` (how many source keywords appear in target) instead of `matchCount / max(source, target)` which punishes long descriptions
- In `calculateBucketScore()`, also match bucket name against `context.windowTitles` and `context.appNames` (not just description)
- In `calculateJiraScore()`, also match issue summary against window titles

**Tiebreaker:**
- When sorting candidates with equal scores, prefer the one with more recent historical usage (most recently assigned by user wins)

## Files Modified

- `electron/aiAssignmentService.ts` — all three changes
- `electron/historicalMatchingService.ts` — no changes needed (already has `extractAssignmentPatterns`)
- IPC handler that constructs `AIAssignmentService` — pass `jiraEnabled` flag

## Out of Scope

- Changes to the Supabase edge function / cloud prompt
- UI changes
- Changes to `assignmentAutoSelected` flag logic
