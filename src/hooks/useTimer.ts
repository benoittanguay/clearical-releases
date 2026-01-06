import { useEffect, useState, useRef } from 'react';

export interface TimerState {
    isRunning: boolean;
    startTime: number | null;
    elapsed: number;
}

interface WindowActivity {
    appName: string;
    windowTitle: string;
    timestamp: number;
    duration: number;
}

export function useTimer() {
    const [isRunning, setIsRunning] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [windowActivity, setWindowActivity] = useState<WindowActivity[]>([]);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const windowPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastWindowRef = useRef<{ appName: string, windowTitle: string, timestamp: number } | null>(null);
    const currentActivityScreenshots = useRef<string[]>([]);
    const lastScreenshotTime = useRef<number>(0);

    // Load state from local storage on mount
    useEffect(() => {
        const stored = localStorage.getItem('timeportal-timer-state');
        if (stored) {
            const state: TimerState = JSON.parse(stored);
            setIsRunning(state.isRunning);
            setStartTime(state.startTime);
            setElapsed(state.elapsed);

            if (state.isRunning && state.startTime) {
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
        localStorage.setItem('timeportal-timer-state', JSON.stringify({ isRunning, startTime, elapsed }));
    }, [isRunning, startTime, elapsed]);

    useEffect(() => {
        const CAPTURE_INTERVAL = 5 * 60 * 1000; // 5 minutes
        const WINDOW_POLL_INTERVAL = 2 * 1000; // 2 seconds (increased from 10s for better tracking)
        let screenshotInterval: ReturnType<typeof setInterval>;

        const capture = async (reason = 'periodic') => {
            const now = Date.now();
            
            console.log('[Renderer] Screenshot capture triggered:', reason, 'at', new Date(now).toLocaleTimeString());

            // @ts-ignore
            if (window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.captureScreenshot) {
                try {
                    // @ts-ignore
                    const path = await window.electron.ipcRenderer.captureScreenshot();
                    console.log('[Renderer] Screenshot captured:', path);
                    if (path) {
                        // Check for duplicates before adding (same path shouldn't happen, but just in case)
                        if (!currentActivityScreenshots.current.includes(path)) {
                            currentActivityScreenshots.current.push(path);
                            lastScreenshotTime.current = now;
                            console.log('[Renderer] Screenshot added to current activity. Total screenshots:', currentActivityScreenshots.current.length);
                        } else {
                            console.log('[Renderer] Screenshot path already exists, skipping duplicate');
                        }
                    }
                } catch (error) {
                    console.error('[Renderer] Failed to capture screenshot:', error);
                }
            }
        };

        const pollWindow = async () => {
            // @ts-ignore
            if (window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.getActiveWindow) {
                // @ts-ignore
                const result = await window.electron.ipcRenderer.getActiveWindow();
                const now = Date.now();
                console.log('[Renderer] pollWindow result:', result);

                if (lastWindowRef.current) {
                    // If window changed, save the previous window's duration
                    if (lastWindowRef.current.appName !== result.appName || lastWindowRef.current.windowTitle !== result.windowTitle) {
                        const duration = now - lastWindowRef.current.timestamp;
                        console.log('[Renderer] Window changed! Saving activity:', {
                            from: lastWindowRef.current,
                            to: result,
                            duration
                        });

                        const newActivity = {
                            appName: lastWindowRef.current.appName,
                            windowTitle: lastWindowRef.current.windowTitle,
                            timestamp: lastWindowRef.current.timestamp,
                            duration,
                            screenshotPaths: currentActivityScreenshots.current.length > 0 ? [...currentActivityScreenshots.current] : undefined
                        };

                        console.log('[Renderer] Creating new activity with screenshots:', {
                            app: newActivity.appName,
                            screenshotCount: currentActivityScreenshots.current.length,
                            screenshotPaths: currentActivityScreenshots.current
                        });

                        setWindowActivity(prev => [...prev, newActivity]);

                        // Reset screenshot array for new activity
                        console.log('[Renderer] Resetting screenshot array for new activity');
                        currentActivityScreenshots.current = [];

                        // Reset screenshot timer on app switch
                        console.log('[Renderer] Resetting screenshot timer due to app switch');
                        if (screenshotInterval) {
                            clearInterval(screenshotInterval);
                        }
                        capture('app-switch'); // Take immediate screenshot on switch
                        screenshotInterval = setInterval(capture, CAPTURE_INTERVAL);
                    }
                }

                lastWindowRef.current = { ...result, timestamp: now };
            }
        };

        if (isRunning && startTime) {
            // Trigger immediately on start
            capture('timer-start');
            pollWindow();

            intervalRef.current = setInterval(() => {
                setElapsed(Date.now() - startTime);
            }, 100);

            screenshotInterval = setInterval(capture, CAPTURE_INTERVAL);
            windowPollRef.current = setInterval(pollWindow, WINDOW_POLL_INTERVAL);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            if (windowPollRef.current) {
                clearInterval(windowPollRef.current);
            }
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (screenshotInterval) clearInterval(screenshotInterval);
            if (windowPollRef.current) clearInterval(windowPollRef.current);
        };
    }, [isRunning, startTime, windowActivity]);

    const start = () => {
        setIsRunning(true);
        setStartTime(Date.now() - elapsed); // Resume or start fresh
        setWindowActivity([]); // Clear previous activity
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        lastScreenshotTime.current = 0; // Reset screenshot timing
    };

    const stop = () => {
        setIsRunning(false);
        // Finalize last window activity and return the complete array
        let finalActivity = windowActivity;
        if (lastWindowRef.current) {
            const now = Date.now();
            const duration = now - lastWindowRef.current.timestamp;
            finalActivity = [...windowActivity, {
                appName: lastWindowRef.current.appName,
                windowTitle: lastWindowRef.current.windowTitle,
                timestamp: lastWindowRef.current.timestamp,
                duration,
                screenshotPaths: currentActivityScreenshots.current.length > 0 ? [...currentActivityScreenshots.current] : undefined
            }];

            console.log('[Renderer] Creating final activity on stop with screenshots:', {
                app: lastWindowRef.current.appName,
                screenshotCount: currentActivityScreenshots.current.length,
                screenshotPaths: currentActivityScreenshots.current
            });
            setWindowActivity(finalActivity);
        }
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        return finalActivity;
    };

    const reset = () => {
        setIsRunning(false);
        setElapsed(0);
        setStartTime(null);
        setWindowActivity([]);
        lastWindowRef.current = null;
        currentActivityScreenshots.current = []; // Reset screenshots
        lastScreenshotTime.current = 0; // Reset screenshot timing
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    return { isRunning, elapsed, windowActivity, start, stop, reset, formatTime };
}
