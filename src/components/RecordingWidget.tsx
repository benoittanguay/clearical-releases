/**
 * Recording Widget Component
 *
 * Displays a floating overlay when audio recording is active.
 * Shows waveform visualization, duration, and stop button.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface AudioLevelData {
    levels: number[];
    timestamp: number;
}

export function RecordingWidget(): React.ReactElement {
    const [duration, setDuration] = useState(0);
    const [audioLevels, setAudioLevels] = useState<number[]>(Array(24).fill(0.1));
    const [ipcStatus, setIpcStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
    const [stopClicked, setStopClicked] = useState(false);
    const startTimeRef = useRef<number>(Date.now());
    const animationFrameRef = useRef<number | undefined>(undefined);
    const lastRealDataRef = useRef<number>(0);
    const hasRealDataRef = useRef<boolean>(false);

    // Check IPC connection status on mount
    useEffect(() => {
        const hasElectron = !!window.electron;
        const hasIpcRenderer = !!window.electron?.ipcRenderer;
        const hasSend = !!window.electron?.ipcRenderer?.send;
        const hasOn = !!window.electron?.ipcRenderer?.on;

        console.log('[RecordingWidget] IPC status check:', {
            hasElectron,
            hasIpcRenderer,
            hasSend,
            hasOn
        });

        if (hasElectron && hasIpcRenderer && hasSend && hasOn) {
            setIpcStatus('connected');
            // Send a test ping to verify IPC is truly working
            try {
                window.electron.ipcRenderer.send('widget:ping', { timestamp: Date.now() });
                console.log('[RecordingWidget] Test ping sent successfully');
            } catch (e) {
                console.error('[RecordingWidget] Test ping failed:', e);
            }
        } else {
            setIpcStatus('disconnected');
            console.error('[RecordingWidget] IPC NOT AVAILABLE - preload may not be loaded');
        }
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
        console.log('[RecordingWidget] window.electron available:', !!window.electron);
        console.log('[RecordingWidget] ipcRenderer available:', !!window.electron?.ipcRenderer);
        console.log('[RecordingWidget] on method available:', !!window.electron?.ipcRenderer?.on);

        let audioLevelsReceivedCount = 0;

        const handleAudioLevels = (data: AudioLevelData) => {
            audioLevelsReceivedCount++;
            if (audioLevelsReceivedCount <= 3 || audioLevelsReceivedCount % 100 === 0) {
                console.log('[RecordingWidget] Received audio levels, count:', audioLevelsReceivedCount, 'data:', data);
            }
            hasRealDataRef.current = true;
            lastRealDataRef.current = Date.now();
            if (data && data.levels) {
                setAudioLevels(data.levels);
            } else {
                console.warn('[RecordingWidget] Invalid audio level data:', data);
            }
        };

        // Subscribe to audio level updates
        // Note: The preload's `on` method strips the event, so data is the first arg
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

    // Animate waveform bars with some randomness when no real data
    useEffect(() => {
        let lastUpdate = 0;
        const animate = (timestamp: number) => {
            // Only animate if we haven't received real data recently (>200ms)
            const timeSinceRealData = Date.now() - lastRealDataRef.current;
            if (!hasRealDataRef.current || timeSinceRealData > 200) {
                if (timestamp - lastUpdate > 100) {
                    lastUpdate = timestamp;
                    setAudioLevels(prev => {
                        // Add slight random variation to make it look alive
                        return prev.map((_level, i) => {
                            const baseLevel = 0.15 + Math.sin(timestamp / 300 + i * 0.5) * 0.1;
                            const randomVariation = Math.random() * 0.15;
                            return Math.max(0.1, Math.min(1, baseLevel + randomVariation));
                        });
                    });
                }
            }
            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // Handle stop button click
    const handleStop = useCallback(() => {
        console.log('[RecordingWidget] *** STOP BUTTON CLICKED ***');
        setStopClicked(true);

        const hasElectron = !!window.electron;
        const hasIpcRenderer = !!window.electron?.ipcRenderer;
        const hasSend = !!window.electron?.ipcRenderer?.send;

        console.log('[RecordingWidget] IPC availability at click time:', {
            hasElectron,
            hasIpcRenderer,
            hasSend
        });

        if (!hasElectron || !hasIpcRenderer || !hasSend) {
            console.error('[RecordingWidget] IPC NOT AVAILABLE - cannot stop recording');
            return;
        }

        try {
            window.electron.ipcRenderer.send('widget:stop-recording', { timestamp: Date.now() });
            console.log('[RecordingWidget] Stop IPC message sent successfully');
        } catch (error) {
            console.error('[RecordingWidget] Error sending stop IPC:', error);
        }
    }, []);

    return (
        <div className="recording-widget">
            {/* App Icon */}
            <div className="widget-icon">
                <img src="./icon.png" alt="Clearical" />
            </div>

            {/* Content */}
            <div className="widget-content">
                <div className="widget-header">
                    <div className="recording-indicator" />
                    <span className="widget-title">Recording Meeting</span>
                    <span className="widget-duration">{formatDuration(duration)}</span>
                    {ipcStatus === 'disconnected' && (
                        <span style={{ color: 'red', fontSize: '10px', marginLeft: '8px' }}>⚠️ IPC Error</span>
                    )}
                </div>

                {/* Waveform Visualization */}
                <div className="waveform-container">
                    {audioLevels.map((level, index) => (
                        <div
                            key={index}
                            className="waveform-bar"
                            style={{
                                height: `${Math.max(4, level * 28)}px`,
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="widget-actions">
                <button
                    className="stop-button"
                    onClick={handleStop}
                    style={stopClicked ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    {stopClicked ? 'Stopping...' : 'Stop Recording'}
                </button>
            </div>
        </div>
    );
}
