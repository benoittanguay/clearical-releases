# TimePortal Testing Guide

This directory contains end-to-end and unit tests for the TimePortal Electron application using Playwright.

## Directory Structure

```
tests/
├── e2e/              # End-to-end tests
├── unit/             # Unit tests
├── fixtures/         # Playwright test fixtures
│   └── electron.ts   # Electron-specific fixtures
├── helpers/          # Test utility functions
│   └── electron.ts   # Electron helper functions
└── README.md         # This file
```

## Getting Started

### Prerequisites

- Node.js and npm installed
- Project dependencies installed (`npm install`)
- Electron app built (`npm run build:electron-main`)

### Running Tests

```bash
# Run all tests
npm test

# Run tests in headed mode (see the app window)
npm run test:headed

# Run tests in debug mode with Playwright Inspector
npm run test:debug

# Run specific test file
npx playwright test tests/e2e/app.spec.ts

# Run tests matching a pattern
npx playwright test --grep "should launch"
```

### Viewing Test Results

After running tests, you can view the HTML report:

```bash
npm run test:report
```

This will open an interactive HTML report showing test results, screenshots, and videos.

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '../fixtures/electron';

test.describe('Feature Name', () => {
  test('should do something', async ({ electronApp, window }) => {
    // Your test code here
    const title = await window.title();
    expect(title).toBeTruthy();
  });
});
```

### Available Fixtures

- `electronApp`: The Electron application instance
- `window`: The main window Page instance
- `launchOptions`: Customize app launch behavior

### Helper Functions

The `helpers/electron.ts` file provides many utility functions:

#### App Lifecycle
- `launchElectronApp(options)` - Launch the app with custom options
- `closeElectronApp(app)` - Gracefully close the app
- `waitForAppReady(window, timeout)` - Wait for app to be fully loaded
- `reloadApp(window)` - Reload the app window

#### Window Management
- `getWindowInfo(app)` - Get info about all windows
- `waitForWindow(app, title, timeout)` - Wait for specific window
- `takeScreenshot(window, path)` - Capture screenshot

#### IPC Testing
- `invokeIPC(window, channel, ...args)` - Call IPC from renderer
- `waitForIPCEvent(window, channel, timeout)` - Wait for IPC event
- `mockIPCHandler(app, channel, handler)` - Mock IPC handlers

#### Debugging
- `captureConsoleLogs(window)` - Capture console output
- `waitForConsoleMessage(window, matcher, timeout)` - Wait for specific log
- `getAppMode(app)` - Check dev/production mode
- `getAppVersion(app)` - Get app version

### Example: Testing with Custom Launch Options

```typescript
test.use({
  launchOptions: {
    env: { TEST_MODE: 'true' },
    timeout: 60000,
    recordVideo: true,
  },
});

test('custom test', async ({ window }) => {
  // Test with custom environment
});
```

### Example: Testing IPC Communication

```typescript
import { invokeIPC } from '../helpers/electron';

test('should communicate via IPC', async ({ window }) => {
  const result = await invokeIPC(window, 'get-app-data');
  expect(result).toBeDefined();
});
```

### Example: Waiting for Specific Elements

```typescript
test('should display timer', async ({ window }) => {
  // Wait for element to be visible
  await window.waitForSelector('.timer-display', { state: 'visible' });

  // Get element text
  const timerText = await window.locator('.timer-display').textContent();
  expect(timerText).toMatch(/\d{2}:\d{2}:\d{2}/);
});
```

## Best Practices

### 1. Build Before Testing

Always build the Electron main process before running tests:

```bash
npm run build:electron-main
npm test
```

### 2. Use Descriptive Test Names

```typescript
// Good
test('should display error message when timer limit exceeded', ...)

// Bad
test('timer test', ...)
```

### 3. Clean Up Resources

The fixtures automatically handle app cleanup, but if you manually launch apps:

```typescript
test('manual test', async ({}) => {
  const { app, window } = await launchElectronApp();
  try {
    // Test code
  } finally {
    await closeElectronApp(app);
  }
});
```

### 4. Use Proper Timeouts

```typescript
// Wait with timeout
await window.waitForSelector('.element', { timeout: 10000 });

// Or configure timeout per test
test.setTimeout(60000);
test('long running test', async ({ window }) => {
  // ...
});
```

### 5. Debug Failing Tests

```bash
# Run with Playwright Inspector
npm run test:debug

# Run headed to see what's happening
npm run test:headed

# Capture screenshots on failure (automatic)
# Check test-results/ directory
```

### 6. Test in Isolation

Each test should be independent and not rely on state from other tests:

```typescript
// Bad - relies on previous test
test('create item', async ({ window }) => { ... });
test('delete item', async ({ window }) => { ... }); // Assumes item exists

// Good - each test sets up its own state
test('should create and delete item', async ({ window }) => {
  // Create item
  // Delete item
  // Verify
});
```

## Continuous Integration

### GitHub Actions Example

```yaml
- name: Build Electron
  run: npm run build:electron-main

- name: Run tests
  run: npm test

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: test-results/
```

## Troubleshooting

### App Won't Launch

1. Ensure Electron main is built: `npm run build:electron-main`
2. Check that `dist-electron/main.js` exists
3. Verify no port conflicts (if using dev server)

### Tests Timeout

1. Increase timeout in `playwright.config.ts`
2. Check if app is stuck loading resources
3. Use `test:headed` to see what's happening

### IPC Calls Fail

1. Verify IPC channel names match between main and renderer
2. Check that preload script is loading correctly
3. Use console logs to debug IPC flow

### Screenshots Not Saving

1. Check `test-results/` directory permissions
2. Verify `screenshot` option in config
3. Tests must fail for automatic screenshots (or use `screenshot: 'on'`)

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
