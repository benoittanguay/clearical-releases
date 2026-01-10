# Jira Crawler Visual Feedback Implementation

This document describes the visual feedback system implemented for the Jira crawler process in TimePortal.

## Overview

The Jira crawler runs in the background to discover all issues in selected projects by incrementing/decrementing issue numbers. This implementation provides users with clear visual feedback about the crawler's progress.

## Architecture

### 1. **CrawlerProgressContext** (`src/context/CrawlerProgressContext.tsx`)

A React context that manages crawler progress state globally across the app.

**Key Features:**
- Subscribes to crawler status updates via `JiraCache.onCrawlStatus()`
- Tracks per-project progress (upward/downward crawling)
- Calculates overall progress across all projects
- Manages dismiss/restore state for the progress bar

**State Management:**
```typescript
interface ProjectProgress {
    projectKey: string;
    upwardProgress: number;  // 0-100
    downwardProgress: number; // 0-100
    totalProgress: number; // 0-100
    issuesFound: number;
    isComplete: boolean;
    currentDirection: 'upward' | 'downward' | 'idle';
}
```

**Exposed Values:**
- `isActive`: Whether any crawl is currently running
- `projects`: Record of all project progress states
- `overallProgress`: Combined progress percentage
- `totalIssuesFound`: Sum of all issues discovered
- `isDismissed`: Whether user has dismissed the progress bar
- `dismiss()` / `restore()`: User control functions

### 2. **CrawlerProgressBar** (`src/components/CrawlerProgressBar.tsx`)

A global progress bar component displayed at the top of the app.

**Features:**

#### Collapsed View (Default)
- Thin bar at the top of the screen
- Shows overall sync status and progress
- Animated sync icon when active
- Smooth progress bar with shimmer effect
- Displays total issues discovered
- Summary text: "Syncing: DES 45%, BEEM 78%"
- Dismiss button (X) - can be closed but returns when new sync starts

#### Expanded View (Click to Expand)
- Detailed per-project breakdown
- Dual progress bars for upward/downward crawling
- Direction indicators (↑ ↓)
- Shows issues discovered per project
- Lists completed projects
- Informational text about the crawler

**Design Principles:**
- Non-intrusive but always visible when active
- Uses existing color scheme (gray-800 background, green accent)
- Smooth animations and transitions
- Compact - minimal vertical space
- Matches the dense UI style of the app

### 3. **JiraIssuesSection Updates** (`src/components/JiraIssuesSection.tsx`)

The Buckets page now includes a detailed crawler status section.

**Features:**
- Shows crawler sync status above the issues list
- Per-project progress with completion checkmarks
- Direction indicators for active crawls
- Total issues discovered count
- Links to top bar for more detailed progress

**Visual Indicators:**
- Green checkmark for completed projects
- Animated sync icon while active
- Direction badges (↑ ↓) for active crawls
- Percentage progress for incomplete projects

## User Experience Flow

### 1. **Initial Sync**
When user enables Jira and selects projects:
1. Progress bar appears at top of app
2. Shows "Syncing: [PROJECT] 0%" for each project
3. Animated sync icon rotates
4. Progress bar fills smoothly as issues are discovered

### 2. **During Crawl**
- Top bar shows overall progress across all projects
- Click to expand for per-project details
- Dual progress bars show upward/downward crawl separately
- Direction indicators show which way crawler is currently moving
- Issues count updates in real-time

### 3. **Completion**
- Progress reaches 100% for all projects
- Sync icon stops spinning
- Shows "Sync complete" status
- Completed projects shown with green checkmarks
- Bar can be dismissed

### 4. **Resuming**
- If app restarts with incomplete crawls, progress resumes
- Progress bar automatically reappears (even if previously dismissed)
- Continues from where it left off

## Integration Points

### App.tsx
```tsx
<CrawlerProgressBar />
```
Placed at the very top of the app, above all other content.

### main.tsx
```tsx
<CrawlerProgressProvider>
  <App />
</CrawlerProgressProvider>
```
Wraps the entire app to provide global access to crawler state.

