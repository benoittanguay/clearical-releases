/**
 * Transcription Display Component
 *
 * Displays meeting/call transcription text with expandable segments.
 */

import React, { useState } from 'react';
import type { EntryTranscription } from '../types/shared';

interface TranscriptionDisplayProps {
    transcription: EntryTranscription;
}

/**
 * Format seconds to MM:SS
 */
function formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)} seconds`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) {
        return secs > 0 ? `${mins}m ${secs}s` : `${mins} minutes`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
}

export function TranscriptionDisplay({ transcription }: TranscriptionDisplayProps): React.ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSegments, setShowSegments] = useState(false);

    // Truncate text for preview
    const previewText = transcription.fullText.length > 200
        ? transcription.fullText.substring(0, 200) + '...'
        : transcription.fullText;

    return (
        <div
            className="rounded-lg border"
            style={{
                backgroundColor: 'var(--color-bg-tertiary)',
                borderColor: 'var(--color-border-primary)',
            }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between p-3 cursor-pointer"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-2">
                    {/* Microphone icon */}
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="rgb(59, 130, 246)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" x2="12" y1="19" y2="22" />
                        </svg>
                    </div>
                    <div>
                        <div className="font-medium text-sm" style={{ color: 'var(--color-text-primary)' }}>
                            Meeting Transcription
                        </div>
                        <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                            {formatDuration(transcription.audioDuration)} · {transcription.wordCount} words · {transcription.language.toUpperCase()}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Expand/collapse icon */}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-text-tertiary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                        }}
                    >
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </div>
            </div>

            {/* Content */}
            {isExpanded && (
                <div className="border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                    {/* Full text */}
                    <div className="p-3">
                        <div
                            className="text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ color: 'var(--color-text-secondary)' }}
                        >
                            {transcription.fullText}
                        </div>
                    </div>

                    {/* Segments toggle */}
                    {transcription.segments.length > 0 && (
                        <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-border-primary)' }}>
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
                                                style={{ color: 'var(--color-text-tertiary)', minWidth: '50px' }}
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
            {!isExpanded && transcription.fullText.length > 0 && (
                <div className="px-3 pb-3">
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
