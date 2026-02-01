/**
 * Waveform Component
 *
 * Reusable audio waveform visualization that shows real-time audio levels.
 * Uses smooth scrolling with proper state management to avoid nested updates.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Waveform.css';

interface WaveformProps {
    isRecording: boolean;
    audioLevel?: number; // 0-1 normalized audio level
    elapsedMs?: number; // Recording elapsed time in milliseconds (for sync)
    width?: number; // Container width in pixels
    height?: number; // Container height in pixels
    variant?: 'dark' | 'light'; // Color scheme
    showPlayhead?: boolean; // Show the center playhead line
    showScanlines?: boolean; // Show the scanlines overlay
}

interface WaveformBar {
    height: number;
    id: number;
}

// Waveform configuration
const BAR_WIDTH = 2;
const BAR_GAP = 4;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const SCROLL_SPEED = 12; // pixels per second
const MIN_HEIGHT = 6;
const MAX_HEIGHT_RATIO = 0.75;

export function Waveform({
    isRecording,
    audioLevel = 0,
    elapsedMs = 0,
    width = 400,
    height = 48,
    variant = 'dark',
    showPlayhead = true,
    showScanlines = true
}: WaveformProps): React.ReactElement {
    const maxHeight = height * MAX_HEIGHT_RATIO;
    const containerWidth = width;

    // Use refs for animation state to avoid re-render loops
    const barsRef = useRef<WaveformBar[]>([]);
    const trackPositionRef = useRef(0);
    const barIdCounterRef = useRef(0);
    const lastTimeRef = useRef(performance.now());
    const lastHeightRef = useRef(maxHeight * 0.5);
    const currentAudioLevelRef = useRef(0);
    const hasRealAudioRef = useRef(false);
    const recentAudioLevelsRef = useRef<number[]>([]);
    const initializedRef = useRef(false);
    const initialElapsedMsRef = useRef(elapsedMs); // Capture initial elapsed time for sync

    // State for rendering (updated periodically)
    const [, forceUpdate] = useState(0);

    // Update audio level ref when prop changes
    useEffect(() => {
        if (audioLevel > 0) {
            hasRealAudioRef.current = true;
            recentAudioLevelsRef.current.push(audioLevel);
            if (recentAudioLevelsRef.current.length > 5) {
                recentAudioLevelsRef.current.shift();
            }
            // Use average instead of max for more natural variation
            const avg = recentAudioLevelsRef.current.reduce((a, b) => a + b, 0) / recentAudioLevelsRef.current.length;
            // Light compression to preserve dynamic range
            const compressed = Math.pow(avg, 0.7);
            currentAudioLevelRef.current = Math.max(0.02, Math.min(1, compressed));
        }
    }, [audioLevel]);

    // Generate bar height based on audio level
    const generateBarHeight = useCallback((): number => {
        if (hasRealAudioRef.current && isRecording) {
            const level = currentAudioLevelRef.current;
            // More variation at all audio levels for dynamic waveform
            const variationRange = 0.3 + level * 0.4;
            const variation = 1 + (Math.random() - 0.5) * 2 * variationRange;
            // Scale the level to preserve dynamic range (quiet = short bars)
            const scaledLevel = Math.pow(level, 0.7);
            const baseHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * scaledLevel;
            const targetHeight = baseHeight * variation;
            // Less smoothing for more responsive movement
            const smoothed = lastHeightRef.current * 0.2 + targetHeight * 0.8;
            lastHeightRef.current = smoothed;
            return Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.round(smoothed)));
        }

        if (isRecording) {
            // Idle animation with more variation
            const variation = 0.2 + Math.random() * 0.5;
            const targetHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * variation;
            const smoothed = lastHeightRef.current * 0.2 + targetHeight * 0.8;
            lastHeightRef.current = smoothed;
            return Math.round(smoothed);
        }

        return MIN_HEIGHT;
    }, [isRecording, maxHeight]);

    // Initialize bars and position based on elapsed time (only on mount or container resize)
    useEffect(() => {
        // Calculate where track should be based on initial elapsed time (for sync)
        const targetPosition = -(initialElapsedMsRef.current / 1000) * SCROLL_SPEED;

        // Calculate how many bars we need
        const barsNeeded = Math.ceil(containerWidth / BAR_STEP) + 10;

        // Calculate how many bars should have scrolled past based on elapsed time
        const barsScrolledPast = Math.max(0, Math.floor(Math.abs(targetPosition) / BAR_STEP));
        const totalBarsNeeded = barsNeeded + barsScrolledPast;

        // Generate initial bars with varied heights to look natural
        const initialBars: WaveformBar[] = [];
        let lastHeight = maxHeight * 0.5;
        for (let i = 0; i < totalBarsNeeded; i++) {
            // Use random variation similar to idle animation
            const variation = 0.2 + Math.random() * 0.5;
            const targetHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * variation;
            const smoothed = lastHeight * 0.2 + targetHeight * 0.8;
            lastHeight = smoothed;
            initialBars.push({
                height: Math.round(smoothed),
                id: barIdCounterRef.current++
            });
        }

        barsRef.current = initialBars;
        trackPositionRef.current = targetPosition;
        initializedRef.current = true;
        lastHeightRef.current = lastHeight; // Preserve continuity
        forceUpdate(n => n + 1);
    }, [containerWidth, maxHeight]);

    // Animation loop
    useEffect(() => {
        if (!isRecording) {
            hasRealAudioRef.current = false;
            recentAudioLevelsRef.current = [];
            return;
        }

        let isActive = true;
        lastTimeRef.current = performance.now();

        const animate = (currentTime: number) => {
            if (!isActive) return;

            let deltaTime = (currentTime - lastTimeRef.current) / 1000;
            deltaTime = Math.min(deltaTime, 0.1); // Cap to prevent jumps
            lastTimeRef.current = currentTime;

            // Update track position
            trackPositionRef.current -= SCROLL_SPEED * deltaTime;

            // Check if we need to add new bars on the right
            const trackWidth = barsRef.current.length * BAR_STEP;
            const rightEdge = trackPositionRef.current + trackWidth;

            if (rightEdge < containerWidth + BAR_STEP * 5) {
                barsRef.current = [...barsRef.current, {
                    height: generateBarHeight(),
                    id: barIdCounterRef.current++
                }];
            }

            // Remove bars that have scrolled off the left
            if (barsRef.current.length > 0) {
                const firstBarRight = trackPositionRef.current + BAR_STEP;
                if (firstBarRight < -BAR_STEP) {
                    trackPositionRef.current += BAR_STEP;
                    barsRef.current = barsRef.current.slice(1);
                }
            }

            // Trigger re-render
            forceUpdate(n => n + 1);

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        const animationFrameRef = { current: 0 };
        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            isActive = false;
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isRecording, containerWidth, generateBarHeight]);

    // Determine if a bar is on the left (recorded) or right (buffer) side
    const getBarSide = (barIndex: number): 'left' | 'right' => {
        const barPosition = trackPositionRef.current + barIndex * BAR_STEP + BAR_WIDTH / 2;
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
                style={{ left: `${trackPositionRef.current}px` }}
            >
                {barsRef.current.map((bar, index) => (
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
            {showPlayhead && <div className="waveform-component__playhead" />}
            {showScanlines && <div className="waveform-component__scanlines" />}
        </div>
    );
}

export default Waveform;
