# Activity Recording Fix - Deep Investigation Report

## Issue Summary
Activity recording in Clearical was completely broken. The timer ran and displayed elapsed time, but:
- No app activity was being captured
- No screenshots were being taken
- Window polling appeared to stop silently
- Permissions (Accessibility, Screen Recording) were properly granted

## Root Cause Analysis

### Critical Bug #1: Incorrect API Path for Blacklist Check

**Location:** `/Users/benoittanguay/Documents/Anti/TimePortal/src/hooks/useTimer.ts:278`

**The Problem:**
```typescript
// INCORRECT - This path doesn't exist
const blacklistCheck = await window.electron.ipcRenderer.isAppBlacklisted(result.bundleId);
```

**The Fix:**
```typescript
// CORRECT - Method is namespaced under appBlacklist
const blacklistCheck = await window.electron.ipcRenderer.appBlacklist.isAppBlacklisted(result.bundleId);
```

**Why This Broke Everything:**
The `pollWindow` function is called every 1 second when recording is active. On each call:
1. It successfully gets the active window info
2. It attempts to check if the app is blacklisted
3. The incorrect API path throws an error (method not found)
4. The error propagates up because there was NO catch block
5. The finally block resets `pollingActiveRef.current = false`
6. But the interval keeps trying to call `pollWindow` every second
7. Each call immediately fails, preventing ANY activity tracking

**Evidence:**
- Preload script (`electron/preload.cts:184`) exposes the method at `appBlacklist.isAppBlacklisted`
- Type definitions (`src/types/electron.d.ts:309`) correctly define it under `appBlacklist`
- The code was calling it at the wrong path, causing immediate failure

### Critical Bug #2: Missing Error Handling in pollWindow

**Location:** `/Users/benoittanguay/Documents/Anti/TimePortal/src/hooks/useTimer.ts:255-378`

**The Problem:**
The `pollWindow` async function had a `try...finally` block but NO `catch` block:

```typescript
const pollWindow = async () => {
    pollingActiveRef.current = true;
    try {
        // All the polling logic
        // If ANY error occurs here, it's not caught
    } finally {
        pollingActiveRef.current = false;
    }
};
```

**Why This Matters:**
- Without a catch block, errors silently propagate
- The interval continues to fire but each call fails immediately
- No visibility into what's failing (no console errors without a catch)
- The polling appears to run (interval is active) but does nothing

**The Fix:**
Added comprehensive error handling:

```typescript
const pollWindow = async () => {
    pollingActiveRef.current = true;
    try {
        // Polling logic

        // Wrapped blacklist check in its own try-catch
        if (result.bundleId) {
            try {
                const blacklistCheck = await window.electron.ipcRenderer.appBlacklist.isAppBlacklisted(result.bundleId);
                if (blacklistCheck?.success && blacklistCheck.isBlacklisted) {
                    console.log(`[Renderer] App is blacklisted, skipping activity tracking`);
                    return;
                }
            } catch (error) {
                console.error('[Renderer] Failed to check blacklist, continuing with tracking:', error);
                // Continue with tracking even if blacklist check fails
            }
        }

        // Rest of polling logic
    } catch (error) {
        console.error('[Renderer] Error in pollWindow:', error);
    } finally {
        pollingActiveRef.current = false;
    }
};
```

## Activity Recording Flow (How It Should Work)

### 1. Timer Start
When `start()` is called:
- Sets `isRunning = true`, `isPaused = false`
- Sets `startTime = Date.now()`
- Clears previous activity data
- Triggers the useEffect that starts intervals

### 2. Intervals Setup
The useEffect at line 380 starts two intervals when `isRunning && !isPaused && startTime`:
```typescript
// Timer display update (100ms)
intervalRef.current = setInterval(() => {
    setElapsed(Date.now() - startTime);
}, 100);

// Window polling (1 second)
windowPollRef.current = setInterval(pollWindow, WINDOW_POLL_INTERVAL);
```

### 3. Window Polling (Every 1 Second)
Each `pollWindow` call:
1. Checks if polling is already active (prevents concurrent calls)
2. Gets active window info via `getActiveWindow` IPC
3. Checks if app is blacklisted (with proper error handling now)
4. Detects if window changed (by comparing appName/windowTitle)
5. If window changed:
   - Saves previous activity to state
   - Resets screenshot refs for new activity
   - Updates `lastWindowRef.current` with new window
   - Takes immediate screenshot
   - Starts 2-minute screenshot interval for this window
6. If same window:
   - Does nothing (preserves original timestamp)

### 4. Screenshot Capture
Screenshots are taken:
- **On window change** (immediate)
- **Every 2 minutes** (interval per window)
- Subject to minimum 5-second spacing

