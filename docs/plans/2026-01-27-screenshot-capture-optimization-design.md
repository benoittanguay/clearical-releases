# Screenshot Capture Optimization Design

**Status**: Completed
**Date**: 2026-01-27
**Version**: 1.7.8 QA Feedback

## Problem Statement

The current screenshot capture logic is too aggressive for multi-window users who frequently switch between apps. Screenshots are taken basically every time the user returns to a screen since it exceeds the settings threshold.

**Consequences:**
- Overwhelming number of screenshots during a workday
- Skewed sampling for the AI Summary agent (583 raw → 20 sampled in the logs)
- Reduced accuracy of activity summaries

## Current Behavior

From `src/hooks/useTimer.ts`:

```
INTERVAL_SCREENSHOT_TIME = 2 minutes (screenshot if no window change)
WINDOW_POLL_INTERVAL = 1 second
MIN_SCREENSHOT_INTERVAL = 5 seconds (rate limit between ANY screenshots)
```

**Trigger logic:**
1. **Window change** → immediate screenshot (if different app or significant title change)
2. **Interval** → screenshot every 2 minutes while on same window
3. **Rate limit** → minimum 5 seconds between any screenshots

**The issue**: `isSignificantWindowChange()` returns `true` when switching back to an app you were just on 10 seconds ago, triggering a new screenshot every time.

## Proposed Solution

Replace the threshold-based logic with a **per-app/window timer** that tracks time since last screenshot for each app/window independently.

**Key insight**: We don't need a screenshot when returning to an app we just captured 30 seconds ago. We only need one if it's been 2+ minutes since our last screenshot of that app/window.

## Open Design Question

**Should the cooldown tracking be per-app or per-window?**

| Option | Behavior | Trade-off |
|--------|----------|-----------|
| **A. Per-app** | Returning to Chrome after 30s = no screenshot, regardless of which Chrome tab | Simpler, fewer screenshots, but might miss context if you switch Chrome tabs frequently |
| **B. Per-window** (app + title) | Returning to "Gmail - Chrome" after 30s = no screenshot, but "Jira - Chrome" = screenshot | More granular, captures different contexts, but might still be chatty for tab-switchers |
| **C. Per-app with browser exception** | Per-app for most apps, but per-stable-identifier for browsers (uses existing URL extraction) | Best of both worlds, but more complex |

**Awaiting user input on this question.**

## Secondary Issue (Fixed)

The user also observed what appeared to be a Jira issue assignment "reverting" from a good match to a less accurate one. From the logs:

```
[HistoryDetail] Auto-assigning with confidence: 0.75 → DEM-3
[HistoryDetail] Auto-assigning with confidence: 0.75 → DES-380
[HistoryDetail] Auto-assigning with confidence: 0.75 → DEM-4
```

**Root cause**: Race condition in `autoAssignWork()` - multiple concurrent calls were proceeding because:
1. The function only checked `selectedAssignment` (local state) which could be stale in closures
2. No protection against concurrent calls
3. Cascading React effects triggered multiple invocations

**Fix applied** (commit pending):
- Added `isAutoAssigningRef` to prevent concurrent auto-assign calls
- Added `autoAssignedForEntryRef` to prevent multiple auto-assigns for the same entry
- Now checks both `selectedAssignment` AND `entry.assignment` to handle stale closures
- Refs are reset when switching to a different entry

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useTimer.ts` | Screenshot trigger logic, window polling, activity tracking |
| `src/context/SettingsContext.tsx` | Activity filtering thresholds and settings |
| `electron/main.ts` | Screenshot capture, active window detection |

## Next Steps

1. Get user input on per-app vs per-window tracking
2. Design the data structure for tracking last-screenshot-time per entity
3. Define the cooldown duration (likely reuse existing 2-minute interval)
4. Plan implementation changes to `useTimer.ts`
