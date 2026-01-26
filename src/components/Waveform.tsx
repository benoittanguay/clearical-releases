/**
 * Waveform Component
 *
 * Reusable audio waveform visualization that shows real-time audio levels.
 * Used in both the recording widget and the main app chrono page.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Waveform.css';

interface WaveformBar {
    height: number;
    id: number;
}

interface WaveformProps {
    isRecording: boolean;
    audioLevel?: number; // 0-1 normalized audio level
    width?: number; // Container width in pixels
    height?: number; // Container height in pixels
    variant?: 'dark' | 'light'; // Color scheme
}

// Waveform configuration
const BAR_WIDTH = 2;
const BAR_GAP = 4;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const SCROLL_SPEED = 30;
const MIN_HEIGHT = 6;
const MAX_HEIGHT_RATIO = 0.75; // Max bar height as ratio of container

export function Waveform({
    isRecording,
    audioLevel = 0,
    width = 400,
    height = 48,
    variant = 'dark'
}: WaveformProps): React.ReactElement {
    const maxHeight = height * MAX_HEIGHT_RATIO;
    const containerWidth = width;

    // Waveform state
    const [bars, setBars] = useState<WaveformBar[]>([]);
    const [trackPosition, setTrackPosition] = useState(containerWidth / 2);
    const [trackScale, setTrackScale] = useState(1);

    // Refs
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(performance.now());
    const barIdCounterRef = useRef<number>(0);
    const audioStateRef = useRef<'normal' | 'loud' | 'quiet'>('normal');
    const stateCounterRef = useRef<number>(0);
    const lastHeightRef = useRef<number>(maxHeight * 0.5);
    const currentIntensityRef = useRef<number>(0);
    const currentAudioLevelRef = useRef<number>(0);
    const hasRealAudioRef = useRef<boolean>(false);
    const recentAudioLevelsRef = useRef<number[]>([]);

    // Update audio level ref when prop changes
    useEffect(() => {
        if (audioLevel > 0) {
            hasRealAudioRef.current = true;
            recentAudioLevelsRef.current.push(audioLevel);
            if (recentAudioLevelsRef.current.length > 5) {
                recentAudioLevelsRef.current.shift();
            }
            const smoothedLevel = Math.max(...recentAudioLevelsRef.current);
            const compressed = Math.pow(smoothedLevel, 0.5);
            currentAudioLevelRef.current = Math.max(0.05, Math.min(1, compressed));
        }
    }, [audioLevel]);

    // Generate bar height based on audio state or real data
    const generateBarHeight = useCallback((): number => {
        // If we have real audio levels, use them
        if (hasRealAudioRef.current && isRecording) {
            const level = currentAudioLevelRef.current;

            // Add organic variation that scales with the audio level
            const variationRange = 0.15 + level * 0.25;
            const variation = 1 + (Math.random() - 0.5) * 2 * variationRange;

            // Calculate base height from audio level
            const baseHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * level;

            // Apply variation and smooth with previous height for continuity
            const targetHeight = baseHeight * variation;
            const smoothed = lastHeightRef.current * 0.3 + targetHeight * 0.7;
            lastHeightRef.current = smoothed;

            return Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.round(smoothed)));
        }

        // Fallback to simulated audio when recording
        if (isRecording) {
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
                targetHeight = maxHeight * (0.7 + Math.random() * 0.3);
            } else if (audioStateRef.current === 'quiet') {
                targetHeight = MIN_HEIGHT + Math.random() * 8;
            } else {
                targetHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * (0.3 + Math.random() * 0.4);
            }

            lastHeightRef.current = lastHeightRef.current * 0.3 + targetHeight * 0.7;
            return Math.round(lastHeightRef.current);
        }

        // Not recording - return minimum height
        return MIN_HEIGHT;
    }, [isRecording, maxHeight]);

    // Initialize waveform bars
    useEffect(() => {
        const barsNeeded = Math.ceil(containerWidth / BAR_STEP) + 25;
        const initialBars: WaveformBar[] = [];

        for (let i = 0; i < barsNeeded; i++) {
            initialBars.push({
                height: MIN_HEIGHT,
                id: barIdCounterRef.current++
            });
        }

        setBars(initialBars);
        setTrackPosition(containerWidth / 2);
    }, [containerWidth]);

    // Waveform animation loop
    useEffect(() => {
        if (!isRecording) {
            // Reset refs when not recording
            hasRealAudioRef.current = false;
            recentAudioLevelsRef.current = [];
            return;
        }

        lastTimeRef.current = performance.now();
        let isActive = true;

        const animate = (currentTime: number) => {
            if (!isActive) return;

            let deltaTime = (currentTime - lastTimeRef.current) / 1000;
            deltaTime = Math.min(deltaTime, 0.1);
            lastTimeRef.current = currentTime;

            setTrackPosition(prevPos => {
                let newPos = prevPos - SCROLL_SPEED * deltaTime;

                setBars(prevBars => {
                    const trackWidth = prevBars.length * BAR_STEP;
                    const rightEdge = newPos + trackWidth;

                    if (rightEdge < containerWidth + BAR_STEP * 5) {
                        const newHeight = generateBarHeight();
                        const newIntensity = (newHeight - MIN_HEIGHT) / (maxHeight - MIN_HEIGHT);
                        currentIntensityRef.current = currentIntensityRef.current * 0.2 + newIntensity * 0.8;

                        return [...prevBars, { height: newHeight, id: barIdCounterRef.current++ }];
                    }

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

            const pulseScale = 0.85 + (currentIntensityRef.current * 0.3);
            setTrackScale(pulseScale);

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            isActive = false;
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isRecording, generateBarHeight, containerWidth, maxHeight]);

    // Determine if a bar is on the left (recorded) or right (buffer) side
    const getBarSide = (barIndex: number): 'left' | 'right' => {
        const barPosition = trackPosition + barIndex * BAR_STEP + BAR_WIDTH / 2;
        return barPosition < containerWidth / 2 ? 'left' : 'right';
    };

    return (
        <div
            className={`waveform-component waveform-component--${variant}`}
            style={{ width, height }}
        >
            <div className="waveform-component__bg-left" />
            <div className="waveform-component__bg-right" />
            <div
                className="waveform-component__track"
                style={{
                    left: `${trackPosition}px`,
                    transform: `scaleY(${trackScale})`
                }}
            >
                {bars.map((bar, index) => (
                    <div
                        key={bar.id}
                        className="waveform-component__bar"
                        style={{
                            width: `${BAR_WIDTH}px`,
                            minWidth: `${BAR_WIDTH}px`,
                            height: `${bar.height}px`,
                            marginRight: `${BAR_GAP}px`
                        }}
                    >
                        <div
                            className="waveform-component__bar-layer waveform-component__bar-layer--recorded"
                            style={{ opacity: getBarSide(index) === 'left' ? 1 : 0 }}
                        />
                        <div
                            className="waveform-component__bar-layer waveform-component__bar-layer--buffer"
                            style={{ opacity: getBarSide(index) === 'right' ? 1 : 0 }}
                        />
                    </div>
                ))}
            </div>
            {/* Playhead */}
            <div className="waveform-component__playhead" />
            {/* Scanline overlay */}
            <div className="waveform-component__scanlines" />
        </div>
    );
}

export default Waveform;
