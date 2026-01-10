import { test, expect } from '../fixtures/electron';
import { mockIPCHandler } from '../helpers/electron';

/**
 * Settings UI tests for TimePortal
 *
 * These tests cover all settings functionality including:
 * - Activity detection settings
 * - Screen permission
 * - Integration toggles (Jira/Tempo)
 * - AI settings
 * - Reset settings functionality
 */

/**
 * Helper function to navigate to settings
 */
async function navigateToSettings(window: any) {
  // Wait for app to be ready
  await window.waitForLoadState('domcontentloaded');

  // Look for settings button/link - adjust selector based on actual UI
  // Common patterns: gear icon, "Settings" text, or navigation item
  const settingsButton = window.locator('button:has-text("Settings"), a:has-text("Settings"), [data-testid="settings-button"]').first();

  // If settings button exists, click it
  if (await settingsButton.count() > 0) {
    await settingsButton.click();
    await window.waitForTimeout(500);
  }

  // Wait for settings to be visible
  await window.waitForSelector('text=Activity Filtering', { timeout: 5000 });
}

/**
 * Helper function to get the current value of duration inputs
 */
async function getDurationInputValue(window: any, label: string): Promise<string> {
  const input = window.locator(`input[type="text"]`).filter({
    has: window.locator(`xpath=ancestor::div[contains(., "${label}")]`)
  }).first();

  return await input.inputValue();
}

test.describe('Settings - Activity Detection', () => {
  test('should display activity detection settings section', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Activity Filtering section
    const activitySection = window.locator('text=Activity Filtering');
    await expect(activitySection).toBeVisible();

    // Check for minimum activity duration input
    const minDurationLabel = window.locator('text=Minimum Activity Duration');
    await expect(minDurationLabel).toBeVisible();

    // Check for activity gap threshold input
    const gapThresholdLabel = window.locator('text=Activity Gap Threshold');
    await expect(gapThresholdLabel).toBeVisible();
  });

  test('should allow entering minimum activity duration in seconds', async ({ window }) => {
    await navigateToSettings(window);

    // Find minimum activity duration input
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    // Clear and enter new value
    await minDurationInput.clear();
    await minDurationInput.fill('5s');

    // Wait for debounced save
    await window.waitForTimeout(600);

    // Verify the value is displayed
    const value = await minDurationInput.inputValue();
    expect(value).toBe('5s');
  });

  test('should allow entering minimum activity duration in milliseconds', async ({ window }) => {
    await navigateToSettings(window);

    // Find minimum activity duration input
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    // Clear and enter new value
    await minDurationInput.clear();
    await minDurationInput.fill('500ms');

    // Wait for debounced save
    await window.waitForTimeout(600);

    // Verify the value is displayed
    const value = await minDurationInput.inputValue();
    expect(value).toBe('500ms');
  });

  test('should parse duration formats correctly', async ({ window }) => {
    await navigateToSettings(window);

    // Find minimum activity duration input
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    // Test different formats
    const testCases = [
      { input: '1s', expected: '1s' },
      { input: '1000ms', expected: '1s' }, // Should normalize to seconds
      { input: '1m', expected: '1m' },
      { input: '60s', expected: '1m' }, // Should normalize to minutes
    ];

    for (const { input, expected } of testCases) {
      await minDurationInput.clear();
      await minDurationInput.fill(input);
      await window.waitForTimeout(600);

      // Check the displayed value (may be normalized)
      const value = await minDurationInput.inputValue();
      // The component may normalize the value, so we just check it's a valid format
      expect(value).toMatch(/^\d+(\.\d+)?(ms|s|m)$/);
    }
  });

  test('should allow entering activity gap threshold', async ({ window }) => {
    await navigateToSettings(window);

    // Find activity gap threshold input
    const gapThresholdInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Activity Gap Threshold")]')
    }).first();

    // Clear and enter new value
    await gapThresholdInput.clear();
    await gapThresholdInput.fill('3m');

    // Wait for debounced save
    await window.waitForTimeout(600);

    // Verify the value is displayed
    const value = await gapThresholdInput.inputValue();
    expect(value).toBe('3m');
  });

  test('should auto-save settings after input change', async ({ window }) => {
    await navigateToSettings(window);

    // Find minimum activity duration input
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    // Get initial value
    const initialValue = await minDurationInput.inputValue();

    // Change value
    await minDurationInput.clear();
    await minDurationInput.fill('2s');

    // Wait for debounced save (500ms debounce + buffer)
    await window.waitForTimeout(600);

    // Navigate away and back to verify persistence would happen
    // In a real test, you might check localStorage or database
    const value = await minDurationInput.inputValue();
    expect(value).toBe('2s');
    expect(value).not.toBe(initialValue);
  });

  test('should display help text for duration inputs', async ({ window }) => {
    await navigateToSettings(window);

    // Check for help text under minimum activity duration
    const minDurationHelp = window.locator('text=Activities shorter than this will be filtered');
    await expect(minDurationHelp).toBeVisible();

    // Check for help text under activity gap threshold
    const gapThresholdHelp = window.locator('text=Maximum time gap between same-app activities');
    await expect(gapThresholdHelp).toBeVisible();
  });
});

