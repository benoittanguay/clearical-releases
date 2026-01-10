# Playwright Testing for TimePortal

Playwright is now configured for testing the TimePortal Electron application.

## Quick Start

### 1. Run Your First Test

```bash
npm test
```

This will:
- Build the Electron main process
- Run all tests in headless mode
- Generate a test report

### 2. See the Test Running (Headed Mode)

```bash
npm run test:headed
```

This opens the Electron app window so you can watch the tests interact with your app.

### 3. Debug a Failing Test

```bash
npm run test:debug
```

This opens the Playwright Inspector where you can:
- Step through test execution
- Pause and inspect the app state
- Try out selectors in the browser
- See detailed logs

### 4. View Test Results

```bash
npm run test:report
```

Opens an interactive HTML report showing:
- Test pass/fail status
- Screenshots of failures
- Videos of test runs
- Execution timeline

## Project Structure

```
TimePortal/
├── playwright.config.ts          # Playwright configuration
├── tests/
│   ├── e2e/
│   │   └── app.spec.ts           # Example end-to-end tests
│   ├── fixtures/
│   │   └── electron.ts           # Test fixtures (auto-setup/teardown)
│   ├── helpers/
│   │   └── electron.ts           # Utility functions for testing
│   ├── tsconfig.json             # TypeScript config for tests
│   └── README.md                 # Detailed testing guide
└── test-results/                 # Generated test artifacts
```

## Writing Your First Test

Edit `/Users/benoittanguay/Documents/Anti/TimePortal/tests/e2e/app.spec.ts` or create a new file:

```typescript
import { test, expect } from '../fixtures/electron';

test('my feature works', async ({ window }) => {
  // Click a button
  await window.click('button.start-timer');

  // Wait for element to appear
  await window.waitForSelector('.timer-display');

  // Check text content
  const text = await window.textContent('.timer-display');
  expect(text).toContain('00:00');
});
```

## Common Test Patterns

### Testing UI Elements

```typescript
test('timer displays correctly', async ({ window }) => {
  const timerElement = window.locator('.timer-display');
  await expect(timerElement).toBeVisible();
  await expect(timerElement).toHaveText(/\d{2}:\d{2}:\d{2}/);
});
```

### Testing User Interactions

```typescript
test('can start and stop timer', async ({ window }) => {
  // Start timer
  await window.click('button.start-timer');
  await window.waitForTimeout(1000);

  // Stop timer
  await window.click('button.stop-timer');

  // Verify state
  const status = await window.textContent('.status');
  expect(status).toBe('Stopped');
});
```

### Testing IPC Communication

```typescript
import { invokeIPC } from '../helpers/electron';

test('can fetch app data via IPC', async ({ window }) => {
  const data = await invokeIPC(window, 'get-app-data');
  expect(data).toBeDefined();
  expect(data).toHaveProperty('version');
});
```

### Testing Main Process

```typescript
import { getAppVersion } from '../helpers/electron';

test('has correct version', async ({ electronApp }) => {
  const version = await getAppVersion(electronApp);
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});
```

## Available Test Helpers

The `/Users/benoittanguay/Documents/Anti/TimePortal/tests/helpers/electron.ts` file provides:

### App Lifecycle
- `launchElectronApp(options)` - Launch app with custom options
- `closeElectronApp(app)` - Close app gracefully
- `waitForAppReady(window)` - Wait for app to fully load
- `reloadApp(window)` - Reload the app

### Window Management
- `getWindowInfo(app)` - Get info about all windows
- `waitForWindow(app, title)` - Wait for specific window
- `takeScreenshot(window, path)` - Save screenshot

### IPC Testing
- `invokeIPC(window, channel, ...args)` - Call main process
- `waitForIPCEvent(window, channel)` - Wait for event
- `mockIPCHandler(app, channel, handler)` - Mock handlers

### Debugging
- `captureConsoleLogs(window)` - Capture console output
- `waitForConsoleMessage(window, matcher)` - Wait for log
- `getAppMode(app)` - Check dev/production
- `getAppVersion(app)` - Get app version

## Tips

### 1. Build Before Testing
Always build the Electron main process before testing:
```bash
npm run build:electron-main
npm test
```
Or use the test scripts which do this automatically.

### 2. Use Headed Mode for Development
When developing tests, use headed mode to see what's happening:
```bash
npm run test:headed
```

### 3. Use Debug Mode When Tests Fail
```bash
npm run test:debug
```

### 4. Use Specific Test Files
Run only specific tests:
```bash
npx playwright test tests/e2e/app.spec.ts
```

### 5. Filter Tests by Name
```bash
npx playwright test --grep "should launch"
```

### 6. Update Snapshots
If you use visual regression testing:
```bash
npx playwright test --update-snapshots
```

## CI/CD Integration

Tests are configured to run in CI with:
- Automatic retries on failure
- GitHub Actions reporter
- Screenshot/video capture on failure

Example GitHub Actions workflow:

```yaml
- name: Install dependencies
  run: npm ci

- name: Build Electron
  run: npm run build:electron-main

- name: Run tests
  run: npm test

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: test-results/
```

## Build vs Test Separation

**Important:** Tests are automatically prevented from running during production builds.

The build scripts (`build:electron`, `release:beta`, etc.) set the `BUILD_ENV` environment variable, which prevents Playwright from executing. This safeguard ensures:
- `npm run build:electron` - Will NOT run tests
- `npm run release:beta` - Will NOT run tests
- `npm run release:stable` - Will NOT run tests
- `npm test` - Will run tests normally

If you see the message "Playwright tests should not run during build process", it means tests were accidentally triggered during a build and have been automatically skipped.

To run tests, always use the explicit test commands:
```bash
npm test                # Run tests
npm run test:headed     # Run with UI
npm run test:debug      # Debug tests
```

## Troubleshooting

### "Cannot find module" errors
Ensure you've built the Electron main process:
```bash
npm run build:electron-main
```

### Tests timeout
Increase timeout in `/Users/benoittanguay/Documents/Anti/TimePortal/playwright.config.ts`:
```typescript
timeout: 60 * 1000, // 60 seconds
```

### App won't launch
1. Check `dist-electron/main.js` exists
2. Verify no other Electron instances running
3. Check for port conflicts

### Tests running during build
If you see tests starting during a build process:
1. The safeguard should automatically prevent execution
2. Check that `BUILD_ENV` is set in the build script
3. Verify `playwright.config.ts` has the build check at the top

### See headed mode for more details
```bash
npm run test:headed
```

## Next Steps

1. Customize the example tests in `tests/e2e/app.spec.ts`
2. Add more test files for different features
3. Set up CI/CD pipeline with tests
4. Add visual regression testing if needed
5. Configure code coverage reporting

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Detailed Testing Guide](./tests/README.md)

## Support

For issues or questions:
1. Check the [detailed testing guide](./tests/README.md)
2. Review [Playwright docs](https://playwright.dev/)
3. Check existing tests for examples
