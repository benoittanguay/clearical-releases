/**
 * Recording Widget Component
 *
 * Displays a floating overlay when audio recording is active.
 * Shows waveform visualization, duration, and stop button.
 * Can be minimized by user, but will slide back in for meeting-ended prompts.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface AudioLevelData {
    levels: number[];
    timestamp: number;
}

export function RecordingWidget(): React.ReactElement {
    const [duration, setDuration] = useState(0);
    const [audioLevels, setAudioLevels] = useState<number[]>(Array(24).fill(0.05));
    const [stopClicked, setStopClicked] = useState(false);
    const [showMeetingEndedPrompt, setShowMeetingEndedPrompt] = useState(false);
    const [promptEntryId, setPromptEntryId] = useState<string | null>(null);
    const [isMinimized, setIsMinimized] = useState(false);
    const [slideIn, setSlideIn] = useState(false);
    const startTimeRef = useRef<number>(Date.now());
    const hasRealDataRef = useRef<boolean>(false);

    // Verify IPC connection on mount
    useEffect(() => {
        const hasElectron = !!window.electron;
        const hasIpcRenderer = !!window.electron?.ipcRenderer;
        const hasInvoke = !!window.electron?.ipcRenderer?.invoke;
        const hasOn = !!window.electron?.ipcRenderer?.on;

        console.log('[RecordingWidget] IPC status check:', {
            hasElectron,
            hasIpcRenderer,
            hasInvoke,
            hasOn
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

    // Format duration as MM:SS
    const formatDuration = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // Update duration every second
    useEffect(() => {
        const interval = setInterval(() => {
            setDuration(Date.now() - startTimeRef.current);
        }, 100);

        return () => clearInterval(interval);
    }, []);


    // Listen for audio level updates from main process
    useEffect(() => {
        console.log('[RecordingWidget] Setting up audio levels listener');

        let audioLevelsReceivedCount = 0;

        const handleAudioLevels = (data: AudioLevelData) => {
            audioLevelsReceivedCount++;
            if (audioLevelsReceivedCount <= 3 || audioLevelsReceivedCount % 100 === 0) {
                console.log('[RecordingWidget] Received audio levels, count:', audioLevelsReceivedCount, 'data:', data);
            }
            hasRealDataRef.current = true;

            if (data && data.levels) {
                // Apply logarithmic scaling to make quiet sounds more visible
                // and boost the overall levels for better visualization
                const scaledLevels = data.levels.map(level => {
                    // Apply a curve that boosts low values more than high values
                    // This makes quiet audio more visible while not clipping loud audio
                    const boosted = Math.pow(level, 0.5) * 1.5; // Square root boost + multiplier
                    return Math.max(0.08, Math.min(1, boosted));
                });
                setAudioLevels(scaledLevels);
            } else {
                console.warn('[RecordingWidget] Invalid audio level data:', data);
            }
        };

        // Subscribe to audio level updates
        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) {
            console.error('[RecordingWidget] ipcRenderer.on not available - preload may not be loaded!');
            return;
        }

        const unsubscribe = onFn('widget:audio-levels', (data: AudioLevelData) => handleAudioLevels(data));
        console.log('[RecordingWidget] Audio levels listener registered');

        return () => {
            console.log('[RecordingWidget] Cleaning up audio levels listener, total received:', audioLevelsReceivedCount);
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

            // If minimized, slide back in to show the prompt
            if (isMinimized) {
                setSlideIn(true);
                setIsMinimized(false);
                // Reset slideIn after animation completes
                setTimeout(() => setSlideIn(false), 400);
            }
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
    }, [isMinimized]);

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
        setStopClicked(true);

        const hasInvoke = !!window.electron?.ipcRenderer?.invoke;

        if (!hasInvoke) {
            console.error('[RecordingWidget] IPC invoke not available');
            setStopClicked(false);
            return;
        }

        try {
            const response = await window.electron.ipcRenderer.invoke('widget:stop-recording', { timestamp: Date.now() });
            console.log('[RecordingWidget] Stop response:', response);
            if (!response?.success) {
                console.error('[RecordingWidget] Stop failed:', response?.error);
                setStopClicked(false);
            }
        } catch (error) {
            const err = error as Error;
            console.error('[RecordingWidget] Stop IPC failed:', err);
            setStopClicked(false);
        }
    }, []);

    // Handle minimize button click
    const handleMinimize = useCallback(() => {
        console.log('[RecordingWidget] *** MINIMIZE CLICKED ***');
        setIsMinimized(true);
    }, []);

    // Handle restore from minimized state
    const handleRestore = useCallback(() => {
        console.log('[RecordingWidget] *** RESTORE CLICKED ***');
        setSlideIn(true);
        setIsMinimized(false);
        setTimeout(() => setSlideIn(false), 400);
    }, []);

    // Minimized view - compact pill
    if (isMinimized) {
        return (
            <div className="recording-widget-minimized" onClick={handleRestore}>
                <div className="recording-indicator" />
                <span className="minimized-duration">{formatDuration(duration)}</span>
            </div>
        );
    }

    return (
        <div className={`recording-widget ${slideIn ? 'slide-in' : ''}`}>
            {/* App Icon */}
            <div className="widget-icon">
                <img src="./icon.png" alt="Clearical" />
            </div>

            {/* Content */}
            <div className="widget-content">
                {showMeetingEndedPrompt ? (
                    /* Meeting ended prompt */
                    <div className="meeting-ended-prompt">
                        <div className="prompt-header">
                            <span className="prompt-title">Meeting ended?</span>
                            <span className="prompt-subtitle">No audio detected</span>
                        </div>
                        <div className="prompt-buttons">
                            <button
                                className="prompt-button prompt-button-yes"
                                onClick={handleMeetingEndedYes}
                            >
                                Yes, stop
                            </button>
                            <button
                                className="prompt-button prompt-button-no"
                                onClick={handleMeetingEndedNo}
                            >
                                No, continue
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Normal recording view */
                    <>
                        <div className="widget-header">
                            <div className="recording-indicator" />
                            <span className="widget-title">Recording</span>
                            <span className="widget-duration">{formatDuration(duration)}</span>
                        </div>

                        {/* Waveform Visualization - Real audio data */}
                        <div className="waveform-container">
                            {audioLevels.map((level, index) => (
                                <div
                                    key={index}
                                    className="waveform-bar"
                                    style={{
                                        height: `${Math.max(3, level * 26)}px`,
                                    }}
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Actions */}
            <div className="widget-actions">
                {!showMeetingEndedPrompt && (
                    <button
                        className="minimize-button"
                        onClick={handleMinimize}
                        title="Minimize"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                )}
                <button
                    className="stop-button"
                    onClick={handleStop}
                    style={stopClicked ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    {stopClicked ? 'Stopping...' : 'Stop'}
                </button>
            </div>
        </div>
    );
}
