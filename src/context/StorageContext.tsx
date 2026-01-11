import React, { createContext, useContext, useState, useEffect } from 'react';
import type {
    LinkedJiraIssue,
    WorkAssignment,
    TimeBucket,
    WindowActivity,
    TimeEntry
} from '../types/shared';

// Re-export shared types for backward compatibility
export type {
    LinkedJiraIssue,
    WorkAssignment,
    TimeBucket,
    WindowActivity,
    TimeEntry
};

interface StorageContextType {
    buckets: TimeBucket[];
    entries: TimeEntry[];
    addBucket: (name: string, color: string, parentId?: string | null) => void;
    removeBucket: (id: string) => void;
    renameBucket: (id: string, newName: string) => void;
    createFolder: (name: string, parentId?: string | null) => void;
    moveBucket: (bucketId: string, newParentId: string | null) => void;
    linkJiraIssueToBucket: (bucketId: string, issue: LinkedJiraIssue) => void;
    unlinkJiraIssueFromBucket: (bucketId: string) => void;
    linkJiraIssueToEntry: (entryId: string, issue: LinkedJiraIssue) => void;
    unlinkJiraIssueFromEntry: (entryId: string) => void;
    setEntryAssignment: (entryId: string, assignment: WorkAssignment | null) => void;
    setEntryTempoAccount: (entryId: string, account: { key: string; name: string; id: string } | null, autoSelected?: boolean) => void;
    addEntry: (entry: Omit<TimeEntry, 'id'>) => Promise<TimeEntry>;
    seedEntries: (newEntries: Omit<TimeEntry, 'id'>[]) => void;
    clearAllEntries: () => void;
    updateEntry: (id: string, updates: Partial<TimeEntry>) => void;
    removeEntry: (id: string) => void;
    removeActivityFromEntry: (entryId: string, activityIndex: number) => void;
    removeAllActivitiesForApp: (entryId: string, appName: string) => void;
    removeScreenshotFromEntry: (screenshotPath: string) => void;
    addManualActivityToEntry: (entryId: string, description: string, duration: number) => void;
}

const StorageContext = createContext<StorageContextType | undefined>(undefined);

