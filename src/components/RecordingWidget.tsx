/**
 * Recording Widget Component
 *
 * Dynamic Island-style floating overlay when audio recording is active.
 * Features animated show/hide transitions and scrolling waveform visualization.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Waveform } from './Waveform';

interface AudioLevelData {
    levels: number[];
    elapsedMs?: number;
    timestamp: number;
}

// Widget layout constants
const WAVEFORM_WIDTH = 520 - 24; // Widget width minus padding
const WAVEFORM_HEIGHT = 48;

// Animation timing constants (in milliseconds)
// Keep in sync with CSS animations in RecordingWidget styles
const ANIMATION_ENTER_DURATION = 520;   // Time for widget to animate in
const ANIMATION_EXIT_DURATION = 500;    // Time for widget to animate out (collapse to icon)
const SAVED_MESSAGE_DURATION = 2000;    // How long to show "Saved" before closing

// Get time-appropriate greeting
function getTimeGreeting(): { text: string; icon: string } {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
        return { text: 'Good morning!', icon: '☀️' };
    } else if (hour >= 12 && hour < 17) {
        return { text: 'Good afternoon!', icon: '🌤️' };
    } else if (hour >= 17 && hour < 21) {
        return { text: 'Good evening!', icon: '🌅' };
    } else {
        return { text: 'Ready to work?', icon: '🌙' };
    }
}

interface MeetingAppInfo {
    appName: string;
    bundleId: string;
}

export function RecordingWidget(): React.ReactElement {
    // Content mode determines WHAT to render (which UI)
    const [contentMode, setContentMode] = useState<'prompt' | 'recording' | 'stopped' | 'working-hours-prompt'>('recording');
    // Animation state determines HOW to render (animation classes)
    const [isHiding, setIsHiding] = useState(false);
    const [showMeetingEndedPrompt, setShowMeetingEndedPrompt] = useState(false);
    const [promptEntryId, setPromptEntryId] = useState<string | null>(null);
    const [_promptMeetingApp, setPromptMeetingApp] = useState<MeetingAppInfo | null>(null);

    // Audio level state for waveform component
    const [audioLevel, setAudioLevel] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);

    // Refs
    const playheadRef = useRef<HTMLDivElement>(null);
    const waveformContainerRef = useRef<HTMLDivElement>(null);
    const widgetRef = useRef<HTMLDivElement>(null);
    const recordingPillRef = useRef<HTMLDivElement>(null);
    const recentAudioLevelsRef = useRef<number[]>([]); // Rolling buffer for smoothing

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

    // Consolidated IPC listeners for atomic cleanup
    // This ensures all listeners are registered and cleaned up together,
    // preventing potential race conditions on rapid remounts
    useEffect(() => {
        console.log('[RecordingWidget] Setting up all IPC listeners');

        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) {
            console.error('[RecordingWidget] ipcRenderer.on not available');
            return;
        }

        // Audio levels tracking
        let audioLevelsReceivedCount = 0;

        // Handler for audio level updates
        const handleAudioLevels = (data: AudioLevelData) => {
            audioLevelsReceivedCount++;
            if (audioLevelsReceivedCount <= 3 || audioLevelsReceivedCount % 100 === 0) {
                console.log('[RecordingWidget] Received audio levels, count:', audioLevelsReceivedCount, 'levels:', data.levels?.slice(0, 4));
            }

            if (data && data.levels && data.levels.length > 0) {
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

                // Use average for more natural variation (max tends to flatten dynamics)
                const smoothedLevel = recentAudioLevelsRef.current.reduce((a, b) => a + b, 0) / recentAudioLevelsRef.current.length;

                // Light compression to preserve dynamic range while avoiding clipping
                const compressed = Math.pow(smoothedLevel, 0.7);

                setAudioLevel(Math.max(0.02, Math.min(1, compressed)));
            }

            // Update elapsed time for waveform sync
            if (data.elapsedMs !== undefined) {
                setElapsedMs(data.elapsedMs);
            }
        };

        // Handler for meeting-ended prompt
        const handleShowMeetingEndedPrompt = (data: { entryId: string; silenceDuration: number }) => {
            console.log('[RecordingWidget] *** RECEIVED MEETING ENDED PROMPT ***', data);
            setPromptEntryId(data.entryId);
            setShowMeetingEndedPrompt(true);
        };

        // Handler for start-timer prompt
        const handleShowStartPrompt = (data: { meetingApp: MeetingAppInfo | null; timestamp: number }) => {
            console.log('[RecordingWidget] *** RECEIVED START TIMER PROMPT ***', data);
            setPromptMeetingApp(data.meetingApp);
            setContentMode('prompt');
            setIsHiding(false);
        };

        // Handler for working-hours prompt
        const handleShowWorkingHoursPrompt = (data: { timestamp: number }) => {
            console.log('[RecordingWidget] *** RECEIVED WORKING HOURS PROMPT ***', data);
            setContentMode('working-hours-prompt');
            setIsHiding(false);
        };

        // Handler for switching to recording mode (from prompt mode)
        const handleShowRecording = (data: { timestamp: number }) => {
            console.log('[RecordingWidget] *** RECEIVED SHOW RECORDING ***', data);
            setContentMode('recording');
            setIsHiding(false);
        };

        // Register all listeners
        const unsubscribeAudioLevels = onFn('widget:audio-levels', handleAudioLevels);
        const unsubscribeMeetingEnded = onFn('widget:show-meeting-ended-prompt', handleShowMeetingEndedPrompt);
        const unsubscribeStartPrompt = onFn('widget:show-prompt', handleShowStartPrompt);
        const unsubscribeWorkingHours = onFn('widget:show-working-hours-prompt', handleShowWorkingHoursPrompt);
        const unsubscribeShowRecording = onFn('widget:show-recording', handleShowRecording);

        console.log('[RecordingWidget] All IPC listeners registered');

        // Atomic cleanup - all listeners removed together
        return () => {
            console.log('[RecordingWidget] Cleaning up all IPC listeners');
            unsubscribeAudioLevels?.();
            unsubscribeMeetingEnded?.();
            unsubscribeStartPrompt?.();
            unsubscribeWorkingHours?.();
            unsubscribeShowRecording?.();
        };
    }, []);

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
        const timer = setTimeout(positionPlayhead, ANIMATION_ENTER_DURATION);
        window.addEventListener('resize', positionPlayhead);

        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', positionPlayhead);
        };
    }, [positionPlayhead]);

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
            setContentMode('stopped');

            // After showing success state, transition to hiding
            setTimeout(() => {
                setIsHiding(true);

                // After exit animation completes, request window close
                setTimeout(() => {
                    window.electron?.ipcRenderer?.invoke?.('widget:request-close', { timestamp: Date.now() })
                        .catch((error: Error) => {
                            console.error('[RecordingWidget] Close request failed:', error);
                        });
                }, ANIMATION_EXIT_DURATION);
            }, SAVED_MESSAGE_DURATION);
        } catch (error) {
            console.error('[RecordingWidget] Error sending meeting ended response:', error);
            // Still show stopped state even on error
            setContentMode('stopped');
            setTimeout(() => {
                setIsHiding(true);

                // After exit animation completes, request window close
                setTimeout(() => {
                    window.electron?.ipcRenderer?.invoke?.('widget:request-close', { timestamp: Date.now() })
                        .catch(() => {}); // Ignore errors on error path
                }, ANIMATION_EXIT_DURATION);
            }, SAVED_MESSAGE_DURATION);
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

            // Skip stopped state - go straight to hiding
            setIsHiding(true);

            // After exit animation completes, request window close
            setTimeout(() => {
                window.electron?.ipcRenderer?.invoke?.('widget:request-close', { timestamp: Date.now() })
                    .catch((error: Error) => {
                        console.error('[RecordingWidget] Close request failed:', error);
                    });
            }, ANIMATION_EXIT_DURATION);
        } catch (error) {
            console.error('[RecordingWidget] Stop IPC failed:', error);
            // Skip stopped state - go straight to hiding
            setIsHiding(true);

            // After exit animation completes, request window close
            setTimeout(() => {
                window.electron?.ipcRenderer?.invoke?.('widget:request-close', { timestamp: Date.now() })
                    .catch(() => {}); // Ignore errors on error path
            }, ANIMATION_EXIT_DURATION);
        }
    }, []);

    // Handle hide button click
    const handleHide = useCallback(() => {
        console.log('[RecordingWidget] *** HIDE BUTTON CLICKED ***');
        setIsHiding(true);

        // After animation completes, tell main process to hide window
        setTimeout(() => {
            window.electron?.ipcRenderer?.invoke?.('widget:hide', { timestamp: Date.now() })
                .catch((error: Error) => {
                    console.error('[RecordingWidget] Hide IPC failed:', error);
                });
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Handle "Yes, Start" button click in prompt mode
    const handlePromptAccept = useCallback(async () => {
        console.log('[RecordingWidget] *** PROMPT ACCEPTED - USER WANTS TO START TIMER ***');
        setIsHiding(true);

        // After animation completes, tell main process
        setTimeout(async () => {
            // Verify IPC is available before attempting call
            if (!window.electron?.ipcRenderer?.invoke) {
                console.error('[RecordingWidget] IPC not available - cannot send prompt accepted');
                return;
            }

            try {
                const result = await window.electron.ipcRenderer.invoke('widget:prompt-accepted', { timestamp: Date.now() });
                console.log('[RecordingWidget] Prompt accepted sent to main, result:', result);
            } catch (error) {
                console.error('[RecordingWidget] Error sending prompt accepted:', error);
            }
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Handle "Dismiss" button click in prompt mode
    const handlePromptDismiss = useCallback(async () => {
        console.log('[RecordingWidget] *** PROMPT DISMISSED - USER DOES NOT WANT TO START TIMER ***');
        setIsHiding(true);

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
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Handle "Yes, Start" button click in working hours prompt mode
    const handleWorkingHoursStart = useCallback(async () => {
        console.log('[RecordingWidget] *** WORKING HOURS - USER WANTS TO START ***');
        setIsHiding(true);

        // After animation completes, tell main process
        setTimeout(async () => {
            if (!window.electron?.ipcRenderer?.invoke) {
                console.error('[RecordingWidget] IPC not available - cannot send working hours accepted');
                return;
            }

            try {
                const result = await window.electron.ipcRenderer.invoke('widget:working-hours-accepted', { timestamp: Date.now() });
                console.log('[RecordingWidget] Working hours accepted sent to main, result:', result);
            } catch (error) {
                console.error('[RecordingWidget] Error sending working hours accepted:', error);
            }
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Handle "Snooze" button click in working hours prompt mode
    const handleWorkingHoursSnooze = useCallback(async () => {
        console.log('[RecordingWidget] *** WORKING HOURS - USER WANTS TO SNOOZE ***');
        setIsHiding(true);

        setTimeout(async () => {
            if (!window.electron?.ipcRenderer?.invoke) {
                console.error('[RecordingWidget] IPC not available - cannot send working hours snoozed');
                return;
            }

            try {
                const result = await window.electron.ipcRenderer.invoke('widget:working-hours-snoozed', { timestamp: Date.now() });
                console.log('[RecordingWidget] Working hours snoozed sent to main, result:', result);
            } catch (error) {
                console.error('[RecordingWidget] Error sending working hours snoozed:', error);
            }
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Handle "Day Off" button click in working hours prompt mode
    const handleWorkingHoursDayOff = useCallback(async () => {
        console.log('[RecordingWidget] *** WORKING HOURS - USER TAKING DAY OFF ***');
        setIsHiding(true);

        setTimeout(async () => {
            if (!window.electron?.ipcRenderer?.invoke) {
                console.error('[RecordingWidget] IPC not available - cannot send working hours day off');
                return;
            }

            try {
                const result = await window.electron.ipcRenderer.invoke('widget:working-hours-day-off', { timestamp: Date.now() });
                console.log('[RecordingWidget] Working hours day off sent to main, result:', result);
            } catch (error) {
                console.error('[RecordingWidget] Error sending working hours day off:', error);
            }
        }, ANIMATION_EXIT_DURATION);
    }, []);

    // Build class name for widget
    const widgetClassName = [
        'audio-widget',
        contentMode === 'prompt' ? 'prompt-mode' : '',
        contentMode === 'working-hours-prompt' ? 'working-hours-mode' : '',
        contentMode === 'stopped' ? 'stopped' : '',
        isHiding ? 'hiding' : ''
    ].filter(Boolean).join(' ');

    // Working hours prompt mode - show start-your-day UI
    if (contentMode === 'working-hours-prompt') {
        return (
            <div className={widgetClassName} id="widget" ref={widgetRef}>
                <div className="prompt-container working-hours-container">
                    {/* App Icon */}
                    <div className="app-icon">
                        <img src="./icon.png" alt="Clearical" />
                    </div>

                    {/* Prompt Content */}
                    <div className="prompt-content">
                        <div className="prompt-title">
                            <span className="prompt-meeting-icon">{getTimeGreeting().icon}</span>
                            {getTimeGreeting().text}
                        </div>
                        <div className="prompt-question">Ready to start your day?</div>
                    </div>

                    {/* Prompt Buttons */}
                    <div className="prompt-buttons working-hours-buttons">
                        <button className="prompt-btn yes-btn" onClick={handleWorkingHoursStart}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="prompt-btn-icon">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            Yes, Start
                        </button>
                        <button className="prompt-btn snooze-btn" onClick={handleWorkingHoursSnooze}>
                            Snooze
                        </button>
                        <button className="prompt-btn dismiss-btn" onClick={handleWorkingHoursDayOff}>
                            Day Off
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Prompt mode - show different UI
    if (contentMode === 'prompt') {
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

                {/* Recording Pill Container - fades out during exit animation */}
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

                {/* Action Buttons - fade out during exit animation */}
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

            {/* Waveform - fades out during exit animation */}
            <div className="waveform-container" ref={waveformContainerRef}>
                <Waveform
                    isRecording={contentMode === 'recording' && !isHiding}
                    audioLevel={audioLevel}
                    elapsedMs={elapsedMs}
                    width={WAVEFORM_WIDTH}
                    height={WAVEFORM_HEIGHT}
                    variant="dark"
                    showPlayhead={false}
                    showScanlines={false}
                />
            </div>

            {/* Playhead - fades out during exit animation */}
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
