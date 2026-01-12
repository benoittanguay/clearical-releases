interface UpdateSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function UpdateSuccessModal({ isOpen, onClose }: UpdateSuccessModalProps) {
    // Hardcoded version for simplicity - this is just a test feature
    const appVersion = '0.1.7';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[32px] shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-[var(--color-border-primary)]"
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
                            Auto-Updater Worked!
                        </h2>
                        <p className="text-[var(--color-text-secondary)] text-lg">
                            Your app has been successfully updated
                        </p>
                    </div>

                    {/* Version Info */}
                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-1 font-['Syne']">Current Version</h4>
                                <p className="text-2xl font-mono font-bold text-[var(--color-success)]">
                                    v{appVersion}
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

                    {/* Success Message */}
                    <div className="bg-[var(--color-success-muted)] border border-[var(--color-success)]/30 rounded-lg px-4 py-3 mb-6">
                        <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                            <svg
                                className="w-5 h-5 flex-shrink-0 mt-0.5 text-[var(--color-success)]"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            <span className="font-medium">
                                The auto-update system is working correctly. You're now running the latest version of Clearical.
                            </span>
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
            `}</style>
        </div>
    );
}
