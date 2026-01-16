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
                className="bg-[var(--color-bg-secondary)] rounded-[12px] shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-[var(--color-border-primary)]"
                style={{
                    animation: 'fadeInScale 0.3s ease-out',
                }}
            >
                {/* Content */}
                <div className="p-8">
                    {/* Success Icon and Header */}
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-[var(--color-success-muted)] rounded-full mb-4 shadow-lg">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
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
                        <h2 className="text-3xl font-bold text-[var(--color-text-primary)] mb-2 font-['Syne']">
                            Update Complete!
                        </h2>
                        <p className="text-[var(--color-text-secondary)] text-lg">
                            Clearical has been updated to the latest version
                        </p>
                    </div>

                    {/* Version Info */}
                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-1 font-['Syne']">Version</h4>
                                <p className="text-2xl font-mono font-bold text-[var(--color-success)]">
                                    v{displayVersion}
                                </p>
                            </div>
                            <div className="flex-shrink-0">
                                <div className="w-12 h-12 bg-[var(--color-success-muted)] rounded-lg flex items-center justify-center border border-[var(--color-success)]/30">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="text-[var(--color-success)]"
                                    >
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Release Notes Section */}
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-3 font-['Syne']">
                            What's New
                        </h3>
                        <div
                            className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-4 max-h-[200px] overflow-y-auto"
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

                    {/* Dismiss Button */}
                    <button
                        onClick={onClose}
                        className="w-full px-6 py-3 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-lg font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg"
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

                /* Custom scrollbar styling for webkit browsers */
                div::-webkit-scrollbar {
                    width: 8px;
                }

                div::-webkit-scrollbar-track {
                    background: transparent;
                    border-radius: 4px;
                }

                div::-webkit-scrollbar-thumb {
                    background: var(--color-border-primary);
                    border-radius: 4px;
                    transition: background 0.2s ease;
                }

                div::-webkit-scrollbar-thumb:hover {
                    background: var(--color-text-tertiary);
                }
            `}</style>
        </div>
    );
}
