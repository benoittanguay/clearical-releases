import { useEffect, useState, useRef, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useScreenshotAnalysis } from '../context/ScreenshotAnalysisContext';
import { FALLBACK_SCREENSHOT_DESCRIPTION } from '../constants';

export interface TimerState {
    isRunning: boolean;
    isPaused: boolean;
    startTime: number | null;
    elapsed: number;
}

interface VisionFrameworkRawData {
    confidence?: number;
    detectedText?: string[];
    objects?: string[];
    extraction?: any;
}

interface WindowActivity {
    appName: string;
    windowTitle: string;
    bundleId?: string;
    timestamp: number;
    duration: number;
    screenshotPaths?: string[];
    screenshotDescriptions?: { [path: string]: string };
    screenshotVisionData?: { [path: string]: VisionFrameworkRawData };
}

// Maximum number of window activities to keep in memory per session.
// Beyond this, oldest activities are consolidated to save memory.
const MAX_WINDOW_ACTIVITIES = 200;

/**
 * Consolidate window activities when the array exceeds MAX_WINDOW_ACTIVITIES.
 * Merges consecutive same-app activities at the front (oldest) of the array,
 * and strips heavyweight screenshot analysis data from old entries.
 * Keeps the most recent half of activities untouched.
 */
function consolidateActivities(activities: WindowActivity[]): WindowActivity[] {
    if (activities.length <= MAX_WINDOW_ACTIVITIES) return activities;

    const keepRecentCount = Math.floor(MAX_WINDOW_ACTIVITIES / 2);
    const oldActivities = activities.slice(0, activities.length - keepRecentCount);
    const recentActivities = activities.slice(activities.length - keepRecentCount);

    // Merge consecutive same-app activities and strip analysis data from old activities
    const consolidated: WindowActivity[] = [];
    let current: WindowActivity | null = null;

    for (const activity of oldActivities) {
        if (current !== null && current.appName === activity.appName && current.bundleId === activity.bundleId) {
            // Merge into current: accumulate duration, keep earliest timestamp, keep screenshot paths but drop analysis
            const prev: WindowActivity = current;
            current = {
                ...prev,
                duration: prev.duration + activity.duration,
                screenshotPaths: [
                    ...(prev.screenshotPaths || []),
                    ...(activity.screenshotPaths || [])
                ].slice(0, 3), // Keep at most 3 screenshot paths from merged activities
                screenshotDescriptions: undefined,
                screenshotVisionData: undefined,
            };
        } else {
            if (current) {
                consolidated.push(current);
            }
            // Strip heavyweight data from old activities
            current = {
                ...activity,
                screenshotDescriptions: undefined,
                screenshotVisionData: undefined,
            };
        }
    }
    if (current) {
        consolidated.push(current);
    }

    const result = [...consolidated, ...recentActivities];
    console.log(`[Timer] Consolidated ${activities.length} activities to ${result.length} (${consolidated.length} old + ${recentActivities.length} recent)`);
    return result;
}

export interface PermissionCheckResult {
    hasAccessibility: boolean;
    hasScreenRecording: boolean;
    requiredGranted: boolean;  // Only accessibility is required
    allGranted: boolean;
}

// Browser bundle IDs that may have dynamic window titles
const BROWSER_BUNDLE_IDS = [
    'com.google.Chrome',
    'com.apple.Safari',
    'org.mozilla.firefox',
    'com.microsoft.edgemac',
    'com.brave.Browser',
    'com.operasoftware.Opera',
    'company.thebrowser.Browser', // Arc
];

// Browser title suffixes for profile extraction
// Format: bundleId -> suffix that appears before the profile name
const BROWSER_TITLE_SUFFIXES: Record<string, string> = {
    'com.google.Chrome': 'Google Chrome',
    'com.brave.Browser': 'Brave',
    'org.mozilla.firefox': 'Mozilla Firefox',
    'com.microsoft.edgemac': 'Microsoft Edge',
    'com.apple.Safari': 'Safari',
    'com.operasoftware.Opera': 'Opera',
    'company.thebrowser.Browser': 'Arc',
};

/**
 * Extract browser profile name from window title.
 * Browser titles typically follow the format: "Page Title - Browser Name" or "Page Title - Browser Name - Profile Name"
 * Returns the profile name if found, null otherwise.
 */
function extractBrowserProfile(windowTitle: string, bundleId: string): string | null {
    const browserSuffix = BROWSER_TITLE_SUFFIXES[bundleId];
    if (!browserSuffix) return null;

    // Split by common separators: " - ", " – ", " — "
    const parts = windowTitle.split(/\s[-–—]\s/);
    if (parts.length < 2) return null;

    // Find the browser name in the parts
    const browserIndex = parts.findIndex(part => part.trim() === browserSuffix);
    if (browserIndex === -1) return null;

    // If there's a part after the browser name, that's the profile
    if (browserIndex < parts.length - 1) {
        const profileName = parts[browserIndex + 1].trim();
        // Ignore if it looks like a default profile indicator
        if (profileName && profileName !== 'Default' && profileName !== 'Person 1') {
            return profileName;
        }
    }

    return null;
}

/**
 * Extract a stable identifier from a window title for activity grouping.
 * For video conferencing URLs, extracts the meeting ID portion.
 * For general URLs, extracts the domain.
 * Returns null if no stable identifier can be extracted.
 */
