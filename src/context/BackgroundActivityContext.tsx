import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { BackgroundActivity } from '../types/shared';

interface BackgroundActivityContextType {
    activities: BackgroundActivity[];
    claimActivities: (fromTimestamp: number, toTimestamp: number) => Promise<BackgroundActivity[]>;
    pauseTracking: () => void;
    resumeTracking: () => void;
}

const BackgroundActivityContext = createContext<BackgroundActivityContextType | null>(null);

export function BackgroundActivityProvider({ children }: { children: ReactNode }) {
    const [activities, setActivities] = useState<BackgroundActivity[]>([]);

    useEffect(() => {
        // Load initial activities
        // @ts-ignore
        window.electron?.backgroundActivity?.getActivities?.()
            .then((result: BackgroundActivity[]) => {
                if (result) setActivities(result);
            })
            .catch(() => {});

        // Subscribe to updates
        // @ts-ignore
        const unsubscribe = window.electron?.backgroundActivity?.onUpdate?.((newActivities: BackgroundActivity[]) => {
            setActivities(newActivities);
        });

        return () => {
            unsubscribe?.();
        };
    }, []);

    const claimActivities = useCallback(async (fromTimestamp: number, toTimestamp: number): Promise<BackgroundActivity[]> => {
        // @ts-ignore
        const claimed = await window.electron?.backgroundActivity?.claimActivities?.(fromTimestamp, toTimestamp);
        return claimed || [];
    }, []);

    const pauseTracking = useCallback(() => {
        // @ts-ignore
        window.electron?.backgroundActivity?.pause?.();
    }, []);

    const resumeTracking = useCallback(() => {
        // @ts-ignore
        window.electron?.backgroundActivity?.resume?.();
    }, []);

    return (
        <BackgroundActivityContext.Provider value={{ activities, claimActivities, pauseTracking, resumeTracking }}>
            {children}
        </BackgroundActivityContext.Provider>
    );
}

export function useBackgroundActivity() {
    const context = useContext(BackgroundActivityContext);
    if (!context) {
        throw new Error('useBackgroundActivity must be used within BackgroundActivityProvider');
    }
    return context;
}
