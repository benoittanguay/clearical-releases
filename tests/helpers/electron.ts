import { _electron as electron, ElectronApplication, Page } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Mock user for authenticated tests
 */
export const MOCK_USER = {
  id: 'test-user-123',
  email: 'test@example.com',
  createdAt: new Date().toISOString(),
};

/**
 * Configuration options for launching the Electron app
 */
export interface ElectronLaunchOptions {
  /**
   * Additional arguments to pass to Electron
   */
  args?: string[];

  /**
   * Environment variables to set
   */
  env?: Record<string, string>;

  /**
   * Whether to run in headless mode (default: false for better debugging)
   */
  headless?: boolean;

  /**
   * Timeout for app launch in milliseconds
   */
  timeout?: number;

  /**
   * Whether to record video
   */
  recordVideo?: boolean;

  /**
   * Path to save videos
   */
  videoPath?: string;
}

/**
 * Result of launching the Electron app
 */
export interface ElectronAppContext {
  app: ElectronApplication;
  window: Page;
}

/**
 * Launches the Electron application for testing
 *
 * @param options - Launch configuration options
 * @returns Promise resolving to app and window instances
 */
export async function launchElectronApp(
  options: ElectronLaunchOptions = {}
): Promise<ElectronAppContext> {
  const {
    args = [],
    env = {},
    headless = false,
    timeout = 30000,
    recordVideo = false,
    videoPath = 'test-results/videos',
  } = options;

  // Get the project root directory
  const projectRoot = path.resolve(process.cwd());

  // Path to the main Electron file
  const electronPath = path.join(projectRoot, 'dist-electron', 'main.js');

  // Merge environment variables
  const testEnv = {
    ...process.env,
    NODE_ENV: 'test',
    ...env,
  };

  // Launch configuration
  const launchConfig: any = {
    args: [electronPath, ...args],
    env: testEnv,
    timeout,
  };

  // Add video recording if enabled
  if (recordVideo) {
    launchConfig.recordVideo = {
      dir: videoPath,
    };
  }

  // Launch Electron app
  const app = await electron.launch(launchConfig);

  // Wait for the first window to open
  const window = await app.firstWindow({ timeout });

  // Wait for the app to be ready
  await waitForAppReady(window, timeout);

  return { app, window };
}

/**
 * Waits for the Electron app to be fully ready
 *
 * @param window - The Playwright Page instance
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForAppReady(
  window: Page,
  timeout: number = 30000
): Promise<void> {
  // Wait for the DOM to be loaded
  await window.waitForLoadState('domcontentloaded', { timeout });

  // Wait for network to be idle (all resources loaded)
  await window.waitForLoadState('networkidle', { timeout: timeout / 2 }).catch(() => {
    // Ignore timeout - some apps keep connections open
    console.log('Network did not become idle, continuing anyway...');
  });

  // Wait for React to be ready by checking for root element
  await window.waitForSelector('#root', { timeout, state: 'attached' });

  // Give the app a moment to initialize and hydrate React
  await window.waitForTimeout(2000);
}

/**
 * Closes the Electron app gracefully
 *
 * @param app - The Electron application instance
 */
export async function closeElectronApp(app: ElectronApplication): Promise<void> {
  // First, force kill the process immediately - don't wait for graceful close
  try {
    const process = app.process();
    if (process) {
      process.kill('SIGKILL');
    }
  } catch {
    // Process may already be closed
  }

  // Small delay then try standard close
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    await Promise.race([
      app.close(),
      new Promise(resolve => setTimeout(resolve, 2000)) // 2s max
    ]);
  } catch {
    // Ignore errors
  }
}

/**
 * Evaluates code in the Electron main process
 *
 * @param app - The Electron application instance
 * @param fn - Function to evaluate in main process
 * @returns Promise resolving to the result
 */
export async function evaluateInMainProcess<T>(
  app: ElectronApplication,
  fn: () => T | Promise<T>
): Promise<T> {
  return app.evaluate(fn);
}

/**
 * Gets information about all windows in the app
 *
 * @param app - The Electron application instance
 */
export async function getWindowInfo(app: ElectronApplication) {
  const windows = app.windows();
  return Promise.all(
    windows.map(async (window) => ({
      title: await window.title(),
      url: window.url(),
    }))
  );
}

/**
 * Waits for a specific window by title
 *
 * @param app - The Electron application instance
 * @param title - Window title to wait for
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForWindow(
  app: ElectronApplication,
  title: string,
  timeout: number = 10000
): Promise<Page> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const windows = app.windows();
    for (const window of windows) {
      const windowTitle = await window.title();
      if (windowTitle.includes(title)) {
        return window;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Window with title "${title}" not found within ${timeout}ms`);
}

/**
 * Mock IPC handler for testing
 *
 * @param app - The Electron application instance
 * @param channel - IPC channel name
 * @param handler - Mock handler function
 */
export async function mockIPCHandler(
  app: ElectronApplication,
  channel: string,
  handler: (...args: any[]) => any
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, handlerString }) => {
      // Remove existing handlers
      ipcMain.removeHandler(channel);

      // Add mock handler
      const mockHandler = eval(`(${handlerString})`);
      ipcMain.handle(channel, mockHandler);
    },
    {
      channel,
      handlerString: handler.toString(),
    }
  );

  // Small delay to ensure handler is registered
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Simulates an IPC call from renderer to main process
 *
 * @param window - The Playwright Page instance
 * @param channel - IPC channel name
 * @param args - Arguments to pass
 */
