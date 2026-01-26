/**
 * Transcription Activity Entry Component
 *
 * Displays meeting transcription as an activity entry in the activity list,
 * with the meeting app icon and an audio badge overlay.
 */

import React, { useState } from 'react';
import type { EntryTranscription, WindowActivity } from '../types/shared';

interface TranscriptionActivityEntryProps {
    transcription: EntryTranscription;
    /** App icon data URL for the meeting app */
    appIcon?: string;
    /** Name of the meeting app (e.g., "Google Chrome", "Zoom") */
    appName: string;
    /** Format time function for duration display */
    formatTime: (ms: number) => string;
    /** Recording number when there are multiple recordings (e.g., 1, 2, 3) */
    recordingNumber?: number;
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) {
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
}

/**
 * Format seconds to MM:SS
 */
function formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function TranscriptionActivityEntry({
    transcription,
    appIcon,
    appName,
    formatTime,
    recordingNumber,
}: TranscriptionActivityEntryProps): React.ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSegments, setShowSegments] = useState(false);

    // Clean up legacy merged text format (remove [Recording X] prefixes and separators)
    const cleanText = transcription.fullText
        .replace(/^\[Recording \d+\]\n?/gm, '')  // Remove [Recording X] prefixes
        .replace(/\n---\n\n/g, '\n\n')           // Remove --- separators
        .trim();

    // Truncate text for preview
    const previewText = cleanText.length > 150
        ? cleanText.substring(0, 150) + '...'
        : cleanText;

    return (
        <div
            className="rounded-lg border overflow-hidden"
            style={{
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)',
            }}
        >
            {/* Header - App style entry */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-3 py-2.5 flex items-center justify-between transition-colors cursor-pointer"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#FAF5EE';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                }}
            >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Expand/collapse chevron */}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="flex-shrink-0 transition-transform"
                        style={{
                            color: 'var(--color-text-secondary)',
                            transform: isExpanded ? 'rotate(90deg)' : 'none',
                            transition: 'transform var(--duration-base) var(--ease-out)',
                        }}
                    >
                        <polyline points="9 18 15 12 9 6" />
                    </svg>

                    {/* App icon with audio badge */}
                    <div className="relative flex-shrink-0">
                        {appIcon ? (
                            <img
                                src={appIcon}
                                alt={appName}
                                className="w-6 h-6 rounded"
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                }}
                            />
                        ) : (
                            <div
                                className="w-6 h-6 rounded flex items-center justify-center"
                                style={{ backgroundColor: 'var(--color-bg-primary)' }}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ color: 'var(--color-text-secondary)' }}
                                >
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                    <line x1="9" y1="3" x2="9" y2="21" />
                                </svg>
                            </div>
                        )}
                        {/* Audio badge */}
                        <div
                            className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{
                                backgroundColor: 'rgb(59, 130, 246)',
                                border: '2px solid var(--color-bg-secondary)',
                            }}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="8"
                                height="8"
                                viewBox="0 0 24 24"
                                fill="white"
                                stroke="none"
                            >
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" stroke="white" strokeWidth="2" />
                            </svg>
                        </div>
                    </div>

                    {/* Title and metadata */}
                    <div className="flex-1 min-w-0">
                        <div
                            className="font-semibold truncate"
                            style={{ color: 'var(--color-text-primary)' }}
                        >
                            {recordingNumber ? `Recording ${recordingNumber}` : 'Meeting Recording'}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            {formatDuration(transcription.audioDuration)} · {transcription.wordCount} words · {transcription.language.toUpperCase()}
                        </div>
                    </div>
                </div>

                {/* Duration */}
                <div
                    className="font-mono font-bold ml-4"
                    style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}
                >
                    {formatTime(transcription.audioDuration * 1000)}
                </div>
            </button>

            {/* Expanded content - Transcription text */}
            {isExpanded && (
                <div
                    className="border-t"
                    style={{ borderColor: 'var(--color-border-primary)' }}
                >
                    {/* Full transcription text */}
                    <div className="p-3">
                        <div
                            className="text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ color: 'var(--color-text-secondary)' }}
                        >
                            {cleanText}
                        </div>
                    </div>

                    {/* Segments toggle */}
                    {transcription.segments.length > 0 && (
                        <div
                            className="border-t px-3 py-2"
                            style={{ borderColor: 'var(--color-border-primary)' }}
                        >
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowSegments(!showSegments);
                                }}
                                className="flex items-center gap-1 text-xs"
                                style={{ color: 'var(--color-text-tertiary)' }}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{
                                        transform: showSegments ? 'rotate(90deg)' : 'rotate(0deg)',
                                        transition: 'transform 0.2s ease',
                                    }}
                                >
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                                {showSegments ? 'Hide' : 'Show'} timestamped segments ({transcription.segments.length})
                            </button>

                            {/* Segments list */}
                            {showSegments && (
                                <div className="mt-2 space-y-1">
                                    {transcription.segments.map((segment) => (
                                        <div
                                            key={segment.id}
                                            className="flex gap-2 py-1 text-xs"
                                        >
                                            <span
                                                className="font-mono shrink-0"
                                                style={{
                                                    color: 'var(--color-text-tertiary)',
                                                    minWidth: '50px',
                                                }}
                                            >
                                                {formatTimestamp(segment.start)}
                                            </span>
                                            <span style={{ color: 'var(--color-text-secondary)' }}>
                                                {segment.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Preview when collapsed */}
            {!isExpanded && cleanText.length > 0 && (
                <div
                    className="px-3 pb-2 pt-0"
                    style={{ marginLeft: '52px' }}
                >
                    <div
                        className="text-xs line-clamp-2"
                        style={{ color: 'var(--color-text-tertiary)' }}
                    >
                        {previewText}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Find the primary meeting app from window activities.
 * Returns the app that was most likely used for the meeting
 * (video conferencing apps, or longest duration browser activity).
 */
export function findMeetingApp(activities: WindowActivity[]): { appName: string; bundleId?: string } | null {
    if (!activities || activities.length === 0) return null;

    // Video conferencing app bundle IDs and their priorities
    const meetingAppPatterns = [
        { pattern: /zoom/i, priority: 1 },
        { pattern: /teams/i, priority: 1 },
        { pattern: /slack/i, priority: 2 },
        { pattern: /webex/i, priority: 1 },
        { pattern: /meet/i, priority: 2 }, // Google Meet in browser
        { pattern: /discord/i, priority: 3 },
    ];

    // First, check for dedicated meeting apps
    for (const { pattern } of meetingAppPatterns) {
        const meetingActivity = activities.find(
            (a) => pattern.test(a.appName) || pattern.test(a.windowTitle || '')
        );
        if (meetingActivity) {
            return { appName: meetingActivity.appName, bundleId: meetingActivity.bundleId };
        }
    }

    // Check for Google Meet in browser
    const meetInBrowser = activities.find(
        (a) => a.windowTitle?.toLowerCase().includes('meet.google.com') ||
               a.windowTitle?.toLowerCase().includes('meet -')
    );
    if (meetInBrowser) {
        return { appName: meetInBrowser.appName, bundleId: meetInBrowser.bundleId };
    }

    // Fall back to the app with longest duration
    const longestActivity = activities.reduce((longest, current) =>
        current.duration > (longest?.duration || 0) ? current : longest
    , activities[0]);

    return longestActivity
        ? { appName: longestActivity.appName, bundleId: longestActivity.bundleId }
        : null;
}
