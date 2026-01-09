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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
                {/* Header */}
                <div className="flex justify-between items-center mb-5">
                    <h3 className="text-lg font-semibold text-white">Create New Bucket</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-4">
                    {/* Name Input */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Bucket Name *
                        </label>
                        <input
                            type="text"
                            value={bucketName}
                            onChange={(e) => setBucketName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            placeholder="e.g. Client Work, Documentation, Research"
                        />
                    </div>

                    {/* Color Picker */}
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">
                            Color
                        </label>
                        <div className="grid grid-cols-6 gap-2">
                            {BUCKET_COLORS.map((color) => (
                                <button
                                    key={color.value}
                                    type="button"
                                    onClick={() => setSelectedColor(color.value)}
                                    className={`w-full aspect-square rounded-lg transition-all ${
                                        selectedColor === color.value
                                            ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800 scale-110'
                                            : 'hover:scale-105 opacity-80 hover:opacity-100'
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
                            <label className="block text-sm text-gray-400 mb-2">
                                Parent Folder (Optional)
                            </label>
                            <select
                                value={selectedParentId || ''}
                                onChange={(e) => setSelectedParentId(e.target.value || null)}
                                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            >
                                <option value="">Root Level</option>
                                {availableFolders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                        {folder.name}
                                    </option>
                                ))}
                            </select>
                            <div className="text-xs text-gray-500 mt-1">
                                Choose a folder to organize this bucket
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!bucketName.trim()}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors"
                    >
                        Create Bucket
                    </button>
                </div>
            </div>
        </div>
    );
}
