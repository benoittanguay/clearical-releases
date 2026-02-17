/**
 * Recording Controls Component
 *
 * Displays audio recording controls with waveform visualization.
 * Placed below the split flap timer in the chrono page.
 *
 * Audio levels come directly from AudioRecordingContext (same renderer process)
 * rather than IPC — identical data to what the widget receives.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Waveform } from './Waveform';
import { useAudioRecording } from '../context/AudioRecordingContext';
import './RecordingControls.css';

interface RecordingControlsProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    disabled?: boolean;
    elapsedMs?: number;
}

export function RecordingControls({
    isRecording,
    onToggleRecording,
    disabled = false,
    elapsedMs = 0
}: RecordingControlsProps): React.ReactElement {
    const [audioLevels, setAudioLevels] = useState<number[]>([]);
    const [isVisible, setIsVisible] = useState(false);
    const [waveformWidth, setWaveformWidth] = useState(320);
    const waveformContainerRef = useRef<HTMLDivElement>(null);
    const { subscribeToAudioLevels } = useAudioRecording();

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
        setWaveformWidth(Math.floor(container.offsetWidth) || 320);

        return () => resizeObserver.disconnect();
    }, []);

    // Subscribe to audio levels from context (same data widget receives)
    useEffect(() => {
        if (!isRecording) {
            setAudioLevels([]);
            return;
        }

        const unsubscribe = subscribeToAudioLevels((levels) => {
            setAudioLevels(levels);
        });

        return () => {
            unsubscribe();
            setAudioLevels([]);
        };
    }, [isRecording, subscribeToAudioLevels]);

    return (
        <div className={`recording-controls ${isVisible ? 'recording-controls--visible' : ''}`}>
            <button
                className={`recording-controls__button ${isRecording ? 'recording-controls__button--recording' : ''}`}
                onClick={onToggleRecording}
                disabled={disabled}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
                {isRecording ? (
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="recording-controls__icon"
                    >
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                ) : (
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

            <div
                ref={waveformContainerRef}
                className={`recording-controls__waveform ${isRecording ? 'recording-controls__waveform--active' : ''}`}
            >
                <Waveform
                    isRecording={isRecording}
                    audioLevels={audioLevels}
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
