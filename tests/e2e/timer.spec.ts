import { test, expect } from '../fixtures/electron';
import { Page } from '@playwright/test';

/**
 * Comprehensive Timer functionality tests for TimePortal
 *
 * Tests cover:
 * 1. Timer Display & Controls (START, STOP, PAUSE, RESUME)
 * 2. Assignment Selection (Bucket and Jira issue assignment)
 * 3. Timer State Management (elapsed time, pause state, persistence)
 */

/**
 * Helper function to get the timer display element
 */
async function getTimerDisplay(page: Page) {
  return page.locator('.text-6xl.font-mono.font-bold');
}

/**
 * Helper function to parse HH:MM:SS format to milliseconds
 */
function parseTimeToMs(timeString: string): number {
  const parts = timeString.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Helper function to navigate to chrono view
 */
async function navigateToChrono(page: Page) {
  // Fixture already ensures the main app is ready and onboarding is skipped
  const chronoButton = page.locator('button:has-text("Chrono")');
  await chronoButton.waitFor({ state: 'visible', timeout: 5000 });
  await chronoButton.click();
  await page.waitForTimeout(300); // Wait for view transition
}

/**
 * Helper function to get START/STOP button
 */
async function getStartStopButton(page: Page) {
  return page.locator('button:has-text("START"), button:has-text("STOP")');
}

/**
 * Helper function to get PAUSE/RESUME button
 */
async function getPauseResumeButton(page: Page) {
  return page.locator('button:has-text("PAUSE"), button:has-text("RESUME")');
}

/**
 * Helper function to get the AssignmentPicker button
 */
async function getAssignmentPicker(page: Page) {
  return page.locator('label:has-text("Assignment")').locator('..').locator('button').first();
}

/**
 * Helper function to open the assignment picker dropdown
 */
async function openAssignmentPicker(page: Page) {
  const picker = await getAssignmentPicker(page);
  await picker.click();
  // Wait for dropdown to appear
  await page.waitForSelector('.absolute.top-full', { state: 'visible', timeout: 2000 });
}

/**
 * Helper function to create a test bucket via storage context
 */
async function createTestBucket(page: Page, name: string, color: string): Promise<void> {
  await page.evaluate(({ bucketName, bucketColor }) => {
    const event = new CustomEvent('test-create-bucket', {
      detail: { name: bucketName, color: bucketColor }
    });
    window.dispatchEvent(event);
  }, { bucketName: name, bucketColor: color });
}

test.describe('Timer Display & Controls', () => {
  test('should display timer interface with initial 00:00:00', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const timerDisplay = await getTimerDisplay(window);
    await expect(timerDisplay).toBeVisible();

    const timeText = await timerDisplay.textContent();
    expect(timeText).toBe('00:00:00');
  });

  test('should have START button initially', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    await expect(startStopButton).toBeVisible();
    await expect(startStopButton).toHaveText('START');
  });

  test('should have disabled PAUSE button initially', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const pauseResumeButton = await getPauseResumeButton(window);
    await expect(pauseResumeButton).toBeVisible();
    await expect(pauseResumeButton).toHaveText('PAUSE');
    await expect(pauseResumeButton).toBeDisabled();
  });

  test('START button initiates timer and increments display', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Verify initial state
    const initialTime = await timerDisplay.textContent();
    expect(initialTime).toBe('00:00:00');

    // Start the timer
    await startStopButton.click();

    // Button should now say STOP
    await expect(startStopButton).toHaveText('STOP');

    // Wait a bit and check that timer has incremented
    await window.waitForTimeout(1500);
    const runningTime = await timerDisplay.textContent();
    expect(runningTime).not.toBe('00:00:00');

    // Verify it's showing at least 1 second
    const elapsedMs = parseTimeToMs(runningTime || '00:00:00');
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
  });

  test('STOP button stops timer and saves entry', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await expect(startStopButton).toHaveText('STOP');

    // Wait for some elapsed time
    await window.waitForTimeout(2000);

    // Stop the timer
    await startStopButton.click();

    // Should navigate to worklog-detail view after stopping
    await window.waitForTimeout(1000);

    // Timer should reset to 00:00:00 after stopping
    await navigateToChrono(window);
    const resetTime = await timerDisplay.textContent();
    expect(resetTime).toBe('00:00:00');

    // Button should be back to START
    await expect(startStopButton).toHaveText('START');
  });

  test('PAUSE button pauses timer and shows PAUSED badge', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(1000);

    // Pause button should be enabled
    await expect(pauseResumeButton).toBeEnabled();
    await expect(pauseResumeButton).toHaveText('PAUSE');

    // Click pause
    await pauseResumeButton.click();

    // Button should change to RESUME
    await expect(pauseResumeButton).toHaveText('RESUME');

    // PAUSED badge should be visible
    const pausedBadge = window.locator('.rounded-full:text("Paused")');
    await expect(pausedBadge).toBeVisible();

    // Timer display should have yellow-400 class when paused
    const hasYellowClass = await timerDisplay.evaluate(el =>
      el.classList.contains('text-yellow-400')
    );
    expect(hasYellowClass).toBe(true);
  });

  test('RESUME button resumes timer from paused state', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(1000);

    // Pause
    await pauseResumeButton.click();
    const pausedTime = await timerDisplay.textContent();
    const pausedMs = parseTimeToMs(pausedTime || '00:00:00');

    // Wait while paused
    await window.waitForTimeout(1000);

    // Time should not have changed while paused
    const stillPausedTime = await timerDisplay.textContent();
    expect(stillPausedTime).toBe(pausedTime);

    // Resume
    await pauseResumeButton.click();

    // Button should change back to PAUSE
    await expect(pauseResumeButton).toHaveText('PAUSE');

    // PAUSED badge should disappear
    const pausedBadge = window.locator('.rounded-full:text("Paused")');
    await expect(pausedBadge).not.toBeVisible();

    // Timer should continue incrementing
    await window.waitForTimeout(1500);
    const resumedTime = await timerDisplay.textContent();
    const resumedMs = parseTimeToMs(resumedTime || '00:00:00');

    expect(resumedMs).toBeGreaterThan(pausedMs);
  });

  test('timer displays HH:MM:SS format correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const timerDisplay = await getTimerDisplay(window);

    // Check initial format
    const initialTime = await timerDisplay.textContent();
    expect(initialTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    // Start and check running format
    const startStopButton = await getStartStopButton(window);
    await startStopButton.click();
    await window.waitForTimeout(1500);

    const runningTime = await timerDisplay.textContent();
    expect(runningTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('timer stops incrementing when paused', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(1000);

    // Pause
    await pauseResumeButton.click();
    const pausedTime1 = await timerDisplay.textContent();

    // Wait and check multiple times that time hasn't changed
    await window.waitForTimeout(500);
    const pausedTime2 = await timerDisplay.textContent();
    expect(pausedTime2).toBe(pausedTime1);

    await window.waitForTimeout(500);
    const pausedTime3 = await timerDisplay.textContent();
    expect(pausedTime3).toBe(pausedTime1);

    await window.waitForTimeout(500);
    const pausedTime4 = await timerDisplay.textContent();
    expect(pausedTime4).toBe(pausedTime1);
  });
});

