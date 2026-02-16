# TimeWarp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable retroactive time capture by continuously tracking user activity in the background and providing a draggable timeline to set the timer's start time to any point in the past.

**Architecture:** A `BackgroundActivityTracker` singleton runs in the Electron main process from app-ready, polling active windows and capturing screenshots into an in-memory ring buffer with 12-hour TTL. The renderer subscribes via IPC and renders a `TimeWarpTimeline` component at the bottom of the chrono screen. When the user drags the playhead back, claimed activities are converted to `WindowActivity[]` and merged into `useTimer`.

**Tech Stack:** Electron IPC (invoke/send/on), React context, TypeScript, inline styles (project convention — no CSS modules)

**Design doc:** `docs/plans/2026-02-15-timewarp-design.md`

---

### Task 1: Add BackgroundActivity type to shared types

**Files:**
- Modify: `src/types/shared.ts` (after WindowActivity interface, ~line 83)

**Step 1: Add the BackgroundActivity interface**

Add after the `WindowActivity` interface (line 83):

```typescript
export interface BackgroundActivity {
    id: string;
    appName: string;
    windowTitle: string;
    bundleId: string;
    browserProfile?: string;
    startTimestamp: number;
    endTimestamp: number;
    isMeeting: boolean;
    screenshotPaths: string[];
}
```

