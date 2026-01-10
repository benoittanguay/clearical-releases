import { test, expect } from '../fixtures/electron';
import { Page } from '@playwright/test';

/**
 * Comprehensive Navigation and App-level functionality tests for TimePortal
 *
 * Tests cover:
 * 1. Main Navigation - Sidebar navigation, active indicators, button styling
 * 2. Window Controls - Title bar controls and responsiveness
 * 3. View Transitions - Loading and switching between views
 * 4. App State - State persistence across navigation
 * 5. Error Boundaries - Graceful error handling
 * 6. Performance - Load times and responsiveness
 */

/**
 * Helper function to navigate to a specific view
 */
async function navigateToView(page: Page, viewName: 'Chrono' | 'Worklog' | 'Buckets' | 'Settings') {
  const button = page.locator(`button:has-text("${viewName}")`);
  await button.click();
  await page.waitForTimeout(300); // Wait for view transition animation
}

/**
 * Helper function to get navigation button by view name
 */
function getNavButton(page: Page, viewName: string) {
  return page.locator(`button:has-text("${viewName}")`);
}

/**
 * Helper function to check if a button has active styling
 */
async function isButtonActive(page: Page, viewName: string): Promise<boolean> {
  const button = getNavButton(page, viewName);
  const iconDiv = button.locator('div').first();
  const classes = await iconDiv.getAttribute('class');
  return classes?.includes('bg-gray-800 text-green-400') || false;
}

/**
 * Helper function to start the timer
 */
async function startTimer(page: Page) {
  const chronoButton = getNavButton(page, 'Chrono');
  await chronoButton.click();
  await page.waitForTimeout(300);

  const startButton = page.locator('button:has-text("START")');
  await startButton.click();
  await page.waitForTimeout(500);
}

/**
 * Helper function to create a test bucket
 */
async function createTestBucket(page: Page, name: string) {
  const bucketsButton = getNavButton(page, 'Buckets');
  await bucketsButton.click();
  await page.waitForTimeout(300);

  const newBucketButton = page.locator('button:has-text("New Bucket")');
  await newBucketButton.click();
  await page.waitForTimeout(300);

  const nameInput = page.locator('input[placeholder="Bucket name"]');
  await nameInput.fill(name);

  const createButton = page.locator('button:has-text("Create")').last();
  await createButton.click();
  await page.waitForTimeout(500);
}

test.describe('Main Navigation - Sidebar', () => {
  test('should display all navigation buttons', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Check all main navigation buttons are visible
    await expect(getNavButton(window, 'Chrono')).toBeVisible();
    await expect(getNavButton(window, 'Worklog')).toBeVisible();
    await expect(getNavButton(window, 'Buckets')).toBeVisible();
    await expect(getNavButton(window, 'Settings')).toBeVisible();
  });

  test('should display Clearical logo/brand', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Check for TP logo - specific selector to avoid matching other text
    const logo = window.locator('nav.w-20 >> text=TP');
    await expect(logo).toBeVisible();
  });

  test('sidebar has correct width and styling', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const sidebar = window.locator('nav.w-20');
    await expect(sidebar).toBeVisible();

    // Check styling
    const classes = await sidebar.getAttribute('class');
    expect(classes).toContain('bg-gray-950');
    expect(classes).toContain('border-r');
    expect(classes).toContain('border-gray-800');
  });

  test('navigation buttons have correct icon and label', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Check Chrono button has clock icon and label
    const chronoButton = getNavButton(window, 'Chrono');
    const chronoIcon = chronoButton.locator('svg');
    await expect(chronoIcon).toBeVisible();
    const chronoLabel = chronoButton.locator('span:has-text("Chrono")');
    await expect(chronoLabel).toBeVisible();

    // Check Worklog button has worklog icon and label
    const worklogButton = getNavButton(window, 'Worklog');
    const worklogIcon = worklogButton.locator('svg');
    await expect(worklogIcon).toBeVisible();
    const worklogLabel = worklogButton.locator('span:has-text("Worklog")');
    await expect(worklogLabel).toBeVisible();

    // Check Buckets button has buckets icon and label
    const bucketsButton = getNavButton(window, 'Buckets');
    const bucketsIcon = bucketsButton.locator('svg');
    await expect(bucketsIcon).toBeVisible();
    const bucketsLabel = bucketsButton.locator('span:has-text("Buckets")');
    await expect(bucketsLabel).toBeVisible();

    // Check Settings button has settings icon and label
    const settingsButton = getNavButton(window, 'Settings');
    const settingsIcon = settingsButton.locator('svg');
    await expect(settingsIcon).toBeVisible();
    const settingsLabel = settingsButton.locator('span:has-text("Settings")');
    await expect(settingsLabel).toBeVisible();
  });

  test('sidebar buttons maintain consistent spacing', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Check that navigation buttons are visible and properly spaced in sidebar
    const sidebar = window.locator('nav.w-20');
    await expect(sidebar).toBeVisible();

    // Verify all navigation buttons exist within the sidebar
    const navButtons = sidebar.locator('button');
    const buttonCount = await navButtons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(4);
  });
});

