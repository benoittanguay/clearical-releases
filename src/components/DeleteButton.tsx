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

    const buttonSizes = {
        sm: 'p-1',
        md: 'p-1.5',
        lg: 'p-2'
    };

    const getVariantStyles = () => {
        if (variant === 'danger') {
            return {
                color: 'var(--color-error)',
                hoverBg: 'rgba(220, 38, 38, 0.1)',
                hoverColor: 'var(--color-error)'
            };
        }
        // subtle variant - ghost button style with warm hover background (matches BucketItem)
        return {
            color: 'var(--color-text-tertiary)',
            hoverBg: '#FAF5EE',
            hoverColor: 'var(--color-error)'
        };
    };

    const variantStyles = getVariantStyles();

    // Check if a text color class is passed - if so, use that instead of variant color
    const hasCustomColor = className.includes('text-white') || className.includes('text-');
    const defaultColor = hasCustomColor ? (className.includes('text-white') ? 'white' : variantStyles.color) : variantStyles.color;

    return (
        <>
            <button
                onClick={handleClick}
                className={`${buttonSizes[size]} rounded-lg active:scale-95 transition-all ${className}`}
                style={{
                    color: defaultColor,
                    transitionDuration: 'var(--duration-base)',
                    transitionTimingFunction: 'var(--ease-out)'
                }}
                onMouseEnter={(e) => {
                    e.stopPropagation();
                    e.currentTarget.style.backgroundColor = variantStyles.hoverBg;
                    e.currentTarget.style.color = variantStyles.hoverColor;
                    // Reset parent hover styles - find closest interactive parent
                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                    if (parent) {
                        parent.style.backgroundColor = parent.dataset.defaultBg || '';
                        parent.style.borderColor = parent.dataset.defaultBorder || '';
                    }
                }}
                onMouseLeave={(e) => {
                    e.stopPropagation();
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = defaultColor;
                    // Reinstate parent hover if mouse moved somewhere within the parent
                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                    const relatedTarget = e.relatedTarget as Node | null;
                    if (parent && relatedTarget && (parent.contains(relatedTarget) || parent === relatedTarget)) {
                        parent.style.backgroundColor = parent.dataset.hoverBg || '#FAF5EE';
                        if (parent.dataset.hoverBorder) {
                            parent.style.borderColor = parent.dataset.hoverBorder;
                        }
                    }
                }}
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