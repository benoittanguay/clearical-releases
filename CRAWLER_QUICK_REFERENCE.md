# Jira Crawler - Quick Reference

## Quick Start

```typescript
import { JiraCache } from './services/jiraCache';

// 1. Initialize
const jiraCache = new JiraCache();
jiraCache.initializeService(baseUrl, email, apiToken);

// 2. Start crawling
await jiraCache.crawlProjects(['DES', 'BEEM']);

// 3. Use the cached data (automatic in AssignmentPicker)
const issues = await jiraCache.getProjectIssues('DES');
```

## Common Operations

### Enable/Disable Crawler
```typescript
jiraCache.setCrawlerEnabled(true);   // Enable
jiraCache.setCrawlerEnabled(false);  // Disable
```

### Monitor Progress
```typescript
jiraCache.onCrawlStatus((status) => {
    console.log(`${status.projectKey}: ${status.currentIssueNumber} (${status.issuesFound} found)`);
});
```

### Get Statistics
```typescript
const stats = jiraCache.getCrawlerStatistics();
console.log(`Total: ${stats.totalIssues} issues, ${stats.completeProjects} projects done`);
```

### Resume Incomplete Crawls
```typescript
await jiraCache.resumeCrawls(['DES', 'BEEM']);
```

### Reset Project
```typescript
jiraCache.crawler.resetProject('DES');
```

### Clear All Cache
```typescript
jiraCache.clearCache();
```

## UI Components

### Status Display
```tsx
import { JiraCrawlerStatus } from './components/JiraCrawlerStatus';

<JiraCrawlerStatus jiraCache={jiraCache} />
```

## Configuration

```typescript
const crawler = new JiraIssueCrawler({
    consecutiveNotFoundThreshold: 50,  // Stop after N 404s
    requestDelayMs: 200,               // 5 req/sec
    batchSize: 10,                     // Save progress every N issues
    maxIssueNumber: 999999             // Safety limit
});
```

## Performance

| Project Size | Crawl Time | API Calls |
|-------------|------------|-----------|
| 100 issues  | ~20 sec    | ~150      |
| 500 issues  | ~1.7 min   | ~600      |
| 1000 issues | ~3.3 min   | ~1100     |

## Troubleshooting

### Crawler not starting?
```typescript
// Check if enabled
console.log(jiraCache.isCrawlerEnabled());

// Check credentials
jiraCache.initializeService(baseUrl, email, apiToken);
```

### Storage quota exceeded?
```typescript
// Clear old projects
jiraCache.crawler.resetProject('OLD_PROJECT');

// Or clear everything
jiraCache.clearCache();
```

### Missing recent issues?
```typescript
// Force refresh
await jiraCache.syncAllData(selectedProjects);
```

## API Quick Reference

### JiraIssueCrawler
- `crawlProject(projectKey, startNumber?)`
- `crawlProjects(projectKeys)`
- `resumeCrawls(projectKeys)`
- `getProjectIssues(projectKey)`
- `getAllIssues()`
- `getStatistics()`
- `resetProject(projectKey)`
- `clearAll()`

### JiraCache
- `crawlProjects(projectKeys)`
- `resumeCrawls(projectKeys)`
- `setCrawlerEnabled(enabled)`
- `isCrawlerEnabled()`
- `getProjectIssues(projectKey)`
- `getCrawlerStatistics()`
- `clearCache()`

## Storage Keys

- `jira-crawler-state` - Crawler progress & issues
- `jira-issues-cache` - JQL cache & settings

## Rate Limits

- Default: 200ms delay = 5 req/sec = 18,000 req/hour
- Jira Cloud limit: 10,000 req/hour per user
- Crawler stays safely under limit

## Best Practices

1. **Auto-resume on startup** - Resume incomplete crawls when app loads
2. **Background crawling** - Don't block UI, use non-blocking calls
3. **Monitor storage** - Watch localStorage size, clear old projects
4. **User feedback** - Show progress, don't hide the crawl
5. **Error handling** - Always catch and log errors

## Example: Complete Integration

```typescript
import { useEffect, useState } from 'react';
import { useSettings } from './context/SettingsContext';
import { JiraCache } from './services/jiraCache';
import { JiraCrawlerStatus } from './components/JiraCrawlerStatus';

export function JiraSettings() {
    const { settings } = useSettings();
    const [jiraCache] = useState(() => new JiraCache());

    // Auto-initialize and resume
    useEffect(() => {
        const { jira } = settings;
        if (jira?.enabled && jira.selectedProjects?.length) {
            jiraCache.initializeService(jira.baseUrl, jira.email, jira.apiToken);
            jiraCache.setSelectedProjects(jira.selectedProjects);
            jiraCache.resumeCrawls(jira.selectedProjects);
        }
    }, [settings.jira]);

    return (
        <div>
            <h2>Jira Settings</h2>
            {/* Your settings UI */}
            <JiraCrawlerStatus jiraCache={jiraCache} />
        </div>
    );
}
```