### JiraIssuesSection
Uses `useCrawlerProgress()` hook to display detailed status in the Buckets page.

## Technical Implementation Details

### Real-time Updates
The system listens to crawler status updates via callbacks:
```typescript
jiraCache.onCrawlStatus((status: CrawlStatus) => {
    handleCrawlStatusUpdate(status);
});
```

Updates are received for each issue discovered, providing real-time progress.

### Progress Calculation
- **Upward Progress**: Based on consecutive 404s and issues found
- **Downward Progress**: Based on consecutive 404s and reaching issue #1
- **Total Progress**: Average of upward and downward progress
- **Overall Progress**: Average across all projects

### State Persistence
Crawler state is persisted in localStorage via `JiraIssueCrawler`:
- Resumes from last known position on app restart
- Remembers highest/lowest issue numbers discovered
- Tracks consecutive 404s for stopping criteria

### Performance
- Updates are throttled by the crawler (200ms between requests)
- Progress bar only re-renders when progress state changes
- Efficient React state updates using functional setState patterns
- No performance impact when crawler is idle

## Styling

### Colors
- Background: `bg-gray-800`
- Border: `border-gray-700`
- Progress bar: `bg-gradient-to-r from-green-600 to-green-400`
- Active indicator: `text-green-400`
- Completed: `text-green-400` with checkmark

### Animations
- Sync icon: 2s spin animation
- Progress bar: Smooth transition with shimmer effect
- Expand/collapse: Rotate transition on chevron
- Fade in: `animate-fade-in` for expanded view

### Responsive Design
- Works at all screen sizes
- Scrollable expanded view if many projects
- Fixed position at top of viewport

## Future Enhancements

Potential improvements for future iterations:

1. **Pause/Resume Controls**
   - Allow user to pause crawling
   - Useful for API rate limiting concerns

2. **Speed Controls**
   - Adjust crawler request delay
   - Balance between speed and API limits

3. **Estimated Time Remaining**
   - Calculate based on current rate
   - Show "~5 minutes remaining"

4. **Error Visualization**
   - Show API errors inline
   - Suggest solutions for rate limits

5. **Statistics Dashboard**
   - Historical sync performance
   - Issues discovered over time
   - API usage metrics

6. **Manual Trigger**
   - Button to manually start crawler
   - Refresh specific projects on demand

7. **Background Notifications**
   - Desktop notifications when sync completes
   - Only if app is in background

## Testing Scenarios

To test the implementation:

1. **New User Setup**
   - Enable Jira integration
   - Select multiple projects
   - Watch progress bar appear and crawl

2. **Resume After Restart**
   - Quit app during active crawl
   - Restart app
   - Progress should resume from last position

3. **Multiple Projects**
   - Select 3+ projects
   - Verify independent progress tracking
   - Check overall progress calculation

4. **Dismiss and Restore**
   - Dismiss progress bar during sync
   - Verify it returns when new sync starts
   - Check restore functionality

5. **Completion State**
   - Let crawler complete all projects
   - Verify checkmarks and "complete" status
   - Check that bar can be dismissed

## Files Changed

### New Files
- `/src/context/CrawlerProgressContext.tsx` - Global state management
- `/src/components/CrawlerProgressBar.tsx` - Top bar component

### Modified Files
- `/src/main.tsx` - Added CrawlerProgressProvider
- `/src/App.tsx` - Added CrawlerProgressBar component
- `/src/components/JiraIssuesSection.tsx` - Added detailed status section

### No Changes Required
- `/src/services/jiraIssueCrawler.ts` - Already emits status updates
- `/src/services/jiraCache.ts` - Already provides subscription mechanism

## Summary

This implementation provides comprehensive visual feedback for the Jira crawler process while maintaining the app's clean, minimal design aesthetic. Users can see progress at a glance via the top bar, or expand for detailed per-project information. The system handles edge cases like app restarts, dismissal, and multiple concurrent crawls gracefully.

The architecture is extensible, allowing for future enhancements without major refactoring. The separation of concerns (context for state, component for UI) makes the code maintainable and testable.
