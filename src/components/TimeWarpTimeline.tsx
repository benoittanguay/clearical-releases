import { useState, useRef, useEffect, useCallback } from 'react';
import type { BackgroundActivity } from '../types/shared';

interface TimeWarpTimelineProps {
    backgroundActivities: BackgroundActivity[];
    timerStartTime: number | null;
    isRunning: boolean;
    onStartTimeChange: (timestamp: number) => void;
}

const MIN_VISIBLE_DURATION = 15 * 60 * 1000;   // 15 minutes
const MAX_VISIBLE_DURATION = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_VISIBLE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const TIMELINE_HEIGHT = 60;
const BASELINE_Y = 40;
const NODE_RADIUS = 4;

function stringToHue(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

function formatHourLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TimeWarpTimeline({
    backgroundActivities,
    timerStartTime,
    isRunning,
    onStartTimeChange,
}: TimeWarpTimelineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(Date.now());
    const [visibleDuration, setVisibleDuration] = useState(DEFAULT_VISIBLE_DURATION);
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredNode, setHoveredNode] = useState<BackgroundActivity | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // Track the original start time when timer is running to prevent dragging right past it
    const originalStartTimeRef = useRef<number | null>(null);
    useEffect(() => {
        if (isRunning && timerStartTime !== null && originalStartTimeRef.current === null) {
            originalStartTimeRef.current = timerStartTime;
        }
        if (!isRunning) {
            originalStartTimeRef.current = null;
        }
    }, [isRunning, timerStartTime]);

    // Update "now" every second
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const visibleEnd = now;
    const visibleStart = visibleEnd - visibleDuration;

    // Convert timestamp to x percentage (0 = left edge, 100 = right edge)
    const timestampToPercent = useCallback((timestamp: number): number => {
        return ((timestamp - visibleStart) / visibleDuration) * 100;
    }, [visibleStart, visibleDuration]);

    // Convert x pixel position to timestamp
    const pixelToTimestamp = useCallback((x: number): number => {
        const container = containerRef.current;
        if (!container) return now;
        const rect = container.getBoundingClientRect();
        const fraction = (x - rect.left) / rect.width;
        return visibleStart + fraction * visibleDuration;
    }, [visibleStart, visibleDuration, now]);

    // Playhead position: either timer start time or the proposed time from dragging
    const [proposedTime, setProposedTime] = useState<number | null>(null);

    const playheadTime = isDragging && proposedTime !== null
        ? proposedTime
        : timerStartTime;

    // --- Drag handling ---
    const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            let ts = pixelToTimestamp(e.clientX);

            // Clamp to visible range
            ts = Math.max(visibleStart, Math.min(now, ts));

            // If timer is running, cannot drag right past original start
            if (isRunning && originalStartTimeRef.current !== null) {
                ts = Math.min(ts, originalStartTimeRef.current);
            }

            setProposedTime(ts);
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            if (proposedTime !== null) {
                onStartTimeChange(proposedTime);
            }
            setProposedTime(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, pixelToTimestamp, visibleStart, now, isRunning, proposedTime, onStartTimeChange]);

    // --- Click on timeline to set playhead ---
    const handleTimelineClick = useCallback((e: React.MouseEvent) => {
        // Don't handle if it was a drag release or node hover
        if (isDragging) return;

        let ts = pixelToTimestamp(e.clientX);
        ts = Math.max(visibleStart, Math.min(now, ts));

        if (isRunning && originalStartTimeRef.current !== null) {
            ts = Math.min(ts, originalStartTimeRef.current);
        }

        onStartTimeChange(ts);
    }, [isDragging, pixelToTimestamp, visibleStart, now, isRunning, onStartTimeChange]);

    // --- Scroll zoom ---
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        setVisibleDuration(prev => {
            const factor = e.deltaY > 0 ? 1.2 : 0.8;
            const next = prev * factor;
            return Math.max(MIN_VISIBLE_DURATION, Math.min(MAX_VISIBLE_DURATION, next));
        });
    }, []);

    // --- Compute hour marks ---
    const hourMarks: { timestamp: number; isHour: boolean }[] = [];
    {
        const HOUR_MS = 60 * 60 * 1000;
        const HALF_HOUR_MS = 30 * 60 * 1000;

        // Find the first half-hour boundary at or after visibleStart
        const firstHalfHour = Math.ceil(visibleStart / HALF_HOUR_MS) * HALF_HOUR_MS;
        for (let t = firstHalfHour; t <= visibleEnd; t += HALF_HOUR_MS) {
            hourMarks.push({
                timestamp: t,
                isHour: t % HOUR_MS === 0,
            });
        }
    }

    // --- Filter visible activities ---
    const visibleActivities = backgroundActivities.filter(a =>
        a.startTimestamp <= visibleEnd && a.endTimestamp >= visibleStart
    );

    return (
        <div
            ref={containerRef}
            className="w-full select-none"
            style={{
                height: TIMELINE_HEIGHT,
                position: 'relative',
                cursor: isDragging ? 'grabbing' : 'pointer',
            }}
            onClick={handleTimelineClick}
            onWheel={handleWheel}
        >
            {/* Horizontal baseline line */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: BASELINE_Y,
                    height: 1,
                    backgroundColor: 'var(--color-border-secondary)',
                }}
            />

            {/* Hour tick marks + labels */}
            {hourMarks.map(mark => {
                const pct = timestampToPercent(mark.timestamp);
                if (pct < 0 || pct > 100) return null;
                return (
                    <div
                        key={mark.timestamp}
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: mark.isHour ? BASELINE_Y - 8 : BASELINE_Y - 4,
                            width: 1,
                            height: mark.isHour ? 16 : 8,
                            backgroundColor: 'var(--color-border-primary)',
                            opacity: mark.isHour ? 0.6 : 0.3,
                        }}
                    >
                        {mark.isHour && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: -14,
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: 9,
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-text-tertiary)',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {formatHourLabel(mark.timestamp)}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Activity nodes */}
            {visibleActivities.map(activity => {
                const pct = timestampToPercent(activity.startTimestamp);
                if (pct < -2 || pct > 102) return null;

                const hue = stringToHue(activity.bundleId || activity.appName);
                const color = `hsl(${hue}, 60%, 55%)`;
                const isMeeting = activity.isMeeting;

                return (
                    <div
                        key={activity.id}
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: BASELINE_Y,
                            transform: isMeeting
                                ? `translate(-50%, -50%) rotate(45deg)`
                                : 'translate(-50%, -50%)',
                            width: isMeeting ? NODE_RADIUS * 2 : NODE_RADIUS * 2,
                            height: isMeeting ? NODE_RADIUS * 2 : NODE_RADIUS * 2,
                            borderRadius: isMeeting ? 1 : '50%',
                            backgroundColor: color,
                            cursor: 'default',
                            zIndex: 2,
                        }}
                        onMouseEnter={(e) => {
                            setHoveredNode(activity);
                            setTooltipPos({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={() => setHoveredNode(null)}
                        onClick={(e) => e.stopPropagation()}
                    />
                );
            })}

            {/* Tooltip for hovered node */}
            {hoveredNode && (
                <div
                    style={{
                        position: 'fixed',
                        left: tooltipPos.x + 8,
                        top: tooltipPos.y - 40,
                        padding: '4px 8px',
                        borderRadius: 4,
                        backgroundColor: 'var(--color-bg-tertiary)',
                        border: '1px solid var(--color-border-primary)',
                        color: 'var(--color-text-primary)',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        zIndex: 100,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{hoveredNode.appName}</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: 10 }}>
                        {hoveredNode.windowTitle}
                    </div>
                    <div style={{ color: 'var(--color-text-tertiary)', fontSize: 9 }}>
                        {formatHourLabel(hoveredNode.startTimestamp)}
                    </div>
                </div>
            )}

            {/* Playhead */}
            {playheadTime !== null && (() => {
                const pct = timestampToPercent(playheadTime);
                if (pct < 0 || pct > 100) return null;
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: 0,
                            bottom: 0,
                            width: 0,
                            zIndex: 10,
                            pointerEvents: 'none',
                        }}
                    >
                        {/* Time label above */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: 9,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-accent)',
                                whiteSpace: 'nowrap',
                                fontWeight: 600,
                            }}
                        >
                            {formatHourLabel(playheadTime)}
                        </div>

                        {/* Vertical line */}
                        <div
                            style={{
                                position: 'absolute',
                                left: -0.5,
                                top: 12,
                                bottom: 4,
                                width: 1,
                                backgroundColor: 'var(--color-accent)',
                            }}
                        />

                        {/* Draggable handle */}
                        <div
                            style={{
                                position: 'absolute',
                                left: -5,
                                top: BASELINE_Y - 5,
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                backgroundColor: 'var(--color-accent)',
                                cursor: isDragging ? 'grabbing' : 'grab',
                                pointerEvents: 'auto',
                                zIndex: 11,
                                boxShadow: '0 0 4px rgba(0,0,0,0.3)',
                            }}
                            onMouseDown={handlePlayheadMouseDown}
                        />
                    </div>
                );
            })()}

            {/* "NOW" label at right edge */}
            <div
                style={{
                    position: 'absolute',
                    right: 4,
                    top: BASELINE_Y - 16,
                    fontSize: 8,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text-tertiary)',
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                    textTransform: 'uppercase' as const,
                }}
            >
                NOW
            </div>
        </div>
    );
}

export default TimeWarpTimeline;
