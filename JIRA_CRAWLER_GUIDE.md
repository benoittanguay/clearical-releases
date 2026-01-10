# Jira Issue Crawler - Technical Documentation

## Overview

The Jira Issue Crawler is an intelligent bi-directional crawling system that discovers all issues in a Jira project by incrementing and decrementing issue numbers. This solves the limitation of JQL queries which only return a maximum of 100 issues and miss deleted or restricted issues.

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer (React)                        │
│  - AssignmentPicker: Issue selection interface              │
│  - JiraCrawlerStatus: Status monitoring & controls          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cache Layer (JiraCache)                    │
│  - Coordinates JQL queries and crawler                      │
│  - Provides unified interface for issue retrieval           │
│  - Manages background sync                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Crawler Layer (JiraIssueCrawler)               │
│  - Bi-directional incremental discovery                    │
│  - Rate limiting & progress tracking                        │
│  - Persistent state across app restarts                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Jira REST API (JiraService)                 │
│  - GET /rest/api/3/issue/{issueKey}                        │
│  - Authentication & error handling                          │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### Bi-Directional Crawling Algorithm

The crawler uses a dual-direction approach to efficiently discover all issues:

```
Starting Issue: DES-230
         │
         ├───────► Upward Crawl
         │         DES-231, DES-232, DES-233...
         │         Stop after 50 consecutive 404s
         │
         └───────► Downward Crawl
                   DES-229, DES-228, DES-227...
                   Stop after 50 consecutive 404s OR reaching issue #0
```

### State Tracking

Each project maintains persistent progress:

```typescript
interface ProjectCrawlProgress {
    projectKey: string;
    highestKnownIssueNumber: number;      // e.g., 456
    lowestKnownIssueNumber: number;       // e.g., 1
    upwardsCrawlComplete: boolean;        // true when hit 50 404s going up
    downwardsCrawlComplete: boolean;      // true when hit 50 404s going down
    totalIssuesFound: number;             // e.g., 312
    consecutiveUpward404s: number;        // Current streak
    consecutiveDownward404s: number;      // Current streak
    lastCrawlTimestamp: number;           // Unix timestamp
}
```

### Rate Limiting

The crawler respects Jira API limits:

- **Delay between requests**: 200ms (5 requests/second)
- **Batch save frequency**: Every 10 issues
- **Concurrent project crawls**: Independent per-project
- **Backoff on errors**: 1 second delay on non-404 errors

## Integration Points

### 1. Initialization

```typescript
import { JiraCache } from './services/jiraCache';

const jiraCache = new JiraCache();

// Initialize with Jira credentials
jiraCache.initializeService(
    'https://your-domain.atlassian.net',
    'user@example.com',
    'api-token-here'
);
```

### 2. Start Crawling

```typescript
// Crawl specific projects
await jiraCache.crawlProjects(['DES', 'BEEM']);

// Resume incomplete crawls
await jiraCache.resumeCrawls(['DES', 'BEEM']);
```

### 3. Retrieve Issues

The cache automatically uses crawler data when available:

```typescript
// Returns all issues from crawler if available, falls back to JQL
const issues = await jiraCache.getProjectIssues('DES');
console.log(`Found ${issues.length} issues`);
```

### 4. Monitor Progress

```typescript
// Subscribe to real-time updates
const unsubscribe = jiraCache.onCrawlStatus((status) => {
    console.log(`${status.projectKey}: Issue ${status.currentIssueNumber}`);
    console.log(`Found: ${status.issuesFound}, 404s: ${status.consecutive404s}`);

    if (status.isComplete) {
        console.log(`${status.direction} crawl complete!`);
    }
});

// Get statistics
const stats = jiraCache.getCrawlerStatistics();
console.log(`Total: ${stats.totalIssues} issues across ${stats.totalProjects} projects`);
```

## Storage Strategy

### localStorage Keys

1. **`jira-crawler-state`** - Crawler state
   - Projects progress tracking
   - All cached issues
   - Last update timestamp

2. **`jira-issues-cache`** - JiraCache state
   - JQL query results (assigned issues, epics)
   - Crawler enabled flag
   - Sync timestamps

### Data Size Considerations

- **Average issue size**: ~2KB JSON
- **1000 issues**: ~2MB storage
- **localStorage limit**: ~5-10MB (varies by browser)

For large projects (>2000 issues), consider:
1. Using IndexedDB for storage
2. Implementing pagination in AssignmentPicker
3. Periodic cleanup of old issues

## Performance Optimization

### Crawl Speed

For a project with 1000 issues:
- **Time**: ~3.3 minutes (1000 issues × 200ms)
- **API calls**: ~1000-1100 (includes 404s)
- **Storage writes**: ~100 (batch size: 10)

### Incremental Updates

After initial crawl, subsequent runs are fast:
- Only crawls new issues beyond `highestKnownIssueNumber`
- Resumes from last known position
- Typical update: <30 seconds

## Error Handling

### Graceful Degradation

1. **Network errors**: Pause and retry with backoff
2. **Authentication errors**: Stop crawl, notify user
3. **404 errors**: Track streak, stop at threshold
4. **Storage errors**: Log warning, continue in-memory

### Recovery Mechanisms

```typescript
// Clear corrupt state and restart
jiraCache.clearCache();
await jiraCache.crawlProjects(['DES']);

// Reset specific project
jiraCache.resetProject('DES');
await jiraCache.crawlProject('DES');
```

## UI Components

### JiraCrawlerStatus Component

Display crawler status in settings or debug panel:

