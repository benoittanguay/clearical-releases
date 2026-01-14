import { useState, useEffect } from 'react';
import type { TimeBucket } from '../context/StorageContext';

interface CreateBucketModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateBucket: (name: string, color: string, parentId?: string | null) => void;
    availableFolders: TimeBucket[];
}

// Curated color palette for buckets
const BUCKET_COLORS = [
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Cyan', value: '#06b6d4' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Lime', value: '#84cc16' },
    { name: 'Amber', value: '#f59e0b' },
];

export function CreateBucketModal({ isOpen, onClose, onCreateBucket, availableFolders }: CreateBucketModalProps) {
    const [bucketName, setBucketName] = useState('');
    const [selectedColor, setSelectedColor] = useState(BUCKET_COLORS[0].value);
    const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setBucketName('');
            setSelectedColor(BUCKET_COLORS[0].value);
            setSelectedParentId(null);
        }
    }, [isOpen]);

    const handleCreate = () => {
        const trimmedName = bucketName.trim();
        if (!trimmedName) {
            return;
        }

        onCreateBucket(trimmedName, selectedColor, selectedParentId);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && bucketName.trim()) {
            handleCreate();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-6 pb-4 flex-shrink-0">
                    <h3 className="text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Create New Bucket</h3>
                    <button
                        onClick={onClose}
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all duration-200 hover:scale-110 active:scale-95"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Form - Scrollable Content */}
                <div className="space-y-5 px-6 overflow-y-auto flex-1">
                    {/* Name Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                            Bucket Name *
                        </label>
                        <input
                            type="text"
                            value={bucketName}
                            onChange={(e) => setBucketName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all duration-200"
                            style={{ fontFamily: 'var(--font-mono)' }}
                            placeholder="e.g. Client Work, Documentation, Research"
                        />
                    </div>

                    {/* Color Picker */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                            Color
                        </label>
                        <div className="grid grid-cols-6 gap-2.5">
                            {BUCKET_COLORS.map((color) => (
                                <button
                                    key={color.value}
                                    type="button"
                                    onClick={() => setSelectedColor(color.value)}
                                    className={`w-full aspect-square rounded-lg transition-all duration-200 transform ${
                                        selectedColor === color.value
                                            ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-secondary)] scale-110 shadow-lg'
                                            : 'hover:scale-105 opacity-70 hover:opacity-100'
                                    }`}
                                    style={{ backgroundColor: color.value }}
                                    title={color.name}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Parent Folder Selection */}
                    {availableFolders.length > 0 && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                                Parent Folder (Optional)
                            </label>
                            <select
                                value={selectedParentId || ''}
                                onChange={(e) => setSelectedParentId(e.target.value || null)}
                                className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all duration-200"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                <option value="">Root Level</option>
                                {availableFolders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                        {folder.name}
                                    </option>
                                ))}
                            </select>
                            <div className="text-xs text-[var(--color-text-tertiary)] mt-2" style={{ fontFamily: 'var(--font-body)' }}>
                                Choose a folder to organize this bucket
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions - Sticky Footer */}
                <div className="flex justify-end gap-3 p-6 pt-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!bucketName.trim()}
                        className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg hover:shadow-[var(--shadow-accent)]"
                        style={{ fontFamily: 'var(--font-body)' }}
                    >
                        Create Bucket
                    </button>
                </div>
            </div>
        </div>
    );
}