function extractStableIdentifier(windowTitle: string): string | null {
    // Common video conferencing patterns with meeting IDs
    // Google Meet: "Meet - abc-defg-hij - Something - Browser"
    const meetPattern = /Meet\s*[-–]\s*([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})/i;
    const meetMatch = windowTitle.match(meetPattern);
    if (meetMatch) {
        return `meet.google.com/${meetMatch[1]}`;
    }

    // meet.google.com URL in title
    const meetUrlPattern = /meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})/i;
    const meetUrlMatch = windowTitle.match(meetUrlPattern);
    if (meetUrlMatch) {
        return `meet.google.com/${meetUrlMatch[1]}`;
    }

    // Zoom meeting
    const zoomPattern = /Zoom\s+(Meeting|Webinar)/i;
    if (zoomPattern.test(windowTitle)) {
        return 'zoom.us/meeting';
    }

    // Microsoft Teams
    const teamsPattern = /Microsoft Teams/i;
    if (teamsPattern.test(windowTitle)) {
        return 'teams.microsoft.com';
    }

    // Generic URL pattern in title (often browsers show URL)
    const urlPattern = /(?:https?:\/\/)?([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/;
    const urlMatch = windowTitle.match(urlPattern);
    if (urlMatch) {
        return urlMatch[1].toLowerCase();
    }

    return null;
}

/**
 * Generate entity key for screenshot cooldown tracking.
 * Browsers with profile: bundleId:profile:stableIdentifier (e.g., "com.google.Chrome:Work:github.com")
 * Browsers without profile: bundleId:stableIdentifier (e.g., "com.google.Chrome:github.com")
 * Non-browsers: bundleId or appName
 */
function getScreenshotCooldownKey(
    appName: string,
    windowTitle: string,
    bundleId?: string
): string {
    const isBrowser = BROWSER_BUNDLE_IDS.includes(bundleId || '');

    if (isBrowser && bundleId) {
        const stableIdentifier = extractStableIdentifier(windowTitle);
        const profile = extractBrowserProfile(windowTitle, bundleId);

        // Build key with optional profile
        let key = bundleId;
        if (profile) {
            key += `:${profile}`;
        }
        if (stableIdentifier) {
            key += `:${stableIdentifier}`;
        }

        console.log(`[Renderer] 🔑 Browser key generation:`, {
            windowTitle,
            extractedIdentifier: stableIdentifier,
            extractedProfile: profile,
            resultKey: key
        });

        return key;
    }

    return bundleId || appName;
}

/**
 * Determine if a window change is "significant" enough to create a new activity.
 * Returns true if we should create a new activity, false if we should just update the title.
 */
function isSignificantWindowChange(
    lastWindow: { appName: string; windowTitle: string; bundleId?: string } | null,
    newWindow: { appName: string; windowTitle: string; bundleId?: string }
): boolean {
    // No previous window - always significant
    if (!lastWindow) return true;

    // Different app - always significant
    if (lastWindow.appName !== newWindow.appName) return true;

    // Same app, same title - not significant (shouldn't happen, but handle it)
    if (lastWindow.windowTitle === newWindow.windowTitle) return false;

    // For browser apps, check if we're on the same site/meeting
    const isBrowser = BROWSER_BUNDLE_IDS.includes(newWindow.bundleId || '');
    if (isBrowser) {
        const lastIdentifier = extractStableIdentifier(lastWindow.windowTitle);
        const newIdentifier = extractStableIdentifier(newWindow.windowTitle);

        // If both have identifiers and they match, it's the same activity
        if (lastIdentifier && newIdentifier && lastIdentifier === newIdentifier) {
            return false; // Not significant - same site/meeting
        }

        // If we can extract an identifier from the new but not old (or vice versa),
        // check if one title contains the other's identifier
        if (lastIdentifier && newWindow.windowTitle.toLowerCase().includes(lastIdentifier.split('/')[0])) {
            return false;
        }
        if (newIdentifier && lastWindow.windowTitle.toLowerCase().includes(newIdentifier.split('/')[0])) {
            return false;
        }
    }

    // Default: different title means different activity
    return true;
}

export function useTimer() {
    const { settings } = useSettings();
    const { startAnalysis, completeAnalysis, failAnalysis } = useScreenshotAnalysis();
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [windowActivity, setWindowActivity] = useState<WindowActivity[]>([]);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const windowPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastWindowRef = useRef<{ appName: string, windowTitle: string, bundleId?: string, pid?: number, browserProfile?: string, timestamp: number } | null>(null);
    const currentActivityScreenshots = useRef<string[]>([]);
    const currentActivityScreenshotDescriptions = useRef<{ [path: string]: string }>({});
    const currentActivityScreenshotVisionData = useRef<{ [path: string]: VisionFrameworkRawData }>({});
    const lastScreenshotTime = useRef<number>(0);
    const entityLastScreenshotTime = useRef<Map<string, number>>(new Map());
    const pollingActiveRef = useRef<boolean>(false);
    const pendingAnalyses = useRef<Map<string, Promise<void>>>(new Map());

    // Analysis queue for concurrency limiting
    const analysisQueue = useRef<Array<{path: string, timestamp: number}>>([]);
    const activeAnalysisCount = useRef<number>(0);

    // Batch analysis configuration
    const SESSION_BATCH_SIZE = 5; // Max screenshots per batch for session analysis
    const SESSION_BATCH_TIMEOUT_MS = 10000; // Flush batch after 10 seconds
    const pendingBatch = useRef<Array<{path: string, timestamp: number}>>([]);
    const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isBatchProcessing = useRef<boolean>(false);

    // Rate limit and backoff tracking
    const consecutiveFailures = useRef<number>(0);
    const queuePausedUntil = useRef<number>(0);
    const analysisPermDisabled = useRef<boolean>(false); // Permanently disabled on subscription/auth errors
    const MAX_CONSECUTIVE_FAILURES_BEFORE_PAUSE = 3;
    const QUEUE_PAUSE_DURATION_MS = 60000; // 1 minute pause after multiple failures
    const FAILURE_BACKOFF_BASE_MS = 2000; // 2 second base delay after failure

    // Load state from local storage on mount
    useEffect(() => {
        const stored = localStorage.getItem('timeportal-timer-state');
        if (stored) {
            const state: TimerState = JSON.parse(stored);
            setIsRunning(state.isRunning || false);
            setIsPaused(state.isPaused || false);
            setStartTime(state.startTime);
            setElapsed(state.elapsed);

            if (state.isRunning && !state.isPaused && state.startTime) {
                // Calculate accrued time while app was potentially closed/inactive
                const now = Date.now();
                const accruedTime = now - state.startTime;
                setElapsed(accruedTime);
                console.log('Timer resumed: accrued time:', accruedTime, 'ms');
            }
        }
    }, []);

    // Persist state
    useEffect(() => {
        localStorage.setItem('timeportal-timer-state', JSON.stringify({ isRunning, isPaused, startTime, elapsed }));
    }, [isRunning, isPaused, startTime, elapsed]);

    // Send timer state to main process for menu bar display
    // Main process will handle the timer interval to avoid renderer throttling
    useEffect(() => {
        // @ts-ignore
        if (window.electron && window.electron.ipcRenderer) {
            // @ts-ignore
            window.electron.ipcRenderer.send('update-timer-display', {
                isRunning,
                isPaused,
                elapsed,
                startTime
            });
        }
    }, [isRunning, isPaused, elapsed, startTime]);

    useEffect(() => {
        const INTERVAL_SCREENSHOT_TIME = 2 * 60 * 1000; // 2 minutes - screenshot if no window change
        const WINDOW_POLL_INTERVAL = 1 * 1000; // 1 second for better window change detection
        const MIN_SCREENSHOT_INTERVAL = 5 * 1000; // Minimum 5 seconds between screenshots
        // Use configurable cooldown from settings (default 2 minutes)
        const PER_ENTITY_COOLDOWN = settings.screenshotCooldown ?? (2 * 60 * 1000);

        const captureScreenshotForCurrentWindow = async (
            reason: string,
            bypassEntityCooldown: boolean = false
        ) => {
            const now = Date.now();
            const currentWindow = lastWindowRef.current;

            if (!currentWindow) {
                console.log('[Renderer] ❌ No current window info, skipping screenshot capture');
                return null;
            }

            // Check screen recording permission before capturing
            try {
                // @ts-ignore
                const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
                if (screenStatus !== 'granted') {
                    console.log('[Renderer] ⏭️  Screen Recording permission not granted, skipping screenshot capture');
                    return null;
                }
            } catch (error) {
                console.error('[Renderer] ❌ Failed to check screen permission:', error);
                return null;
            }

            // Prevent too frequent screenshots (minimum interval)
            if (lastScreenshotTime.current > 0 && (now - lastScreenshotTime.current) < MIN_SCREENSHOT_INTERVAL) {
                console.log(`[Renderer] ⏱️ Too soon since last screenshot (${now - lastScreenshotTime.current}ms ago), skipping ${reason}`);
                return null;
            }

            // Per-entity cooldown check (only for window-change screenshots)
            if (!bypassEntityCooldown && currentWindow) {
                const entityKey = getScreenshotCooldownKey(
                    currentWindow.appName,
                    currentWindow.windowTitle,
                    currentWindow.bundleId
                );
                const lastEntityScreenshot = entityLastScreenshotTime.current.get(entityKey);

                // Debug logging to trace cooldown behavior
                console.log(`[Renderer] 🔍 Cooldown check for "${entityKey}":`, {
                    windowTitle: currentWindow.windowTitle,
                    bundleId: currentWindow.bundleId,
                    lastEntityScreenshot: lastEntityScreenshot ? new Date(lastEntityScreenshot).toISOString() : 'none',
                    timeSinceLast: lastEntityScreenshot ? `${Math.round((now - lastEntityScreenshot) / 1000)}s` : 'N/A',
                    cooldownPeriod: `${PER_ENTITY_COOLDOWN / 1000}s`,
                    allTrackedEntities: Array.from(entityLastScreenshotTime.current.keys())
                });

                if (lastEntityScreenshot && (now - lastEntityScreenshot) < PER_ENTITY_COOLDOWN) {
                    const remainingCooldown = PER_ENTITY_COOLDOWN - (now - lastEntityScreenshot);
                    console.log(
                        `[Renderer] ⏱️ Per-entity cooldown active for "${entityKey}" ` +
                        `(${Math.round(remainingCooldown / 1000)}s remaining), skipping ${reason}`
                    );
                    return null;
                }
            }

            console.log(`[Renderer] 📸 Taking screenshot: ${reason} for ${currentWindow.appName}/${currentWindow.windowTitle}`);

            try {
                // @ts-ignore
                const path = await window.electron.ipcRenderer.captureScreenshot(
                    currentWindow ? {
                        appName: currentWindow.appName,
                        windowTitle: currentWindow.windowTitle,
                        bundleId: currentWindow.bundleId || '',
                        pid: currentWindow.pid || 0
                    } : undefined
                );
                if (!path) {
                    console.log('[Renderer] ❌ Screenshot capture failed - no path returned');
                    return null;
                }

                console.log('[Renderer] ✅ Screenshot captured:', path.split('/').pop());
                
                // Add to current activity screenshots
                if (!currentActivityScreenshots.current.includes(path)) {
                    currentActivityScreenshots.current.push(path);
                    lastScreenshotTime.current = now;
                    console.log('[Renderer] 📁 Screenshot added. Total:', currentActivityScreenshots.current.length);

                    // Start AI analysis
                    analyzeScreenshotAsync(path, now);

                    // Update per-entity cooldown timestamp
                    if (currentWindow) {
                        const entityKey = getScreenshotCooldownKey(
                            currentWindow.appName,
                            currentWindow.windowTitle,
                            currentWindow.bundleId
                        );
                        entityLastScreenshotTime.current.set(entityKey, now);
                        console.log(`[Renderer] ✅ Cooldown set for "${entityKey}" at ${new Date(now).toISOString()}`);
                    }
                } else {
                    console.log('[Renderer] ⚠️ Duplicate screenshot path, skipping');
                }

                return path;
            } catch (error) {
                console.error('[Renderer] ❌ Screenshot capture error:', error);
                return null;
            }
        };

        // Process a single analysis result and update state
        const handleAnalysisResult = (
            path: string,
            analysisResult: { success: boolean; description?: string; confidence?: number; detectedText?: string[]; objects?: string[]; extraction?: any; error?: string; isRateLimited?: boolean } | null
        ) => {
            if (analysisResult?.success && analysisResult.description) {
                // Success - reset failure tracking
                consecutiveFailures.current = 0;

                // Store in refs (always - this ensures data is captured even if activity not in state yet)
                currentActivityScreenshotDescriptions.current[path] = analysisResult.description;
                currentActivityScreenshotVisionData.current[path] = {
                    confidence: analysisResult.confidence,
                    detectedText: analysisResult.detectedText,
                    objects: analysisResult.objects,
                    extraction: analysisResult.extraction
                };

                console.log('[Renderer] ✅ AI analysis completed:', {
                    file: path.split('/').pop(),
                    confidence: analysisResult.confidence,
                    descriptionLength: analysisResult.description.length,
                    hasExtraction: !!analysisResult.extraction
                });

                // Notify context that analysis completed successfully
                completeAnalysis(path);

                // Also update windowActivity state to trigger re-render (if activity exists in state)
                setWindowActivity(prev => {
                    // Find if this screenshot belongs to any existing activity
                    return prev.map(activity => {
                        if (activity.screenshotPaths?.includes(path)) {
                            const existingDescriptions = activity.screenshotDescriptions || {};
                            const newDescriptions: { [path: string]: string } = Object.assign(
                                {},
                                existingDescriptions,
                                { [path]: analysisResult.description }
                            );

                            // Store raw Vision Framework data
                            const existingVisionData = activity.screenshotVisionData || {};
                            const newVisionData: { [path: string]: VisionFrameworkRawData } = Object.assign(
                                {},
                                existingVisionData,
                                { [path]: {
                                    confidence: analysisResult.confidence,
                                    detectedText: analysisResult.detectedText,
                                    objects: analysisResult.objects,
                                    extraction: analysisResult.extraction
                                }}
                            );

                            return {
                                ...activity,
                                screenshotDescriptions: newDescriptions,
                                screenshotVisionData: newVisionData
                            };
                        }
                        return activity;
                    });
                });
            } else {
                // Track consecutive failures
                consecutiveFailures.current++;
                console.log(`[Renderer] ⚠️ AI analysis failed (consecutive failures: ${consecutiveFailures.current})`, analysisResult);

                // Check if this is an auth error
                const errorMsg = analysisResult?.error || 'Analysis failed';
                if (errorMsg.toLowerCase().includes('not authenticated') ||
                    errorMsg.toLowerCase().includes('session expired') ||
                    errorMsg.toLowerCase().includes('sign in')) {
                    console.error('[Renderer] ❌ AI analysis failed due to authentication issue');
                    console.error('[Renderer] User needs to sign in from Settings to enable AI features');
                }

                // Check if this is a permanent error (subscription, auth) that won't resolve by retrying
                const isPermanentError = errorMsg.toLowerCase().includes('premium subscription') ||
                    errorMsg.toLowerCase().includes('upgrade to access') ||
                    errorMsg.toLowerCase().includes('not authenticated') ||
                    errorMsg.toLowerCase().includes('session expired');

                if (isPermanentError) {
                    analysisPermDisabled.current = true;
                    console.log(`[Renderer] 🛑 Analysis permanently disabled for this session: ${errorMsg}`);
                }

                // Check if this looks like a rate limit error
                const isRateLimited = analysisResult?.isRateLimited ||
                    errorMsg.toLowerCase().includes('rate limit') ||
                    errorMsg.toLowerCase().includes('429') ||
                    errorMsg.toLowerCase().includes('too many requests');

                // Pause queue if too many consecutive failures
                if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES_BEFORE_PAUSE) {
                    queuePausedUntil.current = Date.now() + QUEUE_PAUSE_DURATION_MS;
                    console.log(`[Renderer] ⏸️ Pausing queue for ${QUEUE_PAUSE_DURATION_MS / 1000}s after ${consecutiveFailures.current} consecutive failures`);
                } else if (isRateLimited) {
                    // Add a shorter delay for rate limit errors even before max failures
                    const delayMs = FAILURE_BACKOFF_BASE_MS * Math.pow(2, consecutiveFailures.current - 1);
                    queuePausedUntil.current = Date.now() + delayMs;
                    console.log(`[Renderer] ⏳ Rate limited, adding ${delayMs}ms delay before next request`);
                }

                // Notify context that analysis failed
                failAnalysis(path, errorMsg);

                currentActivityScreenshotDescriptions.current[path] = FALLBACK_SCREENSHOT_DESCRIPTION;

                // Update state with fallback description
                setWindowActivity(prev => {
                    return prev.map(activity => {
                        if (activity.screenshotPaths?.includes(path)) {
                            const existingDescriptions = activity.screenshotDescriptions || {};
                            const newDescriptions: { [path: string]: string } = Object.assign(
                                {},
                                existingDescriptions,
                                { [path]: FALLBACK_SCREENSHOT_DESCRIPTION }
                            );
                            return {
                                ...activity,
                                screenshotDescriptions: newDescriptions
                            };
                        }
                        return activity;
                    });
                });
            }
        };

        // Flush the pending batch and process all items
        const flushBatch = async () => {
            // Clear the timeout
            if (batchTimeoutRef.current) {
                clearTimeout(batchTimeoutRef.current);
                batchTimeoutRef.current = null;
            }

            // Get the items to process
            const itemsToProcess = [...pendingBatch.current];
            pendingBatch.current = [];

            if (itemsToProcess.length === 0) {
                return;
            }

            // Check if queue is paused due to rate limiting
            const now = Date.now();
            if (queuePausedUntil.current > now) {
                const remainingPause = Math.ceil((queuePausedUntil.current - now) / 1000);
                console.log(`[Renderer] ⏸️ Queue paused for ${remainingPause}s due to rate limiting`);
                // Re-queue items and schedule retry
                pendingBatch.current.push(...itemsToProcess);
                batchTimeoutRef.current = setTimeout(() => flushBatch(), queuePausedUntil.current - now + 100);
                return;
            }

            // Check if already processing a batch
            if (isBatchProcessing.current) {
                console.log('[Renderer] 🚦 Batch processing already in progress, re-queuing items');
                pendingBatch.current.push(...itemsToProcess);
                return;
            }

            isBatchProcessing.current = true;
            activeAnalysisCount.current++;

            console.log(`[Renderer] 📦 Processing batch of ${itemsToProcess.length} screenshots`);

            // Notify context that analyses are starting
            for (const item of itemsToProcess) {
                startAnalysis(item.path);
            }

            // Create a combined promise for the batch
            const batchPromise = (async () => {
                try {
                    // Prepare batch inputs
                    const batchInputs = itemsToProcess.map(item => ({
                        imagePath: item.path,
                        requestId: `${item.timestamp}`
                    }));

                    // @ts-ignore
                    const batchResult = await window.electron.ipcRenderer.analyzeScreenshotBatch(batchInputs);

                    if (batchResult?.results) {
                        // Process each result
                        for (let i = 0; i < itemsToProcess.length; i++) {
                            const item = itemsToProcess[i];
                            const result = batchResult.results[i];

                            handleAnalysisResult(item.path, result);

                            // Remove from pending analyses
                            pendingAnalyses.current.delete(item.path);
                        }
                    } else {
                        // Batch call failed entirely
                        console.error('[Renderer] ❌ Batch analysis failed:', batchResult?.error);
                        for (const item of itemsToProcess) {
                            handleAnalysisResult(item.path, { success: false, error: batchResult?.error || 'Batch analysis failed' });
                            pendingAnalyses.current.delete(item.path);
                        }
                    }
                } catch (error) {
                    // Track consecutive failures for network errors too
                    consecutiveFailures.current++;
                    console.error(`[Renderer] ❌ Batch AI analysis error (consecutive failures: ${consecutiveFailures.current}):`, error);

                    // Pause queue if too many consecutive failures
                    if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES_BEFORE_PAUSE) {
                        queuePausedUntil.current = Date.now() + QUEUE_PAUSE_DURATION_MS;
                        console.log(`[Renderer] ⏸️ Pausing queue for ${QUEUE_PAUSE_DURATION_MS / 1000}s after ${consecutiveFailures.current} consecutive failures`);
                    }

                    // Handle error for all items in batch
                    for (const item of itemsToProcess) {
                        failAnalysis(item.path, error instanceof Error ? error.message : 'Unknown error');
                        currentActivityScreenshotDescriptions.current[item.path] = FALLBACK_SCREENSHOT_DESCRIPTION;
                        pendingAnalyses.current.delete(item.path);

                        setWindowActivity(prev => {
                            return prev.map(activity => {
                                if (activity.screenshotPaths?.includes(item.path)) {
                                    const existingDescriptions = activity.screenshotDescriptions || {};
                                    const newDescriptions: { [path: string]: string } = Object.assign(
                                        {},
                                        existingDescriptions,
                                        { [item.path]: FALLBACK_SCREENSHOT_DESCRIPTION }
                                    );
                                    return {
                                        ...activity,
                                        screenshotDescriptions: newDescriptions
                                    };
                                }
                                return activity;
                            });
                        });
                    }
                } finally {
                    activeAnalysisCount.current--;
                    isBatchProcessing.current = false;
                    console.log(`[Renderer] 🏁 Batch completed (pending: ${pendingBatch.current.length})`);

                    // Process any items that accumulated while we were processing
                    if (pendingBatch.current.length >= SESSION_BATCH_SIZE) {
                        flushBatch();
                    } else if (pendingBatch.current.length > 0) {
                        // Restart the timeout for remaining items
                        batchTimeoutRef.current = setTimeout(() => flushBatch(), SESSION_BATCH_TIMEOUT_MS);
                    }
                }
            })();

            // Track the batch promise for all items
            for (const item of itemsToProcess) {
                pendingAnalyses.current.set(item.path, batchPromise);
            }
        };

        const analyzeScreenshotAsync = (path: string, timestamp: number) => {
            // Skip analysis entirely if permanently disabled (subscription/auth error)
            if (analysisPermDisabled.current) {
                currentActivityScreenshotDescriptions.current[path] = FALLBACK_SCREENSHOT_DESCRIPTION;
                return;
            }

            console.log(`[Renderer] 📥 Queuing AI analysis for batch: ${path.split('/').pop()}`);

            // Add to pending batch
            pendingBatch.current.push({ path, timestamp });

            // Check if batch is full
            if (pendingBatch.current.length >= SESSION_BATCH_SIZE) {
                console.log(`[Renderer] 📦 Batch full (${pendingBatch.current.length}/${SESSION_BATCH_SIZE}), flushing...`);
                flushBatch();
            } else {
                // Start or restart the timeout
                if (batchTimeoutRef.current) {
                    clearTimeout(batchTimeoutRef.current);
                }
                batchTimeoutRef.current = setTimeout(() => {
                    console.log(`[Renderer] ⏰ Batch timeout (${pendingBatch.current.length} items), flushing...`);
                    flushBatch();
                }, SESSION_BATCH_TIMEOUT_MS);
            }
        };

        const pollWindow = async () => {
            // Prevent concurrent polling
            if (pollingActiveRef.current) {
                console.log('[Renderer] 🔄 Polling already active, skipping');
                return;
            }
            pollingActiveRef.current = true;

            try {
                // @ts-ignore
                if (!window.electron?.ipcRenderer?.getActiveWindow) {
                    console.error('[Renderer] ❌ CRITICAL: getActiveWindow not available - IPC bridge may not be loaded');
                    // @ts-ignore
                    console.error('[Renderer] window.electron:', window.electron);
                    return;
                }

                // @ts-ignore
                const result = await window.electron.ipcRenderer.getActiveWindow();
                const now = Date.now();
                console.log('[Renderer] pollWindow result:', result);

                // Check if the app is blacklisted
                if (result.bundleId) {
                    try {
                        // @ts-ignore
                        const blacklistCheck = await window.electron.ipcRenderer.appBlacklist.isAppBlacklisted(result.bundleId);
                        if (blacklistCheck?.success && blacklistCheck.isBlacklisted) {
                            console.log(`[Renderer] App is blacklisted (${result.appName}, ${result.bundleId}), skipping activity tracking`);
                            return;
                        }
                    } catch (error) {
                        console.error('[Renderer] Failed to check blacklist, continuing with tracking:', error);
                        // Continue with tracking even if blacklist check fails
                    }
                }

                // Check if window changed significantly (new activity vs minor title update)
                const titleChanged = !lastWindowRef.current ||
                    lastWindowRef.current.appName !== result.appName ||
                    lastWindowRef.current.windowTitle !== result.windowTitle;

                const significantChange = isSignificantWindowChange(lastWindowRef.current, result);

                // Debug: Log window change evaluation
                if (titleChanged || significantChange) {
                    console.log('[Renderer] 🔄 Window change evaluation:', {
                        titleChanged,
                        significantChange,
                        lastApp: lastWindowRef.current?.appName || 'none',
                        lastTitle: lastWindowRef.current?.windowTitle || 'none',
                        newApp: result.appName,
                        newTitle: result.windowTitle,
                        newBundleId: result.bundleId
                    });
                }

                if (titleChanged && !significantChange && lastWindowRef.current) {
                    // Minor title change (e.g., "Camera active" suffix in Google Meet)
                    // Update the title in the ref but don't create a new activity
                    console.log('[Renderer] Minor title change (same activity):', {
                        from: lastWindowRef.current.windowTitle,
                        to: result.windowTitle
                    });
                    lastWindowRef.current.windowTitle = result.windowTitle;
                }

                if (significantChange) {
                    console.log('[Renderer] Significant window change detected:', {
                        from: lastWindowRef.current,
                        to: result
                    });

                    // Save previous activity if it existed
                    if (lastWindowRef.current) {
                        // Collect vision data from BOTH the ref AND state
                        // The ref contains data from analysis that completed before activity was in state
                        const visionDataForActivity: { [path: string]: VisionFrameworkRawData } = {
                            ...currentActivityScreenshotVisionData.current
                        };

                        // Also check state for any vision data that was stored there
                        setWindowActivity(prev => {
                            // Find if this activity already exists in state with vision data
                            const existingActivity = prev.find(act =>
                                act.appName === lastWindowRef.current!.appName &&
                                act.windowTitle === lastWindowRef.current!.windowTitle &&
                                act.timestamp === lastWindowRef.current!.timestamp
                            );

                            // Merge vision data from state (state takes precedence)
                            if (existingActivity?.screenshotVisionData) {
                                Object.assign(visionDataForActivity, existingActivity.screenshotVisionData);
                            }

                            return prev;
                        });

                        const newActivity = {
                            appName: lastWindowRef.current.appName,
                            windowTitle: lastWindowRef.current.windowTitle,
                            bundleId: lastWindowRef.current.bundleId,
                            browserProfile: lastWindowRef.current.browserProfile || undefined,
                            timestamp: lastWindowRef.current.timestamp,
                            duration: 0, // Will be calculated properly on stop
                            screenshotPaths: currentActivityScreenshots.current.length > 0 ? [...currentActivityScreenshots.current] : undefined,
                            screenshotDescriptions: Object.keys(currentActivityScreenshotDescriptions.current).length > 0 ? { ...currentActivityScreenshotDescriptions.current } : undefined,
                            screenshotVisionData: Object.keys(visionDataForActivity).length > 0 ? visionDataForActivity : undefined
                        };

                        console.log('[Renderer] Saving previous activity with screenshots:', {
                            app: newActivity.appName,
                            screenshotCount: currentActivityScreenshots.current.length,
                            visionDataCount: Object.keys(visionDataForActivity).length,
                            descriptionsCount: Object.keys(currentActivityScreenshotDescriptions.current).length
                        });

                        setWindowActivity(prev => consolidateActivities([...prev, newActivity]));
                    }

                    // Reset for new activity
                    currentActivityScreenshots.current = [];
                    currentActivityScreenshotDescriptions.current = {};
                    currentActivityScreenshotVisionData.current = {};
                    lastScreenshotTime.current = 0;

                    // Update to new window
                    const detectedProfile = result.bundleId ? extractBrowserProfile(result.windowTitle, result.bundleId) : null;
                    lastWindowRef.current = {
                        appName: result.appName,
                        windowTitle: result.windowTitle,
                        bundleId: result.bundleId,
                        pid: result.pid,
                        browserProfile: detectedProfile || undefined,
                        timestamp: now
                    };

                    // Take screenshot for window change (immediate)
                    await captureScreenshotForCurrentWindow('window-change');

                    // Reset the interval timer for this new window (every 2 minutes)
                    if (screenshotIntervalRef.current) {
                        clearInterval(screenshotIntervalRef.current);
                    }
                    screenshotIntervalRef.current = setInterval(async () => {
                        await captureScreenshotForCurrentWindow('interval-2min', true);
                    }, INTERVAL_SCREENSHOT_TIME);

                } else {
                    // Same activity - don't update timestamp!
                    // The timestamp represents when this activity STARTED, not the current poll time.
                    // Updating it would make all activities artificially short.
                    // We just continue tracking the same activity without creating a new one.
                    // (Minor title changes are handled above - same activity, different title)
                }
            } catch (error) {
                console.error('[Renderer] Error in pollWindow:', error);
            } finally {
                pollingActiveRef.current = false;
            }
        };

        if (isRunning && !isPaused && startTime) {
            intervalRef.current = setInterval(() => {
                setElapsed(Date.now() - startTime);
            }, 100);

            // Start window polling immediately, then continue every interval
            pollWindow();
            windowPollRef.current = setInterval(pollWindow, WINDOW_POLL_INTERVAL);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            if (windowPollRef.current) {
                clearInterval(windowPollRef.current);
            }
            if (screenshotIntervalRef.current) {
                clearInterval(screenshotIntervalRef.current);
                screenshotIntervalRef.current = null;
            }
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current);
            if (windowPollRef.current) clearInterval(windowPollRef.current);
        };
    }, [isRunning, isPaused, startTime, settings.screenshotCooldown]); // Note: windowActivity intentionally excluded to prevent interval thrashing

    const checkPermissions = useCallback(async (): Promise<PermissionCheckResult> => {
        try {
            // Check screen recording permission
            // @ts-ignore
            const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
            const hasScreenRecording = screenStatus === 'granted';

            // Check accessibility permission using proper macOS API
            // @ts-ignore
            const accessibilityStatus = await window.electron.ipcRenderer.checkAccessibilityPermission();
            const hasAccessibility = accessibilityStatus === 'granted';

            console.log('[Timer] Permission check:', { hasAccessibility, hasScreenRecording, accessibilityStatus, screenStatus });

            return {
                hasAccessibility,
                hasScreenRecording,
                requiredGranted: hasAccessibility,  // Only accessibility is required
                allGranted: hasAccessibility && hasScreenRecording
            };
        } catch (error) {
            console.error('[Timer] Error checking permissions:', error);
            return {
                hasAccessibility: false,
                hasScreenRecording: false,
                requiredGranted: false,
                allGranted: false
            };
        }
    }, []);

    const start = useCallback(() => {
        setIsRunning(true);
        setIsPaused(false);
        // Use callback form to get current elapsed value without it being a dependency
        setElapsed(currentElapsed => {
            // If starting fresh (not resuming), start from 0
            if (currentElapsed === 0) {
                setStartTime(Date.now());
            } else {
                // Resuming - adjust start time to account for elapsed
                setStartTime(Date.now() - currentElapsed);
            }
            return currentElapsed;
        });
        setWindowActivity([]); // Clear previous activity
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        currentActivityScreenshotDescriptions.current = {}; // Reset descriptions
        currentActivityScreenshotVisionData.current = {}; // Reset vision data
        lastScreenshotTime.current = 0; // Reset screenshot timing
        entityLastScreenshotTime.current.clear(); // Clear per-entity cooldowns
        pendingAnalyses.current.clear(); // Clear any pending analyses from previous session
        analysisQueue.current = []; // Clear analysis queue
        activeAnalysisCount.current = 0; // Reset active count
        consecutiveFailures.current = 0; // Reset failure tracking
        queuePausedUntil.current = 0; // Clear any queue pause
        analysisPermDisabled.current = false; // Allow analysis for new session
        pendingBatch.current = []; // Clear pending batch
        isBatchProcessing.current = false; // Reset batch processing flag
        if (batchTimeoutRef.current) {
            clearTimeout(batchTimeoutRef.current);
            batchTimeoutRef.current = null;
        }
    }, []);

    // Store state values in refs for use in memoized callbacks without dependencies
    const startTimeRef = useRef<number | null>(null);
    const windowActivityRef = useRef<WindowActivity[]>([]);
    useEffect(() => {
        startTimeRef.current = startTime;
    }, [startTime]);
    useEffect(() => {
        windowActivityRef.current = windowActivity;
    }, [windowActivity]);

    // Store isRunning and isPaused in refs for callbacks
    const isRunningRef = useRef(false);
    const isPausedRef = useRef(false);
    useEffect(() => {
        isRunningRef.current = isRunning;
        isPausedRef.current = isPaused;
    }, [isRunning, isPaused]);

    const pause = useCallback(() => {
        if (!isRunningRef.current || isPausedRef.current) return;
        setIsPaused(true);
        // Update elapsed time to current value when pausing
        const currentStartTime = startTimeRef.current;
        if (currentStartTime) {
            setElapsed(Date.now() - currentStartTime);
        }
    }, []);

    const resume = useCallback(() => {
        if (!isRunningRef.current || !isPausedRef.current) return;
        setIsPaused(false);
        // Adjust start time to account for elapsed time when resuming
        setElapsed(currentElapsed => {
            setStartTime(Date.now() - currentElapsed);
            return currentElapsed;
        });
    }, []);

    const stop = useCallback(async () => {
        setIsRunning(false);
        setIsPaused(false);
        const now = Date.now();

        // Flush any pending batch before finalizing
        if (pendingBatch.current.length > 0) {
            console.log(`[Renderer] 📦 Flushing ${pendingBatch.current.length} pending screenshots before stop...`);
            // Clear the batch timeout
            if (batchTimeoutRef.current) {
                clearTimeout(batchTimeoutRef.current);
                batchTimeoutRef.current = null;
            }
            // Process pending batch items
            const itemsToProcess = [...pendingBatch.current];
            pendingBatch.current = [];

            // Prepare batch inputs
            const batchInputs = itemsToProcess.map(item => ({
                imagePath: item.path,
                requestId: `${item.timestamp}`
            }));

            try {
                // Notify context that analyses are starting
                for (const item of itemsToProcess) {
                    startAnalysis(item.path);
                }

                // @ts-ignore
                const batchResult = await window.electron?.ipcRenderer?.analyzeScreenshotBatch(batchInputs);

                if (batchResult?.results) {
                    for (let i = 0; i < itemsToProcess.length; i++) {
                        const item = itemsToProcess[i];
                        const result = batchResult.results[i];

                        if (result?.success && result.description) {
                            currentActivityScreenshotDescriptions.current[item.path] = result.description;
                            currentActivityScreenshotVisionData.current[item.path] = {
                                confidence: result.confidence,
                                detectedText: result.detectedText,
                                objects: result.objects,
                                extraction: result.extraction
                            };
                            completeAnalysis(item.path);
                        } else {
                            currentActivityScreenshotDescriptions.current[item.path] = FALLBACK_SCREENSHOT_DESCRIPTION;
                            failAnalysis(item.path, result?.error || 'Analysis failed');
                        }
                    }
                } else {
                    // Batch failed, use fallbacks
                    for (const item of itemsToProcess) {
                        currentActivityScreenshotDescriptions.current[item.path] = FALLBACK_SCREENSHOT_DESCRIPTION;
                        failAnalysis(item.path, batchResult?.error || 'Batch analysis failed');
                    }
                }
            } catch (error) {
                console.error('[Renderer] Error flushing pending batch on stop:', error);
                for (const item of itemsToProcess) {
                    currentActivityScreenshotDescriptions.current[item.path] = FALLBACK_SCREENSHOT_DESCRIPTION;
                    failAnalysis(item.path, error instanceof Error ? error.message : 'Unknown error');
                }
            }
        }

        // Wait for all pending AI analyses to complete before finalizing (with timeout)
        const pendingCount = pendingAnalyses.current.size;
        if (pendingCount > 0) {
            console.log(`[Renderer] ⏳ Waiting for ${pendingCount} pending AI analyses to complete before stopping...`);

            // Create a timeout promise to prevent indefinite blocking
            const ANALYSIS_TIMEOUT_MS = 10000; // 10 seconds max wait
            const timeoutPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log('[Renderer] ⚠️ Analysis timeout reached, proceeding without waiting for all analyses');
                    resolve();
                }, ANALYSIS_TIMEOUT_MS);
            });

            // Race between analyses completing and timeout
            await Promise.race([
                Promise.all(Array.from(pendingAnalyses.current.values())),
                timeoutPromise
            ]);

            console.log('[Renderer] ✅ Analysis wait completed');
        }

        const finalActivity = calculateFinalActivities(now);

        // Reset elapsed time to zero after stopping
        setElapsed(0);
        setStartTime(null);

        return finalActivity;
    }, []);

    const filterShortActivities = (activities: WindowActivity[]): WindowActivity[] => {
        const { minActivityDuration, activityGapThreshold } = settings;
        
        // Sort activities by timestamp to process in chronological order
        const sortedActivities = [...activities].sort((a, b) => a.timestamp - b.timestamp);
        const filteredActivities: WindowActivity[] = [];
        
        for (let i = 0; i < sortedActivities.length; i++) {
            const activity = sortedActivities[i];
            
            // If the activity duration meets the minimum threshold, keep it
            if (activity.duration >= minActivityDuration) {
                filteredActivities.push(activity);
                continue;
            }
            
            // For short activities, check if there's a nearby activity from the same app
            const hasNearbyActivity = sortedActivities.some((otherActivity, j) => {
                if (i === j) return false; // Don't compare with itself
                
                // Same app name
                if (otherActivity.appName !== activity.appName) return false;
                
                // Check if the other activity is within the gap threshold
                const timeDifference = Math.abs(otherActivity.timestamp - activity.timestamp);
                return timeDifference <= activityGapThreshold;
            });
            
            // Keep the short activity only if there's a nearby activity from the same app
            if (hasNearbyActivity) {
                filteredActivities.push(activity);
                console.log(`[Timer] Keeping short activity (${activity.duration}ms) for ${activity.appName} due to nearby activity`);
            } else {
                console.log(`[Timer] Filtering out short activity (${activity.duration}ms) for ${activity.appName} - no nearby activities`);
            }
        }
        
        return filteredActivities;
    };
    
    const calculateFinalActivities = (now: number) => {
        const currentStartTime = startTimeRef.current;
        const currentWindowActivity = windowActivityRef.current;

        if (!currentStartTime) {
            console.log('[Renderer] No start time available for activity calculation');
            return currentWindowActivity;
        }

        // Build complete timeline of activities
        let activities: WindowActivity[] = [...currentWindowActivity];

        // Add the current/final activity if it exists
        if (lastWindowRef.current) {
            // Check if we already have this activity in windowActivity state
            // (it would have been added with descriptions via setWindowActivity updates)
            const existingActivityIndex = activities.findIndex(act =>
                act.appName === lastWindowRef.current!.appName &&
                act.windowTitle === lastWindowRef.current!.windowTitle &&
                act.timestamp === lastWindowRef.current!.timestamp
            );

            if (existingActivityIndex >= 0) {
                // Activity already exists in state with potential AI descriptions
                // Merge in any additional screenshots from the ref that might not be in state yet
                const existingActivity = activities[existingActivityIndex];
                const allScreenshotPaths = [
                    ...(existingActivity.screenshotPaths || []),
                    ...currentActivityScreenshots.current.filter(path =>
                        !existingActivity.screenshotPaths?.includes(path)
                    )
                ];

                // Merge descriptions - state descriptions take precedence (they're from completed AI analysis)
                const allDescriptions = {
                    ...currentActivityScreenshotDescriptions.current,
                    ...(existingActivity.screenshotDescriptions || {})
                };

                // Merge vision data - include both ref and state (state takes precedence)
                const allVisionData = {
                    ...currentActivityScreenshotVisionData.current,
                    ...(existingActivity.screenshotVisionData || {})
                };

                console.log('[Renderer] Merging final activity with state:', {
                    app: existingActivity.appName,
                    screenshotsInState: existingActivity.screenshotPaths?.length || 0,
                    screenshotsInRef: currentActivityScreenshots.current.length,
                    descriptionsInState: Object.keys(existingActivity.screenshotDescriptions || {}).length,
                    descriptionsInRef: Object.keys(currentActivityScreenshotDescriptions.current).length,
                    totalDescriptions: Object.keys(allDescriptions).length,
                    visionDataInState: Object.keys(existingActivity.screenshotVisionData || {}).length,
                    visionDataInRef: Object.keys(currentActivityScreenshotVisionData.current).length,
                    totalVisionData: Object.keys(allVisionData).length
                });

                activities[existingActivityIndex] = {
                    ...existingActivity,
                    screenshotPaths: allScreenshotPaths.length > 0 ? allScreenshotPaths : undefined,
                    screenshotDescriptions: Object.keys(allDescriptions).length > 0 ? allDescriptions : undefined,
                    screenshotVisionData: Object.keys(allVisionData).length > 0 ? allVisionData : undefined
                };
            } else {
                // Activity not in state yet, add it
                console.log('[Renderer] Adding final activity from ref:', {
                    app: lastWindowRef.current.appName,
                    screenshots: currentActivityScreenshots.current.length,
                    descriptions: Object.keys(currentActivityScreenshotDescriptions.current).length,
                    visionData: Object.keys(currentActivityScreenshotVisionData.current).length
                });

                activities.push({
                    appName: lastWindowRef.current.appName,
                    windowTitle: lastWindowRef.current.windowTitle,
                    bundleId: lastWindowRef.current.bundleId,
                    timestamp: lastWindowRef.current.timestamp,
                    duration: 0, // Will be calculated below
                    screenshotPaths: currentActivityScreenshots.current.length > 0 ? [...currentActivityScreenshots.current] : undefined,
                    screenshotDescriptions: Object.keys(currentActivityScreenshotDescriptions.current).length > 0 ? { ...currentActivityScreenshotDescriptions.current } : undefined,
                    screenshotVisionData: Object.keys(currentActivityScreenshotVisionData.current).length > 0 ? { ...currentActivityScreenshotVisionData.current } : undefined
                });
            }
        }
        
        // Calculate durations based on complete timeline
        let finalActivity: WindowActivity[] = [];
        
        if (activities.length === 0) {
            console.log('[Renderer] No activities recorded during timer session');
        } else {
            // Sort activities by timestamp to ensure proper order
            activities.sort((a, b) => a.timestamp - b.timestamp);
            
            // Calculate durations: each activity lasts until the next one starts (or until timer end)
            for (let i = 0; i < activities.length; i++) {
                const activity = activities[i];
                const nextActivity = activities[i + 1];
                
                // Duration is from this activity start to next activity start (or session end)
                const activityStart = activity.timestamp;
                const activityEnd = nextActivity ? nextActivity.timestamp : now;
                const duration = activityEnd - activityStart;
                
                finalActivity.push({
                    ...activity,
                    duration: duration
                });
                
                console.log(`[Renderer] Activity ${i}: ${activity.appName} - ${activity.windowTitle} (${duration}ms)`);
            }
            
            // Adjust first activity to start exactly at timer start time
            if (finalActivity.length > 0) {
                const firstActivity = finalActivity[0];
                const firstActivityOriginalStart = firstActivity.timestamp;

                if (firstActivityOriginalStart > currentStartTime) {
                    // There was time before first activity was detected - extend backward
                    const preActivityTime = firstActivityOriginalStart - currentStartTime;
                    finalActivity[0] = {
                        ...firstActivity,
                        timestamp: currentStartTime,
                        duration: firstActivity.duration + preActivityTime
                    };
                    console.log(`[Renderer] Extended first activity backward by ${preActivityTime}ms to cover full timer duration`);
                } else if (firstActivityOriginalStart < currentStartTime) {
                    // First activity started before timer (shouldn't happen but handle it)
                    finalActivity[0] = {
                        ...firstActivity,
                        timestamp: currentStartTime,
                        duration: Math.max(0, firstActivity.duration - (currentStartTime - firstActivityOriginalStart))
                    };
                    console.log('[Renderer] Adjusted first activity to start at timer start time');
                }
            }
        }

        const totalCalculated = finalActivity.reduce((sum, act) => sum + act.duration, 0);
        const totalExpected = now - currentStartTime;
        console.log(`[Renderer] Timer stop - Expected duration: ${totalExpected}ms, Calculated duration: ${totalCalculated}ms, Difference: ${Math.abs(totalExpected - totalCalculated)}ms`);
        
        // Apply activity filtering
        const filteredActivity = filterShortActivities(finalActivity);
        console.log(`[Timer] Activity filtering: ${finalActivity.length} activities before filtering, ${filteredActivity.length} after filtering`);
        
        setWindowActivity(filteredActivity);
        lastWindowRef.current = null;
        currentActivityScreenshots.current = [];
        currentActivityScreenshotDescriptions.current = {};
        currentActivityScreenshotVisionData.current = {};
        return filteredActivity;
    };

    const reset = useCallback(() => {
        setIsRunning(false);
        setIsPaused(false);
        setElapsed(0);
        setStartTime(null);
        setWindowActivity([]);
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        currentActivityScreenshotDescriptions.current = {}; // Reset descriptions
        currentActivityScreenshotVisionData.current = {}; // Reset vision data
        lastScreenshotTime.current = 0; // Reset screenshot timing
        entityLastScreenshotTime.current.clear(); // Clear per-entity cooldowns
        pendingAnalyses.current.clear(); // Clear pending analyses
        analysisQueue.current = []; // Clear analysis queue
        activeAnalysisCount.current = 0; // Reset active count
        consecutiveFailures.current = 0; // Reset failure tracking
        queuePausedUntil.current = 0; // Clear any queue pause
        analysisPermDisabled.current = false; // Allow analysis for new session
        pendingBatch.current = []; // Clear pending batch
        isBatchProcessing.current = false; // Reset batch processing flag
        if (batchTimeoutRef.current) {
            clearTimeout(batchTimeoutRef.current);
            batchTimeoutRef.current = null;
        }
    }, []);

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    /**
     * Notify main process of active time entry for recording purposes.
     * Call this when a time entry is created/becomes active.
     * @param entryId The entry ID to set as active, or null to clear
     * @param forceStart If true, start recording immediately regardless of media detection (used for manual recording button)
     */
    const setActiveRecordingEntry = useCallback(async (entryId: string | null, forceStart: boolean = false): Promise<{ success: boolean; error?: string }> => {
        console.log('[Timer] ========================================');
        console.log('[Timer] setActiveRecordingEntry CALLED');
        console.log('[Timer] entryId:', entryId);
        console.log('[Timer] forceStart:', forceStart);
        console.log('[Timer] window.electron available:', !!window.electron);
        console.log('[Timer] meeting API available:', !!window.electron?.ipcRenderer?.meeting);
        console.log('[Timer] setActiveEntry function available:', !!window.electron?.ipcRenderer?.meeting?.setActiveEntry);
        console.log('[Timer] ========================================');

        // @ts-ignore
        if (window.electron?.ipcRenderer?.meeting?.setActiveEntry) {
            try {
                // @ts-ignore
                const result: { success: boolean; error?: string } = await window.electron.ipcRenderer.meeting.setActiveEntry(entryId, forceStart);
                console.log('[Timer] setActiveEntry IPC response:', result);
                return result;
            } catch (error) {
                console.error('[Timer] setActiveEntry IPC error:', error);
                return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
            }
        } else {
            console.error('[Timer] *** CRITICAL: setActiveEntry function not available! ***');
            return { success: false, error: 'setActiveEntry function not available' };
        }
    }, []);

    return { isRunning, isPaused, elapsed, windowActivity, start, stop, pause, resume, reset, formatTime, checkPermissions, setActiveRecordingEntry };
}
