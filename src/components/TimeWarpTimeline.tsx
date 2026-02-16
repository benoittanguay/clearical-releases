import { useState, useRef, useEffect, useCallback } from 'react';
import type { BackgroundActivity } from '../types/shared';

interface TimeWarpTimelineProps {
    backgroundActivities: BackgroundActivity[];
    timerStartTime: number | null;
    actualStartTime: number | null;
    isRunning: boolean;
    onStartTimeChange: (timestamp: number) => void;
    onStartTimer: (timestamp: number) => void;
}

const MIN_VISIBLE_DURATION = 15 * 60 * 1000;   // 15 minutes
const MAX_VISIBLE_DURATION = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_VISIBLE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const TIMELINE_HEIGHT = 60;
const BASELINE_Y = 40;
const ICON_SIZE = 20;
const CONTENT_PADDING = 16; // matches parent px-4 for internal content alignment

function formatHourLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// SVG icon components for zoom buttons
function ZoomInIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="4.5" cy="4.5" r="3.5" />
            <line x1="7" y1="7" x2="9.5" y2="9.5" />
            <line x1="3" y1="4.5" x2="6" y2="4.5" />
            <line x1="4.5" y1="3" x2="4.5" y2="6" />
        </svg>
    );
}

function ZoomOutIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="4.5" cy="4.5" r="3.5" />
            <line x1="7" y1="7" x2="9.5" y2="9.5" />
            <line x1="3" y1="4.5" x2="6" y2="4.5" />
        </svg>
    );
}

