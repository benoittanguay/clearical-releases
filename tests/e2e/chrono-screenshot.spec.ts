import { test, expect } from '../fixtures/electron';
import { Page } from '@playwright/test';

/**
 * Chrono Timer Screenshot Tests
 *
 * Captures screenshots of the chrono timer view for visual inspection
 * of the split-flap display implementation.
 */

/**
 * Helper function to dismiss any overlay modals
 */
async function dismissModals(page: Page) {
  // Repeat dismissal several times to catch multiple modals
  for (let i = 0; i < 3; i++) {
    // Try to dismiss Update Success modal (button text is "Dismiss")
    const dismissButton = page.locator('button:has-text("Dismiss")');
    if (await dismissButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Dismissing Update Success modal');
      await dismissButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // Try to dismiss Permission Request modal
    const continueButton = page.locator('button:has-text("Continue")');
    if (await continueButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Dismissing modal with Continue button');
      await continueButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // Try to find and click any close button
    const closeButton = page.locator('button:has-text("Close")');
    if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Dismissing modal with Close button');
      await closeButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // Try to find and click any skip button
    const skipButton = page.locator('button:has-text("Skip")');
    if (await skipButton.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Dismissing modal with Skip button');
      await skipButton.click();
      await page.waitForTimeout(500);
      continue;
    }

    // Check if there's still a modal backdrop visible
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/70');
    if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Modal still visible, trying Escape key');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      // No modal detected, we're done
      break;
    }
  }
}

/**
 * Helper function to navigate to chrono view
 */
async function navigateToChrono(page: Page) {
  // First dismiss any modals that might be blocking
  await dismissModals(page);

  const chronoButton = page.locator('button:has-text("Chrono")');
  await chronoButton.waitFor({ state: 'visible', timeout: 5000 });
  await chronoButton.click();
  await page.waitForTimeout(500); // Wait for view transition
}

/**
 * Helper function to get START/STOP button
 */
async function getStartStopButton(page: Page) {
  return page.locator('button:has-text("START"), button:has-text("STOP")');
}

/**
 * Helper function to capture rapid screenshots during animation
 * Takes screenshots every intervalMs for count times
 */
async function captureRapidScreenshots(
  page: Page,
  prefix: string,
  count: number,
  intervalMs: number
) {
  const screenshots: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = `test-results/screenshots/${prefix}-${i.toString().padStart(2, '0')}.png`;
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
    if (i < count - 1) {
      await page.waitForTimeout(intervalMs);
    }
  }
  return screenshots;
}

