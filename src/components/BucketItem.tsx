import React, { useState, useRef, useEffect } from 'react';
import type { TimeBucket } from '../context/StorageContext';

interface BucketItemProps {
    bucket: TimeBucket;
    level?: number;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onRename: (id: string, newName: string) => void;
    onDelete: (id: string) => void;
    onUnlinkJira?: (bucketId: string) => void;
    onMove?: (bucketId: string, newParentId: string | null) => void;
    availableFolders?: TimeBucket[];
}

export const BucketItem: React.FC<BucketItemProps> = ({
    bucket,
    level = 0,
    isExpanded,
    onToggleExpand,
    onRename,
    onDelete,
    onUnlinkJira,
    onMove,
    availableFolders = []
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(bucket.name);
    const [showMoveMenu, setShowMoveMenu] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const moveMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (moveMenuRef.current && !moveMenuRef.current.contains(event.target as Node)) {
                setShowMoveMenu(false);
            }
        };

        if (showMoveMenu) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [showMoveMenu]);

    const handleSaveRename = () => {
        const trimmedName = editedName.trim();
        if (trimmedName && trimmedName !== bucket.name) {
            onRename(bucket.id, trimmedName);
        } else {
            setEditedName(bucket.name);
        }
        setIsEditing(false);
    };

    const handleCancelRename = () => {
        setEditedName(bucket.name);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSaveRename();
        } else if (e.key === 'Escape') {
            handleCancelRename();
        }
    };

    const handleMove = (newParentId: string | null) => {
        if (onMove) {
            onMove(bucket.id, newParentId);
        }
        setShowMoveMenu(false);
    };

    const paddingLeft = level * 24; // 24px per level

    return (
        <li
            className="bg-gray-800/50 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors group"
            style={{ marginLeft: `${paddingLeft}px` }}
        >
            <div className="p-4">
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Expand/Collapse chevron for folders */}
                        {bucket.isFolder && onToggleExpand && (
                            <button
                                onClick={onToggleExpand}
                                className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                >
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </button>
                        )}

                        {/* Folder or Bucket icon */}
                        {bucket.isFolder ? (
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
                                className="text-yellow-500 flex-shrink-0"
                            >
                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                            </svg>
                        ) : (
                            <div
                                className="w-4 h-4 rounded-full shadow-sm flex-shrink-0"
                                style={{ backgroundColor: bucket.color }}
                            />
                        )}

                        {/* Bucket/Folder name - editable */}
                        <div className="flex-1 min-w-0">
                            {isEditing ? (
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    onBlur={handleSaveRename}
                                    onKeyDown={handleKeyDown}
                                    className="w-full bg-gray-700 border border-green-500 rounded px-2 py-1 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            ) : (
                                <span className="font-medium text-white">{bucket.name}</span>
                            )}

                            {/* Linked Jira Issue (only for buckets, not folders) */}
                            {!bucket.isFolder && bucket.linkedIssue && (
                                <div className="mt-2 bg-gray-900/50 rounded p-2 border border-gray-700">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-blue-400 font-mono text-xs">
                                            {bucket.linkedIssue.key}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            {bucket.linkedIssue.projectName}
                                        </span>
                                        <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                            {bucket.linkedIssue.issueType}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-300 truncate">
                                        {bucket.linkedIssue.summary}
                                    </p>
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-xs text-gray-400">
                                            Status: {bucket.linkedIssue.status}
                                        </span>
                                        {onUnlinkJira && (
                                            <button
                                                onClick={() => onUnlinkJira(bucket.id)}
                                                className="text-xs text-red-400 hover:text-red-300 transition-colors"
                                            >
                                                Unlink
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 ml-3">
                        {/* Move to folder button */}
                        {onMove && availableFolders.length > 0 && (
                            <div className="relative" ref={moveMenuRef}>
                                <button
                                    onClick={() => setShowMoveMenu(!showMoveMenu)}
                                    className="text-gray-600 hover:text-blue-400 p-1.5 rounded-md hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100"
                                    title="Move to folder"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="17 8 12 3 7 8" />
                                        <line x1="12" y1="3" x2="12" y2="15" />
                                    </svg>
                                </button>

                                {/* Move menu dropdown */}
                                {showMoveMenu && (
                                    <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-10 min-w-[160px]">
                                        <div className="py-1">
                                            <button
                                                onClick={() => handleMove(null)}
                                                className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                                            >
                                                Move to Root
                                            </button>
                                            {availableFolders
                                                .filter(f => f.id !== bucket.id) // Don't allow moving into self
                                                .map(folder => (
                                                    <button
                                                        key={folder.id}
                                                        onClick={() => handleMove(folder.id)}
                                                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2"
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
                                                            className="text-yellow-500"
                                                        >
                                                            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                                                        </svg>
                                                        {folder.name}
                                                    </button>
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Rename button */}
                        <button
                            onClick={() => setIsEditing(true)}
                            className="text-gray-600 hover:text-green-400 p-1.5 rounded-md hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100"
                            title="Rename"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                        </button>

                        {/* Delete button */}
                        <button
                            onClick={() => onDelete(bucket.id)}
                            className="text-gray-600 hover:text-red-500 p-1.5 rounded-md hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100"
                            title={bucket.isFolder ? 'Delete Folder (and all contents)' : 'Delete Bucket'}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </li>
    );
};
