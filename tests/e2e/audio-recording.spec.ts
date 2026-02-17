import { test, expect } from '../fixtures/electron';
import { Page } from '@playwright/test';
import { waitForConsoleMessage, captureConsoleLogs } from '../helpers/electron';
import { mockMeetingAPI } from '../helpers/meeting-mock';
import { simulateRecordingStart, simulateRecordingStop } from '../helpers/meeting-events';

/**
 * Audio Recording E2E Tests
 *
 * Tests the recording lifecycle at the IPC boundary level:
 * - Recording controls UI visibility and state
 * - Recording start/stop via UI button
 * - Recording start/stop via main process events (media detection)
 * - Regression tests for race conditions and session ID mismatches
 * - Transcription flow integration
 */

/** Dismiss the "Update Complete!" modal if it appears */
async function dismissUpdateModal(page: Page) {
  const dismissButton = page.locator('button:has-text("Dismiss")');
  const visible = await dismissButton.isVisible().catch(() => false);
  if (visible) {
    await dismissButton.click();
    await page.waitForTimeout(300);
  }
}

/** Navigate to the Chrono view */
async function navigateToChrono(page: Page) {
  await dismissUpdateModal(page);
  const chronoButton = page.locator('button:has-text("Chrono")');
  await chronoButton.waitFor({ state: 'visible', timeout: 5000 });
  await chronoButton.click();
  await page.waitForTimeout(300);
}

/** Click the START button to begin a timer */
async function startTimer(page: Page) {
  const startButton = page.locator('button:has-text("START")');
  await startButton.waitFor({ state: 'visible', timeout: 3000 });
  await startButton.click();
  // Wait for timer to be running
  await page.locator('button:has-text("STOP")').waitFor({ state: 'visible', timeout: 3000 });
}

/** Click the STOP button to stop the timer */
async function stopTimerViaUI(page: Page) {
  const stopButton = page.locator('button:has-text("STOP")');
  await stopButton.click();
}

test.describe('Block 1: Recording Controls UI', () => {
  test('recording controls visible with mic button when timer runs', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    // Recording controls container should be visible
    const controls = window.locator('.recording-controls');
    await expect(controls).toBeVisible();

    // Mic button should exist and not be disabled
    const button = window.locator('.recording-controls__button');
    await expect(button).toBeVisible();
    await expect(button).not.toBeDisabled();

    // Should not be in recording state
    const hasRecordingClass = await button.evaluate(el =>
      el.classList.contains('recording-controls__button--recording')
    );
    expect(hasRecordingClass).toBe(false);
  });

  test('recording button disabled when timer not running', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);

    // Don't start timer — button should be disabled
    const button = window.locator('.recording-controls__button');
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  });

  test('clicking mic button starts recording', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // Start listening for the console message before clicking
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await startPromise;

    // Button should now have recording class
    await expect(button).toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });

    // Pulse indicator should be visible
    const pulse = window.locator('.recording-controls__pulse');
    await expect(pulse).toBeVisible();
  });

  test('clicking stop button stops recording', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // Start recording
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await startPromise;
    await expect(button).toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });

    // Stop recording
    const stopPromise = waitForConsoleMessage(window, '[App] Stopping recording from controls', 10000);
    await button.click();
    await stopPromise;

    // Button should no longer have recording class
    await expect(button).not.toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });
  });

  test('stopping timer clears recording state', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    const recordButton = window.locator('.recording-controls__button');

    // Start recording
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await recordButton.click();
    await startPromise;

    // Listen for session ID log before stopping timer
    const sessionPromise = waitForConsoleMessage(window, 'Session ID for transcription lookup', 10000);

    // Stop the timer
    await stopTimerViaUI(window);
    await sessionPromise;

    // Should navigate away from Chrono (to entry detail view)
    await window.waitForTimeout(1000);
  });
});

test.describe('Block 2: Recording via Main Process Events', () => {
  test('recording start event syncs App.tsx state', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    // Simulate recording start from main process
    const syncPromise = waitForConsoleMessage(window, 'Synced recording state from external start, sessionId: test-entry-123', 10000);
    await simulateRecordingStart(electronApp, 'test-entry-123');
    await syncPromise;

    // Recording controls should show recording state
    const button = window.locator('.recording-controls__button');
    await expect(button).toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });
  });

  test('recording stop event syncs App.tsx state', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    // Simulate start then stop
    const startPromise = waitForConsoleMessage(window, 'Synced recording state from external start', 10000);
    await simulateRecordingStart(electronApp, 'test-entry-456');
    await startPromise;

    const stopPromise = waitForConsoleMessage(window, 'Recording stopped externally', 10000);
    await simulateRecordingStop(electronApp, 'test-entry-456');
    await stopPromise;

    // Recording controls should return to idle
    const button = window.locator('.recording-controls__button');
    await expect(button).not.toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });
  });

  test('session ID from event matches transcription lookup (regression)', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    // Simulate start with specific entry ID
    const syncPromise = waitForConsoleMessage(window, 'sessionId: entry-abc-123', 10000);
    await simulateRecordingStart(electronApp, 'entry-abc-123');
    await syncPromise;

    // Stop the timer — should use the same session ID for transcription lookup
    const lookupPromise = waitForConsoleMessage(window, 'Session ID for transcription lookup: entry-abc-123', 10000);
    await stopTimerViaUI(window);
    await lookupPromise;
  });
});

