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
    const startTimeRef = useRef<number>(Date.now());
    const animationFrameRef = useRef<number | undefined>(undefined);
    const lastRealDataRef = useRef<number>(0);
    const hasRealDataRef = useRef<boolean>(false);

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
        const handleAudioLevels = (data: AudioLevelData) => {
            hasRealDataRef.current = true;
            lastRealDataRef.current = Date.now();
            setAudioLevels(data.levels);
        };

        // Subscribe to audio level updates
        const unsubscribe = window.electron?.ipcRenderer?.on?.(
            'widget:audio-levels',
            (_event: any, data: AudioLevelData) => handleAudioLevels(data)
        );

        return () => {
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
        window.electron?.ipcRenderer?.send?.('widget:stop-recording', null);
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
                <button className="stop-button" onClick={handleStop}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                    Stop Recording
                </button>
            </div>
        </div>
    );
}
