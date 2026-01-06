import { useState } from 'react';

interface DeleteButtonProps {
    onDelete: () => void | Promise<void>;
    confirmMessage?: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'danger' | 'subtle';
}

export function DeleteButton({ 
    onDelete, 
    confirmMessage = "Are you sure you want to delete this item?",
    className = "",
    size = 'md',
    variant = 'danger'
}: DeleteButtonProps) {
    const [showConfirm, setShowConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        
        if (!showConfirm) {
            setShowConfirm(true);
            return;
        }

        setIsDeleting(true);
        try {
            await onDelete();
        } catch (error) {
            console.error('Delete failed:', error);
        } finally {
            setIsDeleting(false);
            setShowConfirm(false);
        }
    };

    const handleCancel = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowConfirm(false);
    };

    const sizes = {
        sm: 'w-4 h-4',
        md: 'w-5 h-5', 
        lg: 'w-6 h-6'
    };

    const variants = {
        danger: 'text-red-400 hover:text-red-300',
        subtle: 'text-gray-400 hover:text-red-400'
    };

    const buttonSizes = {
        sm: 'p-1',
        md: 'p-1.5',
        lg: 'p-2'
    };

    if (showConfirm) {
        return (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-1">
                <span className="text-red-300 text-sm">{confirmMessage}</span>
                <button
                    onClick={handleClick}
                    disabled={isDeleting}
                    className="text-red-400 hover:text-red-300 disabled:opacity-50 px-2 py-1 text-xs bg-red-500/20 rounded"
                >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
                <button
                    onClick={handleCancel}
                    className="text-gray-400 hover:text-gray-300 px-2 py-1 text-xs bg-gray-500/20 rounded"
                >
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={handleClick}
            className={`${variants[variant]} transition-colors ${buttonSizes[size]} rounded hover:bg-red-500/10 ${className}`}
            title="Delete"
        >
            <svg className={sizes[size]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c0-1 1-2 2-2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
        </button>
    );
}