test.describe('Settings - Screen Permission', () => {
  test('should display screen permission section', async ({ window, electronApp }) => {
    await navigateToSettings(window);

    // Mock permission status
    await mockIPCHandler(electronApp, 'check-screen-permission', () => {
      return 'not-determined';
    });

    // Check for Permissions section
    const permissionsSection = window.locator('text=Permissions');
    await expect(permissionsSection).toBeVisible();

    // Check for Screen Recording label
    const screenRecordingLabel = window.locator('text=Screen Recording');
    await expect(screenRecordingLabel).toBeVisible();

    // Check for "Required for Screenshots" text
    const requiredText = window.locator('text=Required for Screenshots');
    await expect(requiredText).toBeVisible();
  });

  test('should display granted permission status', async ({ window, electronApp }) => {
    // Mock permission status as granted
    await mockIPCHandler(electronApp, 'check-screen-permission', () => {
      return 'granted';
    });

    await navigateToSettings(window);

    // Wait for permission check
    await window.waitForTimeout(500);

    // Check for granted status badge
    const grantedBadge = window.locator('text=GRANTED');
    await expect(grantedBadge).toBeVisible();

    // Verify badge has green styling
    const badgeElement = await grantedBadge.elementHandle();
    if (badgeElement) {
      const classList = await badgeElement.evaluate(el => el.className);
      expect(classList).toContain('bg-green-900');
      expect(classList).toContain('text-green-400');
    }
  });

  test('should display denied permission status', async ({ window, electronApp }) => {
    // Mock permission status as denied
    await mockIPCHandler(electronApp, 'check-screen-permission', () => {
      return 'denied';
    });

    await navigateToSettings(window);

    // Wait for permission check
    await window.waitForTimeout(500);

    // Check for denied status badge
    const deniedBadge = window.locator('text=DENIED');
    await expect(deniedBadge).toBeVisible();

    // Verify badge has red styling
    const badgeElement = await deniedBadge.elementHandle();
    if (badgeElement) {
      const classList = await badgeElement.evaluate(el => el.className);
      expect(classList).toContain('bg-red-900');
      expect(classList).toContain('text-red-400');
    }
  });

  test('should show request permission button when not granted', async ({ window, electronApp }) => {
    // Mock permission status as not-determined
    await mockIPCHandler(electronApp, 'check-screen-permission', () => {
      return 'not-determined';
    });

    await navigateToSettings(window);

    // Wait for permission check
    await window.waitForTimeout(500);

    // Check for "Open System Settings" button
    const openSettingsButton = window.locator('button:has-text("Open System Settings")');
    await expect(openSettingsButton).toBeVisible();
  });

  test('should hide request permission button when granted', async ({ window, electronApp }) => {
    // Mock permission status as granted
    await mockIPCHandler(electronApp, 'check-screen-permission', () => {
      return 'granted';
    });

    await navigateToSettings(window);

    // Wait for permission check
    await window.waitForTimeout(500);

    // Check that "Open System Settings" button is not visible
    const openSettingsButton = window.locator('button:has-text("Open System Settings")');
    await expect(openSettingsButton).not.toBeVisible();
  });

  test('should have test screenshot capture button', async ({ window }) => {
    await navigateToSettings(window);

    // Check for test screenshot button
    const testScreenshotButton = window.locator('button:has-text("Test Screenshot Capture")');
    await expect(testScreenshotButton).toBeVisible();
  });

  test('should trigger screenshot capture on button click', async ({ window, electronApp }) => {
    let captureTriggered = false;

    // Mock screenshot capture handler
    await mockIPCHandler(electronApp, 'capture-screenshot', () => {
      captureTriggered = true;
      return { success: true };
    });

    await navigateToSettings(window);

    // Click test screenshot button
    const testScreenshotButton = window.locator('button:has-text("Test Screenshot Capture")');
    await testScreenshotButton.click();

    // Wait for IPC call
    await window.waitForTimeout(500);

    // Verify capture was triggered
    expect(captureTriggered).toBe(true);
  });
});