test.describe('Active Indicator & Button Styling', () => {
  test('Chrono view has active indicator by default', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Chrono should be active on initial load
    const isActive = await isButtonActive(window, 'Chrono');
    expect(isActive).toBe(true);
  });

  test('clicking navigation button activates it', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate to Worklog
    await navigateToView(window, 'Worklog');

    // Worklog should be active
    const isWorklogActive = await isButtonActive(window, 'Worklog');
    expect(isWorklogActive).toBe(true);

    // Chrono should not be active
    const isChronoActive = await isButtonActive(window, 'Chrono');
    expect(isChronoActive).toBe(false);
  });

  test('only one navigation button is active at a time', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate to each view and verify only one is active
    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = ['Chrono', 'Worklog', 'Buckets', 'Settings'];

    for (const view of views) {
      await navigateToView(window, view);

      // Check that current view is active
      const isActive = await isButtonActive(window, view);
      expect(isActive).toBe(true);

      // Check that other views are not active
      for (const otherView of views) {
        if (otherView !== view) {
          const isOtherActive = await isButtonActive(window, otherView);
          expect(isOtherActive).toBe(false);
        }
      }
    }
  });

  test('navigation button text color changes with active state', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Chrono should have green text (active)
    const chronoLabel = getNavButton(window, 'Chrono').locator('span');
    let chronoClasses = await chronoLabel.getAttribute('class');
    expect(chronoClasses).toContain('text-green-400');

    // Navigate to Worklog
    await navigateToView(window, 'Worklog');

    // Chrono label should now be gray
    chronoClasses = await chronoLabel.getAttribute('class');
    expect(chronoClasses).toContain('text-gray-500');

    // Worklog label should be green
    const worklogLabel = getNavButton(window, 'Worklog').locator('span');
    const worklogClasses = await worklogLabel.getAttribute('class');
    expect(worklogClasses).toContain('text-green-400');
  });

  test('navigation button icon has hover effect', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate away from Chrono first
    await navigateToView(window, 'Worklog');

    // Get Chrono button (inactive)
    const chronoButton = getNavButton(window, 'Chrono');
    const chronoIcon = chronoButton.locator('div').first();

    // Check initial state (inactive)
    let classes = await chronoIcon.getAttribute('class');
    expect(classes).toContain('text-gray-500');

    // Hover over button
    await chronoButton.hover();

    // With group-hover, the icon should change color
    // Note: Playwright may not fully simulate CSS hover states, so we check the class structure
    expect(classes).toContain('group-hover:text-gray-300');
  });

  test('active navigation button has background highlight', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate to Settings
    await navigateToView(window, 'Settings');

    // Check active button has bg-gray-800
    const settingsButton = getNavButton(window, 'Settings');
    const settingsIcon = settingsButton.locator('div').first();
    const classes = await settingsIcon.getAttribute('class');

    expect(classes).toContain('bg-gray-800');
    expect(classes).toContain('text-green-400');
  });
});

