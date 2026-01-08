# TimePortal Developer Utilities - Quick Reference

## Quick Start

### Generate Mock Data (UI)
1. Run `npm run dev`
2. Click purple button (bottom-right)
3. Enter days (e.g., 14)
4. Click "Seed"
5. Reload app

### Generate Mock Data (Console)
1. Run `npm run dev`
2. Open DevTools Console (F12)
3. Run: `seedMockData(14)`
4. Reload app

## Console Commands

```javascript
seedMockData(14)  // Generate 14 days of mock data
clearAllData()    // Clear all entries
exportData()      // Download backup JSON
```

## What Gets Generated

- **1-2 activities per day** (excludes weekends)
- **Work hours**: 9am - 6pm
- **Durations**: 30 min - 3 hours
- **Apps**: VS Code, Chrome, Slack, Terminal, Finder, etc.
- **Assignments**: Mix of buckets (Work, Meeting, Break) and Jira issues
- **Window activity**: 3-8 activities per entry with realistic titles
- **Screenshots**: Mock paths with AI descriptions

## Data Persistence

- Stored in localStorage
- Keys: `timeportal-buckets`, `timeportal-entries`
- Auto-saves on every change
- Persists across sessions
- Migration support for format changes

## DevTools Features

### Stats
- Shows current bucket and entry counts

### Seed Mock Data
- Configurable number of days
- Adds to existing data
- Weekdays only

### Data Management
- Export: Download JSON backup
- Import: Restore from JSON file

### Danger Zone
- Clear All Entries: Remove all activity data

## Important Notes

1. **DevTools only visible in development mode**
2. **Seeding adds to existing data** (doesn't replace)
3. **Always reload after seeding** to see changes
4. **Export before clearing** to preserve data
5. **Production builds exclude all dev tools**

## Files Reference

- `/src/utils/mockDataGenerator.ts` - Generation logic
- `/src/components/DevTools.tsx` - UI component
- `/src/utils/seedScript.ts` - Console commands
- `/src/context/StorageContext.tsx` - Data persistence

## Verification Checklist

### Data Persistence
- [x] Loads from localStorage on startup
- [x] Saves to localStorage on state change
- [x] Handles migration from legacy formats
- [x] No data loss between sessions
- [x] Proper error handling

### Mock Data Quality
- [x] Realistic timestamps (work hours)
- [x] Varied durations (30min - 3hrs)
- [x] Multiple apps per entry
- [x] Context-appropriate window titles
- [x] Mix of bucket and Jira assignments
- [x] Screenshot paths with descriptions
- [x] Weekday-only generation

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Data not showing | Reload the page |
| DevTools not visible | Run with `npm run dev` |
| Console commands unavailable | Check browser console for imports |
| Data overwrites entries | It shouldn't - adds to existing. Clear first if needed |

## Example Usage Scenarios

### Demo Preparation
```javascript
clearAllData()          // Start fresh
seedMockData(14)        // 2 weeks of data
// Reload app
exportData()            // Save as demo template
```

### Testing Migration
```javascript
exportData()            // Backup current data
clearAllData()          // Clear
seedMockData(7)         // Generate test data
// Test migration code
```

### Custom Data Scenarios
```typescript
import { generateMockData } from './utils/mockDataGenerator';

const buckets = [
  { id: '1', name: 'Custom', color: '#ff0000' }
];
const entries = generateMockData(30, buckets);
```

## Support

For detailed documentation, see: `/MOCK_DATA_GUIDE.md`

For implementation details, see source files in:
- `/src/utils/mockDataGenerator.ts`
- `/src/components/DevTools.tsx`