test.describe('Chrono Timer Screenshot', () => {
  test('capture chrono timer view with running timer', async ({ window, electronApp }) => {
    await window.waitForLoadState('domcontentloaded');

    // Mock the permission check to always return granted
    await electronApp.evaluate(({ ipcMain }) => {
      // Remove existing handlers if any
      ipcMain.removeHandler('check-screen-permission');

      // Mock screen permission check to always return granted
      ipcMain.handle('check-screen-permission', () => 'granted');
    });

    await navigateToChrono(window);

    // Wait for split-flap display to be visible
    const splitFlapDisplay = window.locator('.split-flap-display');
    await splitFlapDisplay.waitFor({ state: 'visible', timeout: 5000 });

    // Capture initial state screenshot (00:00:00)
    await window.screenshot({
      path: 'test-results/screenshots/chrono-timer-initial.png',
      fullPage: true
    });

    // Start the timer
    const startStopButton = await getStartStopButton(window);

    // Verify button is visible and says START
    await expect(startStopButton).toBeVisible();
    console.log('START button is visible');

    // Click the START button
    await startStopButton.click();
    console.log('Clicked START button');

    // Wait a bit for the click to register
    await window.waitForTimeout(500);

    // Wait for the button to change to STOP
    await expect(startStopButton).toHaveText('STOP', { timeout: 5000 });

    // Wait for timer to run for 3 seconds to see the split-flap animation
    await window.waitForTimeout(3000);

    // Capture running timer screenshot
    await window.screenshot({
      path: 'test-results/screenshots/chrono-timer-running.png',
      fullPage: true
    });

    // Also capture just the flip clock container for closer inspection
    const flipClockContainer = window.locator('.flip-clock-container');
    if (await flipClockContainer.isVisible()) {
      await flipClockContainer.screenshot({
        path: 'test-results/screenshots/chrono-split-flap-closeup.png'
      });
    }

    // Wait another second and capture to see more digit changes
    await window.waitForTimeout(1000);

    await window.screenshot({
      path: 'test-results/screenshots/chrono-timer-running-4s.png',
      fullPage: true
    });

    // Verify split-flap elements are present
    const splitFlapDigits = window.locator('.split-flap-digit');
    const digitCount = await splitFlapDigits.count();
    console.log(`Found ${digitCount} split-flap digits`);

    // Should have 6 digits (HH:MM:SS without colons)
    expect(digitCount).toBe(6);

    // Verify the split line is present on each digit (dark line in middle)
    const splitLines = window.locator('.flap-split-line');
    const splitLineCount = await splitLines.count();
    console.log(`Found ${splitLineCount} split lines`);
    expect(splitLineCount).toBe(6);

    // Verify the flip clock bezel (orange border) is present
    const bezel = window.locator('.flip-clock-bezel');
    await expect(bezel).toBeVisible();

    // Stop the timer
    await startStopButton.click();
    await window.waitForTimeout(500);

    console.log('Screenshots captured successfully!');
    console.log('Check test-results/screenshots/ for:');
    console.log('  - chrono-timer-initial.png (00:00:00 state)');
    console.log('  - chrono-timer-running.png (after 3s)');
    console.log('  - chrono-split-flap-closeup.png (close-up of display)');
    console.log('  - chrono-timer-running-4s.png (after 4s)');
  });

  test('capture flip animation in progress', async ({ window, electronApp }) => {
    await window.waitForLoadState('domcontentloaded');

    // Mock the permission check to always return granted
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('check-screen-permission');
      ipcMain.handle('check-screen-permission', () => 'granted');
    });

    await navigateToChrono(window);

    // Wait for split-flap display to be visible
    const splitFlapDisplay = window.locator('.split-flap-display');
    await splitFlapDisplay.waitFor({ state: 'visible', timeout: 5000 });

    // Start the timer
    const startStopButton = await getStartStopButton(window);
    await startStopButton.click();

    // Wait for the button to change to STOP
    await expect(startStopButton).toHaveText('STOP', { timeout: 5000 });

    console.log('Timer started. Will capture rapid screenshots during second transitions.');

    // Collect console logs to verify flip triggers
    const consoleLogs: string[] = [];
    window.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('FLIP')) {
        consoleLogs.push(text);
        console.log('Console:', text);
      }
    });

    // Wait until we're just before a second transition (e.g., at 800ms into a second)
    // Timer format is HH:MM:SS, seconds digit changes every 1000ms
    await window.waitForTimeout(800);

    // Capture rapid screenshots over the next 1.5 seconds (covering ~2 second transitions)
    // Take 15 screenshots at 100ms intervals to catch the animation
    console.log('Capturing rapid screenshots to catch flip animation...');
    const rapidScreenshots = await captureRapidScreenshots(window, 'flip-animation', 15, 100);

    console.log(`Captured ${rapidScreenshots.length} rapid screenshots.`);

    // Also check for animated flap elements
    const animatedTopFlaps = window.locator('.flap-top-animated');
    const animatedBottomFlaps = window.locator('.flap-bottom-animated');

    // Wait another 1.5 seconds and check again
    await window.waitForTimeout(1500);

    // Take a few more screenshots during the next transition
    console.log('Capturing second batch of screenshots...');
    const secondBatch = await captureRapidScreenshots(window, 'flip-animation-batch2', 10, 100);

    // Count how many animated flaps we can see at any moment
    const topAnimatedCount = await animatedTopFlaps.count();
    const bottomAnimatedCount = await animatedBottomFlaps.count();
    console.log(`Currently visible animated flaps: top=${topAnimatedCount}, bottom=${bottomAnimatedCount}`);

    // Stop the timer
    await startStopButton.click();
    await window.waitForTimeout(500);

    // Report findings
    console.log('=== FLIP ANIMATION TEST RESULTS ===');
    console.log(`Total console logs with FLIP: ${consoleLogs.length}`);
    consoleLogs.forEach(log => console.log(`  ${log}`));
    console.log('');
    console.log('Screenshots captured:');
    rapidScreenshots.forEach(s => console.log(`  ${s}`));
    secondBatch.forEach(s => console.log(`  ${s}`));
    console.log('');
    console.log('Inspect the screenshots to verify:');
    console.log('  1. Orange-tinted flaps (#2a1a0a) appear during transitions');
    console.log('  2. Glowing orange shadows visible around flipping digits');
    console.log('  3. Different screenshots show different stages of the flip');

    // Verify we got console logs indicating flips happened
    expect(consoleLogs.length).toBeGreaterThan(0);
  });

  test('verify animated flap elements exist during flip', async ({ window, electronApp }) => {
    await window.waitForLoadState('domcontentloaded');

    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('check-screen-permission');
      ipcMain.handle('check-screen-permission', () => 'granted');
    });

    await navigateToChrono(window);

    const splitFlapDisplay = window.locator('.split-flap-display');
    await splitFlapDisplay.waitFor({ state: 'visible', timeout: 5000 });

    // Click START button - use a more specific locator
    const startButton = window.locator('button:has-text("START")');
    await startButton.waitFor({ state: 'visible', timeout: 5000 });
    await startButton.click();

    // Wait for timer to start and button to change
    await window.waitForTimeout(500);

    // The animation lasts 1400ms and includes orange-tinted animated flaps
    // We need to check rapidly for their presence

    let foundAnimatedTop = false;
    let foundAnimatedBottom = false;

    // Check for 3 seconds (3 second transitions)
    for (let i = 0; i < 30; i++) {
      const topCount = await window.locator('.flap-top-animated').count();
      const bottomCount = await window.locator('.flap-bottom-animated').count();

      if (topCount > 0) {
        foundAnimatedTop = true;
        console.log(`Found ${topCount} animated top flaps at check ${i}`);

        // Take a screenshot when we find animated elements
        await window.screenshot({
          path: `test-results/screenshots/animated-flap-found-${i}.png`,
          fullPage: true
        });
      }

      if (bottomCount > 0) {
        foundAnimatedBottom = true;
        console.log(`Found ${bottomCount} animated bottom flaps at check ${i}`);
      }

      if (foundAnimatedTop && foundAnimatedBottom) {
        console.log('Found both animated flap types!');
        break;
      }

      await window.waitForTimeout(100);
    }

    // Stop timer - click STOP button
    const stopButton = window.locator('button:has-text("STOP")');
    if (await stopButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stopButton.click();
    }

    console.log(`Results: foundAnimatedTop=${foundAnimatedTop}, foundAnimatedBottom=${foundAnimatedBottom}`);

    // Both should have been found at some point during the 3 seconds
    expect(foundAnimatedTop).toBe(true);
    expect(foundAnimatedBottom).toBe(true);
  });
});