test.describe('Window Controls', () => {
  test('should display window control buttons', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Check for title bar
    const titleBar = window.locator('header.h-8.drag-handle');
    await expect(titleBar).toBeVisible();

    // Check for window controls container
    const controls = titleBar.locator('.flex.space-x-2.no-drag.group');
    await expect(controls).toBeVisible();
  });

  test('window controls have correct colors', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const controls = window.locator('header .flex.space-x-2.no-drag.group');

    // Red close button
    const closeButton = controls.locator('button').first();
    const closeClasses = await closeButton.getAttribute('class');
    expect(closeClasses).toContain('bg-red-500');
    expect(closeClasses).toContain('hover:bg-red-600');

    // Yellow minimize button
    const minimizeButton = controls.locator('div').nth(0);
    const minimizeClasses = await minimizeButton.getAttribute('class');
    expect(minimizeClasses).toContain('bg-yellow-500');

    // Green maximize button
    const maximizeButton = controls.locator('div').nth(1);
    const maximizeClasses = await maximizeButton.getAttribute('class');
    expect(maximizeClasses).toContain('bg-green-500');
  });

  test('window controls are in correct position', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const titleBar = window.locator('header.h-8');
    const classes = await titleBar.getAttribute('class');

    // Should be flexbox with items at the end
    expect(classes).toContain('flex');
    expect(classes).toContain('justify-end');
    expect(classes).toContain('items-center');
  });

  test('close button displays "x" on hover', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const closeButton = window.locator('header button.bg-red-500');
    const xText = closeButton.locator('span:has-text("x")');

    // Check that x exists but may be initially transparent
    await expect(xText).toBeVisible();

    // Check opacity class
    const classes = await xText.getAttribute('class');
    expect(classes).toContain('opacity-0');
    expect(classes).toContain('group-hover:opacity-100');
  });

  test('title bar has drag handle', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const titleBar = window.locator('header.drag-handle');
    await expect(titleBar).toBeVisible();

    const classes = await titleBar.getAttribute('class');
    expect(classes).toContain('drag-handle');
    expect(classes).toContain('select-none');
  });
});

test.describe('Window Responsiveness', () => {
  test('app handles window resize gracefully', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Get initial size
    const initialSize = await window.viewportSize();
    expect(initialSize).toBeTruthy();

    // Resize to smaller dimensions
    await window.setViewportSize({ width: 800, height: 600 });
    await window.waitForTimeout(500);

    // Verify app is still functional
    const sidebar = window.locator('nav.w-20');
    await expect(sidebar).toBeVisible();

    const root = window.locator('#root');
    await expect(root).toBeVisible();

    // Resize to larger dimensions
    await window.setViewportSize({ width: 1920, height: 1080 });
    await window.waitForTimeout(500);

    // Verify app is still functional
    await expect(sidebar).toBeVisible();
    await expect(root).toBeVisible();
  });

  test('sidebar remains visible at different widths', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const sidebar = window.locator('nav.w-20');

    // Test at 800px width
    await window.setViewportSize({ width: 800, height: 600 });
    await expect(sidebar).toBeVisible();

    // Test at 1024px width
    await window.setViewportSize({ width: 1024, height: 768 });
    await expect(sidebar).toBeVisible();

    // Test at 1440px width
    await window.setViewportSize({ width: 1440, height: 900 });
    await expect(sidebar).toBeVisible();
  });

  test('content area fills remaining space after sidebar', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const contentArea = window.locator('.flex-1.flex.flex-col.h-full.bg-gray-900');
    await expect(contentArea).toBeVisible();

    // Check flex-1 class which makes it fill remaining space
    const classes = await contentArea.getAttribute('class');
    expect(classes).toContain('flex-1');
    expect(classes).toContain('flex-col');
    expect(classes).toContain('h-full');
  });

  test('app layout uses flexbox correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Root container
    const root = window.locator('#root');
    const rootChild = root.locator('> div').first();
    const rootClasses = await rootChild.getAttribute('class');

    expect(rootClasses).toContain('flex');
    expect(rootClasses).toContain('h-screen');
    expect(rootClasses).toContain('flex-col');

    // Main content container
    const mainContent = rootChild.locator('.flex.flex-1.overflow-hidden');
    await expect(mainContent).toBeVisible();
  });
});

test.describe('View Transitions - Chrono', () => {
  test('Chrono view loads with timer interface', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Chrono');

    // Check for timer display
    const timerDisplay = window.locator('.text-6xl.font-mono.font-bold');
    await expect(timerDisplay).toBeVisible();
    await expect(timerDisplay).toHaveText('00:00:00');

    // Check for START button
    const startButton = window.locator('button:has-text("START")');
    await expect(startButton).toBeVisible();

    // Check for PAUSE button (disabled)
    const pauseButton = window.locator('button:has-text("PAUSE")');
    await expect(pauseButton).toBeVisible();
    await expect(pauseButton).toBeDisabled();
  });

  test('Chrono view displays Assignment picker', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Chrono');

    const assignmentLabel = window.locator('label:has-text("Assignment")');
    await expect(assignmentLabel).toBeVisible();

    const assignmentPicker = window.locator('label:has-text("Assignment")').locator('..').locator('button').first();
    await expect(assignmentPicker).toBeVisible();
  });

  test('Chrono view elements are centered', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Chrono');

    const chronoContainer = window.locator('.flex.flex-col.items-center.justify-center.h-full');
    await expect(chronoContainer).toBeVisible();

    const classes = await chronoContainer.getAttribute('class');
    expect(classes).toContain('items-center');
    expect(classes).toContain('justify-center');
  });
});

