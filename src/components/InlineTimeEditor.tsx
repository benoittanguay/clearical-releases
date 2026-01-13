import { useState, useRef, useEffect } from 'react';

interface InlineTimeEditorProps {
    value: number; // Duration in milliseconds
    onChange: (newDuration: number) => void;
    formatTime: (ms: number) => string;
    className?: string;
}

export function InlineTimeEditor({ value, onChange, formatTime, className = '' }: InlineTimeEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when editing starts
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleStartEdit = () => {
        // Initialize input with current value in HH:MM:SS format
        setInputValue(formatTime(value));
        setError(null);
        setIsEditing(true);
    };

    const parseDuration = (input: string): number | null => {
        const str = input.toLowerCase().trim();

        // Handle empty input
        if (!str) {
            return null;
        }

        // Try HH:MM:SS or HH:MM format first
        const timeMatch = str.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

            // Validate ranges
            if (minutes >= 60 || seconds >= 60) {
                return null;
            }

            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        }

        // Try "Xh Ym" or "Xh" or "Ym" format
        const hoursMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
        const minutesMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);
        const secondsMatch = str.match(/(\d+(?:\.\d+)?)\s*s/);

        if (hoursMatch || minutesMatch || secondsMatch) {
            let totalSeconds = 0;

            if (hoursMatch) {
                totalSeconds += parseFloat(hoursMatch[1]) * 3600;
            }
            if (minutesMatch) {
                totalSeconds += parseFloat(minutesMatch[1]) * 60;
            }
            if (secondsMatch) {
                totalSeconds += parseFloat(secondsMatch[1]);
            }

            return Math.round(totalSeconds * 1000);
        }

        // Try plain number (assume minutes)
        const plainNumber = str.match(/^(\d+(?:\.\d+)?)$/);
        if (plainNumber) {
            const minutes = parseFloat(plainNumber[1]);
            return Math.round(minutes * 60 * 1000);
        }

        return null;
    };

    const handleSave = () => {
        const newDuration = parseDuration(inputValue);

        if (newDuration === null || newDuration <= 0) {
            setError('Invalid time format');
            return;
        }

        onChange(newDuration);
        setIsEditing(false);
        setError(null);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setError(null);
        setInputValue('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    };

    const handleBlur = () => {
        // Small delay to allow clicking the save button if user clicks it instead of pressing Enter
        setTimeout(() => {
            if (isEditing) {
                handleSave();
            }
        }, 150);
    };

    if (isEditing) {
        return (
            <div className="relative inline-flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={handleBlur}
                        placeholder="e.g. 1:30 or 90m"
                        className={`border text-2xl font-mono font-bold rounded-lg px-3 py-1 w-40 focus:outline-none transition-all ${className}`}
                        style={{
                            backgroundColor: 'var(--color-bg-primary)',
                            borderColor: error ? 'var(--color-error)' : 'var(--color-accent)',
                            color: 'var(--color-text-primary)',
                            transitionDuration: 'var(--duration-fast)',
                            transitionTimingFunction: 'var(--ease-out)',
                            boxShadow: error ? 'var(--focus-ring-error)' : 'var(--focus-ring)'
                        }}
                    />
                </div>
                {error && (
                    <div className="text-xs whitespace-nowrap" style={{ color: 'var(--color-error)' }}>
                        {error}
                    </div>
                )}
                <div className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
                    Formats: 1:30, 1:30:00, 90m, 1h 30m
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={handleStartEdit}
            className={`text-2xl font-mono font-bold rounded-lg px-2 py-1 -m-2 transition-all group relative flex items-center ${className}`}
            style={{
                color: 'var(--color-accent)',
                transitionDuration: 'var(--duration-fast)',
                transitionTimingFunction: 'var(--ease-out)'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-accent-muted)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Click to edit duration"
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="inline-block mr-2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                    transitionDuration: 'var(--duration-normal)',
                    transitionTimingFunction: 'var(--ease-out)'
                }}
            >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
            </svg>
            {formatTime(value)}
        </button>
    );
}