test.describe('Assignment Selection', () => {
  test('AssignmentPicker opens correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const picker = await getAssignmentPicker(window);
    await expect(picker).toBeVisible();

    // Open dropdown
    await picker.click();

    // Dropdown should be visible
    const dropdown = window.locator('.absolute.top-full');
    await expect(dropdown).toBeVisible();

    // Should have search input
    const searchInput = window.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();

    // Should have "No assignment" option
    const noAssignment = window.locator('span:has-text("No assignment")');
    await expect(noAssignment).toBeVisible();
  });

  test('can select "No assignment" option', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    await openAssignmentPicker(window);

    // Click "No assignment"
    const noAssignment = window.locator('button:has-text("No assignment")');
    await noAssignment.click();

    // Dropdown should close
    const dropdown = window.locator('.absolute.top-full');
    await expect(dropdown).not.toBeVisible();

    // Picker should show placeholder
    const picker = await getAssignmentPicker(window);
    const pickerText = await picker.textContent();
    expect(pickerText).toContain('Select assignment');
  });

  test('can assign to bucket', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // First navigate to buckets view and create a test bucket
    const bucketsButton = window.locator('button:has-text("Buckets")');
    await bucketsButton.click();
    await window.waitForTimeout(300);

    // Click "New Bucket" button
    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await newBucketButton.click();
    await window.waitForTimeout(300);

    // Fill in bucket name
    const nameInput = window.locator('input[placeholder="Bucket name"]');
    await nameInput.fill('Test Bucket');

    // Click create button
    const createButton = window.locator('button:has-text("Create")').last();
    await createButton.click();
    await window.waitForTimeout(500);

    // Navigate back to chrono
    await navigateToChrono(window);

    // Open assignment picker
    await openAssignmentPicker(window);

    // Select the bucket
    const bucketOption = window.locator('button:has-text("Test Bucket")').first();
    await bucketOption.click();

    // Dropdown should close
    const dropdown = window.locator('.absolute.top-full');
    await expect(dropdown).not.toBeVisible();

    // Picker should display selected bucket
    const picker = await getAssignmentPicker(window);
    const pickerText = await picker.textContent();
    expect(pickerText).toContain('Test Bucket');
  });

  test('assignment displays correctly in picker', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create a bucket first
    const bucketsButton = window.locator('button:has-text("Buckets")');
    await bucketsButton.click();
    await window.waitForTimeout(300);

    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await newBucketButton.click();
    await window.waitForTimeout(300);

    const nameInput = window.locator('input[placeholder="Bucket name"]');
    await nameInput.fill('Display Test Bucket');

    const createButton = window.locator('button:has-text("Create")').last();
    await createButton.click();
    await window.waitForTimeout(500);

    // Navigate to chrono and select bucket
    await navigateToChrono(window);
    await openAssignmentPicker(window);

    const bucketOption = window.locator('button:has-text("Display Test Bucket")').first();
    await bucketOption.click();

    // Verify picker shows bucket name
    const picker = await getAssignmentPicker(window);
    const pickerText = await picker.textContent();
    expect(pickerText).toContain('Display Test Bucket');

    // Verify color indicator is present
    const colorIndicator = picker.locator('.w-3.h-3.rounded-full');
    await expect(colorIndicator).toBeVisible();
  });

  test('assignment locked while timer running', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const picker = await getAssignmentPicker(window);

    // Initially should be enabled
    const initialClasses = await picker.getAttribute('class');
    expect(initialClasses).not.toContain('pointer-events-none');

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(500);

    // Picker should be locked (pointer-events-none and opacity-60)
    const pickerParent = window.locator('label:has-text("Assignment")').locator('..');
    const lockedClasses = await pickerParent.locator('.pointer-events-none').count();
    expect(lockedClasses).toBeGreaterThan(0);

    // Placeholder should indicate it's locked
    const pickerText = await picker.textContent();
    expect(pickerText).toContain('locked while running');
  });

  test('assignment unlocked when timer paused', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const picker = await getAssignmentPicker(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(500);

    // Verify locked
    const pickerParent = window.locator('label:has-text("Assignment")').locator('..');
    const lockedCount1 = await pickerParent.locator('.pointer-events-none').count();
    expect(lockedCount1).toBeGreaterThan(0);

    // Pause timer
    await pauseResumeButton.click();
    await window.waitForTimeout(300);

    // Assignment picker should still be locked even when paused
    // (based on the condition: isRunning && !isPaused)
    // When paused, isRunning is true but isPaused is also true
    // So it should be unlocked during pause
    const lockedCount2 = await pickerParent.locator('.pointer-events-none').count();
    expect(lockedCount2).toBe(0);
  });

  test('search functionality filters assignments', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create multiple buckets
    const bucketsButton = window.locator('button:has-text("Buckets")');
    await bucketsButton.click();
    await window.waitForTimeout(300);

    // Create first bucket
    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await newBucketButton.click();
    await window.waitForTimeout(300);
    const nameInput1 = window.locator('input[placeholder="Bucket name"]');
    await nameInput1.fill('Development Work');
    const createButton1 = window.locator('button:has-text("Create")').last();
    await createButton1.click();
    await window.waitForTimeout(500);

    // Create second bucket
    await newBucketButton.click();
    await window.waitForTimeout(300);
    const nameInput2 = window.locator('input[placeholder="Bucket name"]');
    await nameInput2.fill('Meeting Time');
    const createButton2 = window.locator('button:has-text("Create")').last();
    await createButton2.click();
    await window.waitForTimeout(500);

    // Navigate to chrono
    await navigateToChrono(window);
    await openAssignmentPicker(window);

    // Type in search
    const searchInput = window.locator('input[placeholder*="Search"]');
    await searchInput.fill('Development');
    await window.waitForTimeout(300);

    // Should show Development Work but not Meeting Time
    const devOption = window.locator('button:has-text("Development Work")');
    await expect(devOption).toBeVisible();

    const meetingOption = window.locator('button:has-text("Meeting Time")');
    await expect(meetingOption).not.toBeVisible();
  });
});

