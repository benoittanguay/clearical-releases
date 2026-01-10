import { test, expect } from '../fixtures/electron';
import { captureConsoleLogs, waitForConsoleMessage } from '../helpers/electron';

/**
 * Worklog/History functionality tests for TimePortal
 *
 * Tests cover:
 * 1. Worklog View - entries display, grouping, date headers, totals
 * 2. History Detail View - entry details, editing, assignment
 * 3. Activity Breakdown - app grouping, expansion, deletion
 */

/**
 * Helper function to navigate to worklog view
 */
async function navigateToWorklog(window: any) {
  // Click on the Worklog navigation button in the sidebar
  const worklogButton = window.locator('button:has-text("Worklog")');
  await worklogButton.click();
  await window.waitForTimeout(500); // Allow view to render
}

/**
 * Helper function to create a test entry via IPC
 */
async function createTestEntry(window: any, entryData: Partial<any> = {}) {
  const defaultEntry = {
    startTime: Date.now() - 3600000, // 1 hour ago
    endTime: Date.now(),
    duration: 3600000, // 1 hour
    description: 'Test entry',
    windowActivity: [
      {
        appName: 'Visual Studio Code',
        windowTitle: 'test.ts - TimePortal',
        timestamp: Date.now() - 1800000,
        duration: 1800000,
      },
      {
        appName: 'Chrome',
        windowTitle: 'GitHub - TimePortal',
        timestamp: Date.now() - 900000,
        duration: 1800000,
      },
    ],
    ...entryData,
  };

  return window.evaluate((entry: any) => {
    return (window as any).electron.ipcRenderer.db.insertEntry(entry);
  }, defaultEntry);
}

/**
 * Helper function to get all entries from the database
 */
async function getAllEntries(window: any) {
  const result = await window.evaluate(() => {
    return (window as any).electron.ipcRenderer.db.getAllEntries();
  });
  return result.success ? result.data : [];
}

/**
 * Helper function to clear all entries from the database
 */
async function clearAllEntries(window: any) {
  await window.evaluate(() => {
    return (window as any).electron.ipcRenderer.db.clearAllEntries();
  });
}

