import React, { createContext, useContext, useState, useCallback } from 'react';
import { ToastContainer } from '../components/Toast';
import type { ToastProps } from '../components/Toast';

interface ToastContextType {
    showToast: (toast: Omit<ToastProps, 'id' | 'onDismiss'>) => string;
    dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<ToastProps[]>([]);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const showToast = useCallback((toast: Omit<ToastProps, 'id' | 'onDismiss'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const newToast: ToastProps = {
            ...toast,
            id,
            onDismiss: () => dismissToast(id)
        };

        setToasts(prev => [...prev, newToast]);
        return id;
    }, [dismissToast]);

    return (
        <ToastContext.Provider value={{ showToast, dismissToast }}>
            {children}
            <ToastContainer toasts={toasts} />
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
