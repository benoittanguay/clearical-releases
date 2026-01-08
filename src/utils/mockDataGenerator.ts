import type { TimeEntry, TimeBucket, WindowActivity, WorkAssignment, LinkedJiraIssue } from '../context/StorageContext';

/**
 * Generates realistic mock data for testing and development.
 * Creates 1-2 activities per day going back 2 weeks (14 days).
 */

// Sample app configurations with realistic window titles
const APP_CONFIGS = [
  {
    appName: 'Code',
    titles: [
      'App.tsx - TimePortal',
      'StorageContext.tsx - TimePortal',
      'mockDataGenerator.ts - TimePortal',
      'components/HistoryDetail.tsx - TimePortal',
      'README.md - TimePortal',
      'package.json - TimePortal',
    ],
  },
  {
    appName: 'Google Chrome',
    titles: [
      'React Documentation - Chrome',
      'Stack Overflow - TypeScript error handling',
      'GitHub - TimePortal Issues',
      'Jira Dashboard - Chrome',
      'MDN Web Docs - Chrome',
      'localhost:5173 - Chrome',
      'Gmail - Chrome',
      'Slack - Chrome',
    ],
  },
  {
    appName: 'Slack',
    titles: [
      '#engineering - Slack',
      '#general - Slack',
      '#timeportal-dev - Slack',
      'Direct Message with @john - Slack',
      '#standup - Slack',
    ],
  },
  {
    appName: 'Terminal',
    titles: [
      'zsh - TimePortal',
      'npm run dev - Terminal',
      'git status - Terminal',
      'vim .env - Terminal',
    ],
  },
  {
    appName: 'Finder',
    titles: [
      'Documents',
      'Downloads',
      'TimePortal',
      'Desktop',
    ],
  },
  {
    appName: 'Safari',
    titles: [
      'Apple Developer Documentation',
      'Electron Documentation',
      'TypeScript Handbook',
      'CSS-Tricks',
    ],
  },
  {
    appName: 'Notes',
    titles: [
      'Meeting Notes - Jan 2026',
      'TimePortal Feature Ideas',
      'Todo List',
    ],
  },
  {
    appName: 'Calendar',
    titles: [
      'Calendar - Week View',
      'Meeting: Sprint Planning',
    ],
  },
  {
    appName: 'Figma',
    titles: [
      'TimePortal UI Design',
      'Component Library',
      'Mockups - Dashboard',
    ],
  },
];

// Sample Jira issues for mock data
const JIRA_ISSUES: LinkedJiraIssue[] = [
  {
    key: 'TP-101',
    summary: 'Implement activity tracking with window monitoring',
    issueType: 'Story',
    status: 'In Progress',
    projectKey: 'TP',
    projectName: 'TimePortal',
  },
  {
    key: 'TP-102',
    summary: 'Add Jira integration for time logging',
    issueType: 'Story',
    status: 'In Progress',
    projectKey: 'TP',
    projectName: 'TimePortal',
  },
  {
    key: 'TP-103',
    summary: 'Fix screenshot capture performance issue',
    issueType: 'Bug',
    status: 'Done',
    projectKey: 'TP',
    projectName: 'TimePortal',
  },
  {
    key: 'TP-104',
    summary: 'Implement data export to CSV',
    issueType: 'Feature',
    status: 'To Do',
    projectKey: 'TP',
    projectName: 'TimePortal',
  },
  {
    key: 'TP-105',
    summary: 'Design settings UI improvements',
    issueType: 'Task',
    status: 'In Review',
    projectKey: 'TP',
    projectName: 'TimePortal',
  },
];

// AI descriptions for screenshots
const AI_DESCRIPTIONS = [
  'Code editor showing React component with TypeScript',
  'Terminal window with npm commands running',
  'Web browser displaying documentation page',
  'Slack conversation about project updates',
  'File browser showing project directory structure',
  'Design tool with UI mockups',
  'Calendar application with scheduled meetings',
  'Note taking app with meeting notes',
  'Jira board showing active sprint tasks',
  'Git diff showing recent code changes',
];

/**
 * Generates a random element from an array
 */
function randomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generates a random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random work time within business hours (9am - 6pm)
 */
function generateWorkTime(date: Date, isStart: boolean): Date {
  const result = new Date(date);

  if (isStart) {
    // Start times: 9am - 3pm
    const hour = randomInt(9, 15);
    const minute = randomInt(0, 59);
    result.setHours(hour, minute, 0, 0);
  } else {
    // Will be calculated based on duration
  }

  return result;
}

/**
 * Generates window activities for an entry
 */
function generateWindowActivities(
  startTime: number,
  totalDuration: number
): WindowActivity[] {
  const activities: WindowActivity[] = [];
  const numActivities = randomInt(3, 8);

  // Distribute the total duration across activities
  let remainingDuration = totalDuration;
  let currentTimestamp = startTime;

  // Keep track of used apps to avoid immediate repetition
  const recentApps: string[] = [];

  for (let i = 0; i < numActivities; i++) {
    // For the last activity, use all remaining duration
    const isLast = i === numActivities - 1;
    const activityDuration = isLast
      ? remainingDuration
      : randomInt(
          Math.min(300000, remainingDuration), // Min 5 minutes
          Math.min(Math.floor(remainingDuration * 0.6), remainingDuration - (numActivities - i - 1) * 300000)
        );

    // Select an app, avoiding recent ones if possible
    let appConfig = randomElement(APP_CONFIGS);
    let attempts = 0;
    while (recentApps.includes(appConfig.appName) && attempts < 5) {
      appConfig = randomElement(APP_CONFIGS);
      attempts++;
    }

    // Update recent apps list (keep last 2)
    recentApps.push(appConfig.appName);
    if (recentApps.length > 2) {
      recentApps.shift();
    }

    const windowTitle = randomElement(appConfig.titles);

    // Generate screenshot paths (1-3 screenshots per activity)
    const numScreenshots = randomInt(1, 3);
    const screenshotPaths: string[] = [];
    const screenshotDescriptions: { [path: string]: string } = {};

    for (let j = 0; j < numScreenshots; j++) {
      const screenshotTime = currentTimestamp + (activityDuration * (j + 1) / (numScreenshots + 1));
      const timestamp = new Date(screenshotTime).toISOString().replace(/[:.]/g, '-');
      const screenshotPath = `screenshot-${timestamp}.png`;
      screenshotPaths.push(screenshotPath);
      screenshotDescriptions[screenshotPath] = randomElement(AI_DESCRIPTIONS);
    }

    activities.push({
      appName: appConfig.appName,
      windowTitle,
      timestamp: currentTimestamp,
      duration: activityDuration,
      screenshotPaths,
      screenshotDescriptions,
    });

    currentTimestamp += activityDuration;
    remainingDuration -= activityDuration;
  }

  return activities;
}

/**
 * Generates a work assignment (bucket or Jira issue)
 */
function generateAssignment(buckets: TimeBucket[]): WorkAssignment {
  // 60% bucket, 40% Jira issue
  const useJira = Math.random() > 0.6;

  if (useJira && JIRA_ISSUES.length > 0) {
    return {
      type: 'jira',
      jiraIssue: randomElement(JIRA_ISSUES),
    };
  } else if (buckets.length > 0) {
    const bucket = randomElement(buckets);
    return {
      type: 'bucket',
      bucket: {
        id: bucket.id,
        name: bucket.name,
        color: bucket.color,
      },
    };
  } else {
    // Fallback to a default work bucket
    return {
      type: 'bucket',
      bucket: {
        id: '1',
        name: 'Work',
        color: '#3b82f6',
      },
    };
  }
}

/**
 * Generates activity descriptions based on assignment
 */
function generateDescription(assignment: WorkAssignment): string {
  if (assignment.type === 'jira' && assignment.jiraIssue) {
    return `Working on ${assignment.jiraIssue.key}: ${assignment.jiraIssue.summary}`;
  } else if (assignment.type === 'bucket' && assignment.bucket) {
    const descriptions: { [key: string]: string[] } = {
      'Work': [
        'Feature development',
        'Code review and refactoring',
        'Bug fixing',
        'Architecture planning',
        'Documentation updates',
      ],
      'Meeting': [
        'Sprint planning meeting',
        'Daily standup',
        '1-on-1 with manager',
        'Design review',
        'Technical discussion',
      ],
      'Break': [
        'Lunch break',
        'Coffee break',
        'Short break',
      ],
    };

    const options = descriptions[assignment.bucket.name] || ['General work activity'];
    return randomElement(options);
  }

  return 'Work activity';
}

