# Mock Data Generator Guide

This guide explains how to generate and manage mock data for TimePortal development and testing.

## Overview

The mock data generator creates realistic activity entries with:
- Work hours timing (9am - 6pm)
- Varied durations (30 min - 3 hours)
- Multiple window activities per entry
- Realistic app names and window titles
- Mock screenshot paths and AI descriptions
- Assignment to buckets or Jira issues

## Data Persistence Verification

The TimePortal app uses localStorage for data persistence with the following keys:
- `timeportal-buckets` - Time buckets/categories
- `timeportal-entries` - Activity entries with window tracking data

**Persistence Flow:**
1. Data loads on app startup from localStorage (StorageContext.tsx lines 131-188)
2. Data automatically saves to localStorage when state changes (lines 209-215)
3. Migration system handles legacy data formats (lines 77-206)

**No data loss between sessions** - All entries and buckets persist automatically.

## Method 1: DevTools UI (Recommended)

When running the app in development mode, you'll see a purple floating button in the bottom-right corner.

### Features:
1. **Seed Mock Data**
   - Set the number of days (default: 14)
   - Click "Seed" to generate 1-2 activities per day
   - Excludes weekends automatically
   - Adds to existing data (doesn't overwrite)

2. **Data Management**
   - Export JSON - Download current data as backup
   - Import JSON - Restore data from a backup file

3. **Danger Zone**
   - Clear All Entries - Removes all activity data (keeps buckets)

### Usage:
1. Start the app in development mode: `npm run dev`
2. Click the purple floating button in the bottom-right
3. Enter number of days (e.g., 14)
4. Click "Seed"
5. Close and reopen the DevTools panel to see updated stats

## Method 2: Browser Console

When running in development mode, console commands are automatically available.

### Available Commands:

```javascript
// Seed 14 days of mock data (default)
seedMockData()

// Seed custom number of days
seedMockData(30)  // Seeds 30 days

// Clear all entries
clearAllData()

// Export current data
exportData()
```

### Usage:
1. Start the app: `npm run dev`
2. Open browser DevTools (F12 or Cmd+Option+I)
3. Go to Console tab
4. Run: `seedMockData(14)`
5. Reload the page to see seeded data

## Method 3: Programmatic (Advanced)

For custom seeding scenarios, you can import and use the utility functions directly:

```typescript
import { generateMockData, seedMockDataToLocalStorage, clearAllEntries } from './utils/mockDataGenerator';
import type { TimeBucket } from './context/StorageContext';

// Generate mock entries (without saving)
const buckets: TimeBucket[] = [
  { id: '1', name: 'Work', color: '#3b82f6' },
  { id: '2', name: 'Meeting', color: '#eab308' },
];
const mockEntries = generateMockData(14, buckets);

// Seed directly to localStorage
seedMockDataToLocalStorage(14);

// Clear all entries
clearAllEntries();
```

## Mock Data Structure

Each generated entry includes:

```typescript
{
  id: "uuid",
  startTime: 1704722400000,        // Timestamp in ms
  endTime: 1704729600000,
  duration: 7200000,               // 2 hours in ms
  assignment: {
    type: 'bucket',                // or 'jira'
    bucket: {
      id: '1',
      name: 'Work',
      color: '#3b82f6'
    }
  },
  description: "Feature development",
  windowActivity: [
    {
      appName: "Code",
      windowTitle: "App.tsx - TimePortal",
      timestamp: 1704722400000,
      duration: 3600000,           // 1 hour in ms
      screenshotPaths: [
        "screenshot-2024-01-08T09-00-00-000Z.png"
      ],
      screenshotDescriptions: {
        "screenshot-2024-01-08T09-00-00-000Z.png": "Code editor showing React component"
      }
    }
  ]
}
```

## Realistic Data Characteristics

### App Names
- Code (VS Code)
- Google Chrome
- Slack
- Terminal
- Finder
- Safari
- Notes
- Calendar
- Figma

### Window Titles
Context-appropriate titles for each app:
- Code: "App.tsx - TimePortal", "README.md - TimePortal"
- Chrome: "React Documentation", "Stack Overflow", "localhost:5173"
- Slack: "#engineering", "Direct Message with @john"
- Terminal: "npm run dev", "git status"

### Assignments
- 60% Bucket assignments (Work, Meeting, Break)
- 40% Jira issue assignments (TP-101, TP-102, etc.)

### Timing
- Work hours: 9am - 6pm
- Excludes weekends
- Durations: 30 minutes - 3 hours
- 1-2 activities per day

## Troubleshooting

### Data not showing after seeding
- **Solution**: Reload the page/app after seeding

### DevTools button not visible
- **Cause**: App not running in development mode
- **Solution**: Ensure you're running `npm run dev` (not production build)

### Console commands not available
- **Cause**: seedScript.ts not loaded
- **Solution**: Check main.tsx imports the seedScript in DEV mode

### Data overwrites existing entries
- **Note**: The seeding function ADDS to existing data, it doesn't replace
- **To start fresh**: Use `clearAllData()` before seeding

## Best Practices

1. **Development Testing**
   - Use DevTools UI for quick iterations
   - Export data before clearing if you want to preserve real entries

2. **Demo Preparation**
   - Seed 7-14 days for realistic demonstrations
   - Export seeded data as a template for consistent demos

3. **Data Safety**
   - Always export current data before clearing
   - Keep backups of important real data

4. **Production**
   - DevTools and console commands are disabled in production builds
   - Mock data is only for development/testing

## Implementation Details

### Files Created/Modified:
- `/src/utils/mockDataGenerator.ts` - Core mock data generation logic
- `/src/components/DevTools.tsx` - UI component for dev tools
- `/src/utils/seedScript.ts` - Console command exposure
- `/src/main.tsx` - Imports seedScript in dev mode
- `/src/App.tsx` - Renders DevTools component in dev mode

### Storage Keys:
- `timeportal-buckets` - Array of TimeBucket objects
- `timeportal-entries` - Array of TimeEntry objects

Both are automatically managed by StorageContext.tsx with proper migration support.
