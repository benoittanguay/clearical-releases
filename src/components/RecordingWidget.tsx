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

export function RecordingWidget(): React.ReactElement {
    const [widgetState, setWidgetState] = useState<'recording' | 'stopped' | 'hiding'>('recording');
    const [showMeetingEndedPrompt, setShowMeetingEndedPrompt] = useState(false);
    const [promptEntryId, setPromptEntryId] = useState<string | null>(null);

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

    // Track real audio levels for waveform - store the current RMS level
    const currentAudioLevelRef = useRef<number>(0);
    const audioLevelIndexRef = useRef<number>(0);
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
                // Use different frequency bins to create variation
                // Pick a level based on incrementing index to create more visual interest
                audioLevelIndexRef.current = (audioLevelIndexRef.current + 1) % data.levels.length;

                // Combine a few frequency bins for the current level with some averaging
                const idx = audioLevelIndexRef.current;
                const level1 = data.levels[idx] || 0;
                const level2 = data.levels[(idx + 1) % data.levels.length] || 0;
                const level3 = data.levels[(idx + 2) % data.levels.length] || 0;

                // Use max of nearby bins for more dynamic response
                const maxLevel = Math.max(level1, level2, level3);

                // Boost the level for visibility
                const boosted = Math.pow(maxLevel, 0.4) * 2.0;
                currentAudioLevelRef.current = Math.max(0.1, Math.min(1, boosted));
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

    // Generate bar height based on audio state or real data
    const generateBarHeight = useCallback((): number => {
        // If we have real audio levels, use them
        if (hasRealAudioRef.current) {
            const level = currentAudioLevelRef.current;
            // Add some random variation to make it more interesting
            const variation = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
            const height = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * level * variation;
            return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));
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

        const animate = (currentTime: number) => {
            const deltaTime = (currentTime - lastTimeRef.current) / 1000;
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
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [widgetState, generateBarHeight]);

    // Handle "Yes, meeting ended" response
    const handleMeetingEndedYes = useCallback(async () => {
        console.log('[RecordingWidget] *** USER CONFIRMED MEETING ENDED ***');
        setShowMeetingEndedPrompt(false);

        try {
            await window.electron?.ipcRenderer?.invoke?.('widget:meeting-ended-response', {
                response: 'yes',
                entryId: promptEntryId,
            });
            console.log('[RecordingWidget] Meeting ended confirmation sent');
        } catch (error) {
            console.error('[RecordingWidget] Error sending meeting ended response:', error);
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
        setWidgetState('stopped');

        // After showing success state, transition to hiding then stop
        setTimeout(() => {
            setWidgetState('hiding');

            setTimeout(async () => {
                const hasInvoke = !!window.electron?.ipcRenderer?.invoke;
                if (!hasInvoke) {
                    console.error('[RecordingWidget] IPC invoke not available');
                    return;
                }

                try {
                    const response = await window.electron.ipcRenderer.invoke('widget:stop-recording', { timestamp: Date.now() });
                    console.log('[RecordingWidget] Stop response:', response);
                } catch (error) {
                    console.error('[RecordingWidget] Stop IPC failed:', error);
                }
            }, 450);
        }, 2000); // Show "Saved" for 2 seconds
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

    // Determine if a bar is on the left (recorded) or right (buffer) side
    const getBarSide = (barIndex: number): 'left' | 'right' => {
        const barPosition = trackPosition + barIndex * BAR_STEP + BAR_WIDTH / 2;
        return barPosition < CONTAINER_WIDTH / 2 ? 'left' : 'right';
    };

    // Build class name for widget
    const widgetClassName = [
        'audio-widget',
        widgetState === 'stopped' ? 'stopped' : '',
        widgetState === 'hiding' ? 'hiding' : ''
    ].filter(Boolean).join(' ');

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

                {/* Meeting Ended Prompt Overlay - Shows on top of waveform */}
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

            {/* Playhead */}
            <div className="playhead" ref={playheadRef}></div>
        </div>
    );
}