Screenshot flow:
1. Calls `captureScreenshot` IPC → main process
2. Main process uses `desktopCapturer` to get window sources
3. Filters out Clearical itself and small windows
4. Saves screenshot to disk
5. Returns path to renderer
6. Renderer adds path to `currentActivityScreenshots.current`
7. Starts async AI analysis (doesn't block)

### 5. AI Analysis (Async)
For each screenshot:
1. Calls `analyzeScreenshot` IPC with path
2. Main process uses AI service (OpenAI Vision or Claude)
3. Returns description and Vision Framework data
4. Renderer stores in refs and updates state
5. Data merged when activity is saved

### 6. Timer Stop
When `stop()` is called:
1. Waits for pending AI analyses to complete
2. Calls `calculateFinalActivities(now)`
3. Merges current activity from refs and state
4. Calculates durations (time until next activity or stop time)
5. Filters short activities based on settings
6. Returns final activity array

## Changes Made

### File: `/Users/benoittanguay/Documents/Anti/TimePortal/src/hooks/useTimer.ts`

1. **Fixed blacklist API path** (line 279)
   - Changed from `window.electron.ipcRenderer.isAppBlacklisted`
   - To `window.electron.ipcRenderer.appBlacklist.isAppBlacklisted`

2. **Added error handling to blacklist check** (lines 277-288)
   - Wrapped in try-catch
   - Logs error and continues tracking if check fails
   - Prevents blacklist check from breaking entire polling flow

3. **Added catch block to pollWindow** (lines 379-381)
   - Logs any errors that occur during polling
   - Prevents silent failures
   - Ensures interval continues working even if one poll fails

## Testing Instructions

1. **Kill any running instances**:
   ```bash
   pkill -f "Clearical"
   ```

2. **Start in development mode**:
   ```bash
   npm run dev
   ```

3. **Test basic recording**:
   - Click "Start" timer
   - Switch between different apps (Chrome, VS Code, Terminal, etc.)
   - Wait at least 5 seconds between switches
   - Observe console logs showing:
     - `[Renderer] pollWindow result:` (every second)
     - `[Renderer] Window change detected:` (when switching apps)
     - `[Renderer] 📸 Taking screenshot:` (on window change)
     - `[Renderer] ✅ Screenshot captured:` (path returned)
   - Click "Stop" timer
   - Verify activities are shown with app names and window titles
   - Verify screenshots are present (click to view)

4. **Test blacklist functionality**:
   - Go to Settings → Blacklist
   - Add an app to blacklist
   - Start timer
   - Switch to blacklisted app
   - Observe log: `[Renderer] App is blacklisted, skipping activity tracking`
   - Verify that app does NOT appear in activities

5. **Test screenshot capture**:
   - Start timer
   - Wait on one app for 2+ minutes
   - Verify multiple screenshots are taken (every 2 minutes)
   - Stop timer
   - Verify all screenshots are associated with the activity

## Expected Console Output (When Working)

```
[Renderer] pollWindow result: { appName: "Google Chrome", windowTitle: "GitHub - ...", bundleId: "com.google.Chrome" }
[Renderer] Window change detected: { from: {...}, to: {...} }
[Renderer] 📸 Taking screenshot: window-change for Google Chrome/GitHub - ...
[Main] capture-screenshot requested
[Main] Current Screen Access Status: granted
[Main] capture-screenshot - Active window: { appName: "Google Chrome", ... }
[Main] Window sources found: 15
[Main] Screenshot saved: /Users/.../screenshots/screenshot-1234567890.png
[Renderer] ✅ Screenshot captured: screenshot-1234567890.png
[Renderer] 📁 Screenshot added. Total: 1
[Renderer] 🔍 Starting AI analysis for: screenshot-1234567890.png
[Renderer] ✅ AI analysis completed: { file: "...", confidence: 0.95, ... }
```

## Why This Was So Hard to Diagnose

1. **Silent Failure**: Without proper error handling, the polling just stopped working with no visible errors
2. **Interval Still Running**: The timer display kept updating, making it seem like everything was working
3. **Confusing Logs**: Previous attempts to debug focused on the wrong areas (screenshot capture, permissions)
4. **Subtle API Mismatch**: The method existed, just at a different path - easy to miss in review
5. **Missing Stack Traces**: Async errors in intervals don't always produce clear stack traces

## Prevention Strategies

1. **Always use try-catch in async interval callbacks**
   - Intervals continue running even if callback throws
   - Errors need explicit handling to be visible

2. **Validate API paths match preload exposures**
   - Check `electron/preload.cts` when calling IPC methods
   - Use TypeScript definitions to catch mismatches

3. **Add comprehensive logging**
   - Log entry/exit of critical functions
   - Log errors with context (which operation failed)
   - Use distinctive prefixes for log filtering

4. **Test error paths**
   - Simulate API failures
   - Verify system degrades gracefully
   - Ensure intervals recover from errors

## Status

✅ **FIXED** - Activity recording should now work correctly with proper error handling and the correct API path.