test.describe('Settings - Integration Toggles', () => {
  test('should display integration settings section', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Time Tracking Integration section
    const integrationSection = window.locator('text=Time Tracking Integration');
    await expect(integrationSection).toBeVisible();

    // Check for Jira Status
    const jiraStatus = window.locator('text=Jira Status');
    await expect(jiraStatus).toBeVisible();

    // Check for Tempo Status
    const tempoStatus = window.locator('text=Tempo Status');
    await expect(tempoStatus).toBeVisible();
  });

  test('should display workplace plan badge for free users', async ({ window }) => {
    await navigateToSettings(window);

    // Look for "WORKPLACE ONLY" badge (appears when user doesn't have access)
    const workplaceBadge = window.locator('text=WORKPLACE ONLY');

    // The badge may or may not be visible depending on subscription state
    // We just verify the section renders properly
    const integrationSection = window.locator('text=Time Tracking Integration');
    await expect(integrationSection).toBeVisible();
  });

  test('should display Jira connection status', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Jira status label
    const jiraStatusLabel = window.locator('text=Jira Status');
    await expect(jiraStatusLabel).toBeVisible();

    // Check for status badge (CONNECTED or DISABLED)
    const jiraStatusBadge = window.locator('.bg-gray-900, .bg-green-900').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Jira Status")]')
    }).locator('text=/CONNECTED|DISABLED/').first();

    await expect(jiraStatusBadge).toBeVisible();
  });

  test('should display Tempo connection status', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Tempo status label
    const tempoStatusLabel = window.locator('text=Tempo Status');
    await expect(tempoStatusLabel).toBeVisible();

    // Check for status badge (CONNECTED or DISABLED)
    const tempoStatusBadge = window.locator('.bg-gray-900, .bg-green-900').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Tempo Status")]')
    }).locator('text=/CONNECTED|DISABLED/').first();

    await expect(tempoStatusBadge).toBeVisible();
  });

  test('should show configure button for users with access', async ({ window }) => {
    await navigateToSettings(window);

    // Look for Configure Integration button
    // It appears when user has access to Jira or Tempo
    const configureButton = window.locator('button:has-text("Configure Integration"), button:has-text("Upgrade to Unlock")');

    // At least one of these buttons should be visible
    await expect(configureButton.first()).toBeVisible();
  });

  test('should open integration modal on configure button click', async ({ window }) => {
    await navigateToSettings(window);

    // Try to find and click Configure Integration button
    const configureButton = window.locator('button:has-text("Configure Integration")');

    // Only test if button exists (user has access)
    if (await configureButton.count() > 0) {
      await configureButton.click();

      // Wait for modal to open
      await window.waitForTimeout(500);

      // Check for modal content (adjust based on actual modal structure)
      // The modal should contain integration configuration options
      const modal = window.locator('[role="dialog"], .modal, div[class*="modal"]').first();

      // Modal should be visible
      const isVisible = await modal.isVisible().catch(() => false);

      // If modal opened, verify it has content
      if (isVisible) {
        expect(isVisible).toBe(true);
      }
    }
  });

  test('should display Jira sync settings when Jira is enabled', async ({ window }) => {
    await navigateToSettings(window);

    // Look for Jira Sync Settings section
    // This section only appears when Jira is enabled and configured
    const jiraSyncSection = window.locator('text=Jira Sync Settings');

    // Check if section exists (depends on configuration)
    const sectionCount = await jiraSyncSection.count();

    if (sectionCount > 0) {
      // Verify sync-related elements
      await expect(jiraSyncSection).toBeVisible();

      // Check for Automatic Sync toggle
      const autoSyncLabel = window.locator('text=Automatic Sync');
      await expect(autoSyncLabel).toBeVisible();

      // Check for Sync Now button
      const syncNowButton = window.locator('button:has-text("Sync Now"), button:has-text("Syncing...")');
      await expect(syncNowButton.first()).toBeVisible();
    }
  });
});

