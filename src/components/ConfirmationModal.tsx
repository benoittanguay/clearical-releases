import { useEffect } from 'react';

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
    // Handle escape key to close modal
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !isLoading) {
                onClose();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, isLoading, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={isLoading ? undefined : onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header with Icon - Scrollable Content */}
                <div className="flex items-start gap-4 p-6 pb-4 overflow-y-auto flex-1">
                    <div className="flex items-start gap-4">
                        {confirmVariant === 'danger' ? (
                            <div
                                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
                                style={{
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    border: '2px solid rgba(239, 68, 68, 0.3)'
                                }}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#ef4444"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                            </div>
                        ) : (
                            <div
                                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
                                style={{
                                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                    border: '2px solid rgba(59, 130, 246, 0.3)'
                                }}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="#3b82f6"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="16" x2="12" y2="12" />
                                    <line x1="12" y1="8" x2="12.01" y2="8" />
                                </svg>
                            </div>
                        )}
                        <div className="flex-1 pt-1">
                            <h3 className="text-xl font-bold text-[var(--color-text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                                {title}
                            </h3>
                            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed" style={{ fontFamily: 'var(--font-body)' }}>
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Actions - Sticky Footer */}
                <div className="flex justify-end gap-3 p-6 pt-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={`px-6 py-2.5 text-white text-sm font-semibold rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg disabled:cursor-not-allowed flex items-center gap-2 ${
                            confirmVariant === 'danger'
                                ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-900/30'
                                : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)]'
                        }`}
                        style={
                            confirmVariant === 'danger'
                                ? { fontFamily: 'var(--font-body)', boxShadow: '0 4px 14px rgba(239, 68, 68, 0.4)' }
                                : { fontFamily: 'var(--font-body)' }
                        }
                    >
                        {isLoading ? (
                            <>
                                <svg
                                    className="w-4 h-4 animate-spin"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                >
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                    />
                                    <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                    />
                                </svg>
                                Processing...
                            </>
                        ) : (
                            confirmText
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
