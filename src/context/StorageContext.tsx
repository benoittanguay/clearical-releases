import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

export interface LinkedJiraIssue {
    key: string;
    summary: string;
    issueType: string;
    status: string;
    projectKey: string;
    projectName: string;
}

export interface WorkAssignment {
    type: 'bucket' | 'jira';
    bucket?: {
        id: string;
        name: string;
        color: string;
    };
    jiraIssue?: LinkedJiraIssue;
}

export interface TimeBucket {
    id: string;
    name: string;
    color: string;
    parentId?: string | null;  // Parent folder ID (null/undefined = root level)
    isFolder?: boolean;        // True if this is a folder, not a bucket
    linkedIssue?: LinkedJiraIssue;
}

export interface WindowActivity {
    appName: string;
    windowTitle: string;
    timestamp: number;
    duration: number;
    screenshotPaths?: string[]; // Array of screenshot file paths for this activity
    screenshotDescriptions?: { [path: string]: string }; // AI-generated descriptions for each screenshot
}

export interface TimeEntry {
    id: string;
    startTime: number;
    endTime: number;
    duration: number; // ms
    assignment?: WorkAssignment;
    bucketId?: string | null; // Legacy field for migration
    linkedJiraIssue?: LinkedJiraIssue; // Legacy field for migration
    description?: string;
    windowActivity?: WindowActivity[];
    screenshotPath?: string; // Future use
}

interface StorageContextType {
    buckets: TimeBucket[];
    entries: TimeEntry[];
    addBucket: (name: string, color: string) => void;
    removeBucket: (id: string) => void;
    renameBucket: (id: string, newName: string) => void;
    createFolder: (name: string, parentId?: string | null) => void;
    moveBucket: (bucketId: string, newParentId: string | null) => void;
    linkJiraIssueToBucket: (bucketId: string, issue: LinkedJiraIssue) => void;
    unlinkJiraIssueFromBucket: (bucketId: string) => void;
    linkJiraIssueToEntry: (entryId: string, issue: LinkedJiraIssue) => void;
    unlinkJiraIssueFromEntry: (entryId: string) => void;
    setEntryAssignment: (entryId: string, assignment: WorkAssignment | null) => void;
    addEntry: (entry: Omit<TimeEntry, 'id'>) => TimeEntry;
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
    const migrationDoneRef = useRef(false);

    // Migration function to handle old bucket format
    const migrateBuckets = (buckets: any[]): TimeBucket[] => {
        return buckets.map(bucket => {
            // If bucket doesn't have linkedIssue property, add it as undefined
            if (!bucket.hasOwnProperty('linkedIssue')) {
                return { ...bucket, linkedIssue: undefined };
            }
            return bucket;
        });
    };

    // Migration function to handle old entry format (dual-assignment to unified)
    const migrateEntries = (entries: any[], availableBuckets: TimeBucket[]): TimeEntry[] => {
        return entries.map(entry => {
            // If entry has new assignment field, return as is
            if (entry.assignment) {
                return entry;
            }

            // Migrate from old dual-assignment system
            let assignment: WorkAssignment | undefined = undefined;

            // Priority: Jira issue over bucket (as specified in implementation plan)
            if (entry.linkedJiraIssue) {
                assignment = {
                    type: 'jira',
                    jiraIssue: entry.linkedJiraIssue
                };
            } else if (entry.bucketId) {
                // Find the bucket to get its details
                const bucket = availableBuckets.find(b => b.id === entry.bucketId);
                if (bucket) {
                    assignment = {
                        type: 'bucket',
                        bucket: {
                            id: bucket.id,
                            name: bucket.name,
                            color: bucket.color
                        }
                    };
                }
            }

            return {
                ...entry,
                assignment,
                // Keep legacy fields for gradual migration
                bucketId: entry.bucketId,
                linkedJiraIssue: entry.linkedJiraIssue
            };
        });
    };

