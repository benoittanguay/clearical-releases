# Bug Fix: Assignment Persistence Issue

## Issue Description
When assigning a Jira issue or Tempo account in the Activity Details screen, the assignment was not being persisted. When navigating away and returning to the screen, the fields were cleared.

## Root Cause
The bug was caused by **stale closure** issues in the `StorageContext.tsx` file. All entry update functions were using the `entries` state variable directly from the closure instead of using React's functional update pattern.

### Problematic Code Pattern
```typescript
const setEntryAssignment = (entryId: string, assignment: WorkAssignment | null) => {
    setEntries(entries.map(entry =>  // ❌ Uses stale 'entries' from closure
        entry.id === entryId
            ? { ...entry, assignment: assignment || undefined }
            : entry
    ));
};
```

When this function was called, it would reference the `entries` array from when the function was created, not the current state. This meant that:
1. The update would be applied to an outdated entries array
2. When React triggered the useEffect to persist to localStorage, it might save the wrong data
3. Concurrent updates could overwrite each other

## Solution
Changed all state update functions in `StorageContext.tsx` to use the functional update pattern with `prevEntries`:

### Fixed Code Pattern
```typescript
const setEntryAssignment = (entryId: string, assignment: WorkAssignment | null) => {
    setEntries(prevEntries => prevEntries.map(entry =>  // ✅ Uses current state
        entry.id === entryId
            ? { ...entry, assignment: assignment || undefined }
            : entry
    ));
};
```

## Functions Fixed
The following functions in `StorageContext.tsx` were updated:
1. `updateEntry` - General entry updates
2. `removeEntry` - Entry removal
3. `removeActivityFromEntry` - Activity deletion
4. `removeAllActivitiesForApp` - Bulk activity deletion
5. `removeScreenshotFromEntry` - Screenshot deletion
6. `addManualActivityToEntry` - Manual activity addition
7. `linkJiraIssueToEntry` - Jira issue linking (legacy)
8. `unlinkJiraIssueFromEntry` - Jira issue unlinking (legacy)
9. `setEntryAssignment` - Work assignment (Jira/bucket)
10. `setEntryTempoAccount` - Tempo account assignment

## Impact
This fix ensures that:
- Jira issue assignments are properly persisted to localStorage
- Tempo account selections are properly persisted to localStorage
- All entry modifications are saved correctly
- No race conditions occur when multiple updates happen in quick succession
- Data integrity is maintained across navigation

## Testing Recommendations
1. Assign a Jira issue to an activity and navigate away/back - verify it persists
2. Select a Tempo account and navigate away/back - verify it persists
3. Make multiple rapid changes to assignments - verify all are saved
4. Test other entry modifications (descriptions, activities, etc.) - verify they persist

## Files Changed
- `/src/context/StorageContext.tsx` - Fixed all entry update functions to use functional updates