test.describe('Timer State Management', () => {
  test('elapsed time is accurate', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();

    // Wait exactly 2 seconds
    await window.waitForTimeout(2000);

    // Check elapsed time
    const timeText = await timerDisplay.textContent();
    const elapsedMs = parseTimeToMs(timeText || '00:00:00');

    // Should be between 1900ms and 2500ms (allowing for some variance)
    expect(elapsedMs).toBeGreaterThanOrEqual(1900);
    expect(elapsedMs).toBeLessThanOrEqual(2500);
  });

  test('timer state persists on view change', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(1500);

    // Get current time
    const timeBeforeSwitch = await timerDisplay.textContent();
    const msBeforeSwitch = parseTimeToMs(timeBeforeSwitch || '00:00:00');

    // Switch to worklog view
    const worklogButton = window.locator('button:has-text("Worklog")');
    await worklogButton.click();
    await window.waitForTimeout(500);

    // Switch back to chrono
    await navigateToChrono(window);

    // Timer should still be running
    const startStopButtonAfter = await getStartStopButton(window);
    await expect(startStopButtonAfter).toHaveText('STOP');

    // Time should have continued incrementing
    const timeAfterSwitch = await timerDisplay.textContent();
    const msAfterSwitch = parseTimeToMs(timeAfterSwitch || '00:00:00');

    expect(msAfterSwitch).toBeGreaterThan(msBeforeSwitch);
  });

  test('pause state persists on view change', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);

    // Start and pause timer
    await startStopButton.click();
    await window.waitForTimeout(1000);
    await pauseResumeButton.click();

    // Verify paused state
    await expect(pauseResumeButton).toHaveText('RESUME');
    const pausedBadge = window.locator('.rounded-full:text("Paused")');
    await expect(pausedBadge).toBeVisible();

    // Switch views
    const worklogButton = window.locator('button:has-text("Worklog")');
    await worklogButton.click();
    await window.waitForTimeout(300);

    // Switch back
    await navigateToChrono(window);

    // Should still be paused
    const pauseResumeButtonAfter = await getPauseResumeButton(window);
    await expect(pauseResumeButtonAfter).toHaveText('RESUME');
    await expect(pausedBadge).toBeVisible();
  });

  test('timer updates correctly after pause and resume', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer and run for 1 second
    await startStopButton.click();
    await window.waitForTimeout(1000);

    // Pause and get time
    await pauseResumeButton.click();
    const pausedTime = await timerDisplay.textContent();
    const pausedMs = parseTimeToMs(pausedTime || '00:00:00');

    // Wait while paused
    await window.waitForTimeout(1000);

    // Resume
    await pauseResumeButton.click();

    // Run for another second
    await window.waitForTimeout(1000);

    // Get final time
    const finalTime = await timerDisplay.textContent();
    const finalMs = parseTimeToMs(finalTime || '00:00:00');

    // Final time should be approximately pausedMs + 1000ms
    // Allow some variance (800ms to 1500ms added)
    const expectedMin = pausedMs + 800;
    const expectedMax = pausedMs + 1500;

    expect(finalMs).toBeGreaterThanOrEqual(expectedMin);
    expect(finalMs).toBeLessThanOrEqual(expectedMax);
  });

  test('multiple pause/resume cycles work correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer
    await startStopButton.click();
    await window.waitForTimeout(500);

    // First pause/resume cycle
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('RESUME');
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('PAUSE');

    // Second pause/resume cycle
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('RESUME');
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('PAUSE');

    // Third pause/resume cycle
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('RESUME');
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await expect(pauseResumeButton).toHaveText('PAUSE');

    // Timer should still be running and incrementing
    const time1 = await timerDisplay.textContent();
    await window.waitForTimeout(1000);
    const time2 = await timerDisplay.textContent();

    expect(parseTimeToMs(time2 || '00:00:00')).toBeGreaterThan(parseTimeToMs(time1 || '00:00:00'));
  });

  test('timer resets to 00:00:00 after stop', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer and let it run
    await startStopButton.click();
    await window.waitForTimeout(2000);

    // Verify it's not 00:00:00
    const runningTime = await timerDisplay.textContent();
    expect(runningTime).not.toBe('00:00:00');

    // Stop timer
    await startStopButton.click();

    // Navigate back to chrono (since stop navigates to detail view)
    await window.waitForTimeout(1000);
    await navigateToChrono(window);

    // Timer should be reset
    const resetTime = await timerDisplay.textContent();
    expect(resetTime).toBe('00:00:00');
  });

  test('timer state is consistent after multiple start/stop cycles', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // First cycle: start, run, stop
    await startStopButton.click();
    await window.waitForTimeout(1000);
    await startStopButton.click();
    await window.waitForTimeout(500);

    // Navigate back to chrono
    await navigateToChrono(window);

    // Verify reset
    let currentTime = await timerDisplay.textContent();
    expect(currentTime).toBe('00:00:00');
    await expect(startStopButton).toHaveText('START');
    await expect(pauseResumeButton).toBeDisabled();

    // Second cycle: start, run, pause, resume, stop
    await startStopButton.click();
    await window.waitForTimeout(1000);
    await pauseResumeButton.click();
    await window.waitForTimeout(500);
    await pauseResumeButton.click();
    await window.waitForTimeout(1000);
    await startStopButton.click();
    await window.waitForTimeout(500);

    // Navigate back to chrono
    await navigateToChrono(window);

    // Verify reset again
    currentTime = await timerDisplay.textContent();
    expect(currentTime).toBe('00:00:00');
    await expect(startStopButton).toHaveText('START');
    await expect(pauseResumeButton).toBeDisabled();

    // Third cycle: start fresh and verify it works
    await startStopButton.click();
    await window.waitForTimeout(1500);
    currentTime = await timerDisplay.textContent();
    const elapsedMs = parseTimeToMs(currentTime || '00:00:00');
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
    await expect(startStopButton).toHaveText('STOP');
    await expect(pauseResumeButton).toBeEnabled();
  });
});

