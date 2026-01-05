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

    return (
        <StorageContext.Provider value={{ buckets, entries, addBucket, removeBucket, addEntry, updateEntry }}>
            {children}
        </StorageContext.Provider>
    );
};

export const useStorage = () => {
    const context = useContext(StorageContext);
    if (!context) throw new Error('useStorage must be used within a StorageProvider');
    return context;
};
