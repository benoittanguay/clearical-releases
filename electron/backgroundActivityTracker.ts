/**
 * BackgroundActivityTracker - Core main-process service for TimeWarp
 *
 * Polls the active window every 1 second via AppleScript, groups consecutive
 * same-app activity into BackgroundActivity entries, captures screenshots on
 * significant window changes, detects meetings, and maintains an in-memory
 * ring buffer with 12-hour TTL.
 *
 * Runs in Electron's main process as a singleton. The renderer subscribes
 * to updates via setUpdateCallback.
 */

import { app } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

import { BlacklistService } from './blacklistService.js';
import { mediaMonitor } from './native/index.js';
import { saveEncryptedFile } from './encryption.js';
import type { BackgroundActivity } from '../src/types/shared.js';

const execAsync = promisify(exec);

// Constants
const POLL_INTERVAL_MS = 1000;         // 1 second
const CLEANUP_INTERVAL_MS = 600_000;   // 10 minutes
const TTL_MS = 12 * 60 * 60 * 1000;   // 12 hours
const MIN_ACTIVITY_DURATION_MS = 2000; // 2 seconds minimum to keep an activity

// Meeting app bundle IDs for meeting detection
const MEETING_BUNDLE_IDS = new Set([
    'us.zoom.videomeetings',
    'us.zoom.xos',
    'com.microsoft.teams',
    'com.microsoft.teams2',
    'com.discord.Discord',
    'com.tinyspeck.slackmacgap',
    'com.apple.FaceTime',
    'com.cisco.webex.meetings',
    'com.webex.meetingmanager',
    'com.skype.skype',
    'com.logmein.GoToMeeting',
]);

// Self-capture bundle IDs and app names to skip
const SELF_APP_NAMES = new Set(['clearical', 'time-portal', 'timeportal']);
const SELF_BUNDLE_ID = 'io.clearical.app';

// Browser bundle IDs for profile extraction
const BROWSER_BUNDLE_IDS = new Set([
    'com.google.Chrome',
    'com.brave.Browser',
    'com.microsoft.edgemac',
    'com.vivaldi.Vivaldi',
    'com.operasoftware.Opera',
]);

interface WindowInfo {
    appName: string;
    windowTitle: string;
    bundleId: string;
    pid: number;
}

type UpdateCallback = (activities: BackgroundActivity[]) => void;

export class BackgroundActivityTracker {
    private static instance: BackgroundActivityTracker | null = null;

    private activities: BackgroundActivity[] = [];
    private currentActivity: BackgroundActivity | null = null;
    private lastWindow: WindowInfo | null = null;

    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    private paused = false;
    private running = false;

    private updateCallback: UpdateCallback | null = null;
    private blacklistService: BlacklistService;

    private backgroundCapturesDir: string;
    private screenshotsDir: string;

    private constructor() {
        this.blacklistService = BlacklistService.getInstance();
        this.backgroundCapturesDir = path.join(app.getPath('userData'), 'background-captures');
        this.screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): BackgroundActivityTracker {
        if (!BackgroundActivityTracker.instance) {
            BackgroundActivityTracker.instance = new BackgroundActivityTracker();
        }
        return BackgroundActivityTracker.instance;
    }