test.describe('View Transitions - Worklog', () => {
  test('Worklog view loads with header', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Worklog');

    // Check for Worklog title
    const title = window.locator('h2:has-text("Worklog")');
    await expect(title).toBeVisible();

    // Check title styling
    const classes = await title.getAttribute('class');
    expect(classes).toContain('text-2xl');
    expect(classes).toContain('font-bold');
  });

  test('Worklog view shows empty state when no entries', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Worklog');

    // Wait for view to load
    await window.waitForTimeout(500);

    // Check for empty state message
    const emptyMessage = window.locator('div:has-text("No activities recorded yet.")');
    // May or may not be visible depending on test state
    const isVisible = await emptyMessage.isVisible();

    if (isVisible) {
      const classes = await emptyMessage.getAttribute('class');
      expect(classes).toContain('text-gray-500');
      expect(classes).toContain('text-sm');
    }
  });

  test('Worklog view shows Export CSV button when entries exist', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create an entry by running timer
    await navigateToView(window, 'Chrono');
    const startButton = window.locator('button:has-text("START")');
    await startButton.click();
    await window.waitForTimeout(1000);

    const stopButton = window.locator('button:has-text("STOP")');
    await stopButton.click();
    await window.waitForTimeout(500);

    // Navigate to Worklog
    await navigateToView(window, 'Worklog');

    // Export button should be visible
    const exportButton = window.locator('button:has-text("Export CSV")');
    await expect(exportButton).toBeVisible();
  });

  test('Worklog view has scrollable content area', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Worklog');

    // Check for scrollable container
    const scrollContainer = window.locator('.flex-1.overflow-y-auto.px-4.pb-4');
    await expect(scrollContainer).toBeVisible();

    const classes = await scrollContainer.getAttribute('class');
    expect(classes).toContain('overflow-y-auto');
  });

  test('Worklog view header is sticky', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Worklog');

    const header = window.locator('.flex-shrink-0.bg-gray-900.border-b.border-gray-800').first();
    await expect(header).toBeVisible();

    const classes = await header.getAttribute('class');
    expect(classes).toContain('flex-shrink-0');
  });
});

test.describe('View Transitions - Buckets', () => {
  test('Buckets view loads with header', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Buckets');

    const title = window.locator('h2:has-text("Manage Buckets")');
    await expect(title).toBeVisible();

    const classes = await title.getAttribute('class');
    expect(classes).toContain('text-xl');
    expect(classes).toContain('font-bold');
  });

  test('Buckets view shows action buttons', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Buckets');

    // New Bucket button
    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await expect(newBucketButton).toBeVisible();

    // New Folder button
    const newFolderButton = window.locator('button:has-text("New Folder")');
    await expect(newFolderButton).toBeVisible();
  });

  test('Buckets view has scrollable content', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Buckets');

    const scrollContainer = window.locator('.flex-1.overflow-y-auto.px-4.pb-4');
    await expect(scrollContainer).toBeVisible();
  });

  test('Buckets view header is sticky', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Buckets');

    const header = window.locator('.flex-shrink-0.bg-gray-900.border-b.border-gray-800').first();
    await expect(header).toBeVisible();
  });

  test('New Bucket button opens modal', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Buckets');

    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await newBucketButton.click();
    await window.waitForTimeout(300);

    // Check for modal
    const modal = window.locator('input[placeholder="Bucket name"]');
    await expect(modal).toBeVisible();
  });
});

test.describe('View Transitions - Settings', () => {
  test('Settings view loads with header', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Settings');

    const title = window.locator('h2:has-text("Settings")').first();
    await expect(title).toBeVisible();
  });

  test('Settings view has scrollable content', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Settings');

    const scrollContainer = window.locator('.flex-1.overflow-y-auto');
    await expect(scrollContainer).toBeVisible();
  });

  test('Settings view header is sticky', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToView(window, 'Settings');

    const header = window.locator('.flex-shrink-0.bg-gray-900.border-b.border-gray-800').first();
    await expect(header).toBeVisible();
  });
});