**Step 2: Build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types/shared.ts
git commit -m "feat(timewarp): add BackgroundActivity type definition"
```

---

### Task 2: Create BackgroundActivityTracker service (main process)

**Files:**
- Create: `electron/backgroundActivityTracker.ts`

**Step 1: Implement the BackgroundActivityTracker class**

This is the core main-process service. It must:

1. Import and reuse the existing AppleScript-based `get-active-window` logic from `main.ts` (lines 1107-1217). Rather than importing the IPC handler, call the same AppleScript directly via `child_process.exec`.
2. Import `BlacklistService` from `./blacklistService.js` for filtering.
3. Import `mediaMonitor` from `./native/index.js` for screenshot capture and meeting detection (`isMicrophoneInUse()`).
4. Import `saveEncryptedFile` and `getEncryptionKey` patterns from main.ts (lines 372-427) for screenshot storage.

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { BlacklistService } from './blacklistService.js';
import { mediaMonitor } from './native/index.js';
import { saveEncryptedFile } from './encryption.js';  // Check actual import path
import type { BackgroundActivity } from '../src/types/shared.js';

const execAsync = promisify(exec);

const POLL_INTERVAL = 1000; // 1 second
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const TTL = 12 * 60 * 60 * 1000; // 12 hours
const BACKGROUND_CAPTURES_DIR = path.join(app.getPath('userData'), 'background-captures');

export class BackgroundActivityTracker {
    private static instance: BackgroundActivityTracker | null = null;
    private activities: BackgroundActivity[] = [];
    private pollTimer: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;
    private paused = false;
    private currentActivity: BackgroundActivity | null = null;
    private lastWindow: { appName: string; windowTitle: string; bundleId: string; pid: number } | null = null;
    private updateCallback: ((activities: BackgroundActivity[]) => void) | null = null;
    private activityIdCounter = 0;

    private constructor() {}

    static getInstance(): BackgroundActivityTracker {
        if (!BackgroundActivityTracker.instance) {
            BackgroundActivityTracker.instance = new BackgroundActivityTracker();
        }
        return BackgroundActivityTracker.instance;
    }

    async start(): Promise<void> {
        // Ensure background captures directory exists
        await fs.promises.mkdir(BACKGROUND_CAPTURES_DIR, { recursive: true });

        this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
        console.log('[BackgroundActivityTracker] Started');
    }

    stop(): void {
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.pollTimer = null;
        this.cleanupTimer = null;
        // Finalize current activity
        this.finalizeCurrentActivity();
        console.log('[BackgroundActivityTracker] Stopped');
    }

    pause(): void {
        this.paused = true;
        this.finalizeCurrentActivity();
        console.log('[BackgroundActivityTracker] Paused');
    }

    resume(): void {
        this.paused = false;
        this.lastWindow = null;
        console.log('[BackgroundActivityTracker] Resumed');
    }

    getActivities(): BackgroundActivity[] {
        return [...this.activities];
    }

    setUpdateCallback(cb: (activities: BackgroundActivity[]) => void): void {
        this.updateCallback = cb;
    }

    /**
     * Claim activities in a time range. Removes them from the buffer,
     * moves screenshots to main screenshots dir, returns claimed activities.
     */
    async claimActivities(fromTimestamp: number, toTimestamp: number): Promise<BackgroundActivity[]> {
        const claimed: BackgroundActivity[] = [];
        const remaining: BackgroundActivity[] = [];

        for (const activity of this.activities) {
            // Include if activity overlaps with the claim range
            if (activity.endTimestamp >= fromTimestamp && activity.startTimestamp <= toTimestamp) {
                claimed.push(activity);
            } else {
                remaining.push(activity);
            }
        }

        this.activities = remaining;

        // Move screenshots from background-captures to main screenshots dir
        const mainScreenshotsDir = path.join(app.getPath('userData'), 'screenshots');
        await fs.promises.mkdir(mainScreenshotsDir, { recursive: true });

        for (const activity of claimed) {
            const movedPaths: string[] = [];
            for (const screenshotPath of activity.screenshotPaths) {
                try {
                    const filename = path.basename(screenshotPath);
                    const newPath = path.join(mainScreenshotsDir, filename);
                    await fs.promises.rename(screenshotPath, newPath);
                    movedPaths.push(newPath);
                } catch (err) {
                    console.error('[BackgroundActivityTracker] Failed to move screenshot:', err);
                    // Keep original path if move fails
                    movedPaths.push(screenshotPath);
                }
            }
            activity.screenshotPaths = movedPaths;
        }

        this.notifyUpdate();
        return claimed;
    }

    private async poll(): Promise<void> {
        if (this.paused) return;

        try {
            const windowInfo = await this.getActiveWindow();
            if (!windowInfo || !windowInfo.appName) return;

            // Check blacklist
            const blacklistService = BlacklistService.getInstance();
            if (windowInfo.bundleId && blacklistService.isAppBlacklisted(windowInfo.bundleId)) {
                return;
            }

            // Skip self-capture
            const appNameLower = windowInfo.appName.toLowerCase();
            if (appNameLower === 'clearical' || appNameLower === 'time-portal' || appNameLower === 'timeportal' || windowInfo.bundleId === 'io.clearical.app') {
                return;
            }

            const now = Date.now();
            const isSignificantChange = this.isSignificantWindowChange(windowInfo);

            if (isSignificantChange) {
                // Finalize previous activity
                this.finalizeCurrentActivity();

                // Detect if this is a meeting
                const isMeeting = this.detectMeeting(windowInfo);

                // Start new activity
                this.currentActivity = {
                    id: `bg-${++this.activityIdCounter}`,
                    appName: windowInfo.appName,
                    windowTitle: windowInfo.windowTitle,
                    bundleId: windowInfo.bundleId || '',
                    browserProfile: this.extractBrowserProfile(windowInfo),
                    startTimestamp: now,
                    endTimestamp: now,
                    isMeeting,
                    screenshotPaths: [],
                };

                // Capture screenshot for the new activity
                await this.captureScreenshot(windowInfo);
            } else if (this.currentActivity) {
                // Update end timestamp of current activity
                this.currentActivity.endTimestamp = now;
            }
        } catch (err) {
            console.error('[BackgroundActivityTracker] Poll error:', err);
        }
    }

    private finalizeCurrentActivity(): void {
        if (this.currentActivity) {
            this.currentActivity.endTimestamp = Date.now();
            // Only add if duration > 2 seconds (avoid noise)
            if (this.currentActivity.endTimestamp - this.currentActivity.startTimestamp > 2000) {
                this.activities.push(this.currentActivity);
                this.notifyUpdate();
            }
            this.currentActivity = null;
        }
    }

    private isSignificantWindowChange(newWindow: { appName: string; windowTitle: string; bundleId?: string }): boolean {
        if (!this.lastWindow) {
            this.lastWindow = { ...newWindow, pid: 0 } as any;
            return true;
        }

        if (this.lastWindow.appName !== newWindow.appName) {
            this.lastWindow = { ...newWindow, pid: 0 } as any;
            return true;
        }

        if (this.lastWindow.windowTitle === newWindow.windowTitle) {
            return false;
        }

        // For browsers, use domain-level comparison (reuse logic from useTimer)
        // Simplified: different title in same non-browser app = significant
        this.lastWindow = { ...newWindow, pid: 0 } as any;
        return true;
    }

    private detectMeeting(windowInfo: { appName: string; bundleId?: string }): boolean {
        const meetingBundleIds = [
            'us.zoom.xos', 'com.microsoft.teams', 'com.microsoft.teams2',
            'com.google.Chrome', // Google Meet runs in Chrome
        ];
        const meetingAppNames = ['zoom', 'teams', 'meet', 'webex', 'slack huddle'];
        const isMeetingApp = meetingBundleIds.includes(windowInfo.bundleId || '') ||
            meetingAppNames.some(name => windowInfo.appName.toLowerCase().includes(name));

        // Must also have microphone active
        return isMeetingApp && mediaMonitor.isMicrophoneInUse();
    }

    private extractBrowserProfile(windowInfo: { windowTitle: string; bundleId?: string }): string | undefined {
        // Simplified browser profile extraction
        // Chrome window titles: "Page Title - Profile Name - Google Chrome"
        const browserBundleIds = ['com.google.Chrome', 'com.apple.Safari', 'org.mozilla.firefox', 'com.microsoft.edgemac'];
        if (!browserBundleIds.includes(windowInfo.bundleId || '')) return undefined;

        const parts = windowInfo.windowTitle.split(' - ');
        if (parts.length >= 3 && windowInfo.bundleId === 'com.google.Chrome') {
            return parts[parts.length - 2].trim(); // Profile is second-to-last segment
        }
        return undefined;
    }

    private async captureScreenshot(windowInfo: { appName: string; windowTitle: string; bundleId?: string; pid?: number }): Promise<void> {
        if (!windowInfo.pid) return;

        try {
            const image = mediaMonitor.captureWindowScreenshot(windowInfo.pid, windowInfo.windowTitle);
            if (!image) return;

            const timestamp = Date.now();
            const appNameSafe = windowInfo.appName.replace(/[\/\\:*?"<>|]/g, '_');
            const windowTitleSafe = windowInfo.windowTitle.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
            const filename = `${timestamp}|||${appNameSafe}|||${windowTitleSafe}.png`;
            const filePath = path.join(BACKGROUND_CAPTURES_DIR, filename);

            try {
                await saveEncryptedFile(filePath, image);
            } catch {
                await fs.promises.writeFile(filePath, image);
            }

            if (this.currentActivity) {
                this.currentActivity.screenshotPaths.push(filePath);
            }
        } catch (err) {
            console.error('[BackgroundActivityTracker] Screenshot capture error:', err);
        }
    }

    private async getActiveWindow(): Promise<{ appName: string; windowTitle: string; bundleId: string; pid: number } | null> {
        if (process.platform !== 'darwin') return null;

        try {
            const result = await execAsync(`osascript -e '
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set appName to name of frontApp
                    set bundleId to bundle identifier of frontApp
                    set appPID to unix id of frontApp
                    set windowTitle to ""
                    try
                        set windowCount to count of windows of frontApp
                        if windowCount > 0 then
                            set windowTitle to title of front window of frontApp
                            if windowTitle is missing value then set windowTitle to ""
                        end if
                    end try
                    return appName & "|||" & bundleId & "|||" & appPID & "|||" & windowTitle
                end tell'`);

            const [appName, bundleId, pidStr, ...windowTitleParts] = result.stdout.trim().split('|||');
            return {
                appName: appName || 'Unknown',
                windowTitle: windowTitleParts.join('|||') || '',
                bundleId: bundleId || '',
                pid: parseInt(pidStr, 10) || 0,
            };
        } catch {
            return null;
        }
    }

    private cleanup(): void {
        const cutoff = Date.now() - TTL;
        const before = this.activities.length;

        // Collect screenshot paths to delete
        const toDelete: string[] = [];
        this.activities = this.activities.filter(activity => {
            if (activity.startTimestamp < cutoff) {
                toDelete.push(...activity.screenshotPaths);
                return false;
            }
            return true;
        });

        // Delete orphan screenshots
        for (const filePath of toDelete) {
            fs.promises.unlink(filePath).catch(() => {});
        }

        if (before !== this.activities.length) {
            console.log(`[BackgroundActivityTracker] Cleanup: removed ${before - this.activities.length} old activities, ${toDelete.length} screenshots`);
            this.notifyUpdate();
        }
    }

    /** Delete all unclaimed background screenshots (call on app quit) */
    async cleanupAll(): Promise<void> {
        try {
            const files = await fs.promises.readdir(BACKGROUND_CAPTURES_DIR);
            for (const file of files) {
                await fs.promises.unlink(path.join(BACKGROUND_CAPTURES_DIR, file)).catch(() => {});
            }
            console.log(`[BackgroundActivityTracker] Cleaned up ${files.length} background screenshots on exit`);
        } catch {
            // Directory may not exist
        }
    }

    private notifyUpdate(): void {
        this.updateCallback?.(this.getActivities());
    }
}
```

**Step 2: Build to verify no errors**

Run: `npx tsc --noEmit`

Note: The import for `saveEncryptedFile` may need adjustment — check the actual export in `electron/encryption.ts` or `electron/main.ts`. The agent implementing this should grep for `saveEncryptedFile` to find the correct import path.

**Step 3: Commit**

```bash
git add electron/backgroundActivityTracker.ts
git commit -m "feat(timewarp): add BackgroundActivityTracker main process service"
```

---

### Task 3: Register IPC handlers and initialize tracker in main.ts

**Files:**
- Modify: `electron/main.ts`

**Step 1: Import the tracker at the top of main.ts (near other service imports, ~line 35)**

```typescript
import { BackgroundActivityTracker } from './backgroundActivityTracker.js';
```

**Step 2: Initialize tracker in `app.whenReady()` (after recording manager init, ~line 4512)**

Add after the recording manager initialization block:

```typescript
    // Initialize background activity tracker for TimeWarp feature
    try {
        const tracker = BackgroundActivityTracker.getInstance();

        // Push updates to renderer
        tracker.setUpdateCallback((activities) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('background-activities-update', activities);
            }
        });

        await tracker.start();
        console.log('[Main] Background activity tracker initialized');
    } catch (error) {
        console.error('[Main] Failed to initialize background activity tracker:', error);
    }
