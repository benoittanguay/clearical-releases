/**
 * Recording Controls Component
 *
 * Displays audio recording controls with waveform visualization.
 * Placed below the split flap timer in the chrono page.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Waveform } from './Waveform';
import './RecordingControls.css';

interface RecordingControlsProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    disabled?: boolean;
    elapsedMs?: number; // Recording elapsed time for waveform sync
}

interface AudioLevelData {
    levels: number[];
    timestamp: number;
}

export function RecordingControls({
    isRecording,
    onToggleRecording,
    disabled = false,
    elapsedMs = 0
}: RecordingControlsProps): React.ReactElement {
    const [audioLevel, setAudioLevel] = useState(0);
    const [isVisible, setIsVisible] = useState(false);
    const [waveformWidth, setWaveformWidth] = useState(320);
    const waveformContainerRef = useRef<HTMLDivElement>(null);
    const recentAudioLevelsRef = useRef<number[]>([]);

    // Animate in on mount
    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 100);
        return () => clearTimeout(timer);
    }, []);

    // Measure waveform container width for responsive sizing
    useEffect(() => {
        const container = waveformContainerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                if (width > 0) {
                    setWaveformWidth(Math.floor(width));
                }
            }
        });

        resizeObserver.observe(container);
        // Initial measurement
        setWaveformWidth(Math.floor(container.offsetWidth) || 320);

        return () => resizeObserver.disconnect();
    }, []);

    // Listen for audio level updates from main process (same as widget)
    useEffect(() => {
        if (!isRecording) {
            setAudioLevel(0);
            return;
        }

        const handleAudioLevels = (data: AudioLevelData) => {
            if (data && data.levels && data.levels.length > 0) {
                // Calculate weighted RMS across frequency bins (speech-weighted)
                let weightedSum = 0;
                let totalWeight = 0;
                for (let i = 0; i < data.levels.length; i++) {
                    const weight = i < 2 ? 0.3 : i < 15 ? 1.0 : 0.5;
                    weightedSum += data.levels[i] * data.levels[i] * weight;
                    totalWeight += weight;
                }
                const rms = Math.sqrt(weightedSum / totalWeight);
                const peak = Math.max(...data.levels);
                const blendedLevel = rms * 0.6 + peak * 0.4;

                // Rolling buffer for smoothing
                recentAudioLevelsRef.current.push(blendedLevel);
                if (recentAudioLevelsRef.current.length > 5) {
                    recentAudioLevelsRef.current.shift();
                }

                // Use average for more natural variation (max tends to flatten dynamics)
                const smoothedLevel = recentAudioLevelsRef.current.reduce((a, b) => a + b, 0) / recentAudioLevelsRef.current.length;
                // Light compression to preserve dynamic range
                const compressed = Math.pow(smoothedLevel, 0.7);
                setAudioLevel(Math.max(0.02, Math.min(1, compressed)));
            }
        };

        const onFn = window.electron?.ipcRenderer?.on;
        if (!onFn) return;

        const unsubscribe = onFn('widget:audio-levels', handleAudioLevels);

        return () => {
            unsubscribe?.();
            recentAudioLevelsRef.current = [];
        };
    }, [isRecording]);

    return (
        <div className={`recording-controls ${isVisible ? 'recording-controls--visible' : ''}`}>
            {/* Recording toggle button */}
            <button
                className={`recording-controls__button ${isRecording ? 'recording-controls__button--recording' : ''}`}
                onClick={onToggleRecording}
                disabled={disabled}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
                {isRecording ? (
                    // Stop icon (square)
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="recording-controls__icon"
                    >
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                ) : (
                    // Microphone icon
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="recording-controls__icon"
                    >
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                )}
                {isRecording && <span className="recording-controls__pulse" />}
            </button>

            {/* Waveform container */}
            <div
                ref={waveformContainerRef}
                className={`recording-controls__waveform ${isRecording ? 'recording-controls__waveform--active' : ''}`}
            >
                <Waveform
                    isRecording={isRecording}
                    audioLevel={audioLevel}
                    elapsedMs={elapsedMs}
                    width={waveformWidth}
                    height={40}
                    variant="light"
                />
            </div>
        </div>
    );
}

export default RecordingControls;
