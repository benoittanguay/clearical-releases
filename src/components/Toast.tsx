import { useEffect } from 'react';

export interface ToastProps {
    id: string;
    type: 'success' | 'info' | 'warning' | 'error';
    title?: string;
    message: string;
    duration?: number;
    action?: {
        label: string;
        onClick: () => void;
    };
    onDismiss: () => void;
}

export function Toast({ type, title, message, duration = 5000, action, onDismiss }: ToastProps) {
    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onDismiss();
            }, duration);

            return () => clearTimeout(timer);
        }
    }, [duration, onDismiss]);

    const typeStyles = {
        success: {
            bg: 'bg-[var(--color-bg-secondary)]',
            border: 'border-[var(--color-success)]/20',
            accent: 'bg-[var(--color-success)]',
            iconBg: 'bg-[var(--color-success-muted)]',
            icon: 'text-[var(--color-success)]',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
            )
        },
        info: {
            bg: 'bg-[var(--color-bg-secondary)]',
            border: 'border-[var(--color-accent)]/20',
            accent: 'bg-[var(--color-accent)]',
            iconBg: 'bg-[var(--color-accent)]/10',
            icon: 'text-[var(--color-accent)]',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
            )
        },
        warning: {
            bg: 'bg-[var(--color-bg-secondary)]',
            border: 'border-[var(--color-warning)]/20',
            accent: 'bg-[var(--color-warning)]',
            iconBg: 'bg-[var(--color-warning-muted)]',
            icon: 'text-[var(--color-warning)]',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            )
        },
        error: {
            bg: 'bg-[var(--color-bg-secondary)]',
            border: 'border-[var(--color-error)]/20',
            accent: 'bg-[var(--color-error)]',
            iconBg: 'bg-[var(--color-error-muted)]',
            icon: 'text-[var(--color-error)]',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
            )
        }
    };

    const style = typeStyles[type];

    return (
        <div
            className={`${style.bg} ${style.border} border rounded-2xl shadow-2xl overflow-hidden min-w-[320px] max-w-[420px] animate-slide-in-right`}
        >
            <div className={`h-1 ${style.accent}`} />
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
                        <div className={style.icon}>
                            {style.iconPath}
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        {title && (
                            <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">
                                {title}
                            </div>
                        )}
                        <div className="text-sm text-[var(--color-text-secondary)]">
                            {message}
                        </div>
                        {action && (
                            <button
                                onClick={() => {
                                    action.onClick();
                                    onDismiss();
                                }}
                                className="mt-2 text-xs font-semibold font-mono text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                            >
                                {action.label}
                            </button>
                        )}
                    </div>
                    <button
                        onClick={onDismiss}
                        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

export interface ToastContainerProps {
    toasts: ToastProps[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
            {toasts.map(toast => (
                <div key={toast.id} className="pointer-events-auto">
                    <Toast {...toast} />
                </div>
            ))}
        </div>
    );
}
