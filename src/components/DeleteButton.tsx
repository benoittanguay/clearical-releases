import { useState } from 'react';
import { ConfirmationModal } from './ConfirmationModal';

interface DeleteButtonProps {
    onDelete: () => void | Promise<void>;
    confirmMessage?: string;
    confirmTitle?: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'danger' | 'subtle';
}

export function DeleteButton({
    onDelete,
    confirmMessage = "Are you sure you want to delete this item?",
    confirmTitle = "Confirm Delete",
    className = "",
    size = 'md',
    variant = 'danger'
}: DeleteButtonProps) {
    const [showModal, setShowModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowModal(true);
    };

    const handleConfirm = async () => {
        setIsDeleting(true);
        try {
            await onDelete();
            setShowModal(false);
        } catch (error) {
            console.error('Delete failed:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCancel = () => {
        if (!isDeleting) {
            setShowModal(false);
        }
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

    return (
        <>
            <button
                onClick={handleClick}
                className={`${variants[variant]} ${buttonSizes[size]} rounded hover:bg-red-500/10 active:bg-red-500/20 active:scale-95 transition-all ${className}`}
                style={{ transitionDuration: 'var(--duration-base)', transitionTimingFunction: 'var(--ease-out)' }}
                title="Delete"
            >
                <svg className={sizes[size]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c0-1 1-2 2-2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
            </button>

            <ConfirmationModal
                isOpen={showModal}
                onClose={handleCancel}
                onConfirm={handleConfirm}
                title={confirmTitle}
                message={confirmMessage}
                confirmText="Delete"
                confirmVariant="danger"
                isLoading={isDeleting}
            />
        </>
    );
}