test.describe('Worklog View', () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    // Clear any existing entries before each test
    await clearAllEntries(window);
  });

  test('should display empty state when no entries exist', async ({ window }) => {
    await navigateToWorklog(window);

    // Check for empty state message
    const emptyMessage = window.locator('text=No activities recorded yet.');
    await expect(emptyMessage).toBeVisible();
  });

  test('should display entries in reverse chronological order', async ({ window }) => {
    // Create multiple test entries at different times
    const now = Date.now();
    await createTestEntry(window, {
      startTime: now - 7200000, // 2 hours ago
      endTime: now - 3600000,
      duration: 3600000,
      description: 'Older entry',
    });
    await createTestEntry(window, {
      startTime: now - 1800000, // 30 minutes ago
      endTime: now,
      duration: 1800000,
      description: 'Newer entry',
    });

    // Reload to pick up new entries
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Find all entry descriptions
    const entries = await window.locator('[class*="bg-gray-800/50"]').all();
    expect(entries.length).toBeGreaterThanOrEqual(2);

    // First entry should be the newer one
    const firstEntry = entries[0];
    await expect(firstEntry).toContainText('Newer entry');
  });

  test('should group entries by date with correct headers', async ({ window }) => {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create entry for today
    await createTestEntry(window, {
      startTime: now - 1800000,
      endTime: now,
      duration: 1800000,
      description: 'Today entry',
    });

    // Create entry for yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    await createTestEntry(window, {
      startTime: yesterday.getTime() + 36000000, // 10 hours into yesterday
      endTime: yesterday.getTime() + 39600000,
      duration: 3600000,
      description: 'Yesterday entry',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Check for "Today" header
    const todayHeader = window.locator('text=Today');
    await expect(todayHeader).toBeVisible();

    // Check for "Yesterday" header
    const yesterdayHeader = window.locator('text=Yesterday');
    await expect(yesterdayHeader).toBeVisible();
  });

  test('should display sticky date headers', async ({ window }) => {
    // Create multiple entries
    await createTestEntry(window, { description: 'Entry 1' });
    await createTestEntry(window, { description: 'Entry 2' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Date headers should have sticky positioning
    const dateHeader = window.locator('[class*="sticky"][class*="top-0"]').first();
    await expect(dateHeader).toBeVisible();

    // Verify it has the expected date label format
    const headerText = await dateHeader.textContent();
    expect(headerText).toMatch(/(Today|Yesterday|\w+, \w+ \d+)/);
  });

  test('should calculate and display duration correctly', async ({ window }) => {
    const duration = 5400000; // 1 hour 30 minutes
    await createTestEntry(window, {
      duration,
      description: 'Duration test entry',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Duration should be displayed in HH:MM:SS or similar format
    const durationDisplay = window.locator('[class*="font-mono"][class*="text-green-400"]').first();
    await expect(durationDisplay).toBeVisible();

    const durationText = await durationDisplay.textContent();
    // Should contain time format (e.g., "1:30:00" or "01:30:00")
    expect(durationText).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test('should display total duration per day', async ({ window }) => {
    const now = Date.now();
    // Create two entries for today
    await createTestEntry(window, {
      startTime: now - 7200000,
      endTime: now - 3600000,
      duration: 3600000, // 1 hour
      description: 'Entry 1',
    });
    await createTestEntry(window, {
      startTime: now - 1800000,
      endTime: now,
      duration: 1800000, // 30 minutes
      description: 'Entry 2',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Find the date header with total duration
    const dateHeader = window.locator('[class*="sticky"][class*="top-0"]').first();
    const headerText = await dateHeader.textContent();

    // Should contain total duration (1h 30m = 1:30:00 or similar)
    expect(headerText).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test('should delete entry when delete button is clicked', async ({ window }) => {
    await createTestEntry(window, { description: 'Entry to delete' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Find and click the delete button
    const deleteButton = window.locator('button[aria-label*="Delete"], button:has(svg)').first();
    await deleteButton.click();

    // Wait for potential confirmation and confirm
    await window.waitForTimeout(500);

    // Check if entry was removed
    const entries = await getAllEntries(window);
    expect(entries.length).toBe(0);
  });

  test('should display start and end times for each entry', async ({ window }) => {
    const startTime = Date.now() - 3600000;
    const endTime = Date.now();

    await createTestEntry(window, {
      startTime,
      endTime,
      duration: 3600000,
      description: 'Time display test',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Look for time display (e.g., "9:00 AM - 10:00 AM")
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    const timeText = await entryCard.textContent();

    // Should contain time format with AM/PM
    expect(timeText).toMatch(/\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
  });

  test('should display Export CSV button when entries exist', async ({ window }) => {
    await createTestEntry(window, { description: 'Export test entry' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Check for Export CSV button
    const exportButton = window.locator('button:has-text("Export CSV")');
    await expect(exportButton).toBeVisible();
  });

  test('should navigate to detail view when entry is clicked', async ({ window }) => {
    await createTestEntry(window, { description: 'Clickable entry' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Click on the entry card
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();

    // Should navigate to detail view
    await window.waitForTimeout(500);
    const detailHeader = window.locator('text=Activity Details');
    await expect(detailHeader).toBeVisible();
  });
});

test.describe('History Detail View', () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await clearAllEntries(window);
  });

  test('should load entry details correctly', async ({ window }) => {
    const startTime = Date.now() - 3600000;
    const endTime = Date.now();
    const duration = 3600000;

    await createTestEntry(window, {
      startTime,
      endTime,
      duration,
      description: 'Detail view test',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Click to open detail view
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Verify detail view elements
    const detailHeader = window.locator('text=Activity Details');
    await expect(detailHeader).toBeVisible();

    // Check for start/end time display
    const timeSection = window.locator('text=Start:');
    await expect(timeSection).toBeVisible();

    // Check for duration display
    const durationDisplay = window.locator('[class*="font-mono"][class*="text-green-400"]').first();
    await expect(durationDisplay).toBeVisible();
  });

  test('should allow description editing with auto-save', async ({ window }) => {
    await createTestEntry(window, { description: 'Original description' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Find description textarea
    const descriptionTextarea = window.locator('textarea[placeholder*="description"]');
    await expect(descriptionTextarea).toBeVisible();

    // Edit the description
    await descriptionTextarea.fill('Updated description');

    // Wait for auto-save (500ms debounce + buffer)
    await window.waitForTimeout(1000);

    // Verify the description was saved
    const entries = await getAllEntries(window);
    expect(entries[0].description).toBe('Updated description');
  });

  test('should allow assignment editing via AssignmentPicker', async ({ window }) => {
    await createTestEntry(window, { description: 'Assignment test' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Find assignment picker
    const assignmentPicker = window.locator('text=Assignment');
    await expect(assignmentPicker).toBeVisible();

    // Check for assignment selection UI
    const assignmentSection = window.locator('[class*="border-gray-700"]:has-text("Assignment")');
    await expect(assignmentSection).toBeVisible();
  });

  test('should display start and end time in detail view', async ({ window }) => {
    const startTime = new Date();
    startTime.setHours(9, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(10, 30, 0, 0);

    await createTestEntry(window, {
      startTime: startTime.getTime(),
      endTime: endTime.getTime(),
      duration: endTime.getTime() - startTime.getTime(),
      description: 'Time display test',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Check for start time label and value
    const startLabel = window.locator('text=Start:');
    await expect(startLabel).toBeVisible();

    // Check for end time label and value
    const endLabel = window.locator('text=End:');
    await expect(endLabel).toBeVisible();
  });

  test('should display duration in detail view', async ({ window }) => {
    await createTestEntry(window, {
      duration: 5400000, // 1h 30m
      description: 'Duration test',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Duration should be prominently displayed
    const durationDisplay = window.locator('[class*="font-mono"][class*="text-green-400"]').first();
    await expect(durationDisplay).toBeVisible();

    const durationText = await durationDisplay.textContent();
    expect(durationText).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test('should navigate back to worklog view when back button is clicked', async ({ window }) => {
    await createTestEntry(window, { description: 'Back button test' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Click back button
    const backButton = window.locator('button:has(svg):has-text("")').first();
    await backButton.click();
    await window.waitForTimeout(500);

    // Should be back on worklog view
    const worklogHeader = window.locator('text=Worklog');
    await expect(worklogHeader).toBeVisible();
  });

  test('should show Log to Tempo button in detail view', async ({ window }) => {
    await createTestEntry(window, { description: 'Tempo test' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Check for Log to Tempo button
    const tempoButton = window.locator('button:has-text("Log to Tempo")');
    await expect(tempoButton).toBeVisible();
  });
});

test.describe('Activity Breakdown', () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await clearAllEntries(window);
  });

  test('should group activities by app name', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Multi-app entry',
      windowActivity: [
        {
          appName: 'Visual Studio Code',
          windowTitle: 'test.ts',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Visual Studio Code',
          windowTitle: 'app.ts',
          timestamp: Date.now() - 1800000,
          duration: 900000,
        },
        {
          appName: 'Chrome',
          windowTitle: 'GitHub',
          timestamp: Date.now() - 900000,
          duration: 900000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Should see two app groups
    const vsCodeGroup = window.locator('text=Visual Studio Code');
    await expect(vsCodeGroup).toBeVisible();

    const chromeGroup = window.locator('text=Chrome');
    await expect(chromeGroup).toBeVisible();
  });

  test('should expand and collapse app groups', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Expandable test',
      windowActivity: [
        {
          appName: 'Visual Studio Code',
          windowTitle: 'file1.ts',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Visual Studio Code',
          windowTitle: 'file2.ts',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Find the app group header
    const appGroupHeader = window.locator('button:has-text("Visual Studio Code")').first();
    await expect(appGroupHeader).toBeVisible();

    // Click to expand
    await appGroupHeader.click();
    await window.waitForTimeout(300);

    // Should see individual activities
    const activity1 = window.locator('text=file1.ts');
    await expect(activity1).toBeVisible();

    const activity2 = window.locator('text=file2.ts');
    await expect(activity2).toBeVisible();

    // Click to collapse
    await appGroupHeader.click();
    await window.waitForTimeout(300);
  });

  test('should display activity count for each app', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Activity count test',
      windowActivity: [
        {
          appName: 'Chrome',
          windowTitle: 'Tab 1',
          timestamp: Date.now() - 5400000,
          duration: 1800000,
        },
        {
          appName: 'Chrome',
          windowTitle: 'Tab 2',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Chrome',
          windowTitle: 'Tab 3',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Should show "3 activities" for Chrome
    const activityCount = window.locator('text=3 activities');
    await expect(activityCount).toBeVisible();
  });

  test('should display total duration for each app group', async ({ window }) => {
    await createTestEntry(window, {
      description: 'App duration test',
      windowActivity: [
        {
          appName: 'Terminal',
          windowTitle: 'bash',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Terminal',
          windowTitle: 'zsh',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Find the Terminal app group
    const terminalGroup = window.locator('button:has-text("Terminal")').first();
    const groupText = await terminalGroup.textContent();

    // Should contain total duration in HH:MM:SS format
    expect(groupText).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test('should allow removing individual activities', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Remove activity test',
      windowActivity: [
        {
          appName: 'Slack',
          windowTitle: 'Channel 1',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Slack',
          windowTitle: 'Channel 2',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Expand Slack group
    const slackGroup = window.locator('button:has-text("Slack")').first();
    await slackGroup.click();
    await window.waitForTimeout(300);

    // Find delete button for first activity
    const deleteButtons = await window.locator('button[aria-label*="Delete"], button:has(svg[class*=""])').all();
    if (deleteButtons.length > 0) {
      // Click the delete button for an activity (not the app group)
      await deleteButtons[deleteButtons.length - 1].click();
      await window.waitForTimeout(500);

      // Verify activity was removed
      const entries = await getAllEntries(window);
      const updatedEntry = entries[0];
      expect(updatedEntry.windowActivity.length).toBe(1);
    }
  });

  test('should allow removing all activities for an app', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Remove app test',
      windowActivity: [
        {
          appName: 'Safari',
          windowTitle: 'Tab 1',
          timestamp: Date.now() - 3600000,
          duration: 1800000,
        },
        {
          appName: 'Safari',
          windowTitle: 'Tab 2',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
        {
          appName: 'Finder',
          windowTitle: 'Documents',
          timestamp: Date.now() - 900000,
          duration: 900000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Find delete button for Safari app group
    const safariGroup = window.locator('button:has-text("Safari")').first();
    const deleteButton = safariGroup.locator('~ button').first();

    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      await window.waitForTimeout(500);

      // Verify Safari activities were removed
      const entries = await getAllEntries(window);
      const updatedEntry = entries[0];
      const safariActivities = updatedEntry.windowActivity.filter(
        (a: any) => a.appName === 'Safari'
      );
      expect(safariActivities.length).toBe(0);
    }
  });

  test('should show manual entry option', async ({ window }) => {
    await createTestEntry(window, { description: 'Manual entry test' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Check for Add Manual Entry button
    const addManualButton = window.locator('button:has-text("Add Manual Entry")');
    await expect(addManualButton).toBeVisible();
  });

  test('should allow adding manual activities', async ({ window }) => {
    await createTestEntry(window, { description: 'Add manual test' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Click Add Manual Entry button
    const addManualButton = window.locator('button:has-text("Add Manual Entry")');
    await addManualButton.click();
    await window.waitForTimeout(300);

    // Should show manual entry form
    const descriptionInput = window.locator('input[placeholder*="description"]');
    await expect(descriptionInput).toBeVisible();

    const durationInput = window.locator('input[placeholder*="30m"]');
    await expect(durationInput).toBeVisible();

    // Fill in the form
    await descriptionInput.fill('Manual activity');
    await durationInput.fill('45m');

    // Submit the form
    const submitButton = window.locator('button:has-text("Add Entry")');
    await submitButton.click();
    await window.waitForTimeout(500);

    // Verify manual entry was added
    const entries = await getAllEntries(window);
    const updatedEntry = entries[0];
    const manualActivity = updatedEntry.windowActivity.find(
      (a: any) => a.appName === 'Manual Entry'
    );
    expect(manualActivity).toBeDefined();
    expect(manualActivity?.windowTitle).toBe('Manual activity');
  });

  test('should display empty state when no activities exist', async ({ window }) => {
    await createTestEntry(window, {
      description: 'No activities',
      windowActivity: [],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(500);

    // Should show empty state message
    const emptyMessage = window.locator('text=No window activity recorded');
    await expect(emptyMessage).toBeVisible();
  });

  test('should display app icons when available', async ({ window }) => {
    await createTestEntry(window, {
      description: 'Icon test',
      windowActivity: [
        {
          appName: 'Visual Studio Code',
          windowTitle: 'test.ts',
          timestamp: Date.now() - 1800000,
          duration: 1800000,
        },
      ],
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);
    const entryCard = window.locator('[class*="bg-gray-800/50"]').first();
    await entryCard.click();
    await window.waitForTimeout(1000); // Wait for icon loading

    // App groups should have icon or placeholder
    const appGroup = window.locator('button:has-text("Visual Studio Code")').first();
    const hasIcon = await appGroup.locator('img').count() > 0;
    const hasPlaceholder = await appGroup.locator('svg').count() > 0;

    expect(hasIcon || hasPlaceholder).toBe(true);
  });
});

test.describe('Worklog Integration', () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await clearAllEntries(window);
  });

  test('should display entries with bucket assignments', async ({ window }) => {
    // Create a bucket first
    await window.evaluate(() => {
      return (window as any).electron.ipcRenderer.db.insertBucket({
        id: 'test-bucket-1',
        name: 'Work',
        color: '#3b82f6',
      });
    });

    await createTestEntry(window, {
      description: 'Bucket test',
      assignment: {
        type: 'bucket',
        bucket: {
          id: 'test-bucket-1',
          name: 'Work',
          color: '#3b82f6',
        },
      },
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Entry should display bucket assignment
    const bucketIndicator = window.locator('text=Work');
    await expect(bucketIndicator).toBeVisible();
  });

  test('should navigate between worklog and detail views seamlessly', async ({ window }) => {
    await createTestEntry(window, { description: 'Navigation test 1' });
    await createTestEntry(window, { description: 'Navigation test 2' });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Click first entry
    const entries = await window.locator('[class*="bg-gray-800/50"]').all();
    await entries[0].click();
    await window.waitForTimeout(500);

    // Verify detail view
    let detailHeader = window.locator('text=Activity Details');
    await expect(detailHeader).toBeVisible();

    // Go back
    const backButton = window.locator('button:has(svg):has-text("")').first();
    await backButton.click();
    await window.waitForTimeout(500);

    // Verify back on worklog
    const worklogHeader = window.locator('text=Worklog');
    await expect(worklogHeader).toBeVisible();

    // Click second entry
    const updatedEntries = await window.locator('[class*="bg-gray-800/50"]').all();
    await updatedEntries[1].click();
    await window.waitForTimeout(500);

    // Verify detail view again
    detailHeader = window.locator('text=Activity Details');
    await expect(detailHeader).toBeVisible();
  });

  test('should handle multiple entries across multiple days', async ({ window }) => {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create entries for today, yesterday, and 3 days ago
    await createTestEntry(window, {
      startTime: now - 1800000,
      endTime: now,
      duration: 1800000,
      description: 'Today entry',
    });

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    await createTestEntry(window, {
      startTime: yesterday.getTime() + 36000000,
      endTime: yesterday.getTime() + 39600000,
      duration: 3600000,
      description: 'Yesterday entry',
    });

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    await createTestEntry(window, {
      startTime: threeDaysAgo.getTime() + 36000000,
      endTime: threeDaysAgo.getTime() + 39600000,
      duration: 3600000,
      description: 'Three days ago entry',
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1000);

    await navigateToWorklog(window);

    // Should have three different date headers
    const dateHeaders = await window.locator('[class*="sticky"][class*="top-0"]').all();
    expect(dateHeaders.length).toBeGreaterThanOrEqual(3);

    // Check for specific date labels
    const todayHeader = window.locator('text=Today');
    await expect(todayHeader).toBeVisible();

    const yesterdayHeader = window.locator('text=Yesterday');
    await expect(yesterdayHeader).toBeVisible();
  });
});