```tsx
import { JiraCrawlerStatus } from './components/JiraCrawlerStatus';

<JiraCrawlerStatus jiraCache={jiraCache} className="mt-4" />
```

Features:
- Real-time progress bars per project
- Enable/disable crawler toggle
- Clear cache button
- Statistics display

### AssignmentPicker Enhancement

The AssignmentPicker automatically uses crawler data:

```tsx
// No changes needed - it automatically uses cached issues
<AssignmentPicker
    value={assignment}
    onChange={setAssignment}
    placeholder="Select Jira issue..."
/>
```

## Configuration

### Crawler Config

Customize crawler behavior:

```typescript
const crawler = new JiraIssueCrawler({
    consecutiveNotFoundThreshold: 50,  // How many 404s before stopping
    requestDelayMs: 200,               // Delay between requests
    batchSize: 10,                     // Issues before saving progress
    maxIssueNumber: 999999             // Safety limit
});
```

### Cache Config

Adjust cache TTL:

```typescript
// In JiraCache.ts
private static readonly CACHE_DURATION = 5 * 60 * 1000;  // 5 minutes
private static readonly SYNC_INTERVAL = 30 * 60 * 1000;  // 30 minutes
```

## Testing Strategy

### Unit Tests

```typescript
describe('JiraIssueCrawler', () => {
    it('should crawl upward until 50 consecutive 404s', async () => {
        // Mock JiraService to return 404s
        const crawler = new JiraIssueCrawler();
        await crawler.crawlProject('TEST');

        const progress = crawler.getProjectProgress('TEST');
        expect(progress.upwardsCrawlComplete).toBe(true);
        expect(progress.consecutiveUpward404s).toBe(50);
    });

    it('should handle gaps in issue numbering', async () => {
        // Mock JiraService with gaps (e.g., deleted issues)
        // Verify crawler continues past gaps
    });

    it('should resume from last known position', async () => {
        // Simulate interrupted crawl
        // Verify resume continues from correct position
    });
});
```

### Integration Tests

```typescript
describe('JiraCache with Crawler', () => {
    it('should prefer crawler data over JQL', async () => {
        const cache = new JiraCache();
        await cache.crawlProjects(['DES']);

        const issues = await cache.getProjectIssues('DES');
        expect(issues.length).toBeGreaterThan(100); // More than JQL limit
    });
});
```

## Troubleshooting

### Issue: Crawler keeps running

**Cause**: Never hits 50 consecutive 404s (e.g., issue numbers go to 10000+)

**Solution**: Adjust `maxIssueNumber` config or set `consecutiveNotFoundThreshold` lower

### Issue: Storage quota exceeded

**Cause**: Too many projects/issues cached

**Solution**:
1. Clear old projects: `jiraCache.resetProject('OLD_PROJECT')`
2. Implement IndexedDB storage for large datasets
3. Use pagination in UI

### Issue: Missing recent issues

**Cause**: Cache not syncing or crawler not running

**Solution**:
```typescript
// Force refresh
await jiraCache.syncAllData(selectedProjects);

// Or manually trigger crawl
await jiraCache.crawlProjects(selectedProjects);
```

## Future Enhancements

### Planned Features

1. **Smart Resume**: Detect new issues and only crawl the gap
2. **Parallel Crawling**: Multiple projects simultaneously
3. **IndexedDB Storage**: Support larger datasets
4. **Delta Updates**: Only fetch changed issues
5. **Webhook Integration**: Real-time updates from Jira

### Performance Improvements

1. **Adaptive Rate Limiting**: Adjust based on API response times
2. **Predictive Crawling**: Learn project patterns to optimize range
3. **Compression**: Gzip cached data for storage efficiency

## API Reference

### JiraIssueCrawler

#### Methods

- `initializeService(baseUrl, email, apiToken)` - Configure Jira credentials
- `crawlProject(projectKey, startingIssueNumber?)` - Start/resume crawling a project
- `crawlProjects(projectKeys)` - Crawl multiple projects concurrently
- `resumeCrawls(projectKeys)` - Resume incomplete crawls
- `getProjectIssues(projectKey)` - Get cached issues for a project
- `getAllIssues()` - Get all cached issues
- `getProjectProgress(projectKey)` - Get crawl progress
- `isProjectComplete(projectKey)` - Check if crawl is done
- `getStatistics()` - Get overall statistics
- `resetProject(projectKey)` - Clear cache for a project
- `clearAll()` - Clear all cached data
- `onStatusUpdate(callback)` - Subscribe to status updates

### JiraCache

#### Methods

- `initializeService(baseUrl, email, apiToken)` - Configure Jira credentials
- `setCrawlerEnabled(enabled)` - Enable/disable crawler
- `isCrawlerEnabled()` - Check crawler status
- `crawlProjects(projectKeys)` - Trigger project crawl
- `resumeCrawls(projectKeys)` - Resume incomplete crawls
- `getCrawlerStatistics()` - Get crawler stats
- `getProjectIssues(projectKey, forceRefresh?)` - Get issues (prefers crawler)
- `getAssignedIssues(forceRefresh?)` - Get user's assigned issues
- `getProjectEpics(projectKey, forceRefresh?)` - Get project epics
- `searchIssues(searchText)` - Search issues by text
- `syncAllData(selectedProjects)` - Background sync
- `getCacheInfo()` - Get cache information
- `clearCache()` - Clear all caches
- `onCrawlStatus(callback)` - Subscribe to crawl status

## License

Part of the TimePortal application.