test.describe('Timer Integration Tests', () => {
  test('timer with assignment creates entry in worklog', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');

    // Create a test bucket
    const bucketsButton = window.locator('button:has-text("Buckets")');
    await bucketsButton.click();
    await window.waitForTimeout(300);

    const newBucketButton = window.locator('button:has-text("New Bucket")');
    await newBucketButton.click();
    await window.waitForTimeout(300);

    const nameInput = window.locator('input[placeholder="Bucket name"]');
    await nameInput.fill('Integration Test Bucket');

    const createButton = window.locator('button:has-text("Create")').last();
    await createButton.click();
    await window.waitForTimeout(500);

    // Navigate to chrono and select bucket
    await navigateToChrono(window);
    await openAssignmentPicker(window);

    const bucketOption = window.locator('button:has-text("Integration Test Bucket")').first();
    await bucketOption.click();
    await window.waitForTimeout(300);

    // Start timer
    const startStopButton = await getStartStopButton(window);
    await startStopButton.click();
    await window.waitForTimeout(2000);

    // Stop timer
    await startStopButton.click();
    await window.waitForTimeout(1500);

    // Should be on detail view - navigate to worklog
    const worklogButton = window.locator('button:has-text("Worklog")');
    await worklogButton.click();
    await window.waitForTimeout(500);

    // Verify entry exists in worklog with bucket assignment
    const entryWithBucket = window.locator('span:has-text("Integration Test Bucket")');
    await expect(entryWithBucket).toBeVisible();
  });

  test('paused badge visibility toggles correctly', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const pausedBadge = window.locator('.rounded-full:text("Paused")');

    // Initially should not be visible
    await expect(pausedBadge).not.toBeVisible();

    // Start timer - still should not be visible
    await startStopButton.click();
    await window.waitForTimeout(500);
    await expect(pausedBadge).not.toBeVisible();

    // Pause - should become visible
    await pauseResumeButton.click();
    await expect(pausedBadge).toBeVisible();

    // Resume - should disappear
    await pauseResumeButton.click();
    await expect(pausedBadge).not.toBeVisible();

    // Pause again - should reappear
    await pauseResumeButton.click();
    await expect(pausedBadge).toBeVisible();

    // Stop - should disappear
    await startStopButton.click();
    await window.waitForTimeout(500);
    await navigateToChrono(window);
    await expect(pausedBadge).not.toBeVisible();
  });

  test('timer color changes between running and paused states', async ({ window }) => {
    await window.waitForLoadState('domcontentloaded');
    await navigateToChrono(window);

    const startStopButton = await getStartStopButton(window);
    const pauseResumeButton = await getPauseResumeButton(window);
    const timerDisplay = await getTimerDisplay(window);

    // Start timer - should be green
    await startStopButton.click();
    await window.waitForTimeout(500);

    const runningColor = await timerDisplay.evaluate(el =>
      window.getComputedStyle(el).color
    );
    // Green color (rgb(74, 222, 128) or similar)
    expect(runningColor).toContain('222'); // Green component

    // Pause - should be yellow
    await pauseResumeButton.click();
    await window.waitForTimeout(300);

    // Verify the timer has yellow class when paused
    const hasYellowClass = await timerDisplay.evaluate(el =>
      el.classList.contains('text-yellow-400')
    );
    expect(hasYellowClass).toBe(true);

    // Resume - should be green again
    await pauseResumeButton.click();
    await window.waitForTimeout(300);

    const resumedColor = await timerDisplay.evaluate(el =>
      window.getComputedStyle(el).color
    );
    expect(resumedColor).toContain('222'); // Green component
  });
});
