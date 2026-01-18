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

    const paddingLeft = level * 20; // 20px per level

    return (
        <li
            className="rounded-xl border transition-all group"
            style={{
                marginLeft: `${paddingLeft}px`,
                backgroundColor: 'var(--color-bg-secondary)',
                borderColor: 'var(--color-border-primary)',
                borderRadius: 'var(--radius-xl)',
                transitionDuration: 'var(--duration-base)',
                transitionTimingFunction: 'var(--ease-out)',
                boxShadow: 'var(--shadow-sm)'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent-border)';
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            }}
        >
            <div className="py-2 px-4">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Expand/Collapse chevron for folders */}
                        {bucket.isFolder && onToggleExpand && (
                            <button
                                onClick={onToggleExpand}
                                className="flex-shrink-0 transition-all"
                                style={{
                                    color: 'var(--color-text-tertiary)',
                                    transitionDuration: 'var(--duration-fast)',
                                    transitionTimingFunction: 'var(--ease-out)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="transform transition-transform"
                                    style={{
                                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                        transitionDuration: 'var(--duration-base)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
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
                                className="flex-shrink-0"
                                style={{ color: 'var(--color-text-primary)' }}
                            >
                                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                            </svg>
                        ) : (
                            <div
                                className="rounded-full flex-shrink-0"
                                style={{
                                    width: '14px',
                                    height: '14px',
                                    backgroundColor: bucket.color,
                                    boxShadow: `0 0 12px ${bucket.color}60, 0 2px 8px ${bucket.color}40`
                                }}
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
                                    className="w-full rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none"
                                    style={{
                                        backgroundColor: 'var(--color-bg-tertiary)',
                                        border: '2px solid var(--color-accent)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-body)',
                                        boxShadow: 'var(--focus-ring)'
                                    }}
                                />
                            ) : (
                                <span
                                    className="font-semibold"
                                    style={{
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-body)',
                                        fontSize: 'var(--text-base)'
                                    }}
                                >
                                    {bucket.name}
                                </span>
                            )}

                            {/* Linked Jira Issue (only for buckets, not folders) */}
                            {!bucket.isFolder && bucket.linkedIssue && (
                                <div
                                    className="mt-3 rounded-lg p-3 border"
                                    style={{
                                        backgroundColor: 'var(--color-bg-tertiary)',
                                        borderColor: 'var(--color-border-secondary)',
                                        borderRadius: 'var(--radius-lg)'
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <span
                                            className="font-mono text-xs font-semibold"
                                            style={{ color: 'var(--color-info)' }}
                                        >
                                            {bucket.linkedIssue.key}
                                        </span>
                                        <span
                                            className="text-xs"
                                            style={{
                                                color: 'var(--color-text-tertiary)',
                                                fontFamily: 'var(--font-body)'
                                            }}
                                        >
                                            {bucket.linkedIssue.projectName}
                                        </span>
                                        <span
                                            className="text-xs px-2 py-0.5 rounded"
                                            style={{
                                                backgroundColor: 'var(--color-bg-tertiary)',
                                                color: 'var(--color-text-secondary)',
                                                fontFamily: 'var(--font-body)'
                                            }}
                                        >
                                            {bucket.linkedIssue.issueType}
                                        </span>
                                    </div>
                                    <p
                                        className="text-sm truncate mb-2"
                                        style={{
                                            color: 'var(--color-text-primary)',
                                            fontFamily: 'var(--font-body)'
                                        }}
                                    >
                                        {bucket.linkedIssue.summary}
                                    </p>
                                    <div className="flex items-center justify-between">
                                        <span
                                            className="text-xs"
                                            style={{
                                                color: 'var(--color-text-secondary)',
                                                fontFamily: 'var(--font-body)'
                                            }}
                                        >
                                            Status: {bucket.linkedIssue.status}
                                        </span>
                                        {onUnlinkJira && (
                                            <button
                                                onClick={() => onUnlinkJira(bucket.id)}
                                                className="text-xs font-medium transition-colors"
                                                style={{
                                                    color: 'var(--color-error)',
                                                    fontFamily: 'var(--font-body)',
                                                    transitionDuration: 'var(--duration-fast)'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-accent)'}
                                                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-error)'}
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
                    <div className="flex items-center gap-1 ml-3">
                        {/* Move to folder button */}
                        {onMove && availableFolders.length > 0 && (
                            <div className="relative" ref={moveMenuRef}>
                                <button
                                    onClick={() => setShowMoveMenu(!showMoveMenu)}
                                    className="p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    style={{
                                        color: 'var(--color-text-tertiary)',
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = 'var(--color-accent)';
                                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'var(--color-text-tertiary)';
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
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
                                    <div
                                        className="absolute right-0 top-full mt-2 rounded-lg z-10 min-w-[180px] glass animate-scale-in"
                                        style={{
                                            backgroundColor: 'var(--color-bg-secondary)',
                                            border: '1px solid var(--color-border-primary)',
                                            borderRadius: 'var(--radius-lg)',
                                            boxShadow: 'var(--shadow-xl)'
                                        }}
                                    >
                                        <div className="py-1.5">
                                            <button
                                                onClick={() => handleMove(null)}
                                                className="w-full text-left px-3 py-2 text-sm transition-colors"
                                                style={{
                                                    color: 'var(--color-text-primary)',
                                                    fontFamily: 'var(--font-body)',
                                                    transitionDuration: 'var(--duration-fast)'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'}
                                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                            >
                                                Move to Root
                                            </button>
                                            {availableFolders
                                                .filter(f => f.id !== bucket.id)
                                                .map(folder => (
                                                    <button
                                                        key={folder.id}
                                                        onClick={() => handleMove(folder.id)}
                                                        className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2"
                                                        style={{
                                                            color: 'var(--color-text-primary)',
                                                            fontFamily: 'var(--font-body)',
                                                            transitionDuration: 'var(--duration-fast)'
                                                        }}
                                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)'}
                                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
                                                            style={{ color: 'var(--color-text-primary)' }}
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
                            className="p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            style={{
                                color: 'var(--color-text-tertiary)',
                                transitionDuration: 'var(--duration-fast)',
                                transitionTimingFunction: 'var(--ease-out)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--color-accent)';
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--color-text-tertiary)';
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }}
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
                            className="p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            style={{
                                color: 'var(--color-text-tertiary)',
                                transitionDuration: 'var(--duration-fast)',
                                transitionTimingFunction: 'var(--ease-out)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = 'var(--color-error)';
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--color-text-tertiary)';
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }}
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
