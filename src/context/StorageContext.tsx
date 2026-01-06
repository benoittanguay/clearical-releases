import React, { createContext, useContext, useState, useEffect } from 'react';

export interface TimeBucket {
    id: string;
    name: string;
    color: string;
}

export interface WindowActivity {
    appName: string;
    windowTitle: string;
    timestamp: number;
    duration: number;
    screenshotPaths?: string[]; // Array of screenshot file paths for this activity
}

export interface TimeEntry {
    id: string;
    startTime: number;
    endTime: number;
    duration: number; // ms
    bucketId: string | null;
    description?: string;
    windowActivity?: WindowActivity[];
    screenshotPath?: string; // Future use
}

interface StorageContextType {
    buckets: TimeBucket[];
    entries: TimeEntry[];
    addBucket: (name: string, color: string) => void;
    removeBucket: (id: string) => void;
    addEntry: (entry: Omit<TimeEntry, 'id'>) => void;
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

    // Load from local storage
    useEffect(() => {
        const loadedBuckets = localStorage.getItem('timeportal-buckets');
        const loadedEntries = localStorage.getItem('timeportal-entries');

        if (loadedBuckets) setBuckets(JSON.parse(loadedBuckets));
        else {
            // Default buckets
            setBuckets([
                { id: '1', name: 'Work', color: '#3b82f6' },
                { id: '2', name: 'Meeting', color: '#eab308' },
                { id: '3', name: 'Break', color: '#22c55e' }
            ]);
        }

        if (loadedEntries) setEntries(JSON.parse(loadedEntries));
    }, []);

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
        setBuckets(buckets.filter(b => b.id !== id));
    };

    const addEntry = (entry: Omit<TimeEntry, 'id'>) => {
        setEntries([
            { ...entry, id: crypto.randomUUID() },
            ...entries
        ]);
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

    return (
        <StorageContext.Provider value={{ 
            buckets, 
            entries, 
            addBucket, 
            removeBucket, 
            addEntry, 
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