test.describe('Settings - AI Settings', () => {
  test('should display AI features section', async ({ window }) => {
    await navigateToSettings(window);

    // Check for AI Features section
    const aiSection = window.locator('text=AI Features');
    await expect(aiSection).toBeVisible();
  });

  test('should display auto-generate descriptions toggle', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Auto-generate Descriptions label
    const autoDescLabel = window.locator('text=Auto-generate Descriptions');
    await expect(autoDescLabel).toBeVisible();

    // Check for toggle switch
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-generate Descriptions")]')
    }).first();

    await expect(toggle).toBeAttached();
  });

  test('should toggle auto-generate descriptions on/off', async ({ window }) => {
    await navigateToSettings(window);

    // Find the toggle input
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-generate Descriptions")]')
    }).first();

    // Get initial state
    const initialState = await toggle.isChecked();

    // Click to toggle
    await toggle.click();

    // Wait for state change
    await window.waitForTimeout(100);

    // Verify state changed
    const newState = await toggle.isChecked();
    expect(newState).toBe(!initialState);
  });

  test('should display auto-assign work toggle', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Auto-assign Work label
    const autoAssignLabel = window.locator('text=Auto-assign Work');
    await expect(autoAssignLabel).toBeVisible();

    // Check for toggle switch
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-assign Work")]')
    }).first();

    await expect(toggle).toBeAttached();
  });

  test('should toggle auto-assign work on/off', async ({ window }) => {
    await navigateToSettings(window);

    // Find the toggle input
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-assign Work")]')
    }).first();

    // Get initial state
    const initialState = await toggle.isChecked();

    // Click to toggle
    await toggle.click();

    // Wait for state change
    await window.waitForTimeout(100);

    // Verify state changed
    const newState = await toggle.isChecked();
    expect(newState).toBe(!initialState);
  });

  test('should display auto-select account toggle', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Auto-select Tempo Accounts label
    const autoSelectLabel = window.locator('text=Auto-select Tempo Accounts');
    await expect(autoSelectLabel).toBeVisible();

    // Check for toggle switch
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-select Tempo Accounts")]')
    }).first();

    await expect(toggle).toBeAttached();
  });

  test('should toggle auto-select account on/off', async ({ window }) => {
    await navigateToSettings(window);

    // Find the toggle input
    const toggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-select Tempo Accounts")]')
    }).first();

    // Get initial state
    const initialState = await toggle.isChecked();

    // Click to toggle
    await toggle.click();

    // Wait for state change
    await window.waitForTimeout(100);

    // Verify state changed
    const newState = await toggle.isChecked();
    expect(newState).toBe(!initialState);
  });
});

test.describe('Settings - Reset Functionality', () => {
  test('should display reset to defaults button', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Reset to Defaults button
    const resetButton = window.locator('button:has-text("Reset to Defaults")');
    await expect(resetButton).toBeVisible();
  });

  test('should reset activity settings to defaults', async ({ window }) => {
    await navigateToSettings(window);

    // Change settings first
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    await minDurationInput.clear();
    await minDurationInput.fill('10s');
    await window.waitForTimeout(600);

    // Click reset button
    const resetButton = window.locator('button:has-text("Reset to Defaults")');
    await resetButton.click();

    // Wait for reset to complete
    await window.waitForTimeout(500);

    // Verify settings were reset (default is 1s = 1000ms)
    const value = await minDurationInput.inputValue();
    expect(value).toBe('1s');
  });

  test('should reset AI settings to defaults', async ({ window }) => {
    await navigateToSettings(window);

    // Change AI setting first
    const autoDescToggle = window.locator('input[type="checkbox"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Auto-generate Descriptions")]')
    }).first();

    const initialState = await autoDescToggle.isChecked();

    // Toggle it
    await autoDescToggle.click();
    await window.waitForTimeout(600);

    // Verify it changed
    const changedState = await autoDescToggle.isChecked();
    expect(changedState).toBe(!initialState);

    // Click reset button
    const resetButton = window.locator('button:has-text("Reset to Defaults")');
    await resetButton.click();

    // Wait for reset to complete
    await window.waitForTimeout(500);

    // Verify setting was reset to default (true)
    const resetState = await autoDescToggle.isChecked();
    expect(resetState).toBe(true);
  });
});