export function TimeWarpTimeline({
    backgroundActivities,
    timerStartTime,
    actualStartTime,
    isRunning,
    onStartTimeChange,
    onStartTimer,
}: TimeWarpTimelineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [now, setNow] = useState(Date.now());
    const [visibleDuration, setVisibleDuration] = useState(DEFAULT_VISIBLE_DURATION);
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredNode, setHoveredNode] = useState<BackgroundActivity | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // --- Hover playhead ---
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPct, setHoverPct] = useState<number | null>(null);

    // --- App icon cache ---
    const [iconCache, setIconCache] = useState<Record<string, string>>({});
    const fetchedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        // @ts-ignore
        if (!window.electron?.ipcRenderer?.getAppIcon) return;

        const appNames = [...new Set(backgroundActivities.map(a => a.appName).filter(Boolean))];
        const missing = appNames.filter(name => !fetchedRef.current.has(name));
        if (missing.length === 0) return;

        for (const name of missing) fetchedRef.current.add(name);

        Promise.all(missing.map(async (appName) => {
            try {
                // @ts-ignore
                const icon = await window.electron.ipcRenderer.getAppIcon(appName);
                return [appName, icon] as const;
            } catch {
                return [appName, null] as const;
            }
        })).then(results => {
            const newIcons: Record<string, string> = {};
            for (const [appName, icon] of results) {
                if (icon) newIcons[appName] = icon;
            }
            if (Object.keys(newIcons).length > 0) {
                setIconCache(prev => ({ ...prev, ...newIcons }));
            }
        });
    }, [backgroundActivities]);

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const visibleEnd = now;
    const visibleStart = visibleEnd - visibleDuration;

    const timestampToPercent = useCallback((timestamp: number): number => {
        return ((timestamp - visibleStart) / visibleDuration) * 100;
    }, [visibleStart, visibleDuration]);

    const pixelToTimestamp = useCallback((x: number): number => {
        const container = containerRef.current;
        if (!container) return now;
        const rect = container.getBoundingClientRect();
        const fraction = (x - rect.left) / rect.width;
        return visibleStart + fraction * visibleDuration;
    }, [visibleStart, visibleDuration, now]);

    const [proposedTime, setProposedTime] = useState<number | null>(null);

    const playheadTime = isDragging && proposedTime !== null
        ? proposedTime
        : timerStartTime;

    const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
        if (!isRunning) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, [isRunning]);

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            let ts = pixelToTimestamp(e.clientX);
            ts = Math.max(visibleStart, Math.min(now, ts));
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
    }, [isDragging, pixelToTimestamp, visibleStart, now, proposedTime, onStartTimeChange]);

    const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
        if (isDragging) return;
        let ts = pixelToTimestamp(e.clientX);
        ts = Math.max(visibleStart, Math.min(now, ts));
        setHoverTime(ts);
        const container = containerRef.current;
        if (container) {
            const rect = container.getBoundingClientRect();
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            setHoverPct(Math.max(0, Math.min(100, pct)));
        }
    }, [isDragging, pixelToTimestamp, visibleStart, now]);

    const handleTimelineMouseLeave = useCallback(() => {
        setHoverTime(null);
        setHoverPct(null);
    }, []);

    const handleTimelineClick = useCallback((e: React.MouseEvent) => {
        if (isDragging) return;

        let ts = pixelToTimestamp(e.clientX);
        ts = Math.max(visibleStart, Math.min(now, ts));

        if (isRunning) {
            onStartTimeChange(ts);
        } else {
            onStartTimer(ts);
        }
    }, [isDragging, isRunning, pixelToTimestamp, visibleStart, now, onStartTimeChange, onStartTimer]);

    const zoomIn = useCallback(() => {
        setVisibleDuration(prev => Math.max(MIN_VISIBLE_DURATION, prev * 0.6));
    }, []);

    const zoomOut = useCallback(() => {
        setVisibleDuration(prev => Math.min(MAX_VISIBLE_DURATION, prev * 1.6));
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setVisibleDuration(prev => {
                const factor = e.deltaY > 0 ? 1.2 : 0.8;
                const next = prev * factor;
                return Math.max(MIN_VISIBLE_DURATION, Math.min(MAX_VISIBLE_DURATION, next));
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    // --- Hour marks ---
    const hourMarks: { timestamp: number; isHour: boolean }[] = [];
    {
        const HOUR_MS = 60 * 60 * 1000;
        const HALF_HOUR_MS = 30 * 60 * 1000;
        const firstHalfHour = Math.ceil(visibleStart / HALF_HOUR_MS) * HALF_HOUR_MS;
        for (let t = firstHalfHour; t <= visibleEnd; t += HALF_HOUR_MS) {
            hourMarks.push({ timestamp: t, isHour: t % HOUR_MS === 0 });
        }
    }

    const visibleActivities = backgroundActivities.filter(a =>
        a.startTimestamp <= visibleEnd && a.endTimestamp >= visibleStart
    );

    // --- Highlighted regions ---
    const REGION_HEIGHT = (TIMELINE_HEIGHT - 12) * 0.8;
    const REGION_TOP = BASELINE_Y - REGION_HEIGHT / 2;

    const isTimeWarped = isRunning && playheadTime !== null && actualStartTime !== null && playheadTime < actualStartTime;

    // Label positioning: all label container bottoms sit just above the region
    const LABEL_BOTTOM_Y = REGION_TOP - 2;

    const timeWarpRegion = isTimeWarped ? (() => {
        const startPct = Math.max(0, timestampToPercent(playheadTime!));
        const endPct = Math.min(100, timestampToPercent(actualStartTime!));
        if (startPct >= endPct) return null;
        return { startPct, endPct };
    })() : null;

    const activeRegion = isRunning && actualStartTime !== null ? (() => {
        const startPct = Math.max(0, timestampToPercent(isTimeWarped ? actualStartTime : (playheadTime ?? actualStartTime)));
        const endPct = 100;
        if (startPct >= endPct) return null;
        return { startPct, endPct };
    })() : null;

    // Shared label container style
    const labelContainerStyle: React.CSSProperties = {
        padding: '2px 5px',
        borderRadius: 3,
        backgroundColor: '#ffffff',
        border: '1px solid var(--color-border-secondary)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
    };

    return (
        <div
            ref={containerRef}
            className="w-full select-none"
            style={{
                height: TIMELINE_HEIGHT,
                position: 'relative',
                overflow: 'visible',
                cursor: isDragging ? 'grabbing' : 'pointer',
            }}
            onClick={handleTimelineClick}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
        >
            {/* Horizontal baseline */}
            <div
                style={{
                    position: 'absolute',
                    left: 0, right: 0,
                    top: BASELINE_Y,
                    height: 1,
                    backgroundColor: 'var(--color-border-secondary)',
                }}
            />

            {/* TimeWarp region (orange) */}
            {timeWarpRegion && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${timeWarpRegion.startPct}%`,
                        width: `${timeWarpRegion.endPct - timeWarpRegion.startPct}%`,
                        top: REGION_TOP,
                        height: REGION_HEIGHT,
                        backgroundColor: 'var(--color-accent)',
                        opacity: 0.12,
                        borderRadius: 3,
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* Active region (white) */}
            {activeRegion && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${activeRegion.startPct}%`,
                        width: `${activeRegion.endPct - activeRegion.startPct}%`,
                        top: REGION_TOP,
                        height: REGION_HEIGHT,
                        backgroundColor: '#ffffff',
                        opacity: 0.5,
                        borderRadius: 3,
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* Actual start playhead with label */}
            {isTimeWarped && (() => {
                const pct = timestampToPercent(actualStartTime!);
                if (pct < 0 || pct > 100) return null;
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: 0,
                            bottom: 0,
                            width: 0,
                            zIndex: 8,
                            pointerEvents: 'none',
                        }}
                    >
                        <div
                            style={{
                                position: 'absolute',
                                left: -1,
                                top: REGION_TOP - 4,
                                bottom: TIMELINE_HEIGHT - (REGION_TOP + REGION_HEIGHT + 4),
                                width: 2,
                                backgroundColor: 'var(--color-text-tertiary)',
                                opacity: 0.4,
                                borderRadius: 1,
                            }}
                        />
                        {/* Label */}
                        <div
                            style={{
                                position: 'absolute',
                                bottom: TIMELINE_HEIGHT - (REGION_TOP - 4),
                                left: '50%',
                                transform: 'translateX(-50%)',
                                ...labelContainerStyle,
                            }}
                        >
                            <div style={{
                                fontSize: 8,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-tertiary)',
                                fontWeight: 600,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase' as const,
                            }}>
                                Timer Started
                            </div>
                            <div style={{
                                fontSize: 10,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-secondary)',
                                fontWeight: 600,
                            }}>
                                {formatHourLabel(actualStartTime!)}
                            </div>
                        </div>
                    </div>
                );
            })()}

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
                            top: mark.isHour ? BASELINE_Y - 6 : BASELINE_Y - 3,
                            width: 1,
                            height: mark.isHour ? 12 : 6,
                            backgroundColor: 'var(--color-text-tertiary)',
                            opacity: mark.isHour ? 0.5 : 0.25,
                        }}
                    >
                        {mark.isHour && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: LABEL_BOTTOM_Y - 14 - (BASELINE_Y - 6),
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    fontSize: 10,
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-text-tertiary)',
                                    fontWeight: 600,
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

                const icon = iconCache[activity.appName];

                return (
                    <div
                        key={activity.id}
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: BASELINE_Y,
                            transform: 'translate(-50%, -50%)',
                            width: ICON_SIZE,
                            height: ICON_SIZE,
                            cursor: 'default',
                            zIndex: 2,
                        }}
                        onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredNode(activity);
                            setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
                        }}
                        onMouseLeave={() => setHoveredNode(null)}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {icon ? (
                            <img
                                src={icon}
                                alt={activity.appName}
                                draggable={false}
                                style={{ width: ICON_SIZE, height: ICON_SIZE, borderRadius: 3, display: 'block' }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: ICON_SIZE, height: ICON_SIZE,
                                    borderRadius: 3,
                                    backgroundColor: 'var(--color-text-tertiary)',
                                    opacity: 0.4,
                                }}
                            />
                        )}
                        {activity.isMeeting && (
                            <div
                                style={{
                                    position: 'absolute', top: -2, right: -2,
                                    width: 6, height: 6,
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--color-error)',
                                    border: '1px solid var(--color-bg-primary)',
                                }}
                            />
                        )}
                    </div>
                );
            })}

            {/* Activity tooltip */}
            {hoveredNode && (
                <div
                    style={{
                        position: 'fixed',
                        left: tooltipPos.x,
                        top: tooltipPos.y - 8,
                        transform: 'translate(-50%, -100%)',
                        padding: '6px 10px',
                        borderRadius: 6,
                        backgroundColor: '#1a1a1a',
                        color: '#ffffff',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        zIndex: 100,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{hoveredNode.appName}</div>
                    <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {hoveredNode.windowTitle}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9 }}>
                        {formatHourLabel(hoveredNode.startTimestamp)}
                    </div>
                </div>
            )}

            {/* Hover playhead — hidden when running and hovering past actualStartTime */}
            {hoverTime !== null && hoverPct !== null && !isDragging && !(isRunning && actualStartTime !== null && hoverTime >= actualStartTime) && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${hoverPct}%`,
                        top: 0,
                        bottom: 0,
                        width: 0,
                        zIndex: 5,
                        pointerEvents: 'none',
                    }}
                >
                    {/* Vertical line */}
                    <div
                        style={{
                            position: 'absolute',
                            left: -1,
                            top: REGION_TOP - 4,
                            bottom: TIMELINE_HEIGHT - (REGION_TOP + REGION_HEIGHT + 4),
                            width: 2,
                            backgroundColor: isRunning ? 'var(--color-text-tertiary)' : 'var(--color-accent)',
                            opacity: isRunning ? 0.3 : 0.5,
                            borderRadius: 1,
                        }}
                    />
                    {/* Label container */}
                    <div
                        style={{
                            position: 'absolute',
                            bottom: TIMELINE_HEIGHT - (REGION_TOP - 4),
                            left: '50%',
                            transform: 'translateX(-50%)',
                            ...labelContainerStyle,
                        }}
                    >
                        <div style={{
                            fontSize: 8,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--color-accent)',
                            fontWeight: 600,
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase' as const,
                        }}>
                            {isRunning ? 'Start from here' : 'Start Timer'}
                        </div>
                        <div style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            color: isRunning ? 'var(--color-text-secondary)' : 'var(--color-accent)',
                            fontWeight: 600,
                        }}>
                            {formatHourLabel(hoverTime)}
                        </div>
                    </div>
                </div>
            )}

            {/* Playhead (active timer start) */}
            {playheadTime !== null && (() => {
                const pct = timestampToPercent(playheadTime);
                if (pct < 0 || pct > 100) return null;
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: 0, bottom: 0,
                            width: 0,
                            zIndex: 10,
                            pointerEvents: 'none',
                        }}
                    >
                        {/* Time label in container */}
                        <div
                            style={{
                                position: 'absolute',
                                bottom: TIMELINE_HEIGHT - (REGION_TOP - 4),
                                left: '50%',
                                transform: 'translateX(-50%)',
                                ...labelContainerStyle,
                                borderColor: 'var(--color-accent)',
                            }}
                        >
                            {isTimeWarped && (
                                <div style={{
                                    fontSize: 8,
                                    fontFamily: 'var(--font-mono)',
                                    color: 'var(--color-accent)',
                                    fontWeight: 600,
                                    letterSpacing: '0.04em',
                                    textTransform: 'uppercase' as const,
                                }}>
                                    Backdated Start
                                </div>
                            )}
                            <div style={{
                                fontSize: 10,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-accent)',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                            }}>
                                {formatHourLabel(playheadTime)}
                            </div>
                        </div>

                        {/* Vertical line */}
                        <div
                            style={{
                                position: 'absolute',
                                left: -1,
                                top: REGION_TOP - 4,
                                bottom: TIMELINE_HEIGHT - (REGION_TOP + REGION_HEIGHT + 4),
                                width: 2,
                                backgroundColor: 'var(--color-accent)',
                                borderRadius: 1,
                                cursor: isDragging ? 'grabbing' : 'grab',
                                pointerEvents: 'auto',
                            }}
                            onMouseDown={handlePlayheadMouseDown}
                        />
                    </div>
                );
            })()}

            {/* Zoom controls */}
            <div
                style={{
                    position: 'absolute',
                    left: CONTENT_PADDING,
                    bottom: TIMELINE_HEIGHT - LABEL_BOTTOM_Y,
                    display: 'flex',
                    gap: 2,
                    zIndex: 20,
                    pointerEvents: 'auto',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={zoomIn}
                    style={{
                        width: 20, height: 18,
                        borderRadius: 3,
                        border: '1px solid var(--color-border-primary)',
                        backgroundColor: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                    }}
                    title="Zoom in"
                >
                    <ZoomInIcon />
                </button>
                <button
                    onClick={zoomOut}
                    style={{
                        width: 20, height: 18,
                        borderRadius: 3,
                        border: '1px solid var(--color-border-primary)',
                        backgroundColor: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                    }}
                    title="Zoom out"
                >
                    <ZoomOutIcon />
                </button>
            </div>

            {/* NOW label */}
            <div
                style={{
                    position: 'absolute',
                    right: CONTENT_PADDING,
                    bottom: TIMELINE_HEIGHT - LABEL_BOTTOM_Y,
                    fontSize: 10,
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