/**
 * Generates mock entries for a specific day
 */
function generateEntriesForDay(
  date: Date,
  buckets: TimeBucket[]
): Omit<TimeEntry, 'id'>[] {
  const entries: Omit<TimeEntry, 'id'>[] = [];
  const numEntries = randomInt(1, 2); // 1-2 activities per day

  for (let i = 0; i < numEntries; i++) {
    const startTime = generateWorkTime(date, true);

    // Duration: 30 min - 3 hours (in milliseconds)
    const minDuration = 30 * 60 * 1000; // 30 minutes
    const maxDuration = 3 * 60 * 60 * 1000; // 3 hours
    const duration = randomInt(minDuration, maxDuration);

    const endTime = new Date(startTime.getTime() + duration);

    const assignment = generateAssignment(buckets);
    const description = generateDescription(assignment);
    const windowActivity = generateWindowActivities(startTime.getTime(), duration);

    entries.push({
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      duration,
      assignment,
      description,
      windowActivity,
    });
  }

  return entries;
}

/**
 * Generates mock data for the last N days
 */
export function generateMockData(
  daysBack: number,
  buckets: TimeBucket[]
): Omit<TimeEntry, 'id'>[] {
  const entries: Omit<TimeEntry, 'id'>[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Skip weekends (optional - comment out if you want weekend data)
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const dayEntries = generateEntriesForDay(date, buckets);
    entries.push(...dayEntries);
  }

  return entries;
}

/**
 * Seeds mock data into localStorage directly.
 * This is useful for testing when you want to bypass the React context.
 */
export function seedMockDataToLocalStorage(daysBack: number = 14): void {
  // Load existing buckets or create defaults
  const bucketsJson = localStorage.getItem('timeportal-buckets');
  let buckets: TimeBucket[];

  if (bucketsJson) {
    try {
      buckets = JSON.parse(bucketsJson);
    } catch (e) {
      console.error('Failed to parse existing buckets, using defaults', e);
      buckets = [
        { id: '1', name: 'Work', color: '#3b82f6' },
        { id: '2', name: 'Meeting', color: '#eab308' },
        { id: '3', name: 'Break', color: '#22c55e' },
      ];
    }
  } else {
    buckets = [
      { id: '1', name: 'Work', color: '#3b82f6' },
      { id: '2', name: 'Meeting', color: '#eab308' },
      { id: '3', name: 'Break', color: '#22c55e' },
    ];
    localStorage.setItem('timeportal-buckets', JSON.stringify(buckets));
  }

  // Generate mock entries
  const mockEntries = generateMockData(daysBack, buckets);

  // Add IDs to entries
  const entriesWithIds: TimeEntry[] = mockEntries.map(entry => ({
    ...entry,
    id: crypto.randomUUID(),
  }));

  // Load existing entries and merge (or replace)
  const existingEntriesJson = localStorage.getItem('timeportal-entries');
  let existingEntries: TimeEntry[] = [];

  if (existingEntriesJson) {
    try {
      existingEntries = JSON.parse(existingEntriesJson);
    } catch (e) {
      console.error('Failed to parse existing entries', e);
    }
  }

  // Merge: Add mock entries to existing ones (or replace if desired)
  const allEntries = [...existingEntries, ...entriesWithIds];

  localStorage.setItem('timeportal-entries', JSON.stringify(allEntries));

  console.log(`Seeded ${entriesWithIds.length} mock entries for the last ${daysBack} days`);
  console.log('Reload the application to see the mock data');
}

/**
 * Clears all entries from localStorage.
 * Useful for testing the seeding process.
 */
export function clearAllEntries(): void {
  localStorage.removeItem('timeportal-entries');
  console.log('Cleared all entries from localStorage');
}