```

**Step 3: Add cleanup on app quit**

Find the existing `app.on('before-quit', ...)` handler (or `app.on('will-quit', ...)`). Add:

```typescript
app.on('will-quit', async () => {
    const tracker = BackgroundActivityTracker.getInstance();
    tracker.stop();
    await tracker.cleanupAll();
});
```

If there's already a will-quit handler, add the tracker cleanup inside it.

**Step 4: Register IPC handlers (near other IPC handlers, after existing ones)**

```typescript
// TimeWarp: Background activity tracking IPC
ipcMain.handle('get-background-activities', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    return tracker.getActivities();
});

ipcMain.handle('claim-background-activities', async (_event, fromTimestamp: number, toTimestamp: number) => {
    const tracker = BackgroundActivityTracker.getInstance();
    return tracker.claimActivities(fromTimestamp, toTimestamp);
});

ipcMain.on('pause-background-tracker', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    tracker.pause();
});

ipcMain.on('resume-background-tracker', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    tracker.resume();
});
```

**Step 5: Build to verify**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat(timewarp): register background tracker IPC handlers and init"
```

---

### Task 4: Expose IPC channels in preload

**Files:**
- Modify: `electron/preload.cts` (the preload file exposing IPC to renderer)

**Step 1: Add TimeWarp IPC methods to the exposed API**

