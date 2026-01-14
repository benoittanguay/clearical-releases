import { test as base, ElectronApplication, Page } from '@playwright/test';
import {
  launchElectronApp,
  closeElectronApp,
  ElectronLaunchOptions,
  ElectronAppContext,
  mockAuthentication,
} from '../helpers/electron';

/**
 * Extended test fixture type that includes Electron app and window
 */
type ElectronFixtures = {
  /**
   * The Electron application instance
   */
  electronApp: ElectronApplication;

  /**
   * The main window page instance
   */
  window: Page;

  /**
   * Launch options for customizing app startup
   */
  launchOptions: ElectronLaunchOptions;

  /**
   * Whether to mock authentication (default: true)
   * Set to false to test the login screen
   */
  mockAuth: boolean;
};

/**
 * Extended Playwright test with Electron fixtures
 *
 * Usage:
 * ```ts
 * import { test, expect } from './fixtures/electron';
 *
 * test('my test', async ({ electronApp, window }) => {
 *   // Test code here - authenticated by default
 * });
 *
 * // To test without authentication:
 * test.use({ mockAuth: false });
 * test('login test', async ({ window }) => {
 *   // Test login screen
 * });
 * ```
 */
export const test = base.extend<ElectronFixtures>({
  /**
   * Default launch options - can be overridden per test
   */
  launchOptions: async ({}, use) => {
    await use({
      timeout: 30000,
      headless: false,
      recordVideo: false,
    });
  },

  /**
   * Whether to mock authentication - default true
   */
  mockAuth: async ({}, use) => {
    await use(true);
  },

  /**
   * Electron app fixture - automatically launches and closes the app
   */
  electronApp: async ({ launchOptions, mockAuth }, use) => {
    let context: ElectronAppContext | null = null;

    try {
      // Launch the Electron app
      context = await launchElectronApp(launchOptions);

      // Mock authentication if enabled
      if (mockAuth) {
        await mockAuthentication(context.app);
      }

      // Provide the app to the test
      await use(context.app);
    } finally {
      // Clean up - close the app after the test with timeout protection
      if (context?.app) {
        await Promise.race([
          closeElectronApp(context.app),
          new Promise(resolve => setTimeout(resolve, 10000)) // 10s max for cleanup
        ]);
      }
    }
  },

  /**
   * Window fixture - provides the main window page
   */
  window: async ({ electronApp, mockAuth }, use) => {
    // Get the first window
    const window = await electronApp.firstWindow();

    // If auth is mocked, wait for the main app content and reload to apply auth
    if (mockAuth) {
      // Set localStorage flag to skip onboarding
      await window.evaluate(() => {
        localStorage.setItem('timeportal-onboarding-complete', 'true');
      });

      // Reload to pick up the mocked auth handlers
      await window.reload();
      await window.waitForLoadState('domcontentloaded');

      // Additional wait for network to stabilize
      await window.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        console.log('Network idle timeout, continuing...');
      });

      // Wait for the main nav to be visible with extended timeout
      // Note: nav element uses CSS variables for width, so we look for the nav with drag-handle class
      await window.waitForSelector('nav.drag-handle, nav', { timeout: 20000, state: 'visible' });

      // Extra stabilization time for React hydration
      await window.waitForTimeout(1000);
    }

    // Provide the window to the test
    await use(window);
  },
});

/**
 * Re-export expect from Playwright for convenience
 */
export { expect } from '@playwright/test';
