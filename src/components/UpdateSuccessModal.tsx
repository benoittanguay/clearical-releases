import { useState, useEffect } from 'react';

interface UpdateSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    version?: string;
    releaseNotes?: string;
}

export function UpdateSuccessModal({ isOpen, onClose, version, releaseNotes: initialReleaseNotes }: UpdateSuccessModalProps) {
    const [releaseNotes, setReleaseNotes] = useState<string | undefined>(initialReleaseNotes);
    const [isLoadingNotes, setIsLoadingNotes] = useState(false);

    // Fetch release notes from GitHub if not provided
    useEffect(() => {
        if (!isOpen || !version || initialReleaseNotes) return;

        const fetchReleaseNotes = async () => {
            setIsLoadingNotes(true);
            try {
                // Fetch from both repos and use whichever responds
                const repos = [
                    'benoittanguay/clearical-releases',
                    'benoittanguay/TimePortal'
                ];

                for (const repo of repos) {
                    try {
                        const response = await fetch(
                            `https://api.github.com/repos/${repo}/releases/tags/v${version}`
                        );
                        if (response.ok) {
                            const data = await response.json();
                            if (data.body) {
                                // Parse markdown release notes - extract "What's New" section or use full body
                                let notes = data.body;

                                // Try to extract the relevant section
                                const whatsNewMatch = notes.match(/## What's New\s*([\s\S]*?)(?=##|$)/i);
                                if (whatsNewMatch) {
                                    notes = whatsNewMatch[1].trim();
                                }

                                // Clean up markdown formatting for plain text display
                                notes = notes
                                    .replace(/\*\*/g, '') // Remove bold
                                    .replace(/\*/g, '•') // Convert bullets
                                    .replace(/^-\s/gm, '• ') // Convert dashes to bullets
                                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
                                    .trim();

                                setReleaseNotes(notes || 'See commit history for changes in this release.');
                                break;
                            }
                        }
                    } catch {
                        // Try next repo
                    }
                }
            } catch (error) {
                console.error('[UpdateSuccessModal] Failed to fetch release notes:', error);
            } finally {
                setIsLoadingNotes(false);
            }
        };

        fetchReleaseNotes();
    }, [isOpen, version, initialReleaseNotes]);

    if (!isOpen) return null;

    // Fallback to a default version if none provided
    const displayVersion = version || 'Unknown';

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div
                className="bg-[var(--color-bg-secondary)] rounded-2xl shadow-2xl w-full max-w-md mx-4 border border-[var(--color-border-primary)] max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
                style={{
                    animation: 'fadeInScale 0.3s ease-out',
                }}
            >
                {/* Header - Fixed */}
                <div className="p-6 pb-0 flex-shrink-0">
                    {/* Success Icon and Header */}
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-success-muted)] rounded-2xl mb-4 shadow-lg">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="32"
                                height="32"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="var(--color-success)"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">
                            Update Complete!
                        </h2>
                        <p className="text-[var(--color-text-secondary)] text-base">
                            Clearical has been updated to the latest version
                        </p>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6">
                    {/* Release Notes Section */}
                    <div className="mb-6">
                        <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3 font-display uppercase tracking-wide">
                            What's new in version {displayVersion}
                        </h3>
                        <div
                            className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-4"
                            style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: 'var(--color-border-primary) transparent',
                            }}
                        >
                            {isLoadingNotes ? (
                                <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]">
                                    <div className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                                    <span>Loading release notes...</span>
                                </div>
                            ) : releaseNotes ? (
                                <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                                    {releaseNotes}
                                </div>
                            ) : (
                                <div className="text-sm text-[var(--color-text-tertiary)] italic">
                                    See commit history for changes in this release. Thank you for using Clearical!
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer - Fixed */}
                <div className="p-6 pt-4 flex-shrink-0 border-t border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        className="w-full px-6 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-semibold font-mono rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg"
                    >
                        Dismiss
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
            `}</style>
        </div>
    );
}
