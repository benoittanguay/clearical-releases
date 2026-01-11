import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

interface AnalysisProgress {
    path: string;
    status: 'analyzing' | 'complete' | 'error';
    startTime: number;
    error?: string;
}

interface ScreenshotAnalysisContextValue {
    activeAnalyses: Map<string, AnalysisProgress>;
    totalAnalyzing: number;
    startAnalysis: (path: string) => void;
    completeAnalysis: (path: string) => void;
    failAnalysis: (path: string, error: string) => void;
    isAnalyzing: (path: string) => boolean;
    getProgress: (path: string) => AnalysisProgress | undefined;
}

const ScreenshotAnalysisContext = createContext<ScreenshotAnalysisContextValue | null>(null);

export function ScreenshotAnalysisProvider({ children }: { children: ReactNode }) {
    const [activeAnalyses, setActiveAnalyses] = useState<Map<string, AnalysisProgress>>(new Map());

    const startAnalysis = useCallback((path: string) => {
        console.log('[ScreenshotAnalysisContext] Starting analysis for:', path);
        setActiveAnalyses(prev => {
            const next = new Map(prev);
            next.set(path, {
                path,
                status: 'analyzing',
                startTime: Date.now()
            });
            return next;
        });
    }, []);

    const completeAnalysis = useCallback((path: string) => {
        console.log('[ScreenshotAnalysisContext] Completed analysis for:', path);
        setActiveAnalyses(prev => {
            const next = new Map(prev);
            const current = next.get(path);
            if (current) {
                // Keep completed analyses for a short time before removing
                next.set(path, {
                    ...current,
                    status: 'complete'
                });

                // Remove after 2 seconds
                setTimeout(() => {
                    setActiveAnalyses(latest => {
                        const updated = new Map(latest);
                        updated.delete(path);
                        return updated;
                    });
                }, 2000);
            }
            return next;
        });
    }, []);

    const failAnalysis = useCallback((path: string, error: string) => {
        console.log('[ScreenshotAnalysisContext] Failed analysis for:', path, error);
        setActiveAnalyses(prev => {
            const next = new Map(prev);
            const current = next.get(path);
            if (current) {
                next.set(path, {
                    ...current,
                    status: 'error',
                    error
                });

                // Remove after 5 seconds
                setTimeout(() => {
                    setActiveAnalyses(latest => {
                        const updated = new Map(latest);
                        updated.delete(path);
                        return updated;
                    });
                }, 5000);
            }
            return next;
        });
    }, []);

    const isAnalyzing = useCallback((path: string) => {
        const progress = activeAnalyses.get(path);
        return progress?.status === 'analyzing';
    }, [activeAnalyses]);

    const getProgress = useCallback((path: string) => {
        return activeAnalyses.get(path);
    }, [activeAnalyses]);

    const totalAnalyzing = Array.from(activeAnalyses.values()).filter(
        p => p.status === 'analyzing'
    ).length;

    // Listen for IPC events from main process (if needed in the future)
    useEffect(() => {
        // @ts-ignore
        if (window.electron?.ipcRenderer?.on) {
            const handleAnalysisStart = (path: string) => {
                startAnalysis(path);
            };

            const handleAnalysisComplete = (path: string) => {
                completeAnalysis(path);
            };

            const handleAnalysisError = (data: { path: string; error: string }) => {
                failAnalysis(data.path, data.error);
            };

            // @ts-ignore
            window.electron.ipcRenderer.on('screenshot-analysis-start', handleAnalysisStart);
            // @ts-ignore
            window.electron.ipcRenderer.on('screenshot-analysis-complete', handleAnalysisComplete);
            // @ts-ignore
            window.electron.ipcRenderer.on('screenshot-analysis-error', handleAnalysisError);

            return () => {
                // @ts-ignore
                window.electron.ipcRenderer.removeListener('screenshot-analysis-start', handleAnalysisStart);
                // @ts-ignore
                window.electron.ipcRenderer.removeListener('screenshot-analysis-complete', handleAnalysisComplete);
                // @ts-ignore
                window.electron.ipcRenderer.removeListener('screenshot-analysis-error', handleAnalysisError);
            };
        }
    }, [startAnalysis, completeAnalysis, failAnalysis]);

    return (
        <ScreenshotAnalysisContext.Provider
            value={{
                activeAnalyses,
                totalAnalyzing,
                startAnalysis,
                completeAnalysis,
                failAnalysis,
                isAnalyzing,
                getProgress
            }}
        >
            {children}
        </ScreenshotAnalysisContext.Provider>
    );
}

export function useScreenshotAnalysis() {
    const context = useContext(ScreenshotAnalysisContext);
    if (!context) {
        throw new Error('useScreenshotAnalysis must be used within ScreenshotAnalysisProvider');
    }
    return context;
}
