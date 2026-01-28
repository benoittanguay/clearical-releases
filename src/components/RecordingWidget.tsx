/**
 * Recording Widget Component
 *
 * Dynamic Island-style floating overlay when audio recording is active.
 * Features animated show/hide transitions and scrolling waveform visualization.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface AudioLevelData {
    levels: number[];
    timestamp: number;
}

interface WaveformBar {
    height: number;
    id: number;
}

// Waveform configuration
const BAR_WIDTH = 2;
const BAR_GAP = 4;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const SCROLL_SPEED = 30;
const MIN_HEIGHT = 6;
const MAX_HEIGHT = 36;
const CONTAINER_WIDTH = 520 - 24; // Widget width minus padding

interface MeetingAppInfo {
    appName: string;
    bundleId: string;
}

export function RecordingWidget(): React.ReactElement {
    const [widgetState, setWidgetState] = useState<'prompt' | 'recording' | 'stopped' | 'hiding'>('recording');
    const [showMeetingEndedPrompt, setShowMeetingEndedPrompt] = useState(false);
    const [promptEntryId, setPromptEntryId] = useState<string | null>(null);
    const [promptMeetingApp, setPromptMeetingApp] = useState<MeetingAppInfo | null>(null);

    // Waveform state
    const [bars, setBars] = useState<WaveformBar[]>([]);
    const [trackPosition, setTrackPosition] = useState(CONTAINER_WIDTH / 2);
    const [trackScale, setTrackScale] = useState(1);

    // Refs
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(performance.now());
    const barIdCounterRef = useRef<number>(0);
    const audioStateRef = useRef<'normal' | 'loud' | 'quiet'>('normal');
    const stateCounterRef = useRef<number>(0);
    const lastHeightRef = useRef<number>(20);
    const currentIntensityRef = useRef<number>(0);
    const playheadRef = useRef<HTMLDivElement>(null);
    const waveformContainerRef = useRef<HTMLDivElement>(null);
    const widgetRef = useRef<HTMLDivElement>(null);
    const recordingPillRef = useRef<HTMLDivElement>(null);

    // Track real audio levels for waveform - store recent levels for smoothing
    const currentAudioLevelRef = useRef<number>(0);
    const recentAudioLevelsRef = useRef<number[]>([]); // Rolling buffer of recent peak levels
    const hasRealAudioRef = useRef<boolean>(false);

    // Verify IPC connection on mount
    useEffect(() => {
        const hasElectron = !!window.electron;
        const hasIpcRenderer = !!window.electron?.ipcRenderer;
        const hasInvoke = !!window.electron?.ipcRenderer?.invoke;

        console.log('[RecordingWidget] IPC status check:', {
            hasElectron,
            hasIpcRenderer,
            hasInvoke
        });

        if (!hasElectron || !hasInvoke) {
            console.error('[RecordingWidget] IPC not available');
            return;
        }

        // Ping to verify IPC is working
        window.electron.ipcRenderer.invoke('widget:ping', { timestamp: Date.now() })
            .then((response: { received: boolean; timestamp: number }) => {
                console.log('[RecordingWidget] IPC connected:', response);
            })
            .catch((error: Error) => {
                console.error('[RecordingWidget] IPC ping failed:', error);
            });
    }, []);

    // Listen for audio level updates from main process
    useEffect(() => {
        console.log('[RecordingWidget] Setting up audio levels listener');

        let audioLevelsReceivedCount = 0;

        const handleAudioLevels = (data: AudioLevelData) => {
            audioLevelsReceivedCount++;
            if (audioLevelsReceivedCount <= 3 || audioLevelsReceivedCount % 100 === 0) {
                console.log('[RecordingWidget] Received audio levels, count:', audioLevelsReceivedCount, 'levels:', data.levels?.slice(0, 4));
            }

            if (data && data.levels && data.levels.length > 0) {
                hasRealAudioRef.current = true;

                // Calculate a weighted RMS across frequency bins
                // Weight mid frequencies (speech range) higher for voice visualization
                let weightedSum = 0;
                let totalWeight = 0;
                for (let i = 0; i < data.levels.length; i++) {
                    // Weight curve: higher for mid frequencies (bins 2-15 out of 24)
                    // This corresponds to 200Hz-4kHz range where speech energy is concentrated
                    const weight = i < 2 ? 0.3 : i < 15 ? 1.0 : 0.5;
                    weightedSum += data.levels[i] * data.levels[i] * weight;
                    totalWeight += weight;
                }
                const rms = Math.sqrt(weightedSum / totalWeight);

                // Also get peak level for dynamic response
                const peak = Math.max(...data.levels);

                // Blend RMS (sustained volume) with peak (transients) for responsive visualization
                const blendedLevel = rms * 0.6 + peak * 0.4;

                // Store in rolling buffer for smoothing (keep last 5 readings)
                recentAudioLevelsRef.current.push(blendedLevel);
                if (recentAudioLevelsRef.current.length > 5) {
                    recentAudioLevelsRef.current.shift();
                }

                // Use the max of recent levels for responsive feel
                const smoothedLevel = Math.max(...recentAudioLevelsRef.current);

                // Apply gentle compression curve for better visual range
                // Maps 0-1 input to 0-1 output with boosted low levels
                const compressed = Math.pow(smoothedLevel, 0.5);

                currentAudioLevelRef.current = Math.max(0.05, Math.min(1, compressed));
            }
        };

        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) {
            console.error('[RecordingWidget] ipcRenderer.on not available');
            return;
        }

        const unsubscribe = onFn('widget:audio-levels', handleAudioLevels);
        console.log('[RecordingWidget] Audio levels listener registered');

        return () => {
            console.log('[RecordingWidget] Cleaning up audio levels listener');
            unsubscribe?.();
        };
    }, []);

    // Listen for meeting-ended prompt trigger from main process
    useEffect(() => {
        console.log('[RecordingWidget] Setting up meeting-ended prompt listener');

        const handleShowPrompt = (data: { entryId: string; silenceDuration: number }) => {
            console.log('[RecordingWidget] *** RECEIVED MEETING ENDED PROMPT ***', data);
            setPromptEntryId(data.entryId);
            setShowMeetingEndedPrompt(true);
        };

        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) {
            console.error('[RecordingWidget] ipcRenderer.on not available for prompt listener');
            return;
        }

        const unsubscribe = onFn('widget:show-meeting-ended-prompt', handleShowPrompt);
        console.log('[RecordingWidget] Meeting-ended prompt listener registered');

        return () => {
            console.log('[RecordingWidget] Cleaning up meeting-ended prompt listener');
            unsubscribe?.();
        };
    }, []);

    // Listen for "start timer" prompt trigger from main process
    useEffect(() => {
        console.log('[RecordingWidget] Setting up start-timer prompt listener');

        const handleShowStartPrompt = (data: { meetingApp: MeetingAppInfo | null; timestamp: number }) => {
            console.log('[RecordingWidget] *** RECEIVED START TIMER PROMPT ***', data);
            setPromptMeetingApp(data.meetingApp);
            setWidgetState('prompt');
        };

        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) {
            console.error('[RecordingWidget] ipcRenderer.on not available for start prompt listener');
            return;
        }

        const unsubscribe = onFn('widget:show-prompt', handleShowStartPrompt);
        console.log('[RecordingWidget] Start-timer prompt listener registered');

        return () => {
            console.log('[RecordingWidget] Cleaning up start-timer prompt listener');
            unsubscribe?.();
        };
    }, []);

    // Generate bar height based on audio state or real data
    const generateBarHeight = useCallback((): number => {
        // If we have real audio levels, use them
        if (hasRealAudioRef.current) {
            const level = currentAudioLevelRef.current;

            // Add organic variation that scales with the audio level
            // Louder audio has more variation (more dynamic), quieter audio is more uniform
            const variationRange = 0.15 + level * 0.25; // 15-40% variation based on level
            const variation = 1 + (Math.random() - 0.5) * 2 * variationRange;

            // Calculate base height from audio level
            const baseHeight = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * level;

            // Apply variation and smooth with previous height for continuity
            const targetHeight = baseHeight * variation;
            const smoothed = lastHeightRef.current * 0.3 + targetHeight * 0.7;
            lastHeightRef.current = smoothed;

            return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(smoothed)));
        }

        // Fallback to simulated audio
        stateCounterRef.current--;
        if (stateCounterRef.current <= 0) {
            const rand = Math.random();
            if (rand < 0.15) {
                audioStateRef.current = 'loud';
                stateCounterRef.current = 3 + Math.floor(Math.random() * 8);
            } else if (rand < 0.3) {
                audioStateRef.current = 'quiet';
                stateCounterRef.current = 5 + Math.floor(Math.random() * 10);
            } else {
                audioStateRef.current = 'normal';
                stateCounterRef.current = 2 + Math.floor(Math.random() * 5);
            }
        }

        let targetHeight;
        if (audioStateRef.current === 'loud') {
            targetHeight = MAX_HEIGHT * (0.7 + Math.random() * 0.3);
        } else if (audioStateRef.current === 'quiet') {
            targetHeight = MIN_HEIGHT + Math.random() * 8;
        } else {
            targetHeight = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * (0.3 + Math.random() * 0.4);
        }

        lastHeightRef.current = lastHeightRef.current * 0.3 + targetHeight * 0.7;
        return Math.round(lastHeightRef.current);
    }, []);

    // Initialize waveform bars
    useEffect(() => {
        const barsNeeded = Math.ceil(CONTAINER_WIDTH / BAR_STEP) + 25;
        const initialBars: WaveformBar[] = [];

        for (let i = 0; i < barsNeeded; i++) {
            initialBars.push({
                height: generateBarHeight(),
                id: barIdCounterRef.current++
            });
        }

        setBars(initialBars);
        setTrackPosition(CONTAINER_WIDTH / 2);
    }, [generateBarHeight]);

    // Position playhead after animation completes
    const positionPlayhead = useCallback(() => {
        if (!playheadRef.current || !waveformContainerRef.current || !widgetRef.current || !recordingPillRef.current) {
            return;
        }

        const widgetRect = widgetRef.current.getBoundingClientRect();
        const pillRect = recordingPillRef.current.getBoundingClientRect();
        const waveformRect = waveformContainerRef.current.getBoundingClientRect();

        const pillCenterY = pillRect.top + pillRect.height / 2 - widgetRect.top;
        const waveformBottom = waveformRect.bottom - widgetRect.top;
        const playheadEnd = waveformBottom + 4;

        playheadRef.current.style.top = `${pillCenterY}px`;
        playheadRef.current.style.height = `${playheadEnd - pillCenterY}px`;
    }, []);

    // Position playhead after initial render
    useEffect(() => {
        const timer = setTimeout(positionPlayhead, 520);
        window.addEventListener('resize', positionPlayhead);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', positionPlayhead);
        };
    }, [positionPlayhead]);

    // Waveform animation loop
    useEffect(() => {
        if (widgetState !== 'recording') {
            return;
        }

        // Reset lastTime when starting animation to prevent stale timestamp issues
        // This is crucial when transitioning from 'prompt' or other states to 'recording'
        lastTimeRef.current = performance.now();

        // Track if this effect instance is still active (prevents stale callbacks)
        let isActive = true;

        const animate = (currentTime: number) => {
            if (!isActive) return; // Guard against stale callbacks after cleanup

            let deltaTime = (currentTime - lastTimeRef.current) / 1000;

            // Cap deltaTime to prevent huge jumps when:
            // - Browser tab was backgrounded
            // - Animation frame was delayed
            // - State transition caused a gap
            // Max 100ms (0.1s) ensures smooth animation even with missed frames
            deltaTime = Math.min(deltaTime, 0.1);

            lastTimeRef.current = currentTime;

            setTrackPosition(prevPos => {
                let newPos = prevPos - SCROLL_SPEED * deltaTime;

                // Check if we need to add a new bar
                setBars(prevBars => {
                    const trackWidth = prevBars.length * BAR_STEP;
                    const rightEdge = newPos + trackWidth;

                    if (rightEdge < CONTAINER_WIDTH + BAR_STEP * 5) {
                        const height = generateBarHeight();
                        const newIntensity = (height - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
                        currentIntensityRef.current = currentIntensityRef.current * 0.2 + newIntensity * 0.8;

                        return [...prevBars, { height, id: barIdCounterRef.current++ }];
                    }

                    // Check if we need to remove the first bar
                    if (prevBars.length > 0) {
                        const barRight = newPos + BAR_STEP;
                        if (barRight < -BAR_STEP) {
                            newPos += BAR_STEP;
                            return prevBars.slice(1);
                        }
                    }

                    return prevBars;
                });

                return newPos;
            });

            // Update track scale based on intensity
            const pulseScale = 0.85 + (currentIntensityRef.current * 0.3);
            setTrackScale(pulseScale);

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            isActive = false; // Prevent stale animate callbacks from running
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [widgetState, generateBarHeight]);

    // Handle "Yes, meeting ended" response
    const handleMeetingEndedYes = useCallback(async () => {
        console.log('[RecordingWidget] *** USER CONFIRMED MEETING ENDED ***');
        setShowMeetingEndedPrompt(false);

        // CRITICAL: Send IPC IMMEDIATELY to stop recording
        // Don't delay - stop the recording first, then show animation
        try {
            await window.electron?.ipcRenderer?.invoke?.('widget:meeting-ended-response', {
                response: 'yes',
                entryId: promptEntryId,
            });
            console.log('[RecordingWidget] Meeting ended confirmation sent');

            // Now show the success animation after recording has actually stopped
            setWidgetState('stopped');

            // After showing success state, transition to hiding
            setTimeout(() => {
                setWidgetState('hiding');
            }, 2000); // Show "Saved" for 2 seconds
        } catch (error) {
            console.error('[RecordingWidget] Error sending meeting ended response:', error);
            // Still show stopped state even on error
            setWidgetState('stopped');
            setTimeout(() => {
                setWidgetState('hiding');
            }, 2000);
        }
    }, [promptEntryId]);

    // Handle "No, continue recording" response
    const handleMeetingEndedNo = useCallback(async () => {
        console.log('[RecordingWidget] *** USER CHOSE TO CONTINUE RECORDING ***');
        setShowMeetingEndedPrompt(false);

        try {
            await window.electron?.ipcRenderer?.invoke?.('widget:meeting-ended-response', {
                response: 'no',
                entryId: promptEntryId,
            });
            console.log('[RecordingWidget] Continue recording confirmation sent');
        } catch (error) {
            console.error('[RecordingWidget] Error sending continue response:', error);
        }
    }, [promptEntryId]);

    // Handle stop button click
    const handleStop = useCallback(async () => {
        console.log('[RecordingWidget] *** STOP BUTTON CLICKED ***');

        // CRITICAL: Send stop IPC IMMEDIATELY to stop recording
        // Don't delay - the "Saved" animation should reflect that saving IS complete
        const hasInvoke = !!window.electron?.ipcRenderer?.invoke;
        if (!hasInvoke) {
            console.error('[RecordingWidget] IPC invoke not available');
            return;
        }

        try {
            // Stop recording first, then show animation
            const response = await window.electron.ipcRenderer.invoke('widget:stop-recording', { timestamp: Date.now() });
            console.log('[RecordingWidget] Stop response:', response);

            // Now show the success animation after recording has actually stopped
            setWidgetState('stopped');

            // After showing success state, transition to hiding
            setTimeout(() => {
                setWidgetState('hiding');
            }, 2000); // Show "Saved" for 2 seconds
        } catch (error) {
            console.error('[RecordingWidget] Stop IPC failed:', error);
            // Still show stopped state even on error
            setWidgetState('stopped');
            setTimeout(() => {
                setWidgetState('hiding');
            }, 2000);
        }
    }, []);

    // Handle hide button click
    const handleHide = useCallback(() => {
        console.log('[RecordingWidget] *** HIDE BUTTON CLICKED ***');
        setWidgetState('hiding');

        // After animation completes, tell main process to hide window
        setTimeout(() => {
            window.electron?.ipcRenderer?.invoke?.('widget:hide', { timestamp: Date.now() })
                .catch((error: Error) => {
                    console.error('[RecordingWidget] Hide IPC failed:', error);
                });
        }, 370);
    }, []);

    // Handle "Yes, Start" button click in prompt mode
    const handlePromptAccept = useCallback(async () => {
        console.log('[RecordingWidget] *** PROMPT ACCEPTED - USER WANTS TO START TIMER ***');

        // Verify IPC is available before attempting call
        if (!window.electron?.ipcRenderer?.invoke) {
            console.error('[RecordingWidget] IPC not available - cannot send prompt accepted');
            return;
        }

        try {
            const result = await window.electron.ipcRenderer.invoke('widget:prompt-accepted', { timestamp: Date.now() });
            console.log('[RecordingWidget] Prompt accepted sent to main, result:', result);
            // Widget will be closed by main process, state change will happen when reopened for recording
        } catch (error) {
            console.error('[RecordingWidget] Error sending prompt accepted:', error);
        }
    }, []);

    // Handle "Dismiss" button click in prompt mode
    const handlePromptDismiss = useCallback(async () => {
        console.log('[RecordingWidget] *** PROMPT DISMISSED - USER DOES NOT WANT TO START TIMER ***');
        setWidgetState('hiding');

        // After animation completes, tell main process
        setTimeout(async () => {
            // Verify IPC is available before attempting call
            if (!window.electron?.ipcRenderer?.invoke) {
                console.error('[RecordingWidget] IPC not available - cannot send prompt dismissed');
                return;
            }

            try {
                const result = await window.electron.ipcRenderer.invoke('widget:prompt-dismissed', { timestamp: Date.now() });
                console.log('[RecordingWidget] Prompt dismissed sent to main, result:', result);
            } catch (error) {
                console.error('[RecordingWidget] Error sending prompt dismissed:', error);
            }
        }, 370);
    }, []);

    // Determine if a bar is on the left (recorded) or right (buffer) side
    const getBarSide = (barIndex: number): 'left' | 'right' => {
        const barPosition = trackPosition + barIndex * BAR_STEP + BAR_WIDTH / 2;
        return barPosition < CONTAINER_WIDTH / 2 ? 'left' : 'right';
    };

    // Build class name for widget
    const widgetClassName = [
        'audio-widget',
        widgetState === 'prompt' ? 'prompt-mode' : '',
        widgetState === 'stopped' ? 'stopped' : '',
        widgetState === 'hiding' ? 'hiding' : ''
    ].filter(Boolean).join(' ');

    // Prompt mode - show different UI
    if (widgetState === 'prompt') {
        return (
            <div className={widgetClassName} id="widget" ref={widgetRef}>
                <div className="prompt-container">
                    {/* App Icon */}
                    <div className="app-icon">
                        <img src="./icon.png" alt="Clearical" />
                    </div>

                    {/* Prompt Content */}
                    <div className="prompt-content">
                        <div className="prompt-title">
                            <span className="prompt-meeting-icon">🎤</span>
                            Meeting Detected
                        </div>
                        <div className="prompt-subtitle">
                            {promptMeetingApp?.appName || 'Video call'} is using your microphone
                        </div>
                        <div className="prompt-question">Start timer and record?</div>
                    </div>

                    {/* Prompt Buttons */}
                    <div className="prompt-buttons">
                        <button className="prompt-btn yes-btn" onClick={handlePromptAccept}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="prompt-btn-icon">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            Yes, Start
                        </button>
                        <button className="prompt-btn dismiss-btn" onClick={handlePromptDismiss}>
                            Dismiss
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={widgetClassName} id="widget" ref={widgetRef}>
            {/* Top Row */}
            <div className="widget-top-row">
                {/* App Icon */}
                <div className="app-icon">
                    <img src="./icon.png" alt="Clearical" />
                </div>

                {/* Recording Pill Container */}
                <div className="recording-pill-container">
                    <div className="recording-pill" ref={recordingPillRef}>
                        <div className="recording-dot"></div>
                        <span className="recording-text">Recording...</span>
                        <span className="success-check">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            Saved
                        </span>
                    </div>
                </div>

                {/* Action Buttons - Always visible */}
                <div className="action-buttons">
                    <button className="action-btn stop-btn" onClick={handleStop}>
                        <div className="stop-icon"></div>
                        <span>Stop</span>
                    </button>
                    <button className="action-btn hide-btn" onClick={handleHide}>
                        <div className="hide-icon"></div>
                        <span>Hide</span>
                    </button>
                </div>
            </div>

            {/* Waveform */}
            <div className="waveform-container" ref={waveformContainerRef}>
                <div className="waveform-bg-left"></div>
                <div className="waveform-bg-right"></div>
                <div
                    className="waveform-track"
                    style={{
                        left: `${trackPosition}px`,
                        transform: `scaleY(${trackScale})`
                    }}
                >
                    {bars.map((bar, index) => (
                        <div
                            key={bar.id}
                            className="waveform-bar"
                            style={{
                                width: `${BAR_WIDTH}px`,
                                minWidth: `${BAR_WIDTH}px`,
                                height: `${bar.height}px`,
                                marginRight: `${BAR_GAP}px`
                            }}
                        >
                            <div
                                className="bar-layer-recorded"
                                style={{ opacity: getBarSide(index) === 'left' ? 1 : 0 }}
                            />
                            <div
                                className="bar-layer-buffer"
                                style={{ opacity: getBarSide(index) === 'right' ? 1 : 0 }}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Playhead */}
            <div className="playhead" ref={playheadRef}></div>

            {/* Meeting Ended Prompt Overlay - Positioned above playhead */}
            {showMeetingEndedPrompt && (
                <div className="meeting-ended-overlay">
                    <span className="meeting-ended-text">Meeting ended?</span>
                    <div className="meeting-ended-buttons">
                        <button className="meeting-ended-btn yes-btn" onClick={handleMeetingEndedYes}>
                            Yes, stop
                        </button>
                        <button className="meeting-ended-btn no-btn" onClick={handleMeetingEndedNo}>
                            Continue
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
