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
    audioLevels?: number[]; // Raw frequency bin levels (0-1), drives bar heights directly
    audioLevel?: number; // Fallback single level if audioLevels not provided
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
    audioLevels,
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
    const hasRealAudioRef = useRef(false);
    const initializedRef = useRef(false);
    const initialElapsedMsRef = useRef(elapsedMs); // Capture initial elapsed time for sync

    // Raw frequency bin data — drives bar heights directly
    const currentBinsRef = useRef<number[]>([]);
    const binIndexRef = useRef(0);

    // State for rendering (updated periodically)
    const [, forceUpdate] = useState(0);

    // Update frequency bins when new audio data arrives
    useEffect(() => {
        if (audioLevels && audioLevels.length > 0) {
            currentBinsRef.current = audioLevels;
            hasRealAudioRef.current = true;
        } else if (audioLevel > 0) {
            // Fallback: create uniform bins from single level
            currentBinsRef.current = new Array(24).fill(audioLevel);
            hasRealAudioRef.current = true;
        }
    }, [audioLevels, audioLevel]);

    // Generate bar height from actual audio frequency data
    const generateBarHeight = useCallback((): number => {
        const bins = currentBinsRef.current;

        if (hasRealAudioRef.current && isRecording && bins.length > 0) {
            // Cycle through frequency bins so consecutive bars show different frequencies
            const binIndex = binIndexRef.current % bins.length;
            binIndexRef.current++;

            const binLevel = bins[binIndex];

            // Direct mapping: bin level drives bar height
            const targetHeight = MIN_HEIGHT + (maxHeight - MIN_HEIGHT) * binLevel;

            // Light smoothing (20% previous, 80% new) for visual continuity
            const smoothed = lastHeightRef.current * 0.2 + targetHeight * 0.8;
            lastHeightRef.current = smoothed;
            return Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.round(smoothed)));
        }

        if (isRecording) {
            // No audio data yet — show flat minimum bars
            const targetHeight = MIN_HEIGHT;
            const smoothed = lastHeightRef.current * 0.3 + targetHeight * 0.7;
            lastHeightRef.current = smoothed;
            return Math.max(MIN_HEIGHT, Math.round(smoothed));
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

        // Generate initial bars at minimum height — real audio data will drive heights
        const initialBars: WaveformBar[] = [];
        for (let i = 0; i < totalBarsNeeded; i++) {
            initialBars.push({
                height: MIN_HEIGHT,
                id: barIdCounterRef.current++
            });
        }

        barsRef.current = initialBars;
        trackPositionRef.current = targetPosition;
        initializedRef.current = true;
        lastHeightRef.current = MIN_HEIGHT;
        forceUpdate(n => n + 1);
    }, [containerWidth, maxHeight]);

    // Animation loop
    useEffect(() => {
        if (!isRecording) {
            hasRealAudioRef.current = false;
            currentBinsRef.current = [];
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
