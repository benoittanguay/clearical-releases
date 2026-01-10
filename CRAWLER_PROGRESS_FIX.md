# Jira Crawler Progress Bar Fix

## Problem
The Jira crawler progress bar was not visible in the UI, even when the crawler was actively running.

## Root Cause
Multiple `JiraCache` instances were being created independently across different components:
- `CrawlerProgressContext` created its own instance
- `JiraIssuesSection` created its own instance
- `AssignmentPicker` created its own instance
- `HistoryDetail` created its own instance

Each `JiraCache` instance has its own internal `JiraIssueCrawler`. When `JiraIssuesSection` triggered a crawl on its instance, the progress events were emitted from **that** crawler - but `CrawlerProgressContext` was listening to events from **its own** crawler instance.

**Result**: Events never reached the progress bar because they were coming from different crawler instances.

## Solution
Created a centralized `JiraCacheContext` to provide a **single shared** `JiraCache` instance to all components.

### Changes Made

1. **Created `/src/context/JiraCacheContext.tsx`**
   - New context provider that creates and manages a single `JiraCache` instance
   - Handles initialization when Jira settings change
   - Provides `useJiraCache()` hook for components

2. **Updated `/src/main.tsx`**
   - Added `JiraCacheProvider` wrapping the app
   - Positioned before `CrawlerProgressProvider` so the cache is available when the progress context initializes

3. **Refactored Components**
   - `CrawlerProgressContext`: Now uses shared `JiraCache` via `useJiraCache()`
   - `JiraIssuesSection`: Removed local instance, uses `useJiraCache()`
   - `AssignmentPicker`: Removed local instance, uses `useJiraCache()`
   - `HistoryDetail`: Removed local instance, uses `useJiraCache()`

## Benefits
- **Fixes the bug**: Progress events now flow correctly from the single crawler to the progress bar
- **Better architecture**: Single source of truth for Jira cache and crawler state
- **Performance**: Eliminates redundant crawler instances and duplicate API calls
- **Consistency**: All components see the same cached data and crawler state

## How It Works Now

```
                    JiraCacheProvider (single instance)
                            ↓
                    ┌───────────────────┐
                    │    JiraCache      │
                    │  ┌──────────────┐ │
                    │  │ JiraIssueCrawler│
                    │  └──────┬───────┘ │
                    └─────────┼─────────┘
                              │
                    ┌─────────┼─────────────┐
                    │         │             │
              ┌─────▼─────┐ ┌─▼───────┐  ┌─▼──────────┐
              │CrawlerProg│ │JiraIssues│  │Assignment  │
              │ context   │ │ Section  │  │  Picker    │
              └───────────┘ └──────────┘  └────────────┘
                    │
                    └──> CrawlerProgressBar (visible!)
```

## Testing
Build verified successfully with no TypeScript errors.

To test the fix:
1. Start the app
2. Configure Jira integration with selected projects
3. Navigate to the Buckets view where `JiraIssuesSection` renders
4. The crawler should automatically start and the progress bar should appear at the top of the app
5. Expand the progress bar to see detailed per-project progress

## Files Modified
- `/src/context/JiraCacheContext.tsx` (new file)
- `/src/main.tsx`
- `/src/context/CrawlerProgressContext.tsx`
- `/src/components/JiraIssuesSection.tsx`
- `/src/components/AssignmentPicker.tsx`
- `/src/components/HistoryDetail.tsx`