Find the `contextBridge.exposeInMainWorld('electron', { ... })` block. Add a new `backgroundActivity` namespace (follow the pattern of `appBlacklist` at ~line 228 or `meeting` at ~line 265):

```typescript
backgroundActivity: {
    getActivities: () => ipcRenderer.invoke('get-background-activities'),
    claimActivities: (fromTimestamp: number, toTimestamp: number) =>
        ipcRenderer.invoke('claim-background-activities', fromTimestamp, toTimestamp),
    pause: () => ipcRenderer.send('pause-background-tracker'),
    resume: () => ipcRenderer.send('resume-background-tracker'),
    onUpdate: (callback: (activities: any[]) => void) => {
        const subscription = (_event: any, activities: any[]) => callback(activities);
        ipcRenderer.on('background-activities-update', subscription);
        return () => ipcRenderer.removeListener('background-activities-update', subscription);
    },
},
```

**Step 2: Build to verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add electron/preload.cts
git commit -m "feat(timewarp): expose background activity IPC channels in preload"
```

---

### Task 5: Create BackgroundActivityContext

**Files:**
- Create: `src/context/BackgroundActivityContext.tsx`
- Modify: `src/main.tsx` (add provider)

**Step 1: Create the context**

```typescript
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { BackgroundActivity } from '../types/shared';

interface BackgroundActivityContextType {
    activities: BackgroundActivity[];
    claimActivities: (fromTimestamp: number, toTimestamp: number) => Promise<BackgroundActivity[]>;
    pauseTracking: () => void;
    resumeTracking: () => void;
}

