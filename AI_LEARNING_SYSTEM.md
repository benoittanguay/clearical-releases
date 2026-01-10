# AI Learning System Implementation

## Overview

The TimePortal AI assignment system now includes sophisticated historical learning capabilities. The system learns from previous user assignments to improve suggestions over time, creating a learning loop that gets better with use.

## Architecture

### Core Components

1. **HistoricalMatchingService** (`electron/historicalMatchingService.ts`)
   - Centralized similarity matching engine
   - Multi-factor scoring (app names, descriptions, window titles, technologies, activities)
   - Efficient caching for performance
   - Pattern extraction for assignments and accounts

2. **Enhanced AIAssignmentService** (`electron/aiAssignmentService.ts`)
   - Bucket and Jira issue assignment suggestions
   - Now uses historical matching for 50% of scoring (increased from 30%)
   - Provides detailed explanations based on learned patterns

3. **Enhanced AIAccountService** (`electron/aiAccountService.ts`)
   - Tempo account selection suggestions
   - Now uses historical matching for 60% of scoring (increased from 50%)
   - Context-aware learning from similar work patterns

## How It Works

### Similarity Matching Algorithm

The `HistoricalMatchingService` calculates similarity between current activity and historical entries using weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| App Name Match | 30% | Exact matches of application names (strongest signal) |
| Description Keywords | 25% | Keyword overlap in activity descriptions |
| Window Title Keywords | 20% | Keyword overlap in window titles |
| Technology Match | 15% | Matching detected technologies |
| Activity Type Match | 10% | Matching detected activity types |

**Example Similarity Calculation:**
```typescript
// Current activity: Working in VS Code on React component
{
  appNames: ['Visual Studio Code'],
  description: 'Implementing user profile component with React hooks',
  windowTitles: ['UserProfile.tsx - MyProject'],
  detectedTechnologies: ['react', 'typescript'],
  detectedActivities: ['development']
}

// Historical entry: Previous React work
{
  appNames: ['Visual Studio Code'],
  description: 'Created login component using React and TypeScript',
  windowTitles: ['Login.tsx - MyProject'],
  detectedTechnologies: ['react', 'typescript'],
  assignment: { type: 'jira', jiraIssue: { key: 'PROJ-123' } }
}

// Similarity Score: 0.85 (85%)
// - App name: 100% match (0.30)
// - Description: 60% keyword overlap (0.15)
// - Window title: 50% match (0.10)
// - Technology: 100% match (0.15)
// - Activity: 100% match (0.10)
// Plus frequency boost: +15% (used 5 times)
```

### Assignment Pattern Extraction

The system groups similar historical entries by their assignments and calculates aggregate patterns:

1. **Find Similar Entries**: Match current context against historical entries
2. **Group by Assignment**: Cluster matches by bucket ID or Jira issue key
3. **Calculate Pattern Score**:
   - Base score: Average similarity of matching entries
   - Frequency boost: Up to 30% bonus for frequent usage (5+ times)
4. **Generate Explanations**: Extract and combine reasons from matches

### Account Pattern Extraction

For Tempo accounts, the system learns project-specific preferences:

1. **Exact Issue Match**: Prioritize accounts used with the exact issue (2x weight)
2. **Project Match**: Consider accounts used with any issue in the project
3. **Recency Factor**: Weight recent usage more heavily (40% of score)
4. **Frequency Factor**: Prefer frequently used accounts (60% of score)

## Integration Points

### Frontend Changes

**HistoryDetail.tsx**
```typescript
// Now passes full entries for context-aware learning
const result = await window.electron?.ipcRenderer?.selectTempoAccount?.({
    issue,
    accounts,
    description: entry.description || '',
    historicalAccounts,
    historicalEntries: entries  // NEW: Full entries
});
```

### Backend Changes

**main.ts IPC Handler**
```typescript
ipcMain.handle('select-tempo-account', async (event, request: {
    issue: LinkedJiraIssue;
    accounts: TempoAccount[];
    description?: string;
    historicalAccounts: HistoricalAccountUsage[];
    historicalEntries?: any[];  // NEW: Full entries
}) => {
    // ...
});
```

### Type Definitions

**electron.d.ts**
```typescript
selectTempoAccount: (request: {
    // ... existing fields
    historicalEntries?: TimeEntry[];  // NEW
}) => Promise<AccountSelection>;
```

## Scoring Weight Changes

### AIAssignmentService

**Before:**
- Keyword matching: 40%
- Linked Jira issue: 30%
- Historical usage: 30%

**After:**
- Keyword matching: 30%
- Linked Jira issue: 20%
- **Historical usage: 50%** ⬆️ (Enhanced)

### AIAccountService

**Before:**
- Historical usage: 50%
- Keyword matching: 25%
- Project name: 15%
- Description: 10%

**After:**
- **Historical usage: 60%** ⬆️ (Enhanced)
- Keyword matching: 20%
- Project name: 10%
- Description: 10%

## Performance Considerations

### Caching
- **Keyword Cache**: Stores extracted keywords (max 1000 entries)
- **LRU Eviction**: Oldest entries removed when cache is full
- **Cache Clearing**: Available via `clearCache()` method

### Limits
- **Max Historical Entries**: 50 most recent entries considered
- **Max Results**: Top 10-20 matches returned
- **Min Similarity Threshold**: 0.25 (25%) to be considered

### Complexity
- Similarity calculation: O(n × m) where n = historical entries, m = keywords
- Pattern extraction: O(k) where k = number of matches
- Overall: Linear with historical entry count, sub-second performance

