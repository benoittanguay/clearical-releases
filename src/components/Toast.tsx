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
            bg: 'bg-green-900/90',
            border: 'border-green-700',
            icon: 'text-green-400',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
            )
        },
        info: {
            bg: 'bg-blue-900/90',
            border: 'border-blue-700',
            icon: 'text-blue-400',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
            )
        },
        warning: {
            bg: 'bg-yellow-900/90',
            border: 'border-yellow-700',
            icon: 'text-yellow-400',
            iconPath: (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            )
        },
        error: {
            bg: 'bg-red-900/90',
            border: 'border-red-700',
            icon: 'text-red-400',
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
            className={`${style.bg} ${style.border} border backdrop-blur-sm rounded-lg shadow-2xl p-4 min-w-[320px] max-w-[420px] animate-slide-in-right`}
        >
            <div className="flex items-start gap-3">
                <div className={style.icon}>
                    {style.iconPath}
                </div>
                <div className="flex-1 min-w-0">
                    {title && (
                        <div className="text-sm font-semibold text-white mb-1">
                            {title}
                        </div>
                    )}
                    <div className="text-sm text-gray-300">
                        {message}
                    </div>
                    {action && (
                        <button
                            onClick={() => {
                                action.onClick();
                                onDismiss();
                            }}
                            className="mt-2 text-xs font-medium text-white hover:underline"
                        >
                            {action.label}
                        </button>
                    )}
                </div>
                <button
                    onClick={onDismiss}
                    className="text-gray-400 hover:text-white transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
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
