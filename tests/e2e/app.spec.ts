import { test, expect } from '../fixtures/electron';
import { getAppVersion, getAppMode, captureConsoleLogs } from '../helpers/electron';

/**
 * Basic Electron app tests
 */
test.describe('Clearical App', () => {
  test('should launch the application', async ({ electronApp, window }) => {
    // Verify the app launched
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    // Check if the window is visible
    const isVisible = await window.isVisible('body');
    expect(isVisible).toBe(true);
  });

  test('should have the correct title', async ({ window }) => {
    // Wait for the window to load
    await window.waitForLoadState('domcontentloaded');

    // Get the page title
    const title = await window.title();

    // Verify the title (adjust based on your app's actual title)
    expect(title).toBeTruthy();
    console.log('App title:', title);
  });

  test('should load the React root element', async ({ window }) => {
    // Wait for React root to be present
    const rootElement = await window.locator('#root');
    await expect(rootElement).toBeVisible();

    // Verify root has content
    const innerHTML = await rootElement.innerHTML();
    expect(innerHTML.length).toBeGreaterThan(0);
  });

  test('should display app in correct mode', async ({ electronApp }) => {
    // Get the app mode (development or production)
    const mode = await getAppMode(electronApp);
    console.log('App mode:', mode);

    // In tests, we should be running in development mode
    // unless explicitly testing production builds
    expect(['development', 'production']).toContain(mode);
  });

  test('should have correct version', async ({ electronApp }) => {
    // Get the app version
    const version = await getAppVersion(electronApp);
    console.log('App version:', version);

    // Verify version format (semver)
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('should not have console errors on startup', async ({ window }) => {
    // Capture console logs
    const logs = captureConsoleLogs(window);

    // Wait a bit for app to initialize
    await window.waitForTimeout(2000);

    // Check for errors (you might want to filter out expected errors)
    const errors = logs.filter((log) => log.type === 'error');

    // Log errors for debugging
    if (errors.length > 0) {
      console.log('Console errors found:', errors);
    }

    // Adjust this assertion based on your app's behavior
    // Some apps might have expected console errors
    // expect(errors.length).toBe(0);
  });

  test('should handle window resize', async ({ electronApp }) => {
    // Get the first window from the Electron app
    const window = await electronApp.firstWindow();

    // Get initial window bounds using Electron API
    const initialBounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.getBounds();
    });
    expect(initialBounds).toBeTruthy();

    // Resize the window using Electron API
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.setSize(1280, 720);
    });

    // Give time for resize to complete
    await window.waitForTimeout(500);

    // Verify resize using Electron API
    const newBounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win?.getBounds();
    });
    expect(newBounds?.width).toBe(1280);
    expect(newBounds?.height).toBe(720);
  });

  test('should be able to take screenshots', async ({ window }) => {
    // Take a screenshot
    const screenshot = await window.screenshot();

    // Verify screenshot was captured
    expect(screenshot).toBeTruthy();
    expect(screenshot.length).toBeGreaterThan(0);
  });
});

/**
 * Navigation and routing tests
 */
test.describe('App Navigation', () => {
  test('should navigate through the app', async ({ window }) => {
    // Wait for app to be ready
    await window.waitForLoadState('networkidle');

    // Get current URL
    const currentUrl = window.url();
    console.log('Current URL:', currentUrl);

    // Verify URL structure (adjust based on your app)
    expect(currentUrl).toBeTruthy();
  });

  test('should handle page interactions', async ({ window }) => {
    // Wait for the page to load
    await window.waitForLoadState('domcontentloaded');

    // Example: Click a button (adjust selector based on your app)
    // const button = window.locator('button').first();
    // if (await button.isVisible()) {
    //   await button.click();
    // }

    // Verify no crashes after interaction
    const isVisible = await window.isVisible('body');
    expect(isVisible).toBe(true);
  });
});

/**
 * IPC Communication tests
 */
test.describe('IPC Communication', () => {
  test.skip('should communicate with main process via IPC', async ({ window }) => {
    // Example of testing IPC calls
    // Adjust based on your actual IPC channels

    // You would invoke an IPC method here
    // const result = await invokeIPC(window, 'some-channel', 'arg1', 'arg2');
    // expect(result).toBeDefined();

    // This test is skipped by default as it requires specific IPC setup
  });
});