test.describe('Block 3: Regression Tests', () => {
  test('recording does not auto-stop (mic drop regression)', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // Start recording via UI
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await startPromise;
    await expect(button).toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });

    // Capture console logs to check no stop event fires
    const logs = captureConsoleLogs(window);

    // Wait 3 seconds
    await window.waitForTimeout(3000);

    // Recording button should still show recording state
    await expect(button).toHaveClass(/recording-controls__button--recording/);

    // No unexpected stop event should have fired
    const stopMessages = logs.filter(l => l.text.includes('RECEIVED STOP EVENT'));
    expect(stopMessages.length).toBe(0);
  });

  test('second recording starts cleanly after first stops', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // First recording: start
    const start1 = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await start1;
    await expect(button).toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });

    // First recording: stop
    const stop1 = waitForConsoleMessage(window, '[App] Stopping recording from controls', 10000);
    await button.click();
    await stop1;
    await expect(button).not.toHaveClass(/recording-controls__button--recording/, { timeout: 3000 });

    // Wait for stop lock to release in AudioRecordingContext
    // The context logs this when file processing completes
    await window.waitForTimeout(2000);

    // Second recording: start — should work without guard messages
    const logs = captureConsoleLogs(window);
    const start2 = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await start2;

    // Should not have hit the "already recording" guard
    const guardMessages = logs.filter(l => l.text.includes('GUARD: Already recording'));
    expect(guardMessages.length).toBe(0);
  });

  test('duplicate start events are deduplicated', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp);
    await navigateToChrono(window);
    await startTimer(window);

    // Send two start events 50ms apart
    const guardPromise = waitForConsoleMessage(
      window,
      'Synced recording state from external start',
      10000
    );
    await simulateRecordingStart(electronApp, 'dup-test-1');
    await guardPromise;

    // The second event should be ignored because recordingSessionIdRef is already set
    // App.tsx checks: if (!recordingSessionIdRef.current) before setting state
    const logs = captureConsoleLogs(window);
    await simulateRecordingStart(electronApp, 'dup-test-2');
    await window.waitForTimeout(500);

    // The second start should NOT have synced (session ID was already set)
    const secondSyncMessages = logs.filter(l =>
      l.text.includes('Synced recording state from external start, sessionId: dup-test-2')
    );
    expect(secondSyncMessages.length).toBe(0);
  });
});

test.describe('Block 4: Transcription Flow', () => {
  test('completed transcription available at timer stop', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp, {
      transcriptionResult: {
        success: true,
        transcription: {
          text: 'Test transcription result.',
          segments: [{ start: 0, end: 3, text: 'Test transcription result.' }],
          language: 'en',
          duration: 3,
        },
      },
    });
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // Start recording
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await startPromise;

    // Stop recording
    const stopRecPromise = waitForConsoleMessage(window, '[App] Stopping recording from controls', 10000);
    await button.click();
    await stopRecPromise;

    // Wait for transcription processing
    await window.waitForTimeout(2000);

    // Stop the timer — should find completed transcription
    const foundPromise = waitForConsoleMessage(window, 'completed transcription', 10000);
    await stopTimerViaUI(window);
    await foundPromise;
  });

  test('transcription failure handled gracefully', async ({ electronApp, window }) => {
    await mockMeetingAPI(electronApp, {
      transcriptionResult: {
        success: false,
        error: 'API error: test failure',
      },
    });
    await navigateToChrono(window);
    await startTimer(window);

    const button = window.locator('.recording-controls__button');

    // Start recording
    const startPromise = waitForConsoleMessage(window, '[App] Starting recording from controls', 10000);
    await button.click();
    await startPromise;

    // Stop recording — transcription will fail
    const stopRecPromise = waitForConsoleMessage(window, '[App] Stopping recording from controls', 10000);
    await button.click();
    await stopRecPromise;

    // Wait for transcription attempt
    await window.waitForTimeout(2000);

    // Stop the timer — should not crash, entry should still be created
    await stopTimerViaUI(window);

    // Wait a moment to confirm no crash
    await window.waitForTimeout(1500);

    // App should still be responsive — navigate back to verify
    await navigateToChrono(window);
    const chronoButton = window.locator('button:has-text("Chrono")');
    await expect(chronoButton).toBeVisible();
  });
});