## User Experience

### Improved Suggestions

**Scenario 1: New React Component**
```
User Activity: Working on ProfileCard.tsx in VS Code
Historical Data: Previously assigned similar React work to JIRA-456

Result: AI suggests JIRA-456 with 87% confidence
Reason: "learned from history: same apps used (Visual Studio Code), similar work description"
```

**Scenario 2: Tempo Account Selection**
```
User Activity: Logging time to JIRA-789 (Project XYZ)
Historical Data: Used account "Development" 8 times with Project XYZ

Result: AI suggests "Development" account with 92% confidence
Reason: "used 8 times with this project, recently used"
```

### Learning Loop

1. **First Use**: AI suggests based on keywords and project affinity
2. **User Assigns**: User selects bucket/issue/account
3. **Entry Saved**: Assignment stored with full context
4. **Next Time**: AI recognizes similar context and suggests the same assignment
5. **Confidence Grows**: More uses = higher confidence = more likely to auto-assign

## Configuration

### Confidence Thresholds

Set in user settings:
```typescript
settings: {
  ai: {
    assignmentConfidenceThreshold: 0.7,  // 70% for auto-assignment
    accountConfidenceThreshold: 0.8      // 80% for auto-account
  }
}
```

### Disabling Learning

Historical matching can be disabled by:
1. Not passing `historicalEntries` (falls back to basic matching)
2. Clearing history (removes learned patterns)

## Testing & Validation

### Unit Tests (Recommended)

```typescript
describe('HistoricalMatchingService', () => {
  it('should match by app name', () => {
    const service = new HistoricalMatchingService();
    const context = { appNames: ['VS Code'], ... };
    const entries = [{ windowActivity: [{ appName: 'VS Code' }], ... }];
    const matches = service.findSimilarEntries(context, entries);
    expect(matches[0].score).toBeGreaterThan(0.3);
  });
});
```

### Manual Testing Scenarios

1. **Same App, Same Description**
   - Assign work in VS Code to JIRA-123
   - Do similar work in VS Code
   - Verify AI suggests JIRA-123

2. **Different App, Same Keywords**
   - Assign "API development" in Terminal to bucket "Backend"
   - Do "API testing" in Postman
   - Verify AI considers "Backend" bucket

3. **Frequency Boost**
   - Assign similar work 5 times to same issue
   - Do similar work again
   - Verify high confidence (>80%)

## Future Enhancements

### Potential Improvements

1. **Machine Learning Integration**
   - TF-IDF for better keyword weighting
   - Neural embeddings for semantic similarity
   - Collaborative filtering across users (optional)

2. **Temporal Patterns**
   - Time-of-day preferences (morning meetings vs afternoon coding)
   - Day-of-week patterns (Friday deployments vs Monday planning)
   - Sprint phase awareness (early sprint = feature work, late sprint = testing)

3. **User Feedback Loop**
   - Track when users override AI suggestions
   - Learn from corrections
   - Adapt confidence thresholds per user

4. **Advanced Context**
   - Git branch detection
   - Commit message analysis
   - Calendar integration (meeting context)

### Privacy & Data

The learning system:
- ✅ Runs entirely on-device
- ✅ No data sent to external servers
- ✅ Respects user privacy
- ✅ Can be cleared/disabled anytime

## Troubleshooting

### Low Confidence Scores

**Problem**: AI rarely auto-assigns even with history

**Solutions**:
1. Lower confidence thresholds in settings
2. Add more historical data (use the app more)
3. Ensure descriptions are meaningful
4. Check that app names are being detected

### Incorrect Suggestions

**Problem**: AI suggests wrong assignments

**Solutions**:
1. Review and correct past assignments
2. Clear history and start fresh
3. Add more descriptive activity summaries
4. Ensure window titles are meaningful

### Performance Issues

**Problem**: UI lag when making assignments

**Solutions**:
1. Clear keyword cache: `service.clearCache()`
2. Reduce MAX_HISTORICAL_ENTRIES limit
3. Check historical entry count (>100 may be slow)

## Code References

### Key Files
- `/electron/historicalMatchingService.ts` - Core similarity engine
- `/electron/aiAssignmentService.ts` - Assignment suggestions
- `/electron/aiAccountService.ts` - Account suggestions
- `/electron/main.ts` - IPC handlers (lines 1583-1628)
- `/src/components/HistoryDetail.tsx` - Frontend integration (lines 311-330)
- `/src/types/electron.d.ts` - Type definitions (lines 162-177)

### Key Methods
- `HistoricalMatchingService.findSimilarEntries()` - Find matching entries
- `HistoricalMatchingService.extractAssignmentPatterns()` - Group by assignment
- `HistoricalMatchingService.extractAccountPatterns()` - Find account patterns
- `AIAssignmentService.calculateHistoricalBucketMatch()` - Bucket learning
- `AIAssignmentService.calculateHistoricalJiraMatch()` - Jira learning
- `AIAccountService.calculateEnhancedHistoricalScore()` - Account learning

## Summary

The AI learning system transforms TimePortal from a simple time tracking tool into an intelligent assistant that learns from your work patterns. By analyzing historical assignments across multiple dimensions (apps, descriptions, technologies, activities), it provides increasingly accurate suggestions that save time and reduce cognitive load.

The system achieves this while maintaining privacy (all processing on-device), performance (efficient caching and limits), and transparency (human-readable explanations for every suggestion).

As users interact with the system, it continuously improves, creating a personalized time tracking experience that adapts to individual work patterns and preferences.
