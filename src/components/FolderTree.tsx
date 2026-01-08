import React, { useState } from 'react';
import { BucketItem } from './BucketItem';
import type { TimeBucket } from '../context/StorageContext';

interface FolderTreeProps {
    buckets: TimeBucket[];
    onRename: (id: string, newName: string) => void;
    onDelete: (id: string) => void;
    onUnlinkJira?: (bucketId: string) => void;
    onMove?: (bucketId: string, newParentId: string | null) => void;
}

interface TreeNode {
    bucket: TimeBucket;
    children: TreeNode[];
}

export const FolderTree: React.FC<FolderTreeProps> = ({
    buckets,
    onRename,
    onDelete,
    onUnlinkJira,
    onMove
}) => {
    // Track which folders are expanded
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

    // Build tree structure
    const buildTree = (): TreeNode[] => {
        const nodeMap = new Map<string, TreeNode>();
        const rootNodes: TreeNode[] = [];

        // First pass: create all nodes
        buckets.forEach(bucket => {
            nodeMap.set(bucket.id, { bucket, children: [] });
        });

        // Second pass: build parent-child relationships
        buckets.forEach(bucket => {
            const node = nodeMap.get(bucket.id)!;

            if (bucket.parentId && nodeMap.has(bucket.parentId)) {
                // Add to parent's children
                const parent = nodeMap.get(bucket.parentId)!;
                parent.children.push(node);
            } else {
                // Root level item
                rootNodes.push(node);
            }
        });

        // Sort nodes: folders first, then alphabetically
        const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.sort((a, b) => {
                // Folders come before buckets
                if (a.bucket.isFolder && !b.bucket.isFolder) return -1;
                if (!a.bucket.isFolder && b.bucket.isFolder) return 1;
                // Alphabetical within same type
                return a.bucket.name.localeCompare(b.bucket.name);
            });
        };

        // Recursively sort all levels
        const sortRecursively = (nodes: TreeNode[]): TreeNode[] => {
            const sorted = sortNodes(nodes);
            sorted.forEach(node => {
                if (node.children.length > 0) {
                    node.children = sortRecursively(node.children);
                }
            });
            return sorted;
        };

        return sortRecursively(rootNodes);
    };

    const toggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    };

    // Get all folders for the move menu (excluding non-folder items)
    const availableFolders = buckets.filter(b => b.isFolder);

    // Render tree recursively
    const renderTree = (nodes: TreeNode[], level: number = 0): React.ReactNode => {
        return nodes.map(node => {
            const isExpanded = expandedFolders.has(node.bucket.id);
            const hasChildren = node.children.length > 0;

            return (
                <React.Fragment key={node.bucket.id}>
                    <BucketItem
                        bucket={node.bucket}
                        level={level}
                        isExpanded={isExpanded}
                        onToggleExpand={
                            node.bucket.isFolder && hasChildren
                                ? () => toggleFolder(node.bucket.id)
                                : undefined
                        }
                        onRename={onRename}
                        onDelete={onDelete}
                        onUnlinkJira={onUnlinkJira}
                        onMove={onMove}
                        availableFolders={availableFolders}
                    />
                    {/* Render children if folder is expanded */}
                    {node.bucket.isFolder && isExpanded && hasChildren && (
                        <div className="mt-3">
                            {renderTree(node.children, level + 1)}
                        </div>
                    )}
                </React.Fragment>
            );
        });
    };

    const tree = buildTree();

    return (
        <ul className="space-y-3">
            {tree.length === 0 ? (
                <li className="text-gray-500 text-sm text-center py-8">
                    No buckets or folders yet. Create one to get started.
                </li>
            ) : (
                renderTree(tree)
            )}
        </ul>
    );
};
