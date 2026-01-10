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
                        className={`bg-gray-700 border ${error ? 'border-red-500' : 'border-green-500'} text-white text-2xl font-mono font-bold rounded-lg px-3 py-1 w-40 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all ${className}`}
                        style={{
                            transitionDuration: 'var(--duration-fast)',
                            transitionTimingFunction: 'var(--ease-out)'
                        }}
                    />
                </div>
                {error && (
                    <div className="text-xs text-red-400 whitespace-nowrap">
                        {error}
                    </div>
                )}
                <div className="text-xs text-gray-400 whitespace-nowrap">
                    Formats: 1:30, 1:30:00, 90m, 1h 30m
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={handleStartEdit}
            className={`text-2xl font-mono font-bold text-green-400 hover:text-green-300 active:text-green-200 rounded-lg px-2 py-1 -m-2 hover:bg-green-500/10 active:bg-green-500/20 transition-all group relative ${className}`}
            style={{
                transitionDuration: 'var(--duration-fast)',
                transitionTimingFunction: 'var(--ease-out)'
            }}
            title="Click to edit duration"
        >
            {formatTime(value)}
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
                className="inline-block ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                    transitionDuration: 'var(--duration-normal)',
                    transitionTimingFunction: 'var(--ease-out)'
                }}
            >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
            </svg>
        </button>
    );
}