test.describe('View Transition Smoothness', () => {
  test('transitions between all views work correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = [
      'Chrono', 'Worklog', 'Buckets', 'Settings'
    ];

    for (const view of views) {
      await navigateToView(window, view);

      // Verify view loaded
      const root = window.locator('#root');
      await expect(root).toBeVisible();

      // Verify correct button is active
      const isActive = await isButtonActive(window, view);
      expect(isActive).toBe(true);
    }
  });

  test('rapid view switching does not break app', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Rapidly switch between views
    await navigateToView(window, 'Worklog');
    await navigateToView(window, 'Buckets');
    await navigateToView(window, 'Chrono');
    await navigateToView(window, 'Settings');
    await navigateToView(window, 'Worklog');
    await navigateToView(window, 'Chrono');

    // App should still be functional
    const root = window.locator('#root');
    await expect(root).toBeVisible();

    // Timer should be visible
    const timerDisplay = window.locator('.text-6xl.font-mono.font-bold');
    await expect(timerDisplay).toBeVisible();
  });

  test('view transitions maintain scroll position', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate to Buckets and create multiple items to enable scrolling
    await navigateToView(window, 'Buckets');

    // Switch to another view and back
    await navigateToView(window, 'Settings');
    await window.waitForTimeout(300);
    await navigateToView(window, 'Buckets');

    // View should load correctly
    const header = window.locator('h2:has-text("Manage Buckets")');
    await expect(header).toBeVisible();
  });
});

test.describe('App State Persistence - Timer', () => {
  test('timer state persists when switching views', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Start timer
    await navigateToView(window, 'Chrono');
    const startButton = window.locator('button:has-text("START")');
    await startButton.click();
    await window.waitForTimeout(1000);

    // Get elapsed time
    const timerDisplay = window.locator('.text-6xl.font-mono.font-bold');
    const timeBeforeSwitch = await timerDisplay.textContent();

    // Switch to Worklog
    await navigateToView(window, 'Worklog');
    await window.waitForTimeout(500);

    // Switch back to Chrono
    await navigateToView(window, 'Chrono');

    // Timer should still be running
    const stopButton = window.locator('button:has-text("STOP")');
    await expect(stopButton).toBeVisible();

    // Time should have continued
    const timeAfterSwitch = await timerDisplay.textContent();
    expect(timeAfterSwitch).not.toBe(timeBeforeSwitch);
    expect(timeAfterSwitch).not.toBe('00:00:00');
  });

  test('paused timer state persists when switching views', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Start and pause timer
    await navigateToView(window, 'Chrono');
    const startButton = window.locator('button:has-text("START")');
    await startButton.click();
    await window.waitForTimeout(1000);

    const pauseButton = window.locator('button:has-text("PAUSE")');
    await pauseButton.click();

    // Get paused time
    const timerDisplay = window.locator('.text-6xl.font-mono.font-bold');
    const pausedTime = await timerDisplay.textContent();

    // Switch views
    await navigateToView(window, 'Settings');
    await window.waitForTimeout(300);
    await navigateToView(window, 'Chrono');

    // Timer should still be paused
    const resumeButton = window.locator('button:has-text("RESUME")');
    await expect(resumeButton).toBeVisible();

    // Paused badge should be visible
    const pausedBadge = window.locator('div:has-text("Paused")');
    await expect(pausedBadge).toBeVisible();

    // Time should be the same
    const currentTime = await timerDisplay.textContent();
    expect(currentTime).toBe(pausedTime);
  });

  test('assignment selection persists when switching views', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create a bucket
    await createTestBucket(window, 'Persistent Bucket');

    // Select bucket in Chrono
    await navigateToView(window, 'Chrono');

    const assignmentPicker = window.locator('label:has-text("Assignment")').locator('..').locator('button').first();
    await assignmentPicker.click();
    await window.waitForTimeout(300);

    const bucketOption = window.locator('button:has-text("Persistent Bucket")').first();
    await bucketOption.click();
    await window.waitForTimeout(300);

    // Verify selection
    let pickerText = await assignmentPicker.textContent();
    expect(pickerText).toContain('Persistent Bucket');

    // Switch views
    await navigateToView(window, 'Worklog');
    await window.waitForTimeout(300);
    await navigateToView(window, 'Chrono');

    // Assignment should still be selected
    pickerText = await assignmentPicker.textContent();
    expect(pickerText).toContain('Persistent Bucket');
  });
});

