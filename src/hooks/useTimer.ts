import { useEffect, useState, useRef } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useScreenshotAnalysis } from '../context/ScreenshotAnalysisContext';

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

export interface PermissionCheckResult {
    hasAccessibility: boolean;
    hasScreenRecording: boolean;
    allGranted: boolean;
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
    const lastWindowRef = useRef<{ appName: string, windowTitle: string, bundleId?: string, timestamp: number } | null>(null);
    const currentActivityScreenshots = useRef<string[]>([]);
    const currentActivityScreenshotDescriptions = useRef<{ [path: string]: string }>({});
    const currentActivityScreenshotVisionData = useRef<{ [path: string]: VisionFrameworkRawData }>({});
    const lastScreenshotTime = useRef<number>(0);
    const pollingActiveRef = useRef<boolean>(false);
    const pendingAnalyses = useRef<Map<string, Promise<void>>>(new Map());

    // Analysis queue for concurrency limiting
    const analysisQueue = useRef<Array<{path: string, timestamp: number}>>([]);
    const activeAnalysisCount = useRef<number>(0);
    const MAX_CONCURRENT_ANALYSES = 3;

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

        const captureScreenshotForCurrentWindow = async (reason: string) => {
            const now = Date.now();
            const currentWindow = lastWindowRef.current;
            
            if (!currentWindow) {
                console.log('[Renderer] ❌ No current window info, skipping screenshot capture');
                return null;
            }

            // Prevent too frequent screenshots (minimum interval)
            if (lastScreenshotTime.current > 0 && (now - lastScreenshotTime.current) < MIN_SCREENSHOT_INTERVAL) {
                console.log(`[Renderer] ⏱️ Too soon since last screenshot (${now - lastScreenshotTime.current}ms ago), skipping ${reason}`);
                return null;
            }

            console.log(`[Renderer] 📸 Taking screenshot: ${reason} for ${currentWindow.appName}/${currentWindow.windowTitle}`);

            try {
                // @ts-ignore
                const path = await window.electron.ipcRenderer.captureScreenshot();
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
                } else {
                    console.log('[Renderer] ⚠️ Duplicate screenshot path, skipping');
                }

                return path;
            } catch (error) {
                console.error('[Renderer] ❌ Screenshot capture error:', error);
                return null;
            }
        };

        const processNextAnalysis = () => {
            // Check if we can start another analysis
            if (activeAnalysisCount.current >= MAX_CONCURRENT_ANALYSES) {
                console.log(`[Renderer] 🚦 Max concurrent analyses (${MAX_CONCURRENT_ANALYSES}) reached, waiting...`);
                return;
            }

            // Get next item from queue
            const nextItem = analysisQueue.current.shift();
            if (!nextItem) {
                console.log('[Renderer] 📭 Analysis queue empty');
                return;
            }

            const { path, timestamp } = nextItem;
            console.log(`[Renderer] 🔍 Starting AI analysis for: ${path.split('/').pop()} (active: ${activeAnalysisCount.current + 1}/${MAX_CONCURRENT_ANALYSES}, queue: ${analysisQueue.current.length})`);

            // Increment active count
            activeAnalysisCount.current++;

            // Notify context that analysis is starting
            startAnalysis(path);

            // Create and track the promise
            const analysisPromise = (async () => {
                try {
                    // @ts-ignore
                    const analysisResult = await window.electron.ipcRenderer.analyzeScreenshot(path, `${timestamp}`);

                    if (analysisResult?.success && analysisResult.description) {
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
                        console.log('[Renderer] ⚠️ AI analysis failed, using fallback', analysisResult);

                        // Notify context that analysis failed
                        failAnalysis(path, analysisResult?.error || 'Analysis failed');

                        const fallbackDescription = 'Screenshot captured during work session';
                        currentActivityScreenshotDescriptions.current[path] = fallbackDescription;

                        // Update state with fallback description
                        setWindowActivity(prev => {
                            return prev.map(activity => {
                                if (activity.screenshotPaths?.includes(path)) {
                                    const existingDescriptions = activity.screenshotDescriptions || {};
                                    const newDescriptions: { [path: string]: string } = Object.assign(
                                        {},
                                        existingDescriptions,
                                        { [path]: fallbackDescription }
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
                } catch (error) {
                    console.error('[Renderer] ❌ AI analysis error:', error);

                    // Notify context that analysis encountered an error
                    failAnalysis(path, error instanceof Error ? error.message : 'Unknown error');

                    const fallbackDescription = 'Screenshot captured during work session';
                    currentActivityScreenshotDescriptions.current[path] = fallbackDescription;

                    // Update state with fallback description
                    setWindowActivity(prev => {
                        return prev.map(activity => {
                            if (activity.screenshotPaths?.includes(path)) {
                                const existingDescriptions = activity.screenshotDescriptions || {};
                                const newDescriptions: { [path: string]: string } = Object.assign(
                                    {},
                                    existingDescriptions,
                                    { [path]: fallbackDescription }
                                );
                                return {
                                    ...activity,
                                    screenshotDescriptions: newDescriptions
                                };
                            }
                            return activity;
                        });
                    });
                } finally {
                    // Decrement active count
                    activeAnalysisCount.current--;

                    // Remove from pending analyses when complete
                    pendingAnalyses.current.delete(path);

                    console.log(`[Renderer] 🏁 Analysis completed (active: ${activeAnalysisCount.current}/${MAX_CONCURRENT_ANALYSES}, queue: ${analysisQueue.current.length})`);

                    // Process next item in queue
                    processNextAnalysis();
                }
            })();

            // Store the promise
            pendingAnalyses.current.set(path, analysisPromise);
        };

        const analyzeScreenshotAsync = (path: string, timestamp: number) => {
            console.log(`[Renderer] 📥 Queuing AI analysis for: ${path.split('/').pop()}`);

            // Add to queue
            analysisQueue.current.push({ path, timestamp });

            // Try to process immediately
            processNextAnalysis();
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

                // Check if window changed
                const windowChanged = !lastWindowRef.current ||
                    lastWindowRef.current.appName !== result.appName ||
                    lastWindowRef.current.windowTitle !== result.windowTitle;

                if (windowChanged) {
                    console.log('[Renderer] Window change detected:', {
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

                        setWindowActivity(prev => [...prev, newActivity]);
                    }

                    // Reset for new activity
                    currentActivityScreenshots.current = [];
                    currentActivityScreenshotDescriptions.current = {};
                    currentActivityScreenshotVisionData.current = {};
                    lastScreenshotTime.current = 0;

                    // Update to new window
                    lastWindowRef.current = {
                        appName: result.appName,
                        windowTitle: result.windowTitle,
                        bundleId: result.bundleId,
                        timestamp: now
                    };

                    // Take screenshot for window change (immediate)
                    await captureScreenshotForCurrentWindow('window-change');

                    // Reset the interval timer for this new window (every 2 minutes)
                    if (screenshotIntervalRef.current) {
                        clearInterval(screenshotIntervalRef.current);
                    }
                    screenshotIntervalRef.current = setInterval(async () => {
                        await captureScreenshotForCurrentWindow('interval-2min');
                    }, INTERVAL_SCREENSHOT_TIME);

                } else {
                    // Same window - don't update timestamp!
                    // The timestamp represents when this activity STARTED, not the current poll time.
                    // Updating it would make all activities artificially short.
                    // We just continue tracking the same window without any action needed.
                    console.log('[Renderer] Same window, continuing activity tracking');
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
    }, [isRunning, isPaused, startTime]); // Note: windowActivity intentionally excluded to prevent interval thrashing

    const checkPermissions = async (): Promise<PermissionCheckResult> => {
        try {
            // Check screen recording permission
            // @ts-ignore
            const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
            const hasScreenRecording = screenStatus === 'granted';

            // Check accessibility permission by trying to get active window
            let hasAccessibility = false;
            try {
                // @ts-ignore
                await window.electron.ipcRenderer.getActiveWindow();
                hasAccessibility = true;
            } catch {
                hasAccessibility = false;
            }

            return {
                hasAccessibility,
                hasScreenRecording,
                allGranted: hasAccessibility && hasScreenRecording
            };
        } catch (error) {
            console.error('[Timer] Error checking permissions:', error);
            return {
                hasAccessibility: false,
                hasScreenRecording: false,
                allGranted: false
            };
        }
    };

    const start = () => {
        setIsRunning(true);
        setIsPaused(false);
        // If starting fresh (not resuming), start from 0
        if (elapsed === 0) {
            setStartTime(Date.now());
        } else {
            // Resuming - adjust start time to account for elapsed
            setStartTime(Date.now() - elapsed);
        }
        setWindowActivity([]); // Clear previous activity
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        currentActivityScreenshotDescriptions.current = {}; // Reset descriptions
        currentActivityScreenshotVisionData.current = {}; // Reset vision data
        lastScreenshotTime.current = 0; // Reset screenshot timing
        pendingAnalyses.current.clear(); // Clear any pending analyses from previous session
        analysisQueue.current = []; // Clear analysis queue
        activeAnalysisCount.current = 0; // Reset active count
    };

    const pause = () => {
        if (!isRunning || isPaused) return;
        setIsPaused(true);
        // Update elapsed time to current value when pausing
        if (startTime) {
            setElapsed(Date.now() - startTime);
        }
    };

    const resume = () => {
        if (!isRunning || !isPaused) return;
        setIsPaused(false);
        // Adjust start time to account for elapsed time when resuming
        if (startTime) {
            setStartTime(Date.now() - elapsed);
        }
    };

    const stop = async () => {
        setIsRunning(false);
        setIsPaused(false);
        const now = Date.now();

        // Wait for all pending AI analyses to complete before finalizing
        const pendingCount = pendingAnalyses.current.size;
        if (pendingCount > 0) {
            console.log(`[Renderer] ⏳ Waiting for ${pendingCount} pending AI analyses to complete before stopping...`);
            await Promise.all(Array.from(pendingAnalyses.current.values()));
            console.log('[Renderer] ✅ All AI analyses completed');
        }

        const finalActivity = calculateFinalActivities(now);

        // Reset elapsed time to zero after stopping
        setElapsed(0);
        setStartTime(null);

        return finalActivity;
    };

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
        if (!startTime) {
            console.log('[Renderer] No start time available for activity calculation');
            return windowActivity;
        }

        // Build complete timeline of activities
        let activities: WindowActivity[] = [...windowActivity];

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
                
                if (firstActivityOriginalStart > startTime) {
                    // There was time before first activity was detected - extend backward
                    const preActivityTime = firstActivityOriginalStart - startTime;
                    finalActivity[0] = {
                        ...firstActivity,
                        timestamp: startTime,
                        duration: firstActivity.duration + preActivityTime
                    };
                    console.log(`[Renderer] Extended first activity backward by ${preActivityTime}ms to cover full timer duration`);
                } else if (firstActivityOriginalStart < startTime) {
                    // First activity started before timer (shouldn't happen but handle it)
                    finalActivity[0] = {
                        ...firstActivity,
                        timestamp: startTime,
                        duration: Math.max(0, firstActivity.duration - (startTime - firstActivityOriginalStart))
                    };
                    console.log('[Renderer] Adjusted first activity to start at timer start time');
                }
            }
        }
        
        const totalCalculated = finalActivity.reduce((sum, act) => sum + act.duration, 0);
        const totalExpected = now - startTime;
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

    const reset = () => {
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
        pendingAnalyses.current.clear(); // Clear pending analyses
        analysisQueue.current = []; // Clear analysis queue
        activeAnalysisCount.current = 0; // Reset active count
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    return { isRunning, isPaused, elapsed, windowActivity, start, stop, pause, resume, reset, formatTime, checkPermissions };
}
