import { useEffect, useRef } from 'react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    message: string;
    confirmText?: string;
    confirmVariant?: 'danger' | 'primary';
    isLoading?: boolean;
}

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Delete',
    confirmVariant = 'danger',
    isLoading = false
}: ConfirmationModalProps) {
    const confirmButtonRef = useRef<HTMLButtonElement>(null);

    // Handle escape key and focus management
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isLoading) {
                onClose();
            }
        };

        // Focus the confirm button on open for keyboard accessibility
        setTimeout(() => confirmButtonRef.current?.focus(), 50);

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, isLoading, onClose]);

    if (!isOpen) return null;

    const isDanger = confirmVariant === 'danger';

    return (
        <div
            className="fixed inset-0 flex items-center justify-center z-50"
            onClick={(e) => {
                e.stopPropagation();
                if (!isLoading) {
                    onClose();
                }
            }}
        >
            {/* Backdrop with warm tint */}
            <div
                className="absolute inset-0 bg-[#0D0C0C]/60 backdrop-blur-sm"
                style={{
                    animation: 'modalBackdropIn 200ms ease-out forwards',
                }}
            />

            {/* Modal Card */}
            <div
                className="relative w-full max-w-[380px] mx-4"
                onClick={(e) => e.stopPropagation()}
                style={{
                    animation: 'modalContentIn 250ms cubic-bezier(0.175, 0.885, 0.32, 1.05) forwards',
                }}
            >
                {/* Main card */}
                <div
                    className="bg-[var(--color-bg-secondary)] overflow-hidden"
                    style={{
                        borderRadius: 'var(--radius-2xl)',
                        border: '1px solid var(--color-border-primary)',
                        boxShadow: `
                            0 0 0 1px rgba(255, 255, 255, 0.05),
                            0 20px 50px -10px rgba(13, 12, 12, 0.25),
                            0 10px 30px -10px rgba(13, 12, 12, 0.2)
                        `,
                    }}
                >
                    {/* Content Section */}
                    <div className="p-6 pb-5">
                        {/* Icon - Refined and contextual */}
                        <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                            style={{
                                background: isDanger
                                    ? 'linear-gradient(135deg, rgba(220, 38, 38, 0.08) 0%, rgba(220, 38, 38, 0.04) 100%)'
                                    : 'linear-gradient(135deg, rgba(255, 72, 0, 0.08) 0%, rgba(255, 72, 0, 0.04) 100%)',
                                border: `1px solid ${isDanger ? 'rgba(220, 38, 38, 0.12)' : 'rgba(255, 72, 0, 0.12)'}`,
                            }}
                        >
                            {isDanger ? (
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="var(--color-error)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M3 6h18" />
                                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                            ) : (
                                <svg
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="var(--color-accent)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 8v4" />
                                    <path d="M12 16h.01" />
                                </svg>
                            )}
                        </div>

                        {/* Title */}
                        <h3
                            className="text-lg font-semibold mb-2"
                            style={{
                                fontFamily: 'var(--font-display)',
                                color: 'var(--color-text-primary)',
                                letterSpacing: '-0.01em',
                            }}
                        >
                            {title}
                        </h3>

                        {/* Message */}
                        <p
                            className="text-sm leading-relaxed"
                            style={{
                                fontFamily: 'var(--font-body)',
                                color: 'var(--color-text-secondary)',
                            }}
                        >
                            {message}
                        </p>
                    </div>

                    {/* Divider */}
                    <div
                        className="h-px mx-4"
                        style={{ background: 'var(--color-border-primary)' }}
                    />

                    {/* Actions */}
                    <div className="p-4 flex gap-3">
                        {/* Cancel Button */}
                        <button
                            onClick={onClose}
                            disabled={isLoading}
                            className="flex-1 px-4 py-2.5 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--color-text-secondary)',
                                background: 'var(--color-bg-tertiary)',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--color-border-primary)',
                            }}
                            onMouseEnter={(e) => {
                                if (!isLoading) {
                                    e.currentTarget.style.background = 'var(--color-bg-quaternary)';
                                    e.currentTarget.style.color = 'var(--color-text-primary)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--color-bg-tertiary)';
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                        >
                            Cancel
                        </button>

                        {/* Confirm Button */}
                        <button
                            ref={confirmButtonRef}
                            onClick={onConfirm}
                            disabled={isLoading}
                            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            style={{
                                fontFamily: 'var(--font-mono)',
                                background: isDanger
                                    ? 'var(--color-error)'
                                    : 'var(--color-accent)',
                                borderRadius: 'var(--radius-lg)',
                                boxShadow: isDanger
                                    ? '0 2px 8px -2px rgba(220, 38, 38, 0.4)'
                                    : '0 2px 8px -2px rgba(255, 72, 0, 0.4)',
                                opacity: isLoading ? 0.7 : 1,
                            }}
                            onMouseEnter={(e) => {
                                if (!isLoading) {
                                    e.currentTarget.style.background = isDanger
                                        ? '#c41e1e'
                                        : 'var(--color-accent-hover)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                    e.currentTarget.style.boxShadow = isDanger
                                        ? '0 4px 12px -2px rgba(220, 38, 38, 0.5)'
                                        : '0 4px 12px -2px rgba(255, 72, 0, 0.5)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = isDanger
                                    ? 'var(--color-error)'
                                    : 'var(--color-accent)';
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = isDanger
                                    ? '0 2px 8px -2px rgba(220, 38, 38, 0.4)'
                                    : '0 2px 8px -2px rgba(255, 72, 0, 0.4)';
                            }}
                        >
                            {isLoading ? (
                                <>
                                    <svg
                                        className="w-4 h-4 animate-spin"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                    >
                                        <circle
                                            className="opacity-30"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="3"
                                        />
                                        <path
                                            className="opacity-100"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        />
                                    </svg>
                                    <span>Processing</span>
                                </>
                            ) : (
                                confirmText
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Keyframe animations */}
            <style>{`
                @keyframes modalBackdropIn {
                    from {
                        opacity: 0;
                    }
                    to {
                        opacity: 1;
                    }
                }

                @keyframes modalContentIn {
                    from {
                        opacity: 0;
                        transform: scale(0.96) translateY(8px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
            `}</style>
        </div>
    );
}