export const StorageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [buckets, setBuckets] = useState<TimeBucket[]>([]);
    const [entries, setEntries] = useState<TimeEntry[]>([]);
    const [, setIsLoading] = useState(true);

    // Load from SQLite database
    useEffect(() => {
        const loadData = async () => {
            console.log('[StorageContext] Loading data from SQLite database');
            setIsLoading(true);

            try {
                // Load buckets from database
                const bucketsResult = await window.electron.ipcRenderer.db.getAllBuckets();
                if (bucketsResult.success && bucketsResult.data) {
                    if (bucketsResult.data.length > 0) {
                        console.log('[StorageContext] Loaded buckets from database:', bucketsResult.data.length);
                        setBuckets(bucketsResult.data);
                    } else {
                        // Create default buckets if none exist
                        console.log('[StorageContext] No buckets in database, creating defaults');
                        const defaultBuckets = [
                            { id: '1', name: 'Work', color: '#3b82f6' },
                            { id: '2', name: 'Meeting', color: '#eab308' },
                            { id: '3', name: 'Break', color: '#22c55e' }
                        ];

                        // Insert default buckets into database
                        for (const bucket of defaultBuckets) {
                            await window.electron.ipcRenderer.db.insertBucket(bucket);
                        }
                        setBuckets(defaultBuckets);
                    }
                } else {
                    console.error('[StorageContext] Failed to load buckets:', bucketsResult.error);
                    setBuckets([]);
                }

                // Load entries from database
                const entriesResult = await window.electron.ipcRenderer.db.getAllEntries();
                if (entriesResult.success && entriesResult.data) {
                    console.log('[StorageContext] Loaded entries from database:', entriesResult.data.length);
                    setEntries(entriesResult.data);
                } else {
                    console.error('[StorageContext] Failed to load entries:', entriesResult.error);
                    setEntries([]);
                }
            } catch (error) {
                console.error('[StorageContext] Error loading data from database:', error);
                setBuckets([]);
                setEntries([]);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, []);

    const addBucket = async (name: string, color: string, parentId?: string | null) => {
        const newBucket = {
            id: crypto.randomUUID(),
            name,
            color,
            parentId: parentId || null
        };

        // Insert into database
        const result = await window.electron.ipcRenderer.db.insertBucket(newBucket);
        if (result.success) {
            setBuckets([...buckets, newBucket]);
        } else {
            console.error('[StorageContext] Failed to add bucket:', result.error);
        }
    };

    const removeBucket = async (id: string) => {
        // When deleting a folder, also delete all its children
        const toDelete = new Set([id]);
        const findChildren = (parentId: string) => {
            buckets.forEach(bucket => {
                if (bucket.parentId === parentId) {
                    toDelete.add(bucket.id);
                    findChildren(bucket.id);
                }
            });
        };
        findChildren(id);

        // Delete from database
        for (const bucketId of toDelete) {
            const result = await window.electron.ipcRenderer.db.deleteBucket(bucketId);
            if (!result.success) {
                console.error('[StorageContext] Failed to delete bucket:', bucketId, result.error);
            }
        }

        setBuckets(buckets.filter(b => !toDelete.has(b.id)));
    };

    const renameBucket = async (id: string, newName: string) => {
        const result = await window.electron.ipcRenderer.db.updateBucket(id, { name: newName });
        if (result.success) {
            setBuckets(buckets.map(bucket =>
                bucket.id === id
                    ? { ...bucket, name: newName }
                    : bucket
            ));
        } else {
            console.error('[StorageContext] Failed to rename bucket:', result.error);
        }
    };

    const createFolder = async (name: string, parentId?: string | null) => {
        const newFolder = {
            id: crypto.randomUUID(),
            name,
            color: '#6b7280',  // Default gray color for folders
            parentId: parentId || null,
            isFolder: true
        };

        const result = await window.electron.ipcRenderer.db.insertBucket(newFolder);
        if (result.success) {
            setBuckets([...buckets, newFolder]);
        } else {
            console.error('[StorageContext] Failed to create folder:', result.error);
        }
    };

    const moveBucket = async (bucketId: string, newParentId: string | null) => {
        // Prevent moving a folder into itself or its descendants
        if (newParentId) {
            let currentId: string | null = newParentId;
            while (currentId) {
                if (currentId === bucketId) {
                    console.error('Cannot move folder into itself or its descendants');
                    return;
                }
                const parent = buckets.find(b => b.id === currentId);
                currentId = parent?.parentId || null;
            }
        }

        const result = await window.electron.ipcRenderer.db.updateBucket(bucketId, { parentId: newParentId });
        if (result.success) {
            setBuckets(buckets.map(bucket =>
                bucket.id === bucketId
                    ? { ...bucket, parentId: newParentId }
                    : bucket
            ));
        } else {
            console.error('[StorageContext] Failed to move bucket:', result.error);
        }
    };

    const linkJiraIssueToBucket = async (bucketId: string, issue: LinkedJiraIssue) => {
        const result = await window.electron.ipcRenderer.db.updateBucket(bucketId, { linkedIssue: issue });
        if (result.success) {
            setBuckets(buckets.map(bucket =>
                bucket.id === bucketId
                    ? { ...bucket, linkedIssue: issue }
                    : bucket
            ));
        } else {
            console.error('[StorageContext] Failed to link Jira issue to bucket:', result.error);
        }
    };

    const unlinkJiraIssueFromBucket = async (bucketId: string) => {
        const result = await window.electron.ipcRenderer.db.updateBucket(bucketId, { linkedIssue: undefined });
        if (result.success) {
            setBuckets(buckets.map(bucket =>
                bucket.id === bucketId
                    ? { ...bucket, linkedIssue: undefined }
                    : bucket
            ));
        } else {
            console.error('[StorageContext] Failed to unlink Jira issue from bucket:', result.error);
        }
    };

    const addEntry = async (entry: Omit<TimeEntry, 'id'>): Promise<TimeEntry> => {
        const newEntry: TimeEntry = { ...entry, id: crypto.randomUUID() };
        const result = await window.electron.ipcRenderer.db.insertEntry(newEntry);
        if (result.success) {
            // Use functional update to ensure we have the latest state
            setEntries(prevEntries => [newEntry, ...prevEntries]);
            return newEntry;
        } else {
            console.error('[StorageContext] Failed to add entry:', result.error);
            throw new Error('Failed to add entry');
        }
    };

    const seedEntries = async (newEntries: Omit<TimeEntry, 'id'>[]) => {
        // Add IDs to all new entries
        const entriesWithIds: TimeEntry[] = newEntries.map(entry => ({
            ...entry,
            id: crypto.randomUUID()
        }));

        // Insert all entries into database
        for (const entry of entriesWithIds) {
            const result = await window.electron.ipcRenderer.db.insertEntry(entry);
            if (!result.success) {
                console.error('[StorageContext] Failed to seed entry:', result.error);
            }
        }

        // Add all new entries to existing ones in a single state update
        setEntries(prevEntries => [...entriesWithIds, ...prevEntries]);
    };

    const clearAllEntries = async () => {
        const result = await window.electron.ipcRenderer.db.deleteAllEntries();
        if (result.success) {
            setEntries([]);
        } else {
            console.error('[StorageContext] Failed to clear entries:', result.error);
        }
    };

    const updateEntry = async (id: string, updates: Partial<TimeEntry>) => {
        const result = await window.electron.ipcRenderer.db.updateEntry(id, updates);
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === id ? { ...entry, ...updates } : entry
            ));
        } else {
            console.error('[StorageContext] Failed to update entry:', result.error);
        }
    };

    const removeEntry = async (id: string) => {
        const result = await window.electron.ipcRenderer.db.deleteEntry(id);
        if (result.success) {
            setEntries(prevEntries => prevEntries.filter(entry => entry.id !== id));
        } else {
            console.error('[StorageContext] Failed to remove entry:', result.error);
        }
    };

    const removeActivityFromEntry = async (entryId: string, activityIndex: number) => {
        const entry = entries.find(e => e.id === entryId);
        if (!entry || !entry.windowActivity) return;

        const updatedActivity = [...entry.windowActivity];
        updatedActivity.splice(activityIndex, 1);

        // Recalculate total duration based on remaining activities
        const newDuration = updatedActivity.reduce((sum, activity) => sum + activity.duration, 0);

        const updates = {
            windowActivity: updatedActivity,
            duration: newDuration
        };

        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, updates);
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(e =>
                e.id === entryId ? { ...e, ...updates } : e
            ));
        } else {
            console.error('[StorageContext] Failed to remove activity from entry:', result.error);
        }
    };

    const removeAllActivitiesForApp = async (entryId: string, appName: string) => {
        const entry = entries.find(e => e.id === entryId);
        if (!entry || !entry.windowActivity) return;

        const filteredActivity = entry.windowActivity.filter(
            activity => activity.appName !== appName
        );

        // Recalculate total duration based on remaining activities
        const newDuration = filteredActivity.reduce((sum, activity) => sum + activity.duration, 0);

        const updates = {
            windowActivity: filteredActivity,
            duration: newDuration
        };

        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, updates);
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(e =>
                e.id === entryId ? { ...e, ...updates } : e
            ));
        } else {
            console.error('[StorageContext] Failed to remove activities for app:', result.error);
        }
    };

    const removeScreenshotFromEntry = async (screenshotPath: string) => {
        // Find the entry that contains this screenshot
        const affectedEntry = entries.find(entry =>
            entry.windowActivity?.some(activity =>
                activity.screenshotPaths?.includes(screenshotPath)
            )
        );

        if (!affectedEntry) return;

        const updatedActivity = affectedEntry.windowActivity!.map(activity => {
            if (activity.screenshotPaths) {
                return {
                    ...activity,
                    screenshotPaths: activity.screenshotPaths.filter(path => path !== screenshotPath)
                };
            }
            return activity;
        });

        const result = await window.electron.ipcRenderer.db.updateEntry(affectedEntry.id, {
            windowActivity: updatedActivity
        });

        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === affectedEntry.id
                    ? { ...entry, windowActivity: updatedActivity }
                    : entry
            ));
        } else {
            console.error('[StorageContext] Failed to remove screenshot from entry:', result.error);
        }
    };

    const addManualActivityToEntry = async (entryId: string, description: string, duration: number) => {
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        const manualActivity: WindowActivity = {
            appName: 'Manual Entry',
            windowTitle: description,
            timestamp: Date.now(),
            duration: duration
        };

        const updatedActivity = [...(entry.windowActivity || []), manualActivity];
        // Recalculate total duration including the new manual activity
        const newDuration = updatedActivity.reduce((sum, activity) => sum + activity.duration, 0);

        const updates = {
            windowActivity: updatedActivity,
            duration: newDuration
        };

        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, updates);
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(e =>
                e.id === entryId ? { ...e, ...updates } : e
            ));
        } else {
            console.error('[StorageContext] Failed to add manual activity to entry:', result.error);
        }
    };

    const linkJiraIssueToEntry = async (entryId: string, issue: LinkedJiraIssue) => {
        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, { linkedJiraIssue: issue });
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === entryId
                    ? { ...entry, linkedJiraIssue: issue }
                    : entry
            ));
        } else {
            console.error('[StorageContext] Failed to link Jira issue to entry:', result.error);
        }
    };

    const unlinkJiraIssueFromEntry = async (entryId: string) => {
        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, { linkedJiraIssue: undefined });
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === entryId
                    ? { ...entry, linkedJiraIssue: undefined }
                    : entry
            ));
        } else {
            console.error('[StorageContext] Failed to unlink Jira issue from entry:', result.error);
        }
    };

    const setEntryAssignment = async (entryId: string, assignment: WorkAssignment | null) => {
        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, {
            assignment: assignment || undefined
        });
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === entryId
                    ? { ...entry, assignment: assignment || undefined }
                    : entry
            ));
        } else {
            console.error('[StorageContext] Failed to set entry assignment:', result.error);
        }
    };

    const setEntryTempoAccount = async (
        entryId: string,
        account: { key: string; name: string; id: string } | null,
        autoSelected?: boolean
    ) => {
        const updates = {
            tempoAccount: account || undefined,
            tempoAccountAutoSelected: account ? (autoSelected || false) : undefined
        };

        const result = await window.electron.ipcRenderer.db.updateEntry(entryId, updates);
        if (result.success) {
            setEntries(prevEntries => prevEntries.map(entry =>
                entry.id === entryId
                    ? { ...entry, ...updates }
                    : entry
            ));
        } else {
            console.error('[StorageContext] Failed to set entry tempo account:', result.error);
        }
    };

    return (
        <StorageContext.Provider value={{
            buckets,
            entries,
            addBucket,
            removeBucket,
            renameBucket,
            createFolder,
            moveBucket,
            linkJiraIssueToBucket,
            unlinkJiraIssueFromBucket,
            linkJiraIssueToEntry,
            unlinkJiraIssueFromEntry,
            setEntryAssignment,
            setEntryTempoAccount,
            addEntry,
            seedEntries,
            clearAllEntries,
            updateEntry,
            removeEntry,
            removeActivityFromEntry,
            removeAllActivitiesForApp,
            removeScreenshotFromEntry,
            addManualActivityToEntry
        }}>
            {children}
        </StorageContext.Provider>
    );
};

export const useStorage = () => {
    const context = useContext(StorageContext);
    if (!context) throw new Error('useStorage must be used within a StorageProvider');
    return context;
};
