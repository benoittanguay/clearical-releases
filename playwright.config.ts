import { defineConfig, devices } from '@playwright/test';

// Prevent accidental test execution during builds
if (process.env.BUILD_ENV === 'production' || process.env.BUILD_ENV === 'development') {
  console.error('⚠️  Playwright tests should not run during build process');
  console.error('    BUILD_ENV is set to:', process.env.BUILD_ENV);
  console.error('    Tests are skipped to prevent interference with build.');
  process.exit(0);
}

/**
 * Playwright configuration for Electron testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Maximum time one test can run for
  timeout: 60 * 1000,

  // Expect statements timeout
  expect: {
    timeout: 20 * 1000,
  },

  // Run tests in files in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: 1,

  // Global setup and teardown timeouts
  globalTimeout: 600 * 1000, // 10 minutes for entire test run

  // Increase timeout for fixture teardown (Electron can be slow to close)
  testIdAttribute: 'data-testid',

  // Reporter to use
  reporter: process.env.CI ? 'github' : [
    ['list'],
    ['html', { outputFolder: 'test-results/html' }]
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    // Not applicable for Electron apps

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on first retry
    video: 'retain-on-failure',
  },

  // Configure projects for Electron
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // Electron-specific settings will be configured in test files
      },
    },
  ],

  // Output folder for test artifacts
  outputDir: 'test-results/artifacts',
});
