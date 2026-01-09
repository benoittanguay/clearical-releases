import { useState, useEffect } from 'react';
import type { TimeBucket } from '../context/StorageContext';

interface CreateFolderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateFolder: (name: string, parentId?: string | null) => void;
    availableFolders: TimeBucket[];
}

export function CreateFolderModal({ isOpen, onClose, onCreateFolder, availableFolders }: CreateFolderModalProps) {
    const [folderName, setFolderName] = useState('');
    const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            setFolderName('');
            setSelectedParentId(null);
        }
    }, [isOpen]);

    const handleCreate = () => {
        const trimmedName = folderName.trim();
        if (!trimmedName) {
            return;
        }

        onCreateFolder(trimmedName, selectedParentId);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && folderName.trim()) {
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
                    <div className="flex items-center gap-2">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-yellow-500"
                        >
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                        <h3 className="text-lg font-semibold text-white">Create New Folder</h3>
                    </div>
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
                            Folder Name *
                        </label>
                        <input
                            type="text"
                            value={folderName}
                            onChange={(e) => setFolderName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                            placeholder="e.g. Projects, Clients, Internal"
                        />
                        <div className="text-xs text-gray-500 mt-1">
                            Folders help organize your buckets into categories
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
                                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                            >
                                <option value="">Root Level</option>
                                {availableFolders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                        {folder.name}
                                    </option>
                                ))}
                            </select>
                            <div className="text-xs text-gray-500 mt-1">
                                Create nested folder structure
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
                        disabled={!folderName.trim()}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition-colors flex items-center gap-2"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                        Create Folder
                    </button>
                </div>
            </div>
        </div>
    );
}