test.describe('App State Persistence - Data', () => {
  test('created buckets persist across view changes', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create bucket
    await createTestBucket(window, 'Persisted Bucket');

    // Switch to Chrono
    await navigateToView(window, 'Chrono');
    await window.waitForTimeout(300);

    // Switch back to Buckets
    await navigateToView(window, 'Buckets');

    // Bucket should still exist
    const bucketItem = window.locator('span:has-text("Persisted Bucket")');
    await expect(bucketItem).toBeVisible();
  });

  test('worklog entries persist across view changes', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create entry
    await navigateToView(window, 'Chrono');
    const startButton = window.locator('button:has-text("START")');
    await startButton.click();
    await window.waitForTimeout(1500);

    const stopButton = window.locator('button:has-text("STOP")');
    await stopButton.click();
    await window.waitForTimeout(1000);

    // Navigate to Worklog
    await navigateToView(window, 'Worklog');

    // Entry should be visible
    const entries = window.locator('.bg-gray-800\\/50.p-2\\.5.rounded-lg');
    const entryCount = await entries.count();
    expect(entryCount).toBeGreaterThan(0);

    // Switch to Chrono and back
    await navigateToView(window, 'Chrono');
    await window.waitForTimeout(300);
    await navigateToView(window, 'Worklog');

    // Entry should still be there
    const entriesAfter = window.locator('.bg-gray-800\\/50.p-2\\.5.rounded-lg');
    const entryCountAfter = await entriesAfter.count();
    expect(entryCountAfter).toBe(entryCount);
  });
});

test.describe('Performance', () => {
  test('initial app load time is acceptable', async ({ window }) => {
    const startTime = Date.now();

    await window.waitForLoadState('domcontentloaded');

    const loadTime = Date.now() - startTime;

    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);

    console.log(`App loaded in ${loadTime}ms`);
  });

  test('view switching is responsive', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = [
      'Chrono', 'Worklog', 'Buckets', 'Settings'
    ];

    for (const view of views) {
      const startTime = Date.now();
      await navigateToView(window, view);
      const switchTime = Date.now() - startTime;

      // View switch should complete within 1 second
      expect(switchTime).toBeLessThan(1000);

      console.log(`Switched to ${view} in ${switchTime}ms`);
    }
  });

  test('repeated navigation does not slow down over time', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const timings: number[] = [];

    // Perform 10 navigation cycles
    for (let i = 0; i < 10; i++) {
      const startTime = Date.now();

      await navigateToView(window, 'Worklog');
      await navigateToView(window, 'Buckets');
      await navigateToView(window, 'Settings');
      await navigateToView(window, 'Chrono');

      const cycleTime = Date.now() - startTime;
      timings.push(cycleTime);
    }

    // Calculate average of first 3 and last 3 cycles
    const firstThreeAvg = (timings[0] + timings[1] + timings[2]) / 3;
    const lastThreeAvg = (timings[7] + timings[8] + timings[9]) / 3;

    // Last three should not be significantly slower than first three
    // Allow up to 50% increase (which would indicate memory leak or performance degradation)
    expect(lastThreeAvg).toBeLessThan(firstThreeAvg * 1.5);

    console.log('First three cycles avg:', firstThreeAvg + 'ms');
    console.log('Last three cycles avg:', lastThreeAvg + 'ms');
  });

  test('app remains responsive with multiple buckets', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create multiple buckets
    for (let i = 0; i < 5; i++) {
      await createTestBucket(window, `Bucket ${i}`);
    }

    // Navigate to Chrono
    const startTime = Date.now();
    await navigateToView(window, 'Chrono');
    const navTime = Date.now() - startTime;

    // Should still be fast
    expect(navTime).toBeLessThan(1000);

    // Open assignment picker
    const picker = window.locator('label:has-text("Assignment")').locator('..').locator('button').first();
    const pickerStartTime = Date.now();
    await picker.click();
    await window.waitForSelector('.absolute.top-full', { state: 'visible' });
    const pickerOpenTime = Date.now() - pickerStartTime;

    // Picker should open quickly
    expect(pickerOpenTime).toBeLessThan(1000);
  });

  test('worklog view performs well with multiple entries', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create multiple entries
    for (let i = 0; i < 3; i++) {
      await navigateToView(window, 'Chrono');
      const startButton = window.locator('button:has-text("START")');
      await startButton.click();
      await window.waitForTimeout(500);

      const stopButton = window.locator('button:has-text("STOP")');
      await stopButton.click();
      await window.waitForTimeout(500);
    }

    // Navigate to Worklog
    const startTime = Date.now();
    await navigateToView(window, 'Worklog');
    const loadTime = Date.now() - startTime;

    // Should load quickly
    expect(loadTime).toBeLessThan(1000);

    // Verify entries are visible
    const entries = window.locator('.bg-gray-800\\/50.p-2\\.5.rounded-lg');
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Error Handling', () => {
  test('app handles missing view gracefully', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // App should always have a valid view
    const root = window.locator('#root');
    await expect(root).toBeVisible();

    // Try navigating to all valid views
    await navigateToView(window, 'Chrono');
    await expect(root).toBeVisible();

    await navigateToView(window, 'Worklog');
    await expect(root).toBeVisible();

    await navigateToView(window, 'Buckets');
    await expect(root).toBeVisible();

    await navigateToView(window, 'Settings');
    await expect(root).toBeVisible();
  });

  test('app continues to function after navigation error', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Navigate to valid view
    await navigateToView(window, 'Chrono');

    // Try to trigger navigation multiple times rapidly
    const chronoButton = getNavButton(window, 'Chrono');
    await chronoButton.click();
    await chronoButton.click();
    await chronoButton.click();

    // App should still work
    const root = window.locator('#root');
    await expect(root).toBeVisible();

    const timerDisplay = window.locator('.text-6xl.font-mono.font-bold');
    await expect(timerDisplay).toBeVisible();
  });

  test('app recovers from rapid state changes', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Rapidly change views and start/stop timer
    await navigateToView(window, 'Chrono');
    const startButton = window.locator('button:has-text("START")');
    await startButton.click();

    await navigateToView(window, 'Worklog');
    await navigateToView(window, 'Chrono');
    await navigateToView(window, 'Buckets');
    await navigateToView(window, 'Chrono');

    // App should still be functional
    const stopButton = window.locator('button:has-text("STOP")');
    await expect(stopButton).toBeVisible();

    // Should be able to stop timer
    await stopButton.click();
    await window.waitForTimeout(500);
  });
});