    /**
     * Start background activity tracking
     * Creates the background-captures directory and starts polling + cleanup intervals
     */
    public async start(): Promise<void> {
        if (this.running) return;

        console.log('[BackgroundActivityTracker] Starting...');

        // Ensure background-captures directory exists
        await fs.promises.mkdir(this.backgroundCapturesDir, { recursive: true });

        this.running = true;
        this.paused = false;

        // Start polling every 1 second
        this.pollInterval = setInterval(() => {
            this.poll().catch((err) => {
                console.error('[BackgroundActivityTracker] Poll error:', err);
            });
        }, POLL_INTERVAL_MS);

        // Start cleanup every 10 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanup().catch((err) => {
                console.error('[BackgroundActivityTracker] Cleanup error:', err);
            });
        }, CLEANUP_INTERVAL_MS);

        console.log('[BackgroundActivityTracker] Started');
    }

    /**
     * Stop background activity tracking
     * Clears intervals and finalizes any current activity
     */
    public stop(): void {
        if (!this.running) return;

        console.log('[BackgroundActivityTracker] Stopping...');

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        this.finalizeCurrentActivity();
        this.running = false;
        this.lastWindow = null;

        console.log('[BackgroundActivityTracker] Stopped');
    }

    /**
     * Pause tracking (e.g., when the user starts a timer)
     * Finalizes the current activity but keeps intervals alive
     */
    public pause(): void {
        if (this.paused) return;
        console.log('[BackgroundActivityTracker] Paused');
        this.paused = true;
        this.finalizeCurrentActivity();
    }

    /**
     * Resume tracking after a pause
     */
    public resume(): void {
        if (!this.paused) return;
        console.log('[BackgroundActivityTracker] Resumed');
        this.paused = false;
        this.lastWindow = null;
    }

    /**
     * Get a copy of all tracked activities
     */
    public getActivities(): BackgroundActivity[] {
        return [...this.activities];
    }

    /**
     * Set a callback for pushing activity updates to the renderer
     */
    public setUpdateCallback(cb: UpdateCallback): void {
        this.updateCallback = cb;
    }

    /**
     * Claim activities in a time range
     *
     * Removes matching activities from the buffer and moves their screenshots
     * from background-captures/ to the main screenshots/ directory.
     *
     * @param from - Start timestamp (inclusive)
     * @param to - End timestamp (inclusive)
     * @returns The claimed activities
     */
    public async claimActivities(from: number, to: number): Promise<BackgroundActivity[]> {
        // Ensure main screenshots directory exists before moving files
        await fs.promises.mkdir(this.screenshotsDir, { recursive: true });

        const claimed: BackgroundActivity[] = [];
        const remaining: BackgroundActivity[] = [];

        for (const activity of this.activities) {
            // Activity overlaps with the claim range
            if (activity.startTimestamp <= to && activity.endTimestamp >= from) {
                claimed.push(activity);
            } else {
                remaining.push(activity);
            }
        }

        // Move screenshot files from background-captures to main screenshots dir
        for (const activity of claimed) {
            const movedPaths: string[] = [];
            for (const screenshotPath of activity.screenshotPaths) {
                try {
                    const filename = path.basename(screenshotPath);
                    const destPath = path.join(this.screenshotsDir, filename);

                    if (fs.existsSync(screenshotPath)) {
                        await fs.promises.rename(screenshotPath, destPath);
                        movedPaths.push(destPath);
                    }
                } catch (err) {
                    console.error('[BackgroundActivityTracker] Failed to move screenshot:', err);
                }
            }
            activity.screenshotPaths = movedPaths;
        }

        this.activities = remaining;
        this.notifyUpdate();

        console.log(`[BackgroundActivityTracker] Claimed ${claimed.length} activities (${from} - ${to})`);
        return claimed;
    }

    /**
     * Delete all files in background-captures/ (called on app quit)
     */
    public async cleanupAll(): Promise<void> {
        console.log('[BackgroundActivityTracker] Cleaning up all background captures...');
        try {
            if (fs.existsSync(this.backgroundCapturesDir)) {
                const files = await fs.promises.readdir(this.backgroundCapturesDir);
                for (const file of files) {
                    try {
                        await fs.promises.unlink(path.join(this.backgroundCapturesDir, file));
                    } catch (err) {
                        console.error('[BackgroundActivityTracker] Failed to delete file:', file, err);
                    }
                }
            }
        } catch (err) {
            console.error('[BackgroundActivityTracker] cleanupAll error:', err);
        }
        this.activities = [];
        console.log('[BackgroundActivityTracker] Cleanup complete');
    }

    // -------------------------------------------------------------------------
    // Private methods
    // -------------------------------------------------------------------------

    /**
     * The 1-second polling loop
     * Gets the active window, checks blacklist/self-capture, detects significant
     * changes, finalizes previous activity, creates new ones, and captures screenshots
     */
    private async poll(): Promise<void> {
        if (this.paused || !this.running) return;

        const windowInfo = await this.getActiveWindow();
        if (!windowInfo || !windowInfo.appName || windowInfo.appName === 'Unknown') {
            return;
        }

        // Skip blacklisted apps
        if (windowInfo.bundleId && this.blacklistService.isAppBlacklisted(windowInfo.bundleId)) {
            return;
        }

        // Skip self-capture (Clearical / TimePortal)
        if (this.isSelfApp(windowInfo)) {
            return;
        }

        const now = Date.now();
        const isSignificant = this.isSignificantWindowChange(windowInfo);

        if (isSignificant) {
            // Finalize the previous activity
            this.finalizeCurrentActivity();

            // Detect if this is a meeting
            const isMeeting = this.detectMeeting(windowInfo);

            // Extract browser profile if applicable
            const browserProfile = this.extractBrowserProfile(windowInfo);

            // Create a new activity
            this.currentActivity = {
                id: crypto.randomUUID(),
                appName: windowInfo.appName,
                windowTitle: windowInfo.windowTitle,
                bundleId: windowInfo.bundleId,
                browserProfile: browserProfile || undefined,
                startTimestamp: now,
                endTimestamp: now,
                isMeeting,
                screenshotPaths: [],
            };

            this.lastWindow = windowInfo;

            // Capture a screenshot on significant change
            await this.captureScreenshot(windowInfo);
        } else if (this.currentActivity) {
            // Update the end timestamp of the current activity
            this.currentActivity.endTimestamp = now;
        }
    }

    /**
     * Finalize the current activity and push it to the activities buffer
     * Only keeps activities longer than 2 seconds
     */
    private finalizeCurrentActivity(): void {
        if (!this.currentActivity) return;

        // Update end timestamp one final time
        this.currentActivity.endTimestamp = Date.now();

        const duration = this.currentActivity.endTimestamp - this.currentActivity.startTimestamp;

        if (duration >= MIN_ACTIVITY_DURATION_MS) {
            this.activities.push(this.currentActivity);
            this.notifyUpdate();
        } else {
            // Activity too short; clean up its screenshots
            for (const screenshotPath of this.currentActivity.screenshotPaths) {
                fs.promises.unlink(screenshotPath).catch(() => {
                    // Ignore - file may not exist
                });
            }
        }

        this.currentActivity = null;
    }

    /**
     * Determine if the window change is significant
     * Different app = significant. Same app + same title = not significant.
     */
    private isSignificantWindowChange(newWindow: WindowInfo): boolean {
        if (!this.lastWindow) return true;

        // Different app is always significant
        if (this.lastWindow.bundleId !== newWindow.bundleId) return true;
        if (this.lastWindow.appName !== newWindow.appName) return true;

        // Same app, different window title is significant
        if (this.lastWindow.windowTitle !== newWindow.windowTitle) return true;

        // Same app, same title = not significant
        return false;
    }

    /**
     * Check if the current window is a meeting
     * Requires mic to be active + a known meeting app bundle ID
     */
    private detectMeeting(windowInfo: WindowInfo): boolean {
        if (!MEETING_BUNDLE_IDS.has(windowInfo.bundleId)) {
            return false;
        }
        return mediaMonitor.isMicrophoneInUse();
    }

    /**
     * Check if the window belongs to this app (Clearical/TimePortal)
     */
    private isSelfApp(windowInfo: WindowInfo): boolean {
        if (windowInfo.bundleId === SELF_BUNDLE_ID) return true;
        const appNameLower = windowInfo.appName.toLowerCase();
        return SELF_APP_NAMES.has(appNameLower);
    }

    /**
     * Extract browser profile from window title for Chrome-based browsers
     * Chrome window titles are typically: "Page Title - Profile Name - Google Chrome"
     * So we take the second-to-last segment when split by " - "
     */
    private extractBrowserProfile(windowInfo: WindowInfo): string | null {
        if (!BROWSER_BUNDLE_IDS.has(windowInfo.bundleId)) {
            return null;
        }

        const parts = windowInfo.windowTitle.split(' - ');
        if (parts.length >= 3) {
            // Second-to-last segment is the profile name
            return parts[parts.length - 2].trim();
        }

        return null;
    }

    /**
     * Capture a screenshot of the current window and save it encrypted
     * to the background-captures directory
     */
    private async captureScreenshot(windowInfo: WindowInfo): Promise<void> {
        try {
            const screenshotBuffer = mediaMonitor.captureWindowScreenshot(
                windowInfo.pid,
                windowInfo.windowTitle
            );

            if (!screenshotBuffer || screenshotBuffer.length === 0) {
                return;
            }

            const timestamp = Date.now();
            const appNameSafe = windowInfo.appName.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50);
            const windowTitleSafe = windowInfo.windowTitle.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
            const filename = `${timestamp}|||${appNameSafe}|||${windowTitleSafe}.png`;
            const filePath = path.join(this.backgroundCapturesDir, filename);

            await saveEncryptedFile(filePath, screenshotBuffer);

            if (this.currentActivity) {
                this.currentActivity.screenshotPaths.push(filePath);
            }
        } catch (err) {
            console.error('[BackgroundActivityTracker] Screenshot capture failed:', err);
        }
    }

    /**
     * Get the active window via AppleScript
     * Returns appName, windowTitle, bundleId, and pid
     */
    private async getActiveWindow(): Promise<WindowInfo | null> {
        if (process.platform !== 'darwin') return null;

        try {
            const result = await execAsync(`osascript -e '
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set appName to name of frontApp
                    set bundleId to bundle identifier of frontApp
                    set appPID to unix id of frontApp
                    set windowTitle to ""

                    -- Strategy 1: Try to get title from front window (standard approach)
                    set windowCount to 0
                    try
                        set windowCount to count of windows of frontApp
                    end try

                    if windowCount > 0 then
                        try
                            set windowTitle to title of front window of frontApp
                            if windowTitle is missing value then
                                set windowTitle to ""
                            end if
                        on error
                            set windowTitle to ""
                        end try
                    end if

                    -- Strategy 2: For Electron apps, try AXTitle from UI elements
                    if windowTitle is "" then
                        try
                            set uiElements to UI elements of frontApp
                            repeat with elem in uiElements
                                try
                                    set elemRole to role of elem
                                    if elemRole is "AXWindow" then
                                        set axTitle to value of attribute "AXTitle" of elem
                                        if axTitle is not missing value and axTitle is not "" then
                                            set windowTitle to axTitle
                                            exit repeat
                                        end if
                                    end if
                                end try
                            end repeat
                        end try
                    end if

                    -- Strategy 3: Try AXTitle attribute directly on first window
                    if windowTitle is "" and windowCount > 0 then
                        try
                            set firstWindow to window 1 of frontApp
                            set axTitle to value of attribute "AXTitle" of firstWindow
                            if axTitle is not missing value and axTitle is not "" then
                                set windowTitle to axTitle
                            end if
                        end try
                    end if

                    -- Strategy 4: For Electron apps, try AXDocument attribute
                    if windowTitle is "" then
                        try
                            set firstWindow to window 1 of frontApp
                            set docTitle to value of attribute "AXDocument" of firstWindow
                            if docTitle is not missing value and docTitle is not "" then
                                if docTitle contains "/" then
                                    set AppleScript'"'"'s text item delimiters to "/"
                                    set pathParts to text items of docTitle
                                    set windowTitle to last item of pathParts
                                    set AppleScript'"'"'s text item delimiters to ""
                                else
                                    set windowTitle to docTitle
                                end if
                            end if
                        end try
                    end if

                    return appName & "|||" & windowTitle & "|||" & bundleId & "|||" & appPID
                end tell
            '`);

            const parts = result.stdout.trim().split('|||');
            const appName = parts[0] || 'Unknown';
            const rawWindowTitle = parts[1];
            const bundleId = parts[2] || '';
            const pid = parseInt(parts[3], 10) || 0;
            const windowTitle = (rawWindowTitle && rawWindowTitle.trim() !== '') ? rawWindowTitle : 'Unknown';

            return { appName, windowTitle, bundleId, pid };
        } catch (error) {
            console.error('[BackgroundActivityTracker] Failed to get active window:', error);
            return null;
        }
    }

    /**
     * Clean up activities older than 12 hours
     * Deletes their screenshot files from disk
     */
    private async cleanup(): Promise<void> {
        const cutoff = Date.now() - TTL_MS;
        const expired: BackgroundActivity[] = [];
        const remaining: BackgroundActivity[] = [];

        for (const activity of this.activities) {
            if (activity.endTimestamp < cutoff) {
                expired.push(activity);
            } else {
                remaining.push(activity);
            }
        }

        if (expired.length === 0) return;

        // Delete screenshot files for expired activities
        for (const activity of expired) {
            for (const screenshotPath of activity.screenshotPaths) {
                try {
                    if (fs.existsSync(screenshotPath)) {
                        await fs.promises.unlink(screenshotPath);
                    }
                } catch (err) {
                    console.error('[BackgroundActivityTracker] Failed to delete expired screenshot:', err);
                }
            }
        }

        this.activities = remaining;
        console.log(`[BackgroundActivityTracker] Cleaned up ${expired.length} expired activities`);
        this.notifyUpdate();
    }

    /**
     * Notify the renderer of updated activities via the callback
     */
    private notifyUpdate(): void {
        if (this.updateCallback) {
            this.updateCallback(this.getActivities());
        }
    }
}
