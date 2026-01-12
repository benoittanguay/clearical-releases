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
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[32px] p-6 w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[var(--color-warning-muted)] flex items-center justify-center">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="var(--color-warning)"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-[var(--color-text-primary)] font-['Syne']">Create New Folder</h3>
                    </div>
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

                {/* Form */}
                <div className="space-y-5">
                    {/* Name Input */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 font-['Syne']">
                            Folder Name *
                        </label>
                        <input
                            type="text"
                            value={folderName}
                            onChange={(e) => setFolderName(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-warning)] focus:border-transparent transition-all duration-200"
                            placeholder="e.g. Projects, Clients, Internal"
                        />
                        <div className="text-xs text-[var(--color-text-tertiary)] mt-2 font-mono">
                            Folders help organize your buckets into categories
                        </div>
                    </div>

                    {/* Parent Folder Selection */}
                    {availableFolders.length > 0 && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 font-['Syne']">
                                Parent Folder (Optional)
                            </label>
                            <select
                                value={selectedParentId || ''}
                                onChange={(e) => setSelectedParentId(e.target.value || null)}
                                className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-warning)] focus:border-transparent transition-all duration-200"
                            >
                                <option value="">Root Level</option>
                                {availableFolders.map((folder) => (
                                    <option key={folder.id} value={folder.id}>
                                        {folder.name}
                                    </option>
                                ))}
                            </select>
                            <div className="text-xs text-[var(--color-text-tertiary)] mt-2 font-mono">
                                Create nested folder structure
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 mt-8">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!folderName.trim()}
                        className="px-6 py-2.5 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-[var(--color-bg-primary)] text-sm font-semibold rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg flex items-center gap-2"
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