export async function invokeIPC<T>(
  window: Page,
  channel: string,
  ...args: any[]
): Promise<T> {
  return window.evaluate(
    ({ channel, args }) => {
      return (window as any).electronAPI.invoke(channel, ...args);
    },
    { channel, args }
  );
}

/**
 * Waits for a specific IPC event
 *
 * @param window - The Playwright Page instance
 * @param channel - IPC channel name
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForIPCEvent(
  window: Page,
  channel: string,
  timeout: number = 5000
): Promise<any> {
  return window.evaluate(
    ({ channel, timeout }) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`IPC event "${channel}" not received within ${timeout}ms`));
        }, timeout);

        const handler = (_event: any, ...args: any[]) => {
          clearTimeout(timeoutId);
          resolve(args.length === 1 ? args[0] : args);
        };

        // Assuming electronAPI exposes an 'on' method for listening to events
        if ((window as any).electronAPI?.on) {
          (window as any).electronAPI.on(channel, handler);
        } else {
          reject(new Error('electronAPI.on not available'));
        }
      });
    },
    { channel, timeout }
  );
}

/**
 * Takes a screenshot of the app window
 *
 * @param window - The Playwright Page instance
 * @param path - Path to save screenshot
 */
export async function takeScreenshot(
  window: Page,
  path: string
): Promise<void> {
  await window.screenshot({ path, fullPage: true });
}

/**
 * Reloads the Electron app window
 *
 * @param window - The Playwright Page instance
 */
export async function reloadApp(window: Page): Promise<void> {
  await window.reload();
  await waitForAppReady(window);
}

/**
 * Gets console messages from the app
 *
 * @param window - The Playwright Page instance
 * @returns Array of console messages
 */
export function captureConsoleLogs(window: Page): Array<{ type: string; text: string }> {
  const logs: Array<{ type: string; text: string }> = [];

  window.on('console', (msg) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
    });
  });

  return logs;
}

/**
 * Waits for a specific console message
 *
 * @param window - The Playwright Page instance
 * @param matcher - String or RegExp to match against console message
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForConsoleMessage(
  window: Page,
  matcher: string | RegExp,
  timeout: number = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Console message matching ${matcher} not found within ${timeout}ms`));
    }, timeout);

    const handler = (msg: any) => {
      const text = msg.text();
      const matches =
        typeof matcher === 'string' ? text.includes(matcher) : matcher.test(text);

      if (matches) {
        clearTimeout(timeoutId);
        window.off('console', handler);
        resolve(text);
      }
    };

    window.on('console', handler);
  });
}

/**
 * Checks if the app is running in development or production mode
 *
 * @param app - The Electron application instance
 */
export async function getAppMode(app: ElectronApplication): Promise<'development' | 'production'> {
  return app.evaluate(({ app }) => {
    return app.isPackaged ? 'production' : 'development';
  });
}

/**
 * Gets the app version
 *
 * @param app - The Electron application instance
 */
export async function getAppVersion(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ app }) => {
    return app.getVersion();
  });
}

/**
 * Mock authentication by setting up IPC handler responses
 * This bypasses the login screen for testing the main app functionality
 *
 * @param app - The Electron application instance
 */
export async function mockAuthentication(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const mockUser = {
      id: 'test-user-123',
      email: 'test@example.com',
      createdAt: new Date().toISOString(),
    };

    // Remove existing handlers if any
    ipcMain.removeHandler('auth:is-authenticated');
    ipcMain.removeHandler('auth:get-user');
    ipcMain.removeHandler('auth:send-otp');
    ipcMain.removeHandler('auth:verify-otp');
    ipcMain.removeHandler('auth:sign-out');

    // Mock auth handlers
    ipcMain.handle('auth:is-authenticated', () => true);
    ipcMain.handle('auth:get-user', () => ({ success: true, user: mockUser }));
    ipcMain.handle('auth:send-otp', () => ({ success: true }));
    ipcMain.handle('auth:verify-otp', () => ({ success: true, user: mockUser }));
    ipcMain.handle('auth:sign-out', () => {});
  });
}

/**
 * Bypass authentication in the renderer by triggering auth check
 * Call this after mockAuthentication to reload auth state
 *
 * @param window - The Playwright Page instance
 */
export async function bypassAuthentication(window: Page): Promise<void> {
  // Force the app to re-check auth status which will now return authenticated
  await window.evaluate(() => {
    // Dispatch a custom event that the app can listen for to recheck auth
    window.dispatchEvent(new CustomEvent('recheck-auth'));
  });

  // Wait for the app to process the auth state change
  await window.waitForTimeout(1000);
}

/**
 * Wait for the main app content to be visible (after authentication)
 *
 * @param window - The Playwright Page instance
 * @param timeout - Maximum time to wait in milliseconds
 */
export async function waitForMainApp(window: Page, timeout: number = 30000): Promise<void> {
  try {
    // Wait for either the main nav or the login screen
    await Promise.race([
      window.waitForSelector('nav.w-20', { timeout }),
      window.waitForSelector('[data-testid="login-screen"]', { timeout }),
      window.waitForSelector('text=TP', { timeout }),
    ]);
  } catch {
    // If neither is found, just continue
    console.log('Neither main app nor login screen found within timeout');
  }
}