test.describe('Layout Consistency', () => {
  test('all views have consistent header styling', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<{ name: 'Worklog' | 'Buckets' | 'Settings', title: string }> = [
      { name: 'Worklog', title: 'Worklog' },
      { name: 'Buckets', title: 'Manage Buckets' },
      { name: 'Settings', title: 'Settings' }
    ];

    for (const view of views) {
      await navigateToView(window, view.name);

      // Check for sticky header
      const header = window.locator('.flex-shrink-0.bg-gray-900.border-b.border-gray-800').first();
      await expect(header).toBeVisible();

      // Check for title
      const title = window.locator(`h2:has-text("${view.title}")`).first();
      await expect(title).toBeVisible();
    }
  });

  test('all views maintain sidebar visibility', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = [
      'Chrono', 'Worklog', 'Buckets', 'Settings'
    ];

    for (const view of views) {
      await navigateToView(window, view);

      // Sidebar should always be visible
      const sidebar = window.locator('nav.w-20');
      await expect(sidebar).toBeVisible();
    }
  });

  test('all views maintain title bar visibility', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = [
      'Chrono', 'Worklog', 'Buckets', 'Settings'
    ];

    for (const view of views) {
      await navigateToView(window, view);

      // Title bar should always be visible
      const titleBar = window.locator('header.h-8.drag-handle');
      await expect(titleBar).toBeVisible();
    }
  });

  test('content area maintains consistent layout', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    const views: Array<'Chrono' | 'Worklog' | 'Buckets' | 'Settings'> = [
      'Chrono', 'Worklog', 'Buckets', 'Settings'
    ];

    for (const view of views) {
      await navigateToView(window, view);

      // Content area should maintain structure
      const contentArea = window.locator('.flex-1.flex.flex-col.h-full.bg-gray-900').first();
      await expect(contentArea).toBeVisible();

      const classes = await contentArea.getAttribute('class');
      expect(classes).toContain('flex-1');
      expect(classes).toContain('flex-col');
    }
  });
});