    // Load from local storage
    useEffect(() => {
        console.log('[StorageContext] useEffect triggered - loading data');
        const loadedBuckets = localStorage.getItem('timeportal-buckets');
        const loadedEntries = localStorage.getItem('timeportal-entries');

        console.log('[StorageContext] Loading buckets from localStorage:', loadedBuckets);
        
        if (loadedBuckets && loadedBuckets !== 'undefined' && loadedBuckets !== 'null') {
            try {
                const parsed = JSON.parse(loadedBuckets);
                console.log('[StorageContext] Parsed buckets:', parsed);
                
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const migratedBuckets = migrateBuckets(parsed);
                    console.log('[StorageContext] Migrated buckets:', migratedBuckets);
                    setBuckets(migratedBuckets);
                } else {
                    console.log('[StorageContext] Empty or invalid buckets array, creating defaults');
                    const defaultBuckets = [
                        { id: '1', name: 'Work', color: '#3b82f6' },
                        { id: '2', name: 'Meeting', color: '#eab308' },
                        { id: '3', name: 'Break', color: '#22c55e' }
                    ];
                    setBuckets(defaultBuckets);
                }
            } catch (error) {
                console.error('[StorageContext] Error parsing buckets, using defaults:', error);
                const defaultBuckets = [
                    { id: '1', name: 'Work', color: '#3b82f6' },
                    { id: '2', name: 'Meeting', color: '#eab308' },
                    { id: '3', name: 'Break', color: '#22c55e' }
                ];
                setBuckets(defaultBuckets);
            }
        } else {
            // Default buckets
            console.log('[StorageContext] No saved buckets, creating defaults');
            const defaultBuckets = [
                { id: '1', name: 'Work', color: '#3b82f6' },
                { id: '2', name: 'Meeting', color: '#eab308' },
                { id: '3', name: 'Break', color: '#22c55e' }
            ];
            setBuckets(defaultBuckets);
        }

        if (loadedEntries && loadedEntries !== 'undefined' && loadedEntries !== 'null') {
            try {
                const parsed = JSON.parse(loadedEntries);
                if (Array.isArray(parsed)) {
                    // Defer entries migration until buckets are loaded
                    setEntries(parsed);
                }
            } catch (error) {
                console.error('[StorageContext] Error parsing entries:', error);
                setEntries([]);
            }
        }
    }, []);

    // Migrate entries when buckets are loaded (run only once)
    useEffect(() => {
        if (!migrationDoneRef.current && buckets.length > 0 && entries.length > 0) {
            // Check if any entries need migration
            const needsMigration = entries.some(entry => 
                !entry.assignment && (entry.bucketId || entry.linkedJiraIssue)
            );
            
            if (needsMigration) {
                console.log('[StorageContext] Migrating entries from dual-assignment to unified model');
                const migratedEntries = migrateEntries(entries, buckets);
                setEntries(migratedEntries);
            }
            // Mark migration as done regardless of whether it was needed
            migrationDoneRef.current = true;
        }
    }, [buckets, entries]);

    // Persist
    useEffect(() => {
        localStorage.setItem('timeportal-buckets', JSON.stringify(buckets));
    }, [buckets]);

    useEffect(() => {
        localStorage.setItem('timeportal-entries', JSON.stringify(entries));
    }, [entries]);

    const addBucket = (name: string, color: string) => {
        setBuckets([...buckets, { id: crypto.randomUUID(), name, color }]);
    };

    const removeBucket = (id: string) => {
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
        setBuckets(buckets.filter(b => !toDelete.has(b.id)));
    };

    const renameBucket = (id: string, newName: string) => {
        setBuckets(buckets.map(bucket =>
            bucket.id === id
                ? { ...bucket, name: newName }
                : bucket
        ));
    };

    const createFolder = (name: string, parentId?: string | null) => {
        setBuckets([...buckets, {
            id: crypto.randomUUID(),
            name,
            color: '#6b7280',  // Default gray color for folders
            parentId: parentId || null,
            isFolder: true
        }]);
    };

    const moveBucket = (bucketId: string, newParentId: string | null) => {
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

        setBuckets(buckets.map(bucket =>
            bucket.id === bucketId
                ? { ...bucket, parentId: newParentId }
                : bucket
        ));
    };

    const linkJiraIssueToBucket = (bucketId: string, issue: LinkedJiraIssue) => {
        setBuckets(buckets.map(bucket => 
            bucket.id === bucketId 
                ? { ...bucket, linkedIssue: issue }
                : bucket
        ));
    };

    const unlinkJiraIssueFromBucket = (bucketId: string) => {
        setBuckets(buckets.map(bucket => 
            bucket.id === bucketId 
                ? { ...bucket, linkedIssue: undefined }
                : bucket
        ));
    };

    const addEntry = (entry: Omit<TimeEntry, 'id'>): TimeEntry => {
        const newEntry: TimeEntry = { ...entry, id: crypto.randomUUID() };
        setEntries([newEntry, ...entries]);
        return newEntry;
    };

    const seedEntries = (newEntries: Omit<TimeEntry, 'id'>[]) => {
        // Add IDs to all new entries
        const entriesWithIds: TimeEntry[] = newEntries.map(entry => ({
            ...entry,
            id: crypto.randomUUID()
        }));

        // Add all new entries to existing ones in a single state update
        setEntries(prevEntries => [...entriesWithIds, ...prevEntries]);
    };

    const clearAllEntries = () => {
        setEntries([]);
    };

    const updateEntry = (id: string, updates: Partial<TimeEntry>) => {
        setEntries(entries.map(entry => 
            entry.id === id ? { ...entry, ...updates } : entry
        ));
    };

    const removeEntry = (id: string) => {
        setEntries(entries.filter(entry => entry.id !== id));
    };

    const removeActivityFromEntry = (entryId: string, activityIndex: number) => {
        setEntries(entries.map(entry => {
            if (entry.id === entryId && entry.windowActivity) {
                const updatedActivity = [...entry.windowActivity];
                updatedActivity.splice(activityIndex, 1);
                
                // Recalculate total duration based on remaining activities
                const newDuration = updatedActivity.reduce((sum, activity) => sum + activity.duration, 0);
                
                return { 
                    ...entry, 
                    windowActivity: updatedActivity,
                    duration: newDuration
                };
            }
            return entry;
        }));
    };

    const removeAllActivitiesForApp = (entryId: string, appName: string) => {
        setEntries(entries.map(entry => {
            if (entry.id === entryId && entry.windowActivity) {
                const filteredActivity = entry.windowActivity.filter(
                    activity => activity.appName !== appName
                );
                
                // Recalculate total duration based on remaining activities
                const newDuration = filteredActivity.reduce((sum, activity) => sum + activity.duration, 0);
                
                return { 
                    ...entry, 
                    windowActivity: filteredActivity,
                    duration: newDuration
                };
            }
            return entry;
        }));
    };

    const removeScreenshotFromEntry = (screenshotPath: string) => {
        setEntries(entries.map(entry => {
            if (entry.windowActivity) {
                const updatedActivity = entry.windowActivity.map(activity => {
                    if (activity.screenshotPaths) {
                        return {
                            ...activity,
                            screenshotPaths: activity.screenshotPaths.filter(path => path !== screenshotPath)
                        };
                    }
                    return activity;
                });
                return { ...entry, windowActivity: updatedActivity };
            }
            return entry;
        }));
    };

    const addManualActivityToEntry = (entryId: string, description: string, duration: number) => {
        setEntries(entries.map(entry => {
            if (entry.id === entryId) {
                const manualActivity: WindowActivity = {
                    appName: 'Manual Entry',
                    windowTitle: description,
                    timestamp: Date.now(),
                    duration: duration
                };
                
                const updatedActivity = [...(entry.windowActivity || []), manualActivity];
                // Recalculate total duration including the new manual activity
                const newDuration = updatedActivity.reduce((sum, activity) => sum + activity.duration, 0);
                
                return {
                    ...entry,
                    windowActivity: updatedActivity,
                    duration: newDuration
                };
            }
            return entry;
        }));
    };

    const linkJiraIssueToEntry = (entryId: string, issue: LinkedJiraIssue) => {
        setEntries(entries.map(entry => 
            entry.id === entryId 
                ? { ...entry, linkedJiraIssue: issue }
                : entry
        ));
    };

    const unlinkJiraIssueFromEntry = (entryId: string) => {
        setEntries(entries.map(entry => 
            entry.id === entryId 
                ? { ...entry, linkedJiraIssue: undefined }
                : entry
        ));
    };

    const setEntryAssignment = (entryId: string, assignment: WorkAssignment | null) => {
        setEntries(entries.map(entry => 
            entry.id === entryId 
                ? { ...entry, assignment: assignment || undefined }
                : entry
        ));
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