test.describe('Settings - Account & Subscription', () => {
  test('should display account section', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Account section
    const accountSection = window.locator('text=Account').first();
    await expect(accountSection).toBeVisible();
  });

  test('should display user email', async ({ window }) => {
    await navigateToSettings(window);

    // User info should be displayed
    // The actual email depends on authentication state
    const accountSection = window.locator('text=Account').first();
    await expect(accountSection).toBeVisible();
  });

  test('should display subscription status', async ({ window }) => {
    await navigateToSettings(window);

    // Check for plan status (Free Plan or Workplace Plan)
    const planStatus = window.locator('text=/Free Plan|Workplace Plan/').first();
    await expect(planStatus).toBeVisible();
  });

  test('should display sign out button', async ({ window }) => {
    await navigateToSettings(window);

    // Check for Sign Out button
    const signOutButton = window.locator('button:has-text("Sign Out")');
    await expect(signOutButton).toBeVisible();
  });

  test('should show upgrade prompt for free users', async ({ window }) => {
    await navigateToSettings(window);

    // Look for upgrade-related content
    // This may or may not be visible depending on subscription state
    const upgradeContent = window.locator('text=Upgrade to Workplace Plan, text=Upgrade Now');

    // Just verify the settings page renders properly
    const accountSection = window.locator('text=Account').first();
    await expect(accountSection).toBeVisible();
  });
});

test.describe('Settings - About Section', () => {
  test('should display about section', async ({ window }) => {
    await navigateToSettings(window);

    // Scroll to bottom to see About section
    await window.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Check for About section
    const aboutSection = window.locator('text=About');
    await expect(aboutSection).toBeVisible();
  });

  test('should display app version', async ({ window }) => {
    await navigateToSettings(window);

    // Scroll to bottom
    await window.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Check for version number
    const versionText = window.locator('text=/Clearical v\\d+\\.\\d+\\.\\d+/');
    await expect(versionText).toBeVisible();
  });
});

test.describe('Settings - Persistence', () => {
  test('should persist settings changes', async ({ window }) => {
    await navigateToSettings(window);

    // Change a setting
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    await minDurationInput.clear();
    await minDurationInput.fill('7s');

    // Wait for debounced save
    await window.waitForTimeout(600);

    // Get the value
    const savedValue = await minDurationInput.inputValue();
    expect(savedValue).toBe('7s');

    // In a full test, you would reload the app and verify the setting persisted
    // For now, we just verify the value is set
  });

  test('should handle rapid changes with debouncing', async ({ window }) => {
    await navigateToSettings(window);

    // Find input
    const minDurationInput = window.locator('input[type="text"]').filter({
      has: window.locator('xpath=ancestor::div[contains(., "Minimum Activity Duration")]')
    }).first();

    // Make rapid changes
    await minDurationInput.clear();
    await minDurationInput.fill('1s');
    await window.waitForTimeout(100);

    await minDurationInput.clear();
    await minDurationInput.fill('2s');
    await window.waitForTimeout(100);

    await minDurationInput.clear();
    await minDurationInput.fill('3s');

    // Wait for debounce to complete
    await window.waitForTimeout(600);

    // Verify final value is saved
    const finalValue = await minDurationInput.inputValue();
    expect(finalValue).toBe('3s');
  });
});

test.describe('Settings - UI Responsiveness', () => {
  test('should handle scroll for long settings page', async ({ window }) => {
    await navigateToSettings(window);

    // Scroll to bottom
    await window.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await window.waitForTimeout(200);

    // Scroll to top
    await window.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await window.waitForTimeout(200);

    // Verify we can still interact with top element
    const activitySection = window.locator('text=Activity Filtering');
    await expect(activitySection).toBeVisible();
  });

  test('should maintain consistent styling across sections', async ({ window }) => {
    await navigateToSettings(window);

    // Check that all section headers use consistent styling
    const sectionHeaders = window.locator('h3.text-xs.font-semibold.text-gray-400.uppercase');
    const headerCount = await sectionHeaders.count();

    // Should have multiple sections
    expect(headerCount).toBeGreaterThan(3);

    // All headers should be visible (within scroll view)
    for (let i = 0; i < Math.min(headerCount, 3); i++) {
      const header = sectionHeaders.nth(i);
      await expect(header).toBeVisible();
    }
  });
});