const BackgroundActivityContext = createContext<BackgroundActivityContextType | null>(null);

export function BackgroundActivityProvider({ children }: { children: ReactNode }) {
    const [activities, setActivities] = useState<BackgroundActivity[]>([]);

    useEffect(() => {
        // Load initial activities
        // @ts-ignore
        window.electron?.ipcRenderer?.invoke?.('get-background-activities')
            .then((result: BackgroundActivity[]) => {
                if (result) setActivities(result);
            })
            .catch(() => {});

        // Subscribe to updates
        // @ts-ignore
        const unsubscribe = window.electron?.backgroundActivity?.onUpdate?.((newActivities: BackgroundActivity[]) => {
            setActivities(newActivities);
        });

        return () => {
            unsubscribe?.();
        };
    }, []);

    const claimActivities = useCallback(async (fromTimestamp: number, toTimestamp: number): Promise<BackgroundActivity[]> => {
        // @ts-ignore
        const claimed = await window.electron?.backgroundActivity?.claimActivities?.(fromTimestamp, toTimestamp);
        return claimed || [];
    }, []);

    const pauseTracking = useCallback(() => {
        // @ts-ignore
        window.electron?.backgroundActivity?.pause?.();
    }, []);

    const resumeTracking = useCallback(() => {
        // @ts-ignore
        window.electron?.backgroundActivity?.resume?.();
    }, []);

    return (
        <BackgroundActivityContext.Provider value={{ activities, claimActivities, pauseTracking, resumeTracking }}>
            {children}
        </BackgroundActivityContext.Provider>
    );
}

export function useBackgroundActivity() {
    const context = useContext(BackgroundActivityContext);
    if (!context) {
        throw new Error('useBackgroundActivity must be used within BackgroundActivityProvider');
    }
    return context;
}
```

**Step 2: Add provider to main.tsx**

In `src/main.tsx`, import and wrap. Add after `AudioRecordingProvider` (~line 48), before `AnimationProvider`:

```typescript
import { BackgroundActivityProvider } from './context/BackgroundActivityContext';
```

```tsx
<AudioRecordingProvider>
  <BackgroundActivityProvider>
    <AnimationProvider>
      <App />
      <SplitAnimationOverlay />
    </AnimationProvider>
  </BackgroundActivityProvider>
</AudioRecordingProvider>
```

**Step 3: Build to verify**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/context/BackgroundActivityContext.tsx src/main.tsx
git commit -m "feat(timewarp): add BackgroundActivityContext and provider"
```

---

### Task 6: Modify useTimer to support retroactive start and adjustment

**Files:**
- Modify: `src/hooks/useTimer.ts`

**Step 1: Add `overrideStartTime` parameter to `start()`**

At line 976, change the `start` function signature and body:

```typescript
const start = useCallback((overrideStartTime?: number) => {
```

Inside `start()`, where `startTime` is set (find the line like `setStartTime(Date.now())`), change to:

```typescript
const effectiveStartTime = overrideStartTime || Date.now();
setStartTime(effectiveStartTime);
```

**Step 2: Add `adjustStartTime` method**

After the `start` function, add a new exported method:

```typescript
const adjustStartTime = useCallback((newStartTime: number) => {
    if (!isRunning) return;
    setStartTime(newStartTime);
    // Elapsed will auto-recalculate from the interval since it uses `Date.now() - startTime`
}, [isRunning]);
```

**Step 3: Add pause/resume IPC calls for background tracker**

Inside `start()`, after setting the start time, add:

```typescript
// Pause background activity tracker — useTimer takes over
// @ts-ignore
window.electron?.backgroundActivity?.pause?.();
```

Inside `stop()`, after the timer stops (where cleanup happens), add:

```typescript
// Resume background activity tracker
// @ts-ignore
window.electron?.backgroundActivity?.resume?.();
```

**Step 4: Export the new method**

Find the return statement of `useTimer` (the object it returns). Add `adjustStartTime`:

```typescript
return {
    isRunning,
    isPaused,
    elapsed,
    start: start,
    stop: stop,
    pause: pauseTimer,
    resume: resumeTimer,
    formatTime,
    checkPermissions,
    setActiveRecordingEntry,
    adjustStartTime,  // NEW
};
```

