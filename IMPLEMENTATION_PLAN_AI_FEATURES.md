# AI Features Implementation Plan - TimePortal

**Version:** 1.0
**Date:** January 8, 2026
**Author:** Claude Code

---

## Executive Summary

This document outlines the implementation plan for three interconnected AI-powered features in TimePortal:

1. **Automatic Description Generation** - AI-generated activity summaries from screenshot analysis
2. **AI Auto-Selection of Bucket/Jira Task** - Smart assignment matching based on context
3. **AI Auto-Selection of Tempo Account** - Intelligent account selection for Jira issues
4. **Account Display in Activity Details** - UI enhancement for account visibility

These features leverage the existing Apple Vision Framework infrastructure and introduce new AI-based decision-making capabilities to reduce manual data entry and improve time tracking accuracy.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Current System Analysis](#current-system-analysis)
3. [Feature 1: Automatic Description Generation](#feature-1-automatic-description-generation)
4. [Feature 2: AI Auto-Selection of Best Bucket/Jira Task](#feature-2-ai-auto-selection-of-best-bucketjira-task)
5. [Feature 3: AI Auto-Selection of Tempo Account](#feature-3-ai-auto-selection-of-tempo-account)
6. [Feature 4: Account Selection in Activity Details UI](#feature-4-account-selection-in-activity-details-ui)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Implementation Phases](#implementation-phases)
9. [API Contracts](#api-contracts)
10. [UI/UX Considerations](#ui-ux-considerations)
11. [Edge Cases and Fallbacks](#edge-cases-and-fallbacks)
12. [Testing Strategy](#testing-strategy)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        TimePortal App                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐         ┌──────────────────┐             │
│  │  React Frontend  │◄────────┤  Storage Context │             │
│  │  (HistoryDetail) │         │   (TimeEntry)    │             │
│  └────────┬─────────┘         └──────────────────┘             │
│           │                                                      │
│           │ IPC Calls                                           │
│           ▼                                                      │
│  ┌──────────────────────────────────────────────────────┐      │
│  │           Electron Main Process                       │      │
│  │  ┌────────────────────────────────────────────────┐  │      │
│  │  │  AI Service Layer (New)                        │  │      │
│  │  │  - Description Generator                       │  │      │
│  │  │  - Assignment Matcher                          │  │      │
│  │  │  - Account Selector                            │  │      │
│  │  └────────────────────────────────────────────────┘  │      │
│  │                                                        │      │
│  │  ┌────────────────────────────────────────────────┐  │      │
│  │  │  Existing AI Infrastructure                    │  │      │
│  │  │  - Screenshot Analysis (Vision Framework)      │  │      │
│  │  │  - Activity Summary Generation                 │  │      │
│  │  └────────────────────────────────────────────────┘  │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐      │
│  │           Swift Helper Process                        │      │
│  │  - Vision Framework (Text Recognition)               │      │
│  │  - Object Classification                             │      │
│  │  - Natural Language Description Generation           │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **HistoryDetail Component** - Main UI for viewing/editing time entries
2. **StorageContext** - State management for time entries and assignments
3. **SettingsContext** - Configuration for Jira and Tempo integrations
4. **AssignmentPicker** - UI component for selecting buckets/Jira issues
5. **TempoValidationModal** - Modal for confirming Tempo time logs
6. **Swift Screenshot Analyzer** - Apple Vision Framework integration for on-device AI
7. **IPC Handlers** - Electron main process handlers for AI operations
8. **JiraService** - API client for Jira Cloud
9. **TempoService** - API client for Tempo timesheets

---

## Current System Analysis

### Screenshot Analysis Flow (Existing)

```
User Activity Captured
    ↓
Screenshot Taken (electron/main.ts)
    ↓
Stored Encrypted (screenshots directory)
    ↓
analyze-screenshot IPC Handler Called
    ↓
Swift Helper Invoked (native/screenshot-analyzer/main.swift)
    ↓
Vision Framework Processing:
    - Text Recognition (VNRecognizeTextRequest)
    - Object Classification (VNClassifyImageRequest)
    ↓
Natural Language Description Generated
    ↓
Response Returned to Renderer
    ↓
Stored in WindowActivity.screenshotDescriptions[path]
```

### Current Data Models

**TimeEntry:**
```typescript
interface TimeEntry {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
    assignment?: WorkAssignment;      // Unified assignment model
    description?: string;             // Manual description
    windowActivity?: WindowActivity[];
}
```

**WindowActivity:**
```typescript
interface WindowActivity {
    appName: string;
    windowTitle: string;
    timestamp: number;
    duration: number;
    screenshotPaths?: string[];
    screenshotDescriptions?: { [path: string]: string }; // AI-generated per screenshot
}
```

**WorkAssignment:**
```typescript
interface WorkAssignment {
    type: 'bucket' | 'jira';
    bucket?: {
        id: string;
        name: string;
        color: string;
    };
    jiraIssue?: LinkedJiraIssue;
}
```

### Current Description Generation Flow

Currently, description generation is **manual** via the "Generate Summary" button in `HistoryDetail.tsx`:

1. User clicks "Generate Summary" button
2. Component collects context:
   - Screenshot descriptions (from AI analysis)
   - Window titles
   - App names
   - Duration and time range
3. Calls `generate-activity-summary` IPC handler
4. Main process invokes `generateTextBasedSummary` (heuristic-based, not LLM)
5. Description populated in textarea
6. Auto-saved after 500ms debounce

**Key Insight:** The system already has AI screenshot analysis and a summary generation mechanism. We need to make it **automatic** rather than manual.

---

## Feature 1: Automatic Description Generation

### Objective

Automatically generate comprehensive descriptions for time entries once all screenshots have been analyzed, eliminating the need for manual "Generate" button clicks while maintaining the button as a fallback for regeneration.

### Design Decisions

**Trigger Point:** After the last screenshot for an entry is analyzed
**Approach:** Event-driven automatic generation with manual override
**Storage:** Description stored in `TimeEntry.description`
**User Control:** "Generate" button remains for manual regeneration

### Data Flow

```
Screenshot Analysis Complete Event
    ↓
Check: All screenshots analyzed?
    ↓ (Yes)
Check: Description already exists?
    ↓ (No or user preference to auto-update)
Aggregate Screenshot Analysis Data:
    - All screenshotDescriptions
    - Window titles from activities
    - App names
    - Temporal context (duration, time range)
    ↓
Call generate-activity-summary IPC Handler
    ↓
Main Process: Enhanced Summary Generation
    - Text-based heuristics (current)
    - Pattern matching for technologies
    - Activity type detection
    - Contextual insights from window titles
    ↓
Return Generated Description
    ↓
Update TimeEntry.description via StorageContext
    ↓
UI Updates Automatically (React state)
```

### Implementation Details

#### 1. Detection of "All Screenshots Analyzed"

**Location:** `src/components/HistoryDetail.tsx`

**Current State:** Component already tracks screenshot stats:
```typescript
const screenshotStats = useMemo(() => {
    // ... calculates total vs analyzed screenshots
    return { total: totalScreenshots, analyzed: analyzedScreenshots };
}, [entry.windowActivity]);
```

**Enhancement:** Add effect to trigger auto-generation:

```typescript
// Auto-generate description when all screenshots are analyzed
useEffect(() => {
    if (!entry.description &&
        screenshotStats.total > 0 &&
        screenshotStats.analyzed === screenshotStats.total &&
        !isGeneratingSummary) {
        // All screenshots analyzed and no description yet
        handleGenerateSummary();
    }
}, [screenshotStats, entry.description]);
```

**Edge Cases:**
- Only trigger if description is empty (avoid overwriting manual edits)
- Don't trigger during active generation
- Handle entries with no screenshots (skip auto-generation)

#### 2. Enhanced Summary Generation

**Location:** `electron/main.ts` - `generateTextBasedSummary` function

**Current Capabilities:**
- Duration formatting
- Activity detection (coding, debugging, research, design, testing)
- Technology detection (React, TypeScript, Electron, etc.)
- Heuristic-based text analysis

**Enhancements Needed:**
1. **Screenshot-specific insights:** Better utilization of Vision Framework data
2. **Temporal patterns:** Recognize context switches and focus periods
3. **Confidence scoring:** Indicate certainty of detected activities
4. **Structured output:** Consistent format for easy parsing

**Enhanced Prompt Strategy:**

```
CONTEXT:
- Duration: {duration} ({formatted_time})
- Time Range: {start_time} - {end_time}
- Apps Used: {unique_apps}
- Window Count: {activity_count}

SCREENSHOT ANALYSIS:
{screenshot_descriptions_aggregated}

DETECTED TECHNOLOGIES:
{tech_list}

DETECTED ACTIVITIES:
{activity_list}

GENERATE:
A concise, professional summary of this work session in 2-3 sentences.
Focus on WHAT was done, not just WHERE (app names).
Prioritize specific insights from screenshot analysis over generic app usage.
```

**Example Output:**
```
"Spent 1 hour and 23 minutes on software development and debugging.
Technologies involved included React, TypeScript, and Electron.
The session focused on implementation work and bug fixing, with multiple
code editor windows active showing component refactoring."
```

#### 3. State Management Updates

**Location:** `src/context/StorageContext.tsx`

**No changes required** - the existing `updateEntry` function already handles description updates.

**Verification:**
```typescript
updateEntry(id: string, updates: Partial<TimeEntry>) {
    setEntries(entries.map(entry =>
        entry.id === id ? { ...entry, ...updates } : entry
    ));
}
```

#### 4. UI Indicator for Auto-Generated Descriptions

**Enhancement:** Add visual indicator when description is auto-generated:

```typescript
<div className="flex items-center gap-2">
    <label className="text-xs text-gray-400 uppercase font-semibold">Description</label>
    {entry.description && !description.startsWith('[Manual]') && (
        <span className="text-xs text-purple-400 flex items-center gap-1">
            <svg>...</svg>
            AI Generated
        </span>
    )}
</div>
```

### API Contract

**IPC Handler:** `generate-activity-summary`

**Request:**
```typescript
interface GenerateActivitySummaryRequest {
    screenshotDescriptions: string[];
    windowTitles: string[];
    appNames: string[];
    duration: number;
    startTime: number;
    endTime: number;
}
```

**Response:**
```typescript
interface GenerateActivitySummaryResponse {
    success: boolean;
    summary: string | null;
    error?: string;
    metadata?: {
        detectedActivities: string[];
        detectedTechnologies: string[];
        confidence: number;
    };
}
```

### Testing Checklist

- [ ] Auto-generation triggers when last screenshot analyzed
- [ ] Doesn't overwrite existing manual descriptions
- [ ] "Generate" button still works for manual regeneration
- [ ] Works with entries that have no screenshots
- [ ] Works with entries that have partial screenshot analysis
- [ ] Handles Vision Framework failures gracefully
- [ ] Description updates trigger auto-save
- [ ] UI updates reactively when description changes

---

## Feature 2: AI Auto-Selection of Best Bucket/Jira Task

### Objective

Automatically analyze the generated description and activity context to intelligently select the most appropriate bucket or Jira issue assignment, reducing manual categorization work.

### Design Decisions

**Trigger Point:** After automatic description generation completes
**Approach:** Semantic matching using keyword analysis and historical patterns
**User Control:** Assignment can be overridden manually via AssignmentPicker
**Confidence Threshold:** Only auto-assign if confidence > 70%

### Matching Algorithm

#### Strategy 1: Keyword-Based Matching

**Bucket Matching:**
```
For each available bucket:
    1. Extract keywords from bucket name
    2. Extract keywords from bucket's linked Jira issue (if any)
    3. Calculate similarity score with:
        - Generated description
        - App names used
        - Window titles
        - Detected technologies
    4. Return highest scoring bucket if score > threshold
```

**Jira Issue Matching:**
```
For each available Jira issue:
    1. Extract keywords from:
        - Issue key (project prefix)
        - Issue summary
        - Issue type
        - Project name
    2. Calculate similarity score with activity context
    3. Prioritize:
        - Recently used issues (Jira cache)
        - Issues in selected projects
        - Issues with matching technologies in summary
    4. Return highest scoring issue if score > threshold
```

#### Strategy 2: Historical Pattern Learning

**Concept:** Learn from user's past assignment choices

```
Historical Pattern Analysis:
    1. Build activity signature from:
        - Primary app used
        - Detected technologies
        - Activity type (coding, debugging, research)
        - Time of day
    2. Query past TimeEntry records with assignments
    3. Find entries with similar signatures
    4. Return most frequently used assignment for this pattern
```

### Implementation Details

#### 1. New AI Service Module

**Location:** `electron/aiAssignmentService.ts` (NEW FILE)

**Purpose:** Centralize assignment matching logic

**Structure:**
```typescript
export class AIAssignmentService {
    /**
     * Analyze activity context and suggest best assignment
     */
    async suggestAssignment(context: ActivityContext): Promise<AssignmentSuggestion> {
        // 1. Get available assignments
        const buckets = await this.getAvailableBuckets();
        const jiraIssues = await this.getAvailableJiraIssues();

        // 2. Calculate scores for each candidate
        const bucketScores = buckets.map(b => ({
            assignment: this.bucketToAssignment(b),
            score: this.calculateBucketScore(b, context),
            reason: this.explainBucketScore(b, context)
        }));

        const jiraScores = jiraIssues.map(j => ({
            assignment: this.jiraToAssignment(j),
            score: this.calculateJiraScore(j, context),
            reason: this.explainJiraScore(j, context)
        }));

        // 3. Combine and rank
        const allCandidates = [...bucketScores, ...jiraScores]
            .sort((a, b) => b.score - a.score);

        // 4. Return best match if confidence is sufficient
        const best = allCandidates[0];
        if (best.score >= this.CONFIDENCE_THRESHOLD) {
            return {
                assignment: best.assignment,
                confidence: best.score,
                reason: best.reason,
                alternatives: allCandidates.slice(1, 3)
            };
        }

        return { assignment: null, confidence: 0, reason: 'No confident match' };
    }

    private calculateBucketScore(bucket: TimeBucket, context: ActivityContext): number {
        let score = 0;

        // Keyword matching in bucket name
        score += this.keywordMatch(bucket.name, context.description) * 0.4;

        // Linked Jira issue relevance
        if (bucket.linkedIssue) {
            score += this.keywordMatch(bucket.linkedIssue.summary, context.description) * 0.3;
        }

        // Historical usage pattern
        score += this.historicalMatch(bucket.id, context) * 0.3;

        return Math.min(score, 1.0);
    }

    private calculateJiraScore(issue: JiraIssue, context: ActivityContext): number {
        let score = 0;

        // Project match (high weight)
        if (context.detectedProjects.includes(issue.fields.project.key)) {
            score += 0.3;
        }

        // Summary keyword match
        score += this.keywordMatch(issue.fields.summary, context.description) * 0.4;

        // Technology/domain match
        score += this.technologyMatch(issue, context.detectedTechnologies) * 0.2;

        // Recency (prefer recently used issues)
        score += this.recencyScore(issue.key) * 0.1;

        return Math.min(score, 1.0);
    }

    private keywordMatch(source: string, target: string): number {
        const sourceWords = this.extractKeywords(source.toLowerCase());
        const targetWords = this.extractKeywords(target.toLowerCase());

        const matchCount = sourceWords.filter(w => targetWords.includes(w)).length;
        const maxWords = Math.max(sourceWords.length, targetWords.length);

        return maxWords > 0 ? matchCount / maxWords : 0;
    }

    private extractKeywords(text: string): string[] {
        // Remove common words
        const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);

        return text
            .split(/\s+/)
            .filter(word => word.length > 2 && !stopWords.has(word));
    }
}
```

#### 2. Context Aggregation

**Location:** `electron/aiAssignmentService.ts`

**Activity Context Structure:**
```typescript
interface ActivityContext {
    // From auto-generated description
    description: string;

    // From activity data
    appNames: string[];
    windowTitles: string[];

    // From AI analysis
    detectedTechnologies: string[];
    detectedActivities: string[];

    // From Jira context (if available)
    detectedProjects: string[];  // e.g., ["BEEM", "DES"]

    // Temporal
    duration: number;
    startTime: number;
    dayOfWeek: number;
    hourOfDay: number;

    // Historical
    previousAssignments: WorkAssignment[];  // Last 5 assignments
}
```

#### 3. Integration Point

**Location:** `src/components/HistoryDetail.tsx`

**Flow:**
```typescript
// After description is auto-generated
const handleGenerateSummary = async () => {
    // ... existing description generation ...

    if (result?.success && result.summary) {
        setDescription(result.summary);

        // NEW: Auto-assign if no assignment yet
        if (!selectedAssignment) {
            await autoAssignWork(result.summary, result.metadata);
        }
    }
};

const autoAssignWork = async (description: string, metadata: any) => {
    try {
        // Call new IPC handler
        const suggestion = await window.electron.ipcRenderer.suggestAssignment({
            description,
            appNames: Array.from(new Set(entry.windowActivity?.map(a => a.appName) || [])),
            windowTitles: Array.from(new Set(entry.windowActivity?.map(a => a.windowTitle) || [])),
            detectedTechnologies: metadata?.detectedTechnologies || [],
            detectedActivities: metadata?.detectedActivities || [],
            duration: entry.duration,
            startTime: entry.startTime,
        });

        if (suggestion.assignment && suggestion.confidence >= 0.7) {
            // Auto-assign with visual indicator
            handleAssignmentChange(suggestion.assignment);

            // Show toast notification
            showNotification({
                type: 'info',
                title: 'Assignment Suggested',
                message: `Auto-assigned to "${suggestion.assignment.type === 'jira'
                    ? suggestion.assignment.jiraIssue.key
                    : suggestion.assignment.bucket.name}" (${Math.round(suggestion.confidence * 100)}% confidence)`,
                action: {
                    label: 'Undo',
                    onClick: () => handleAssignmentChange(null)
                }
            });
        }
    } catch (error) {
        console.error('Auto-assignment failed:', error);
        // Fail silently - user can still assign manually
    }
};
```

#### 4. IPC Handler

**Location:** `electron/main.ts`

```typescript
ipcMain.handle('suggest-assignment', async (event, context: ActivityContext) => {
    console.log('[Main] suggest-assignment requested');

    try {
        const service = new AIAssignmentService();
        const suggestion = await service.suggestAssignment(context);

        return {
            success: true,
            suggestion
        };
    } catch (error) {
        console.error('[Main] suggest-assignment failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
```

### Keyword Dictionaries

**Technology Keywords:**
```typescript
const TECH_KEYWORDS = {
    'react': ['react', 'jsx', 'component', 'hook', 'useeffect', 'usestate'],
    'typescript': ['typescript', 'interface', 'type', 'generic', 'ts'],
    'electron': ['electron', 'ipc', 'main process', 'renderer', 'preload'],
    'swift': ['swift', 'swiftui', 'appkit', 'foundation', 'vision framework'],
    'python': ['python', 'django', 'flask', 'pandas', 'numpy'],
    'jira': ['jira', 'issue', 'ticket', 'sprint', 'backlog'],
    'tempo': ['tempo', 'timesheet', 'worklog', 'time tracking'],
};
```

**Activity Keywords:**
```typescript
const ACTIVITY_KEYWORDS = {
    'development': ['coding', 'programming', 'implementation', 'function', 'class', 'code'],
    'debugging': ['debug', 'error', 'bug', 'fix', 'troubleshoot', 'exception'],
    'research': ['research', 'reading', 'documentation', 'learning', 'tutorial'],
    'design': ['design', 'ui', 'ux', 'interface', 'mockup', 'wireframe'],
    'testing': ['test', 'testing', 'qa', 'validation', 'spec', 'jest'],
    'meeting': ['meeting', 'call', 'discussion', 'standup', 'review'],
    'planning': ['planning', 'architecture', 'design document', 'requirements'],
};
```

### Confidence Threshold Strategy

**Scoring Tiers:**
- **90-100%**: Very high confidence - auto-assign immediately
- **70-89%**: High confidence - auto-assign with notification
- **50-69%**: Medium confidence - suggest but don't auto-assign
- **0-49%**: Low confidence - don't suggest

**Default Threshold:** 70%

### API Contract

**IPC Handler:** `suggest-assignment`

**Request:**
```typescript
interface SuggestAssignmentRequest {
    description: string;
    appNames: string[];
    windowTitles: string[];
    detectedTechnologies: string[];
    detectedActivities: string[];
    duration: number;
    startTime: number;
}
```

**Response:**
```typescript
interface SuggestAssignmentResponse {
    success: boolean;
    suggestion?: AssignmentSuggestion;
    error?: string;
}

interface AssignmentSuggestion {
    assignment: WorkAssignment | null;
    confidence: number;  // 0-1
    reason: string;      // Human-readable explanation
    alternatives?: Array<{
        assignment: WorkAssignment;
        confidence: number;
        reason: string;
    }>;
}
```

### Testing Checklist

- [ ] Correct bucket selected for known patterns (e.g., "coding" → "Work" bucket)
- [ ] Correct Jira issue selected when project mentioned in description
- [ ] Technology matching works (React code → React-related issues)
- [ ] Historical patterns improve suggestions over time
- [ ] Low confidence doesn't auto-assign (< 70%)
- [ ] User can override auto-assignment
- [ ] Undo action works via notification toast
- [ ] Handles no available assignments gracefully
- [ ] Doesn't interfere with manual assignment selection
- [ ] Performance acceptable (< 500ms for suggestion)

---

## Feature 3: AI Auto-Selection of Tempo Account

### Objective

When a Jira issue is selected (manually or by AI), automatically select the most appropriate Tempo account based on the issue's project context, description, and available accounts.

### Design Decisions

**Trigger Point:** When WorkAssignment is set to a Jira issue
**Approach:** Project-based account matching with fallback to issue-level
**User Control:** Manual override in TempoValidationModal
**Storage:** Account stored in TimeEntry (new field)

### Matching Strategy

```
Account Selection Logic:
    1. Get Jira issue's project ID
    2. Fetch accounts linked to project (via Tempo API)
    3. If multiple accounts available:
        a. Match account name/key with issue summary
        b. Check for historical usage patterns
        c. Use default account if configured
    4. If no project accounts, try issue-level accounts
    5. If single account found, auto-select with high confidence
    6. If no accounts or ambiguous, leave for user selection
```

### Implementation Details

#### 1. Data Model Update

**Location:** `src/context/StorageContext.tsx`

**Add to TimeEntry interface:**
```typescript
interface TimeEntry {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
    assignment?: WorkAssignment;
    description?: string;
    windowActivity?: WindowActivity[];

    // NEW: Selected Tempo account
    tempoAccount?: {
        key: string;
        name: string;
        id: string;
    };
}
```

**Add context method:**
```typescript
const setEntryTempoAccount = (entryId: string, account: TempoAccount | null) => {
    setEntries(entries.map(entry =>
        entry.id === entryId
            ? {
                ...entry,
                tempoAccount: account ? {
                    key: account.key,
                    name: account.name,
                    id: account.id
                } : undefined
            }
            : entry
    ));
};
```

#### 2. Account Selection Service

**Location:** `electron/aiAccountService.ts` (NEW FILE)

```typescript
export class AIAccountService {
    /**
     * Select best Tempo account for a Jira issue
     */
    async selectAccount(
        issue: LinkedJiraIssue,
        availableAccounts: TempoAccount[],
        context: {
            description?: string;
            historicalAccounts: { issueKey: string; accountKey: string }[];
        }
    ): Promise<AccountSelection> {

        // Single account - auto-select with 100% confidence
        if (availableAccounts.length === 1) {
            return {
                account: availableAccounts[0],
                confidence: 1.0,
                reason: 'Only one account available for this project'
            };
        }

        // No accounts - return null
        if (availableAccounts.length === 0) {
            return {
                account: null,
                confidence: 0,
                reason: 'No accounts linked to this issue or project'
            };
        }

        // Multiple accounts - use matching logic
        const scores = availableAccounts.map(account => ({
            account,
            score: this.calculateAccountScore(account, issue, context),
            reason: this.explainAccountScore(account, issue, context)
        }));

        scores.sort((a, b) => b.score - a.score);
        const best = scores[0];

        // Only auto-select if clear winner (score difference > 0.2)
        const secondBest = scores[1];
        if (best.score - (secondBest?.score || 0) > 0.2 && best.score > 0.6) {
            return {
                account: best.account,
                confidence: best.score,
                reason: best.reason
            };
        }

        // Ambiguous - let user choose
        return {
            account: null,
            confidence: 0,
            reason: 'Multiple accounts available, please select manually',
            suggestions: scores.slice(0, 3)
        };
    }

    private calculateAccountScore(
        account: TempoAccount,
        issue: LinkedJiraIssue,
        context: any
    ): number {
        let score = 0;

        // Historical usage - strong signal
        const historicalUse = context.historicalAccounts.filter(h =>
            h.issueKey.startsWith(issue.projectKey) && h.accountKey === account.key
        );
        if (historicalUse.length > 0) {
            score += 0.5 * Math.min(historicalUse.length / 5, 1);
        }

        // Account name matches issue summary keywords
        const keywordMatch = this.keywordMatch(account.name, issue.summary);
        score += keywordMatch * 0.3;

        // Account name matches project name
        if (account.name.toLowerCase().includes(issue.projectName.toLowerCase())) {
            score += 0.2;
        }

        return Math.min(score, 1.0);
    }
}
```

#### 3. Integration in HistoryDetail

**Location:** `src/components/HistoryDetail.tsx`

**Enhancement:** Auto-select account when assignment changes

```typescript
const handleAssignmentChange = async (assignment: WorkAssignment | null) => {
    setSelectedAssignment(assignment);
    setEntryAssignment(entry.id, assignment);

    // NEW: Auto-select Tempo account for Jira assignments
    if (assignment?.type === 'jira' && assignment.jiraIssue) {
        await autoSelectTempoAccount(assignment.jiraIssue);
    }
};

const autoSelectTempoAccount = async (issue: LinkedJiraIssue) => {
    if (!settings.tempo?.enabled || !settings.jira?.enabled) return;

    try {
        // Fetch available accounts for this issue
        const tempoService = new TempoService(
            settings.tempo.baseUrl,
            settings.tempo.apiToken
        );
        const jiraService = new JiraService(
            settings.jira.baseUrl,
            settings.jira.email,
            settings.jira.apiToken
        );

        // Get full issue details
        const fullIssue = await jiraService.getIssue(issue.key);
        const projectId = fullIssue.fields.project.id;
        const issueId = fullIssue.id;

        // Get accounts
        const accounts = await tempoService.getAccountsForIssueOrProject(projectId, issueId);

        // Select best account
        const selection = await window.electron.ipcRenderer.selectTempoAccount({
            issue,
            accounts,
            description: description,
            historicalAccounts: getHistoricalAccountUsage()
        });

        if (selection.account && selection.confidence >= 0.8) {
            // Auto-select account
            setEntryTempoAccount(entry.id, selection.account);

            // Show notification
            showNotification({
                type: 'success',
                message: `Auto-selected account: ${selection.account.name}`,
                duration: 3000
            });
        }
    } catch (error) {
        console.error('Failed to auto-select Tempo account:', error);
        // Fail silently
    }
};

const getHistoricalAccountUsage = (): Array<{ issueKey: string; accountKey: string }> => {
    return entries
        .filter(e => e.assignment?.type === 'jira' && e.tempoAccount)
        .map(e => ({
            issueKey: e.assignment!.jiraIssue!.key,
            accountKey: e.tempoAccount!.key
        }));
};
```

#### 4. Display in Activity Details

**Location:** `src/components/HistoryDetail.tsx`

**Add UI section after Assignment picker:**

```tsx
{/* Assignment Section */}
<div className="p-3 border-b border-gray-700">
    <label className="text-xs text-gray-400 uppercase font-semibold mb-1.5 block">Assignment</label>
    <AssignmentPicker
        value={currentAssignment}
        onChange={handleAssignmentChange}
        placeholder="Select assignment..."
        className="w-full"
    />
</div>

{/* NEW: Tempo Account Section (only show for Jira assignments) */}
{currentAssignment?.type === 'jira' && settings.tempo?.enabled && (
    <div className="p-3 border-b border-gray-700">
        <label className="text-xs text-gray-400 uppercase font-semibold mb-1.5 block">
            Tempo Account
        </label>
        {entry.tempoAccount ? (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-700 rounded">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-white text-sm">{entry.tempoAccount.name}</span>
                    <span className="text-gray-500 text-xs">({entry.tempoAccount.key})</span>
                </div>
                <button
                    onClick={() => setEntryTempoAccount(entry.id, null)}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                >
                    Clear
                </button>
            </div>
        ) : (
            <div className="text-sm text-gray-500 italic px-3 py-2 bg-gray-900 border border-gray-700 rounded">
                No account selected (will be selected when logging to Tempo)
            </div>
        )}
    </div>
)}
```

#### 5. Integration in TempoValidationModal

**Location:** `src/components/TempoValidationModal.tsx`

**Enhancement:** Pre-populate account from TimeEntry

```typescript
export function TempoValidationModal({
    entry,
    assignment,
    // ... other props
}: TempoValidationModalProps) {
    // ... existing state ...

    const [selectedAccount, setSelectedAccount] = useState<string>(() => {
        // NEW: Pre-populate from TimeEntry if available
        return entry.tempoAccount?.key || '';
    });

    // ... rest of component
}
```

### API Contract

**IPC Handler:** `select-tempo-account`

**Request:**
```typescript
interface SelectTempoAccountRequest {
    issue: LinkedJiraIssue;
    accounts: TempoAccount[];
    description?: string;
    historicalAccounts: Array<{
        issueKey: string;
        accountKey: string;
    }>;
}
```

**Response:**
```typescript
interface SelectTempoAccountResponse {
    success: boolean;
    selection?: AccountSelection;
    error?: string;
}

interface AccountSelection {
    account: TempoAccount | null;
    confidence: number;
    reason: string;
    suggestions?: Array<{
        account: TempoAccount;
        score: number;
        reason: string;
    }>;
}
```

### Testing Checklist

- [ ] Single account auto-selected with 100% confidence
- [ ] Historical patterns prioritized (same project + account combo)
- [ ] Account name matching works (account name contains project/issue keywords)
- [ ] Default account used when configured
- [ ] Manual override in TempoValidationModal works
- [ ] Account persisted with TimeEntry
- [ ] Account pre-populated in modal on subsequent logs
- [ ] Handles no accounts gracefully
- [ ] Handles account fetch failures gracefully
- [ ] Works for both manual and AI-assigned Jira issues

---

## Feature 4: Account Selection in Activity Details UI

### Objective

Display the selected Tempo account prominently in the activity details section (top section of HistoryDetail), allowing users to see and modify the account before logging time.

### Design Decisions

**Location:** Activity Details top section, below Assignment picker
**Visibility:** Only shown when Tempo is enabled and assignment is Jira
**Interaction:** Click to change account (inline selector)
**Persistence:** Account saved immediately to TimeEntry

### Implementation Details

#### UI Component Structure

**Location:** `src/components/HistoryDetail.tsx`

**Visual Hierarchy:**
```
┌─────────────────────────────────────────────────────────┐
│  Activity Details                                       │
├─────────────────────────────────────────────────────────┤
│  Start: 2:30 PM        End: 3:45 PM        Duration     │
│                                            1:15          │
├─────────────────────────────────────────────────────────┤
│  Assignment                                             │
│  [●] BEEM-123 - Implement AI features                   │
├─────────────────────────────────────────────────────────┤
│  Tempo Account                        [AI Selected]     │
│  [●] Client Billable Hours (ACC-001)        [Change]    │
├─────────────────────────────────────────────────────────┤
│  Description                           [Generate]       │
│  [Text area with auto-generated description...]         │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**

```tsx
{/* Tempo Account Section */}
{currentAssignment?.type === 'jira' && settings.tempo?.enabled && (
    <div className="p-3 border-b border-gray-700">
        <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-gray-400 uppercase font-semibold">
                Tempo Account
            </label>
            {entry.tempoAccount && entry.tempoAccountAutoSelected && (
                <span className="text-xs text-purple-400 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                    </svg>
                    AI Selected
                </span>
            )}
        </div>

        {isLoadingAccounts ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-400">
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                Loading accounts...
            </div>
        ) : entry.tempoAccount ? (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-700 rounded hover:bg-gray-800 transition-colors">
                <div className="flex items-center gap-2 flex-1">
                    <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm" style={{ boxShadow: '0 0 6px rgba(34, 197, 94, 0.4)' }} />
                    <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium">{entry.tempoAccount.name}</div>
                        <div className="text-gray-500 text-xs">{entry.tempoAccount.key}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAccountPicker(true)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 hover:bg-blue-500/10 rounded"
                    >
                        Change
                    </button>
                    <button
                        onClick={() => clearTempoAccount()}
                        className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                        ×
                    </button>
                </div>
            </div>
        ) : availableAccounts.length > 0 ? (
            <button
                onClick={() => setShowAccountPicker(true)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 text-gray-400 text-sm rounded hover:bg-gray-800 hover:border-gray-600 transition-colors text-left"
            >
                Select an account...
            </button>
        ) : (
            <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-400">
                No accounts available for this issue
            </div>
        )}
    </div>
)}
```

#### Account Picker Modal

**Component:** `TempoAccountPicker.tsx` (NEW FILE)

**Purpose:** Inline account selection modal

```tsx
interface TempoAccountPickerProps {
    accounts: TempoAccount[];
    selectedAccountKey?: string;
    onSelect: (account: TempoAccount) => void;
    onClose: () => void;
}

export function TempoAccountPicker({ accounts, selectedAccountKey, onSelect, onClose }: TempoAccountPickerProps) {
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-700">
                    <h3 className="text-lg font-semibold text-white">Select Tempo Account</h3>
                </div>
                <div className="p-2 max-h-96 overflow-y-auto">
                    {accounts.map(account => (
                        <button
                            key={account.id}
                            onClick={() => {
                                onSelect(account);
                                onClose();
                            }}
                            className={`w-full px-3 py-2 text-left rounded hover:bg-gray-700 transition-colors ${
                                account.key === selectedAccountKey ? 'bg-gray-700' : ''
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${
                                    account.key === selectedAccountKey ? 'bg-green-500' : 'bg-gray-600'
                                }`} />
                                <div className="flex-1">
                                    <div className="text-white text-sm font-medium">{account.name}</div>
                                    <div className="text-gray-400 text-xs">{account.key}</div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
```

### State Management

**Add to HistoryDetail component:**

```typescript
const [showAccountPicker, setShowAccountPicker] = useState(false);
const [availableAccounts, setAvailableAccounts] = useState<TempoAccount[]>([]);
const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);

// Fetch accounts when Jira assignment changes
useEffect(() => {
    const fetchAccounts = async () => {
        if (currentAssignment?.type !== 'jira' || !settings.tempo?.enabled) {
            setAvailableAccounts([]);
            return;
        }

        setIsLoadingAccounts(true);

        try {
            const tempoService = new TempoService(settings.tempo.baseUrl, settings.tempo.apiToken);
            const jiraService = new JiraService(settings.jira.baseUrl, settings.jira.email, settings.jira.apiToken);

            const issue = await jiraService.getIssue(currentAssignment.jiraIssue.key);
            const accounts = await tempoService.getAccountsForIssueOrProject(issue.fields.project.id, issue.id);

            setAvailableAccounts(accounts);
        } catch (error) {
            console.error('Failed to fetch Tempo accounts:', error);
            setAvailableAccounts([]);
        } finally {
            setIsLoadingAccounts(false);
        }
    };

    fetchAccounts();
}, [currentAssignment, settings.tempo, settings.jira]);

const clearTempoAccount = () => {
    setEntryTempoAccount(entry.id, null);
};
```

### Testing Checklist

- [ ] Account section only visible for Jira assignments with Tempo enabled
- [ ] Account picker shows all available accounts
- [ ] Selected account persists in TimeEntry
- [ ] "Change" button opens account picker
- [ ] Clear button removes account
- [ ] AI Selected badge shows when auto-selected
- [ ] Loading state shown while fetching accounts
- [ ] Empty state shown when no accounts available
- [ ] Account pre-populated in TempoValidationModal
- [ ] Manual selection overrides AI selection

---

## Data Flow Diagrams

### Complete AI Feature Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Activity Occurs                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            Screenshot Captured & Stored (Encrypted)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│    AI Analysis (Vision Framework - Text + Object Detection)      │
│    - Detected Text: [...words...]                               │
│    - Detected Objects: [...classifications...]                  │
│    - Generated Description: "..."                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│      Store Analysis in WindowActivity.screenshotDescriptions     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────┴────────┐
                    │  Check: All     │
                    │  Screenshots    │
                    │  Analyzed?      │
                    └────────┬────────┘
                             │ Yes
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│        FEATURE 1: Auto-Generate Activity Description             │
│        - Aggregate all screenshot descriptions                   │
│        - Analyze app names, window titles                        │
│        - Detect technologies and activities                      │
│        - Generate comprehensive summary                          │
│        - Store in TimeEntry.description                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│   FEATURE 2: AI Auto-Select Assignment (Bucket/Jira)            │
│   - Build activity context from description                     │
│   - Score all available buckets/Jira issues                     │
│   - Calculate confidence (keyword match + historical)           │
│   - Auto-assign if confidence > 70%                             │
│   - Store in TimeEntry.assignment                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────┴────────┐
                    │  Assignment     │
                    │  Type = Jira?   │
                    └────────┬────────┘
                             │ Yes
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│   FEATURE 3: AI Auto-Select Tempo Account                       │
│   - Fetch accounts for Jira issue/project                       │
│   - Score accounts (historical + keyword match)                 │
│   - Auto-select if single account OR high confidence            │
│   - Store in TimeEntry.tempoAccount                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│   FEATURE 4: Display in Activity Details UI                     │
│   - Show assignment (bucket or Jira issue)                      │
│   - Show Tempo account (if Jira assignment)                     │
│   - Allow manual override of both                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────┴────────┐
                    │  User Clicks    │
                    │  "Log to Tempo" │
                    └────────┬────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│        TempoValidationModal Opens                                │
│        - Pre-populated description                               │
│        - Pre-populated Jira issue                                │
│        - Pre-populated Tempo account                             │
│        - User reviews and confirms                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│        Create Tempo Worklog                                      │
│        - issueId: (from Jira)                                    │
│        - timeSpentSeconds: (calculated)                          │
│        - description: (from TimeEntry)                           │
│        - account: (from TimeEntry.tempoAccount)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Assignment Matching Flow

```
Activity Context
    ├─ Description: "Worked on React components for user dashboard..."
    ├─ Apps: ["Cursor", "Google Chrome"]
    ├─ Technologies: ["React", "TypeScript"]
    └─ Duration: 3600000ms (1 hour)

          ↓

Available Assignments:
    ├─ Bucket: "Frontend Development" (score: 0.85)
    │   └─ Matches: "React", "components", "dashboard"
    ├─ Bucket: "Backend API" (score: 0.2)
    │   └─ Matches: none
    ├─ Jira: "BEEM-123 - Implement user dashboard UI" (score: 0.95)
    │   └─ Matches: "user dashboard", project="BEEM", frequent
    └─ Jira: "DES-456 - Database optimization" (score: 0.1)
        └─ Matches: none

          ↓

Best Match Selected:
    Assignment: BEEM-123 (Jira)
    Confidence: 95%
    Reason: "High keyword match with issue summary and frequently used for similar React work"

          ↓

Auto-Assign with Notification
```

### Account Selection Flow

```
Jira Issue Selected: BEEM-123
    ↓
Fetch Accounts:
    ├─ Project-level (BEEM):
    │   ├─ "Client Billable" (ACC-001)
    │   └─ "Internal R&D" (ACC-002)
    └─ Issue-level: (none)

          ↓

Historical Analysis:
    Past entries for BEEM-* issues:
    ├─ BEEM-100 → ACC-001 (3 times)
    ├─ BEEM-105 → ACC-001 (2 times)
    └─ BEEM-110 → ACC-002 (1 time)

          ↓

Keyword Matching:
    Issue: "Implement user dashboard UI"
    ├─ ACC-001 "Client Billable": score 0.6 (client + historical)
    └─ ACC-002 "Internal R&D": score 0.3 (R&D matches "implement")

          ↓

Best Account Selected:
    Account: ACC-001 "Client Billable"
    Confidence: 88%
    Reason: "Frequently used for BEEM project issues and client-facing work"

          ↓

Auto-Select + Show in UI
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal:** Set up infrastructure for AI services

**Tasks:**
1. Create new service modules
   - [ ] `electron/aiAssignmentService.ts`
   - [ ] `electron/aiAccountService.ts`
   - [ ] Add shared utilities (keyword extraction, scoring)

2. Enhance existing IPC handlers
   - [ ] Update `generate-activity-summary` to return metadata
   - [ ] Add `suggest-assignment` IPC handler
   - [ ] Add `select-tempo-account` IPC handler

3. Data model updates
   - [ ] Add `tempoAccount` field to TimeEntry interface
   - [ ] Add `setEntryTempoAccount` to StorageContext
   - [ ] Add `tempoAccountAutoSelected` flag for UI indicators

**Deliverables:**
- Working IPC handlers with test responses
- Updated data models with migration
- Service skeletons with basic logic

**Testing:**
- IPC handlers respond correctly
- Data persists in localStorage
- No breaking changes to existing functionality

---

### Phase 2: Auto Description Generation (Week 2)

**Goal:** Implement automatic description generation after screenshot analysis

**Tasks:**
1. Implement auto-trigger logic
   - [ ] Add `useEffect` to detect all screenshots analyzed
   - [ ] Call `handleGenerateSummary` automatically
   - [ ] Prevent overwriting manual descriptions

2. Enhance summary generation
   - [ ] Improve `generateTextBasedSummary` algorithm
   - [ ] Add metadata extraction (technologies, activities)
   - [ ] Return structured response with confidence

3. UI indicators
   - [ ] Add "AI Generated" badge to description section
   - [ ] Show analysis progress ("3/5 screenshots analyzed")
   - [ ] Loading state during generation

**Deliverables:**
- Auto-generation working end-to-end
- Enhanced summaries with better context
- Clear UI indicators for AI-generated content

**Testing:**
- Auto-generation triggers correctly
- Generated descriptions are high quality
- Manual descriptions never overwritten
- Works with 0, 1, or many screenshots

---

### Phase 3: AI Assignment Selection (Week 3)

**Goal:** Implement intelligent bucket/Jira issue selection

**Tasks:**
1. Implement matching algorithms
   - [ ] Keyword extraction and scoring
   - [ ] Historical pattern analysis
   - [ ] Technology/domain matching
   - [ ] Confidence calculation

2. Integration with HistoryDetail
   - [ ] Call `suggest-assignment` after description generated
   - [ ] Auto-assign if confidence > threshold
   - [ ] Show notification with undo option
   - [ ] Respect manual overrides

3. Build keyword dictionaries
   - [ ] Technology keywords (React, TypeScript, etc.)
   - [ ] Activity keywords (coding, debugging, etc.)
   - [ ] Make configurable for user customization

**Deliverables:**
- Working assignment auto-selection
- Notification system with undo
- Keyword dictionaries

**Testing:**
- Correct assignments for various scenarios
- Confidence thresholds working correctly
- Undo functionality works
- No auto-assign when confidence low

---

### Phase 4: Tempo Account Selection (Week 4)

**Goal:** Implement automatic Tempo account selection for Jira issues

**Tasks:**
1. Implement account matching
   - [ ] Fetch accounts from Tempo API
   - [ ] Historical usage analysis
   - [ ] Keyword matching with issue/account
   - [ ] Single account auto-select (100% confidence)

2. UI integration
   - [ ] Add account display in HistoryDetail
   - [ ] Create TempoAccountPicker component
   - [ ] Loading states for account fetching
   - [ ] Error handling for API failures

3. Pre-populate in TempoValidationModal
   - [ ] Read account from TimeEntry
   - [ ] Pre-select in dropdown
   - [ ] Allow override before logging

**Deliverables:**
- Working account auto-selection
- New UI components for account display
- Pre-population in modal

**Testing:**
- Single account auto-selected immediately
- Multiple accounts scored correctly
- Historical patterns improve selection
- Manual override works
- Graceful degradation when no accounts

---

### Phase 5: Polish & Optimization (Week 5)

**Goal:** Refine UX, add edge case handling, optimize performance

**Tasks:**
1. Performance optimization
   - [ ] Cache Jira issues locally (reduce API calls)
   - [ ] Debounce AI suggestions
   - [ ] Lazy load accounts only when needed
   - [ ] Background processing for non-critical tasks

2. Edge case handling
   - [ ] No screenshots scenario
   - [ ] Partial screenshot analysis
   - [ ] Vision Framework failures
   - [ ] Network errors during Jira/Tempo API calls
   - [ ] No available assignments
   - [ ] Ambiguous matches (low confidence)

3. User preferences
   - [ ] Setting to disable auto-description
   - [ ] Setting to disable auto-assignment
   - [ ] Confidence threshold configuration
   - [ ] Preferred default account

4. Analytics & feedback
   - [ ] Log AI suggestion acceptance rate
   - [ ] Track manual overrides
   - [ ] Measure performance metrics
   - [ ] User feedback mechanism

**Deliverables:**
- Polished, production-ready features
- Comprehensive error handling
- User preferences panel
- Analytics instrumentation

**Testing:**
- All edge cases handled gracefully
- Performance acceptable on slower machines
- User preferences respected
- No crashes or data loss

---

### Phase 6: Documentation & Release (Week 6)

**Goal:** Document features, create user guide, prepare for release

**Tasks:**
1. Developer documentation
   - [ ] Update CLAUDE.md with new patterns
   - [ ] API documentation for IPC handlers
   - [ ] Service architecture diagrams
   - [ ] Code comments for complex logic

2. User documentation
   - [ ] Feature guide in app
   - [ ] Tutorial/walkthrough for first-time users
   - [ ] FAQ for common questions
   - [ ] Troubleshooting guide

3. Testing & QA
   - [ ] End-to-end testing of all features
   - [ ] Cross-platform testing (macOS)
   - [ ] Load testing with large datasets
   - [ ] User acceptance testing

4. Release preparation
   - [ ] Changelog
   - [ ] Migration guide for existing users
   - [ ] Release notes
   - [ ] Version bump

**Deliverables:**
- Complete documentation
- Tested and verified features
- Release-ready build

---

## API Contracts

### IPC Handler: `generate-activity-summary`

**Location:** `electron/main.ts`

**Request:**
```typescript
interface GenerateActivitySummaryRequest {
    screenshotDescriptions: string[];
    windowTitles: string[];
    appNames: string[];
    duration: number;
    startTime: number;
    endTime: number;
}
```

**Response:**
```typescript
interface GenerateActivitySummaryResponse {
    success: boolean;
    summary: string | null;
    error?: string;
    metadata?: {
        detectedActivities: string[];      // ["development", "debugging"]
        detectedTechnologies: string[];    // ["React", "TypeScript"]
        confidence: number;                // 0-1
        wordCount: number;
    };
}
```

**Error Handling:**
- Vision Framework not available: Return basic summary from heuristics
- No screenshot descriptions: Use app names and window titles only
- Empty context: Return generic "Work session" description

---

### IPC Handler: `suggest-assignment`

**Location:** `electron/main.ts`

**Request:**
```typescript
interface SuggestAssignmentRequest {
    description: string;
    appNames: string[];
    windowTitles: string[];
    detectedTechnologies: string[];
    detectedActivities: string[];
    duration: number;
    startTime: number;
}
```

**Response:**
```typescript
interface SuggestAssignmentResponse {
    success: boolean;
    suggestion?: {
        assignment: WorkAssignment | null;
        confidence: number;  // 0-1
        reason: string;
        alternatives?: Array<{
            assignment: WorkAssignment;
            confidence: number;
            reason: string;
        }>;
    };
    error?: string;
}
```

**Error Handling:**
- No available assignments: Return null with reason
- Jira API error: Fallback to buckets only
- Low confidence (< 0.7): Return null, don't auto-assign
- Tie between candidates: Return highest but flag as ambiguous

---

### IPC Handler: `select-tempo-account`

**Location:** `electron/main.ts`

**Request:**
```typescript
interface SelectTempoAccountRequest {
    issue: LinkedJiraIssue;
    accounts: TempoAccount[];
    description?: string;
    historicalAccounts: Array<{
        issueKey: string;
        accountKey: string;
    }>;
}
```

**Response:**
```typescript
interface SelectTempoAccountResponse {
    success: boolean;
    selection?: {
        account: TempoAccount | null;
        confidence: number;
        reason: string;
        suggestions?: Array<{
            account: TempoAccount;
            score: number;
            reason: string;
        }>;
    };
    error?: string;
}
```

**Error Handling:**
- Single account: Auto-select with confidence 1.0
- No accounts: Return null with helpful error
- Multiple accounts, ambiguous: Return null with suggestions list
- Historical data unavailable: Use keyword matching only

---

## UI/UX Considerations

### User Control & Transparency

**Principle:** AI should assist, not override user decisions

**Implementation:**
1. **Always show what AI did**
   - "AI Generated" badges
   - "AI Selected" indicators
   - Confidence percentages when helpful

2. **Easy manual override**
   - All AI selections can be changed
   - "Undo" action for auto-assignments
   - Clear UI for manual selection

3. **Explain AI decisions**
   - "Matched keywords: React, TypeScript"
   - "Frequently used for similar tasks"
   - "Based on your recent activity"

### Progressive Enhancement

**Never block the user flow with AI**

1. **Graceful degradation**
   - If AI fails, revert to manual workflow
   - Don't show errors for failed suggestions
   - Always provide fallback options

2. **Non-blocking operations**
   - AI processing happens in background
   - User can continue working during generation
   - Loading states don't prevent other actions

3. **Incremental adoption**
   - Features work independently
   - Can disable any AI feature individually
   - No all-or-nothing approach

### Visual Feedback

**Loading States:**
```
┌─────────────────────────────────────┐
│ ⟳ Generating description...         │
│ 3/5 screenshots analyzed            │
└─────────────────────────────────────┘
```

**Success States:**
```
┌─────────────────────────────────────┐
│ ✓ Description generated              │
│ 🎯 AI Selected                       │
│ ✨ Auto-assigned to BEEM-123 (85%)  │
└─────────────────────────────────────┘
```

**Error States:**
```
┌─────────────────────────────────────┐
│ ⚠ Could not generate description    │
│ → You can enter one manually        │
└─────────────────────────────────────┘
```

### Notification System

**Toast Notifications:**

```typescript
interface ToastNotification {
    type: 'success' | 'info' | 'warning' | 'error';
    title?: string;
    message: string;
    duration?: number;  // Auto-dismiss after ms
    action?: {
        label: string;
        onClick: () => void;
    };
}
```

**Examples:**
```typescript
// Auto-assignment notification
showNotification({
    type: 'info',
    message: 'Auto-assigned to "BEEM-123 - User Dashboard" (85% confidence)',
    duration: 5000,
    action: {
        label: 'Undo',
        onClick: () => handleAssignmentChange(null)
    }
});

// Account selection notification
showNotification({
    type: 'success',
    message: 'Selected Tempo account: Client Billable Hours',
    duration: 3000
});

// Low confidence notification
showNotification({
    type: 'info',
    message: 'Could not confidently suggest an assignment. Please select manually.',
    duration: 4000
});
```

### Accessibility

1. **Keyboard Navigation**
   - All AI features accessible via keyboard
   - Tab order logical and predictable
   - Undo actions have keyboard shortcuts

2. **Screen Reader Support**
   - ARIA labels for AI indicators
   - Announcements for auto-actions
   - Alternative text for all icons

3. **Visual Indicators**
   - Don't rely solely on color
   - Use icons + text for status
   - Sufficient contrast ratios

---

## Edge Cases and Fallbacks

### Scenario 1: No Screenshots Available

**Situation:** User creates manual time entry or screenshots disabled

**Behavior:**
- Skip auto-description generation
- Allow manual description entry
- Still attempt auto-assignment based on:
  - Manual description (if provided)
  - Time of day patterns
  - Historical data
  - Default bucket/issue

**Implementation:**
```typescript
if (screenshotStats.total === 0) {
    // Don't auto-generate description
    // But still suggest assignment if description manually entered
    if (description.trim()) {
        await autoAssignWork(description, {});
    }
}
```

---

### Scenario 2: Partial Screenshot Analysis

**Situation:** Some screenshots analyzed, others failed or still processing

**Behavior:**
- Wait for all screenshots OR timeout after 30 seconds
- Generate description with available data
- Include disclaimer: "Based on N/M screenshots"
- Allow manual regeneration when all complete

**Implementation:**
```typescript
const screenshotTimeout = setTimeout(() => {
    if (screenshotStats.analyzed > 0) {
        // Generate with partial data
        handleGenerateSummary();
    }
}, 30000);  // 30 second timeout

// Clear timeout if all analyzed
if (screenshotStats.analyzed === screenshotStats.total) {
    clearTimeout(screenshotTimeout);
}
```

---

### Scenario 3: Vision Framework Unavailable

**Situation:** macOS version too old or Swift helper not built

**Behavior:**
- Detect early (on app startup)
- Disable screenshot analysis features
- Show setup instructions
- Revert to manual workflow

**Implementation:**
```typescript
const visionAvailable = await window.electron.ipcRenderer.checkVisionFramework();

if (!visionAvailable) {
    showNotification({
        type: 'warning',
        title: 'AI Features Limited',
        message: 'Screenshot analysis requires macOS 10.15+ and Swift helper. Some AI features disabled.',
        duration: 10000
    });

    // Disable auto-description
    settings.aiFeatures.autoDescription = false;
}
```

---

### Scenario 4: Low Confidence Matches

**Situation:** AI cannot confidently suggest assignment or account

**Behavior:**
- Don't auto-assign (avoid bad guesses)
- Show top suggestions with scores
- Provide explanation for ambiguity
- Guide user to make decision

**UI:**
```
┌─────────────────────────────────────────────────────────┐
│ Could not confidently suggest an assignment             │
│                                                          │
│ Top suggestions:                                        │
│ ● BEEM-123 - User Dashboard (65%)                      │
│   Similar keywords, but less frequently used           │
│                                                          │
│ ● Frontend Development bucket (58%)                     │
│   Matches "React" and "development" keywords           │
│                                                          │
│ [Select Manually]                                       │
└─────────────────────────────────────────────────────────┘
```

---

### Scenario 5: No Available Assignments

**Situation:** User hasn't created buckets or connected Jira

**Behavior:**
- Skip auto-assignment
- Show onboarding prompt
- Offer to create first bucket or connect Jira
- Allow entry without assignment

**Implementation:**
```typescript
if (buckets.length === 0 && !settings.jira?.enabled) {
    showNotification({
        type: 'info',
        title: 'No Assignments Available',
        message: 'Create buckets or connect Jira to enable auto-assignment',
        action: {
            label: 'Settings',
            onClick: () => navigateToSettings()
        }
    });
}
```

---

### Scenario 6: Network Errors (Jira/Tempo API)

**Situation:** API calls fail due to network issues or invalid credentials

**Behavior:**
- Cache previous responses when possible
- Degrade gracefully to local data
- Show clear error messages
- Retry with exponential backoff
- Don't block user workflow

**Implementation:**
```typescript
try {
    const jiraIssues = await jiraCache.getAssignedIssues();
} catch (error) {
    console.error('Jira API failed:', error);

    // Use cached data if available
    const cachedIssues = jiraCache.getCachedIssues();
    if (cachedIssues.length > 0) {
        jiraIssues = cachedIssues;
        showNotification({
            type: 'warning',
            message: 'Using cached Jira data (offline)',
            duration: 5000
        });
    } else {
        // Fallback to buckets only
        jiraEnabled = false;
    }
}
```

---

### Scenario 7: Multiple Accounts with Equal Scores

**Situation:** Historical data and keywords produce identical scores

**Behavior:**
- Don't auto-select (avoid arbitrary choice)
- Present all equal-scoring options
- Let user choose
- Remember choice for future similar contexts

**Implementation:**
```typescript
const topScore = accountScores[0].score;
const tiedAccounts = accountScores.filter(a => a.score === topScore);

if (tiedAccounts.length > 1) {
    return {
        account: null,
        confidence: 0,
        reason: 'Multiple accounts have equal relevance',
        suggestions: tiedAccounts
    };
}
```

---

### Scenario 8: User Consistently Overrides AI

**Situation:** User manually changes AI suggestions frequently

**Behavior:**
- Learn from overrides
- Adjust confidence thresholds
- Offer to disable auto-features
- Ask for feedback

**Implementation:**
```typescript
const overrideRate = calculateOverrideRate(entries, 20);  // Last 20 entries

if (overrideRate > 0.7) {  // 70% override rate
    showNotification({
        type: 'info',
        title: 'AI Learning',
        message: 'We notice you often change AI suggestions. Would you like to adjust settings?',
        action: {
            label: 'Review Settings',
            onClick: () => navigateToAISettings()
        }
    });
}
```

---

### Scenario 9: Conflicting Assignment Types

**Situation:** Bucket and Jira issue have similar scores

**Behavior:**
- Prefer Jira issues (more specific)
- Require score difference > 0.15 to override
- Show both options in suggestions
- Learn user preference over time

**Implementation:**
```typescript
const bestBucket = bucketScores[0];
const bestJira = jiraScores[0];

if (Math.abs(bestBucket.score - bestJira.score) < 0.15) {
    // Too close to call - show both
    return {
        assignment: null,
        confidence: 0,
        reason: 'Bucket and Jira issue are equally relevant',
        alternatives: [
            { assignment: bestJira.assignment, confidence: bestJira.score },
            { assignment: bestBucket.assignment, confidence: bestBucket.score }
        ]
    };
}
```

---

### Scenario 10: Description Changed After Auto-Assignment

**Situation:** User edits description after AI assigned bucket/issue

**Behavior:**
- Don't re-run auto-assignment automatically
- Show "Re-suggest" button if description significantly changed
- Respect user's manual edit
- Learn from the new description for future

**Implementation:**
```typescript
useEffect(() => {
    const significantChange = calculateDescriptionDifference(
        originalDescription,
        description
    ) > 0.3;

    if (significantChange && selectedAssignment) {
        setShowResuggestButton(true);
    }
}, [description]);

// UI
{showResuggestButton && (
    <button onClick={handleResuggestAssignment}>
        Re-suggest assignment based on new description
    </button>
)}
```

---

## Testing Strategy

### Unit Tests

**Services:**
- AIAssignmentService
  - [ ] Keyword extraction accuracy
  - [ ] Score calculation correctness
  - [ ] Confidence threshold enforcement
  - [ ] Historical pattern matching

- AIAccountService
  - [ ] Single account auto-select
  - [ ] Multiple account scoring
  - [ ] Historical preference weighting
  - [ ] Keyword matching logic

- Summary Generation
  - [ ] Technology detection accuracy
  - [ ] Activity type classification
  - [ ] Duration formatting
  - [ ] Edge cases (no data, partial data)

**Components:**
- HistoryDetail
  - [ ] Auto-generation trigger logic
  - [ ] Screenshot stats calculation
  - [ ] Assignment change handling
  - [ ] Account selection flow

- TempoAccountPicker
  - [ ] Account list rendering
  - [ ] Selection persistence
  - [ ] Modal open/close

### Integration Tests

**End-to-End Flows:**
- [ ] Screenshot → Analysis → Description → Assignment → Account
- [ ] Manual override of AI suggestions
- [ ] Undo action functionality
- [ ] Settings changes affecting AI behavior

**API Integration:**
- [ ] Jira API calls with various responses
- [ ] Tempo API calls with various responses
- [ ] Network error handling
- [ ] Rate limiting compliance

### User Acceptance Testing

**Scenarios:**
1. **First-time user**
   - [ ] AI features work out-of-box
   - [ ] Onboarding clear and helpful
   - [ ] No confusion about auto-actions

2. **Power user**
   - [ ] AI suggestions accurate for complex workflows
   - [ ] Manual overrides respected
   - [ ] Historical learning improves over time

3. **Edge case user**
   - [ ] Works without Jira/Tempo
   - [ ] Works with many buckets
   - [ ] Works with infrequent time tracking

### Performance Tests

**Metrics:**
- [ ] Description generation < 2 seconds
- [ ] Assignment suggestion < 500ms
- [ ] Account selection < 300ms
- [ ] No UI blocking during AI operations
- [ ] Memory usage acceptable with large history

### Regression Tests

**Ensure no breaking changes:**
- [ ] Manual description entry still works
- [ ] Manual assignment selection still works
- [ ] Manual account selection in modal still works
- [ ] Existing time entries not affected
- [ ] Data migration successful

---

## Success Metrics

### Adoption Metrics
- % of time entries with AI-generated descriptions
- % of time entries with AI-selected assignments
- % of time entries with AI-selected accounts
- Average time to complete time entry (before/after)

### Quality Metrics
- AI suggestion acceptance rate (vs. manual override)
- Description quality (user satisfaction survey)
- Assignment accuracy (correct on first try)
- Account accuracy (correct on first try)

### Performance Metrics
- Time to generate description
- Time to suggest assignment
- Time to select account
- Total time savings per user per week

### User Satisfaction
- Net Promoter Score for AI features
- User feedback sentiment
- Feature request trends
- Support ticket volume related to AI

---

## Future Enhancements

### Advanced AI Capabilities

1. **LLM Integration**
   - Use Claude API for more sophisticated summaries
   - Context-aware descriptions with project knowledge
   - Multi-turn refinement of descriptions

2. **Pattern Recognition**
   - Detect recurring tasks automatically
   - Suggest templates for common workflows
   - Auto-categorize work types (deep work, meetings, admin)

3. **Predictive Features**
   - Predict next assignment based on time of day
   - Suggest optimal time blocking
   - Forecast time spent on tasks

### User Customization

1. **AI Personality**
   - Adjust verbosity of descriptions
   - Choose description style (technical, business, casual)
   - Custom keyword dictionaries

2. **Learning Preferences**
   - Explicit feedback on AI suggestions
   - Thumbs up/down for descriptions
   - Mark preferred assignments for contexts

3. **Automation Rules**
   - "Always assign React work to BEEM-123"
   - "Morning coding sessions → Focus bucket"
   - "Screenshots with X app → Y account"

### Analytics & Insights

1. **Work Pattern Analysis**
   - Visualize time spent by technology
   - Identify most productive hours
   - Detect context switching frequency

2. **Productivity Metrics**
   - Focus time vs. fragmented time
   - Deep work sessions
   - Meeting time vs. maker time

3. **Team Features**
   - Share assignment patterns across team
   - Learn from team's categorization
   - Suggest collaboration based on similar work

---

## Conclusion

This implementation plan outlines a comprehensive approach to adding intelligent AI features to TimePortal, building on the existing Vision Framework foundation. By implementing automatic description generation, smart assignment selection, and intelligent Tempo account selection, we significantly reduce manual data entry while maintaining user control and transparency.

The phased approach ensures each feature is solid before moving to the next, with clear testing checkpoints and fallback strategies for edge cases. The end result will be a more intelligent time tracking system that learns from user behavior and provides increasingly accurate suggestions over time.

**Next Steps:**
1. Review and validate this plan with stakeholders
2. Set up development environment for Phase 1
3. Begin implementation of foundation services
4. Iterate based on early testing feedback

---

**Document Version:** 1.0
**Last Updated:** January 8, 2026
**Status:** Ready for Implementation