**Step 5: Build to verify**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/hooks/useTimer.ts
git commit -m "feat(timewarp): add overrideStartTime and adjustStartTime to useTimer"
```

---

### Task 7: Create TimeWarpTimeline component

**Files:**
- Create: `src/components/TimeWarpTimeline.tsx`

**Step 1: Implement the timeline component**

This is the largest single component. Key behaviors:
- Renders at full width, directly on page background (no container card)
- Shows activity nodes (circles for apps, diamonds for meetings)
- Hour/half-hour tick marks
- Draggable playhead
- Right-to-left orientation (now = right edge)

```typescript
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { BackgroundActivity } from '../types/shared';

interface TimeWarpTimelineProps {
    backgroundActivities: BackgroundActivity[];
    timerStartTime: number | null;
    isRunning: boolean;
    onStartTimeChange: (timestamp: number) => void;
}

// Generate a consistent hue from a string (for color-coding apps)
function stringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

function formatTimeLabel(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const VISIBLE_DURATION_DEFAULT = 2 * 60 * 60 * 1000; // 2 hours
const TIMELINE_HEIGHT = 60;
const NODE_RADIUS = 5;
const MEETING_SIZE = 8;

export function TimeWarpTimeline({
    backgroundActivities,
    timerStartTime,
    isRunning,
    onStartTimeChange,
}: TimeWarpTimelineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [playheadTime, setPlayheadTime] = useState<number | null>(null);
    const [visibleDuration, setVisibleDuration] = useState(VISIBLE_DURATION_DEFAULT);
    const [now, setNow] = useState(Date.now());

    // Update "now" every second
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const visibleStart = now - visibleDuration;

    // The effective playhead position
    const effectivePlayhead = isRunning
        ? timerStartTime
        : playheadTime;

    // Convert timestamp to x position (0 = left edge, 1 = right edge)
    const timeToPosition = useCallback((timestamp: number): number => {
        return (timestamp - visibleStart) / visibleDuration;
    }, [visibleStart, visibleDuration]);

    // Convert x position to timestamp
    const positionToTime = useCallback((posX: number, containerWidth: number): number => {
        const ratio = posX / containerWidth;
        return visibleStart + ratio * visibleDuration;
    }, [visibleStart, visibleDuration]);

    // Generate hour marks
    const hourMarks = useMemo(() => {
        const marks: { timestamp: number; isHour: boolean }[] = [];
        // Round down to nearest hour
        const startHour = new Date(visibleStart);
        startHour.setMinutes(0, 0, 0);
        let t = startHour.getTime();

        while (t <= now) {
            if (t >= visibleStart) {
                marks.push({ timestamp: t, isHour: true });
            }
            // Half hour
            const halfHour = t + 30 * 60 * 1000;
            if (halfHour >= visibleStart && halfHour <= now) {
                marks.push({ timestamp: halfHour, isHour: false });
            }
            t += 60 * 60 * 1000;
        }
        return marks;
    }, [visibleStart, now, visibleDuration]);

    // Filter activities to visible range
    const visibleActivities = useMemo(() => {
        return backgroundActivities.filter(a =>
            a.endTimestamp >= visibleStart && a.startTimestamp <= now
        );
    }, [backgroundActivities, visibleStart, now]);

    // Playhead drag handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = positionToTime(Math.max(0, Math.min(x, rect.width)), rect.width);

        // Clamp: cannot go past now, and if running cannot go past original start
        const clampedTime = Math.min(time, now);

        if (isRunning) {
            onStartTimeChange(clampedTime);
        } else {
            setPlayheadTime(clampedTime);
            onStartTimeChange(clampedTime);
        }
    }, [isDragging, positionToTime, now, isRunning, onStartTimeChange]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Handle click on timeline to set playhead
    const handleTimelineClick = useCallback((e: React.MouseEvent) => {
        if (!containerRef.current || isDragging) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = positionToTime(Math.max(0, Math.min(x, rect.width)), rect.width);
        const clampedTime = Math.min(time, now);

        if (!isRunning) {
            setPlayheadTime(clampedTime);
            onStartTimeChange(clampedTime);
        } else {
            // When running, only allow dragging further back
            if (timerStartTime && clampedTime < timerStartTime) {
                onStartTimeChange(clampedTime);
            }
        }
    }, [positionToTime, now, isRunning, timerStartTime, onStartTimeChange, isDragging]);

    // Scroll wheel to zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 1.2 : 0.8;
        setVisibleDuration(prev => {
            const newDuration = prev * delta;
            // Clamp between 15 minutes and 12 hours
            return Math.max(15 * 60 * 1000, Math.min(12 * 60 * 60 * 1000, newDuration));
        });
    }, []);

    // Global mouse up listener for drag release
    useEffect(() => {
        if (!isDragging) return;
        const handleUp = () => setIsDragging(false);
        window.addEventListener('mouseup', handleUp);
        return () => window.removeEventListener('mouseup', handleUp);
    }, [isDragging]);

    const playheadPos = effectivePlayhead ? timeToPosition(effectivePlayhead) : null;

    return (
        <div
            ref={containerRef}
            className="w-full select-none"
            style={{
                height: TIMELINE_HEIGHT,
                position: 'relative',
                cursor: isDragging ? 'grabbing' : 'pointer',
            }}
            onClick={handleTimelineClick}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
        >
            {/* Horizontal baseline */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: TIMELINE_HEIGHT / 2,
                    height: 1,
                    backgroundColor: 'var(--color-border-primary)',
                }}
            />

            {/* Hour marks */}
            {hourMarks.map((mark) => {
                const pos = timeToPosition(mark.timestamp);
                if (pos < 0 || pos > 1) return null;
                return (
                    <div key={mark.timestamp} style={{ position: 'absolute', left: `${pos * 100}%`, top: 0, bottom: 0, pointerEvents: 'none' }}>
                        {/* Tick line */}
                        <div style={{
                            position: 'absolute',
                            left: 0,
                            top: mark.isHour ? TIMELINE_HEIGHT / 2 - 10 : TIMELINE_HEIGHT / 2 - 5,
                            width: 1,
                            height: mark.isHour ? 20 : 10,
                            backgroundColor: 'var(--color-border-secondary)',
                            opacity: mark.isHour ? 0.6 : 0.3,
                        }} />
                        {/* Hour label */}
                        {mark.isHour && (
                            <span style={{
                                position: 'absolute',
                                left: -16,
                                top: TIMELINE_HEIGHT / 2 + 14,
                                fontSize: 10,
                                color: 'var(--color-text-tertiary)',
                                fontFamily: 'var(--font-mono)',
                                whiteSpace: 'nowrap',
                            }}>
                                {formatTimeLabel(mark.timestamp)}
                            </span>
                        )}
                    </div>
                );
            })}

            {/* Activity nodes */}
            {visibleActivities.map((activity) => {
                const pos = timeToPosition(activity.startTimestamp);
                if (pos < 0 || pos > 1) return null;
                const hue = stringToHue(activity.bundleId || activity.appName);
                const color = `hsl(${hue}, 60%, 55%)`;

                return (
                    <div
                        key={activity.id}
                        style={{
                            position: 'absolute',
                            left: `${pos * 100}%`,
                            top: TIMELINE_HEIGHT / 2,
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'none',
                        }}
                        title={`${activity.appName}\n${activity.windowTitle}\n${formatTimeLabel(activity.startTimestamp)}`}
                    >
                        {activity.isMeeting ? (
                            // Diamond for meetings
                            <div style={{
                                width: MEETING_SIZE,
                                height: MEETING_SIZE,
                                backgroundColor: color,
                                transform: 'rotate(45deg)',
                                borderRadius: 1,
                            }} />
                        ) : (
                            // Circle for app switches
                            <div style={{
                                width: NODE_RADIUS * 2,
                                height: NODE_RADIUS * 2,
                                backgroundColor: color,
                                borderRadius: '50%',
                            }} />
                        )}
                    </div>
                );
            })}

            {/* Playhead */}
            {playheadPos !== null && playheadPos >= 0 && playheadPos <= 1 && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${playheadPos * 100}%`,
                        top: 4,
                        bottom: 4,
                        width: 2,
                        backgroundColor: 'var(--color-accent)',
                        cursor: 'grab',
                        zIndex: 10,
                        borderRadius: 1,
                    }}
                    onMouseDown={handleMouseDown}
                >
                    {/* Playhead handle */}
                    <div style={{
                        position: 'absolute',
                        top: -4,
                        left: -5,
                        width: 12,
                        height: 12,
                        backgroundColor: 'var(--color-accent)',
                        borderRadius: '50%',
                        border: '2px solid white',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                    {/* Time label above playhead */}
                    {effectivePlayhead && (
                        <span style={{
                            position: 'absolute',
                            top: -22,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'var(--color-accent)',
                            fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap',
                            textShadow: '0 0 4px var(--color-bg-primary)',
                        }}>
                            {formatTimeLabel(effectivePlayhead)}
                        </span>
                    )}
                </div>
            )}

            {/* "NOW" label at right edge */}
            <span style={{
                position: 'absolute',
                right: 4,
                top: TIMELINE_HEIGHT / 2 + 14,
                fontSize: 9,
                fontWeight: 600,
                color: 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
            }}>
                now
            </span>
        </div>
    );
}
```

**Step 2: Build to verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/TimeWarpTimeline.tsx
git commit -m "feat(timewarp): add TimeWarpTimeline component"
```

---

### Task 8: Wire everything together in App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Import the new component and context**

At the top of App.tsx (near other component imports, ~line 14):

```typescript
import { TimeWarpTimeline } from './components/TimeWarpTimeline';
import { useBackgroundActivity } from './context/BackgroundActivityContext';
```

**Step 2: Use the context inside the App component**

Inside the `function App()` body, near other hook calls (~line 67):

```typescript
const { activities: backgroundActivities } = useBackgroundActivity();
```

**Step 3: Add state for proposed start time**

Near other state declarations:

```typescript
const [proposedStartTime, setProposedStartTime] = useState<number | null>(null);
```

**Step 4: Destructure `adjustStartTime` from useTimer**

Update the existing useTimer destructuring at line 67 to include the new method:

```typescript
const {
    isRunning,
    isPaused,
    elapsed,
    start: startTimer,
    stop: stopTimer,
    pause: pauseTimer,
    resume: resumeTimer,
    formatTime,
    checkPermissions,
    setActiveRecordingEntry,
    adjustStartTime,  // NEW
} = useTimer();
```

**Step 5: Modify handleStartStop to use proposedStartTime**

Find the `handleStartStop` function. Where it calls `startTimer()`, change to:

```typescript
startTimer(proposedStartTime || undefined);
setProposedStartTime(null);
```

**Step 6: Add handleTimeWarpChange callback**

```typescript
const handleTimeWarpChange = useCallback((timestamp: number) => {
    if (isRunning) {
        adjustStartTime(timestamp);
    } else {
        setProposedStartTime(timestamp);
    }
}, [isRunning, adjustStartTime]);
```

**Step 7: Insert TimeWarpTimeline in the chrono view**

Find the chrono view container (line ~1174, `currentView === 'chrono'`). The timeline goes at the very bottom of the chrono view, inside the container but after the timer+buttons block. After the closing `</div>` of the `mb-8 inline-flex flex-col` container (line ~1371), add:

```tsx
{/* TimeWarp Timeline - anchored to bottom */}
<div className="absolute bottom-0 left-0 right-0 px-4 pb-2">
    <TimeWarpTimeline
        backgroundActivities={backgroundActivities}
        timerStartTime={isRunning ? (elapsed ? Date.now() - elapsed : null) : null}
        isRunning={isRunning}
        onStartTimeChange={handleTimeWarpChange}
    />
</div>
```

Note: The chrono container already has `relative` positioning (line 1175), so `absolute bottom-0` will anchor the timeline to the bottom.

**Step 8: Build to verify**

Run: `npx tsc --noEmit`

**Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(timewarp): wire TimeWarpTimeline into chrono view"
```

---

### Task 9: Integration testing and polish

**Files:**
- Various (based on findings)

**Step 1: Run dev build and test manually**

Run: `npm run dev:electron`

Test these scenarios:
1. App launches → timeline appears at bottom of chrono screen with hour marks
2. Switch between apps → nodes appear on timeline in real-time
3. Click on timeline → playhead moves, proposed start time updates
4. Drag playhead back → time label shows selected time
5. Click START with playhead set back → timer starts with retroactive start time, elapsed shows correct duration
6. While running, drag playhead further back → elapsed adjusts
7. Scroll wheel on timeline → zooms in/out
8. Stop timer → background tracker resumes, new nodes appear

**Step 2: Fix any issues found during testing**

Common things to check:
- `timerStartTime` prop calculation — may need to use the actual `startTime` from useTimer rather than computing from elapsed
- Ensure `startTime` is exposed from useTimer return if needed
- Playhead drag responsiveness
- Activity node tooltip positioning

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(timewarp): integration fixes from manual testing"
```

---

### Task 10: Build verification

**Step 1: Full production build**

Run: `npm run build`
Expected: No TypeScript errors, successful Vite build

**Step 2: Commit if any remaining changes**

```bash
git status
# If clean, done. Otherwise:
git add -A
git commit -m "chore(timewarp): final build verification"
```
