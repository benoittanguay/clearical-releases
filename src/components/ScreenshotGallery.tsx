import { useState, useEffect } from 'react';
import { DeleteButton } from './DeleteButton';
import { useScreenshotAnalysis } from '../context/ScreenshotAnalysisContext';

interface VisionFrameworkRawData {
    confidence?: number;
    detectedText?: string[];
    objects?: string[];
    extraction?: any;
}

interface ScreenshotMetadata {
    path: string;
    timestamp: number;
    appName?: string;
    windowTitle?: string;

    // NEW: Two-stage architecture fields
    aiDescription?: string;  // LLM-generated narrative (Stage 2)
    rawVisionData?: VisionFrameworkRawData;  // Vision Framework extraction (Stage 1)
    llmError?: string;  // LLM error if description generation failed

    // Legacy field (deprecated)
    visionData?: VisionFrameworkRawData;
}

interface ScreenshotGalleryProps {
    screenshotPaths: string[];
    metadata?: ScreenshotMetadata[];
    onClose: () => void;
    onScreenshotDeleted?: (screenshotPath: string) => void;
}

export function ScreenshotGallery({ screenshotPaths, metadata, onClose, onScreenshotDeleted }: ScreenshotGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showMetadata, setShowMetadata] = useState(false);
    // Raw vision data is always shown, no toggle needed
    const [loadedImages, setLoadedImages] = useState<Map<string, string>>(new Map());
    const { isAnalyzing } = useScreenshotAnalysis();

    // Load images via IPC
    useEffect(() => {
        const loadImages = async () => {
            console.log('[ScreenshotGallery] Loading images for paths:', screenshotPaths);
            // @ts-ignore - window.electron is defined in preload
            console.log('[ScreenshotGallery] Electron API available:', !!window.electron?.ipcRenderer?.getScreenshot);

            const imagePromises = screenshotPaths.map(async (path) => {
                if (loadedImages.has(path)) {
                    console.log('[ScreenshotGallery] Using cached image for:', path);
                    return { path, dataUrl: loadedImages.get(path)! };
                }

                console.log('[ScreenshotGallery] Loading image:', path);
                try {
                    // @ts-ignore
                    if (window.electron?.ipcRenderer?.getScreenshot) {
                        // @ts-ignore
                        const dataUrl = await window.electron.ipcRenderer.getScreenshot(path);
                        console.log('[ScreenshotGallery] Received dataUrl for:', path, dataUrl ? 'SUCCESS' : 'NULL');
                        return { path, dataUrl };
                    } else {
                        console.error('[ScreenshotGallery] getScreenshot method not available');
                    }
                } catch (error) {
                    console.error('[ScreenshotGallery] Failed to load screenshot:', path, error);
                }
                return { path, dataUrl: null };
            });

            const results = await Promise.all(imagePromises);
            const newImageMap = new Map(loadedImages);
            
            results.forEach(({ path, dataUrl }) => {
                if (dataUrl) {
                    newImageMap.set(path, dataUrl);
                    console.log('[ScreenshotGallery] Added to image map:', path);
                }
            });

            console.log('[ScreenshotGallery] Total loaded images:', newImageMap.size);
            setLoadedImages(newImageMap);
        };

        if (screenshotPaths.length > 0) {
            loadImages();
        }
    }, [screenshotPaths]);

    if (screenshotPaths.length === 0) {
        return null;
    }

    const currentScreenshot = screenshotPaths[selectedIndex];
    const currentMetadata = metadata?.[selectedIndex];

    const nextScreenshot = () => {
        setSelectedIndex((prev) => (prev + 1) % screenshotPaths.length);
    };

    const prevScreenshot = () => {
        setSelectedIndex((prev) => (prev - 1 + screenshotPaths.length) % screenshotPaths.length);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
        } else if (e.key === 'ArrowLeft') {
            prevScreenshot();
        } else if (e.key === 'ArrowRight') {
            nextScreenshot();
        }
    };

    const handleDeleteScreenshot = async () => {
        const screenshotToDelete = currentScreenshot;
        
        try {
            // @ts-ignore
            if (window.electron?.ipcRenderer?.invoke) {
                // @ts-ignore
                const result = await window.electron.ipcRenderer.invoke('delete-file', screenshotToDelete);
                
                if (result.success) {
                    // Notify parent component
                    onScreenshotDeleted?.(screenshotToDelete);
                    
                    // If this was the last screenshot, close the gallery
                    if (screenshotPaths.length <= 1) {
                        onClose();
                    } else {
                        // Adjust selection if needed
                        if (selectedIndex >= screenshotPaths.length - 1) {
                            setSelectedIndex(Math.max(0, screenshotPaths.length - 2));
                        }
                    }
                } else {
                    console.error('Failed to delete screenshot:', result.error);
                }
            }
        } catch (error) {
            console.error('Failed to delete screenshot:', error);
        }
    };

    const handleDownload = () => {
        const dataUrl = loadedImages.get(currentScreenshot);
        if (dataUrl) {
            const timestamp = currentMetadata?.timestamp || Date.now();
            const filename = `screenshot-${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}.png`;
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center modal-backdrop"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Header - Left Side Buttons */}
            <div className="absolute top-4 left-4 flex items-center gap-2 z-20 no-drag">
                {/* Info Toggle Button */}
                {currentMetadata && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMetadata(!showMetadata);
                        }}
                        className={`transition-all bg-black/50 rounded-lg p-2 active:scale-95 ${
                            showMetadata
                                ? 'text-green-400 hover:text-green-300'
                                : 'text-white'
                        }`}
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        onMouseEnter={(e) => {
                            if (!showMetadata) {
                                e.currentTarget.style.color = 'var(--color-accent)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!showMetadata) {
                                e.currentTarget.style.color = 'white';
                            }
                        }}
                        title={showMetadata ? "Hide screenshot info" : "Show screenshot info"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="16" x2="12" y2="12"/>
                            <line x1="12" y1="8" x2="12.01" y2="8"/>
                        </svg>
                    </button>
                )}

                {/* Download Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleDownload();
                    }}
                    className="text-white transition-all bg-black/50 rounded-lg p-2 active:scale-95"
                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--color-accent)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'white';
                    }}
                    title="Download"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>

                {/* Delete Button */}
                <div className="bg-black/50 rounded-lg p-1">
                    <DeleteButton
                        onDelete={handleDeleteScreenshot}
                        confirmMessage="Delete this screenshot?"
                        size="md"
                        variant="subtle"
                        className="text-white"
                    />
                </div>
            </div>

            {/* Header - Right Side Close Button */}
            <div className="absolute top-4 right-4 z-20 no-drag">
                <button
                    onClick={onClose}
                    className="text-white transition-all bg-black/50 rounded-lg p-2 active:scale-95"
                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--color-accent)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'white';
                    }}
                    title="Close (Esc)"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {/* Navigation Buttons */}
            {screenshotPaths.length > 1 && (
                <>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            prevScreenshot();
                        }}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 hover:scale-110 active:scale-95 transition-all z-10 bg-black/50 hover:bg-black/70 rounded-full p-3 no-drag"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            nextScreenshot();
                        }}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 hover:scale-110 active:scale-95 transition-all z-10 bg-black/50 hover:bg-black/70 rounded-full p-3 no-drag"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                </>
            )}

            {/* Screenshot Display */}
            <div
                className="max-w-full max-h-full p-4 modal-content"
                onClick={(e) => e.stopPropagation()}
            >
                {loadedImages.get(currentScreenshot) ? (
                    <img
                        src={loadedImages.get(currentScreenshot)}
                        alt={`Screenshot ${selectedIndex + 1}`}
                        className="max-w-full max-h-[90vh] object-contain rounded-lg"
                        style={{ boxShadow: 'var(--shadow-xl)' }}
                    />
                ) : (
                    <div className="max-w-full max-h-[90vh] flex items-center justify-center bg-gray-800 rounded-lg p-8">
                        <div className="text-gray-400 text-center animate-fade-in">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 spinner">
                                <circle cx="12" cy="12" r="3"/>
                                <circle cx="12" cy="1" r="1"/>
                                <circle cx="12" cy="23" r="1"/>
                                <circle cx="4.22" cy="4.22" r="1"/>
                                <circle cx="19.78" cy="19.78" r="1"/>
                                <circle cx="1" cy="12" r="1"/>
                                <circle cx="23" cy="12" r="1"/>
                                <circle cx="4.22" cy="19.78" r="1"/>
                                <circle cx="19.78" cy="4.22" r="1"/>
                            </svg>
                            <p>Loading screenshot...</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Metadata Panel - Redesigned */}
            {showMetadata && currentMetadata && (
                <div
                    className="absolute top-20 left-4 max-w-md z-20 animate-slide-in-right no-drag overflow-hidden"
                    style={{
                        background: 'linear-gradient(135deg, rgba(250, 245, 238, 0.97) 0%, rgba(255, 252, 249, 0.95) 100%)',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '16px',
                        border: '1px solid rgba(255, 72, 0, 0.15)',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) inset'
                    }}
                >
                    {/* Header with accent stripe */}
                    <div
                        className="px-5 py-4 border-b"
                        style={{
                            background: 'linear-gradient(90deg, var(--color-accent) 0%, #FF6B35 100%)',
                            borderColor: 'rgba(255, 72, 0, 0.2)'
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                                    style={{ background: 'rgba(255, 255, 255, 0.25)' }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                                        Screenshot Details
                                    </h3>
                                    <p className="text-[11px] text-white/70 font-medium">
                                        {selectedIndex + 1} of {screenshotPaths.length}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowMetadata(false);
                                }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                                style={{
                                    background: 'rgba(255, 255, 255, 0.2)',
                                    transitionDuration: 'var(--duration-fast)'
                                }}
                                title="Close panel"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18"/>
                                    <line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                        {/* Metadata Grid */}
                        <div
                            className="grid grid-cols-2 gap-3 p-4 rounded-xl"
                            style={{ background: 'rgba(0, 0, 0, 0.03)' }}
                        >
                            <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Time</span>
                                <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                                    {new Date(currentMetadata.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                            <div>
                                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Date</span>
                                <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text-primary)' }}>
                                    {new Date(currentMetadata.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </p>
                            </div>
                            {currentMetadata.appName && (
                                <div className="col-span-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Application</span>
                                    <p className="text-sm font-medium mt-0.5 flex items-center gap-2" style={{ color: 'var(--color-text-primary)' }}>
                                        <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ background: 'var(--color-accent)' }}
                                        />
                                        {currentMetadata.appName}
                                    </p>
                                </div>
                            )}
                            <div className="col-span-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Window</span>
                                {currentMetadata.windowTitle && currentMetadata.windowTitle !== 'Unknown' ? (
                                    <p className="text-sm font-medium mt-0.5 break-words" style={{ color: 'var(--color-text-primary)' }}>
                                        {currentMetadata.windowTitle}
                                    </p>
                                ) : (
                                    <p className="text-sm mt-0.5 italic" style={{ color: 'var(--color-text-tertiary)' }}>
                                        No window title available
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Permission Warning */}
                        {(!currentMetadata.windowTitle || currentMetadata.windowTitle === 'Unknown') && (
                            <div
                                className="rounded-xl p-4"
                                style={{
                                    background: 'var(--color-warning-muted)',
                                    border: '1px solid rgba(245, 158, 11, 0.3)'
                                }}
                            >
                                <div className="flex items-start gap-3">
                                    <div
                                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                        style={{ background: 'var(--color-warning)' }}
                                    >
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
                                            Window title not captured
                                        </p>
                                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                                            This may be due to accessibility permission issues.
                                        </p>
                                        <button
                                            onClick={() => window.electron.ipcRenderer.openAccessibilitySettings()}
                                            className="mt-3 text-xs px-3 py-1.5 font-semibold rounded-lg transition-all hover:scale-105 active:scale-95"
                                            style={{
                                                background: 'var(--color-warning)',
                                                color: 'white'
                                            }}
                                        >
                                            Fix Permissions
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* AI Narrative Section */}
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <div
                                    className="w-6 h-6 rounded-lg flex items-center justify-center"
                                    style={{ background: 'var(--color-accent-muted)' }}
                                >
                                    <svg className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                </div>
                                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                                    AI Analysis
                                </span>
                                {isAnalyzing(currentScreenshot) && (
                                    <span
                                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1.5 animate-pulse"
                                        style={{
                                            background: 'var(--color-info-muted)',
                                            color: 'var(--color-info)'
                                        }}
                                    >
                                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing
                                    </span>
                                )}
                            </div>

                            {currentMetadata.aiDescription ? (
                                <div
                                    className="rounded-xl p-4 animate-fade-in"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(255, 72, 0, 0.08) 0%, rgba(255, 107, 53, 0.04) 100%)',
                                        borderLeft: '3px solid var(--color-accent)'
                                    }}
                                >
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-primary)' }}>
                                        {currentMetadata.aiDescription}
                                    </p>
                                </div>
                            ) : currentMetadata.llmError ? (
                                <div
                                    className="rounded-xl p-4 animate-fade-in"
                                    style={{
                                        background: 'var(--color-warning-muted)',
                                        borderLeft: '3px solid var(--color-warning)'
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <svg className="w-4 h-4" style={{ color: 'var(--color-warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>Analysis Unavailable</span>
                                    </div>
                                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{currentMetadata.llmError}</p>
                                </div>
                            ) : isAnalyzing(currentScreenshot) ? (
                                <div
                                    className="rounded-xl p-4 animate-fade-in"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)',
                                        border: '1px solid rgba(59, 130, 246, 0.2)'
                                    }}
                                >
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="relative">
                                            <svg className="animate-spin h-5 w-5" style={{ color: 'var(--color-info)' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Analyzing screenshot...</p>
                                            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Extracting visual context</p>
                                        </div>
                                    </div>
                                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                                        <div
                                            className="h-full rounded-full animate-shimmer"
                                            style={{
                                                width: '100%',
                                                background: 'linear-gradient(90deg, var(--color-info) 0%, var(--color-accent) 50%, var(--color-info) 100%)',
                                                backgroundSize: '200% 100%'
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div
                                    className="rounded-xl p-4 flex items-center gap-3 animate-fade-in"
                                    style={{
                                        background: 'rgba(0, 0, 0, 0.03)',
                                        borderLeft: '3px solid var(--color-border-secondary)'
                                    }}
                                >
                                    <svg className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                    </svg>
                                    <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Analysis not available</span>
                                </div>
                            )}
                        </div>

                        {/* Vision Data Section - Collapsible */}
                        {(currentMetadata.rawVisionData || currentMetadata.visionData) && (
                            <details className="group">
                                <summary
                                    className="flex items-center gap-2 cursor-pointer list-none py-2 select-none"
                                    style={{ color: 'var(--color-text-secondary)' }}
                                >
                                    <svg
                                        className="w-4 h-4 transition-transform group-open:rotate-90"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                                    </svg>
                                    <span className="text-xs font-bold uppercase tracking-wider">Vision Data</span>
                                    <span
                                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                        style={{
                                            background: 'var(--color-success-muted)',
                                            color: 'var(--color-success)'
                                        }}
                                    >
                                        Raw
                                    </span>
                                </summary>
                                <div className="mt-3 space-y-3">
                                    {(() => {
                                        const visionData = currentMetadata.rawVisionData || currentMetadata.visionData;
                                        if (!visionData) return null;
                                        return (
                                            <>
                                                {visionData.confidence !== undefined && (
                                                    <div
                                                        className="rounded-lg p-3"
                                                        style={{ background: 'rgba(0, 0, 0, 0.03)' }}
                                                    >
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                                                            Confidence
                                                        </span>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.1)' }}>
                                                                <div
                                                                    className="h-full rounded-full transition-all"
                                                                    style={{
                                                                        width: `${visionData.confidence * 100}%`,
                                                                        background: 'var(--color-success)'
                                                                    }}
                                                                />
                                                            </div>
                                                            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-success)' }}>
                                                                {(visionData.confidence * 100).toFixed(0)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                                {visionData.detectedText && visionData.detectedText.length > 0 && (
                                                    <div
                                                        className="rounded-lg p-3"
                                                        style={{ background: 'rgba(0, 0, 0, 0.03)' }}
                                                    >
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                                                            Detected Text ({visionData.detectedText.length})
                                                        </span>
                                                        <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                                                            {visionData.detectedText.slice(0, 10).map((text, idx) => (
                                                                <p key={idx} className="text-xs break-words" style={{ color: 'var(--color-text-secondary)' }}>
                                                                    {text}
                                                                </p>
                                                            ))}
                                                            {visionData.detectedText.length > 10 && (
                                                                <p className="text-[10px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
                                                                    +{visionData.detectedText.length - 10} more items
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </details>
                        )}

                        {/* File Info */}
                        <div
                            className="pt-3 border-t"
                            style={{ borderColor: 'var(--color-border-primary)' }}
                        >
                            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                                File
                            </span>
                            <p className="text-[11px] mt-1 break-all font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                                {currentScreenshot.split('/').pop()}
                            </p>
                        </div>
                    </div>
                </div>
            )}


            {/* Thumbnail Strip */}
            {screenshotPaths.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 max-w-4xl overflow-x-auto px-4 z-20">
                    {screenshotPaths.map((path, index) => (
                        <button
                            key={index}
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedIndex(index);
                            }}
                            className={`flex-shrink-0 w-20 h-20 rounded overflow-hidden border-2 transition-all ${
                                index === selectedIndex
                                    ? 'border-green-500 scale-110'
                                    : 'border-gray-600 opacity-60 hover:opacity-100 hover:border-gray-500'
                            }`}
                            style={{
                                transitionDuration: 'var(--duration-base)',
                                transitionTimingFunction: 'var(--ease-out)',
                                boxShadow: index === selectedIndex ? 'var(--glow-green)' : 'none'
                            }}
                        >
                            {loadedImages.get(path) ? (
                                <img
                                    src={loadedImages.get(path)}
                                    alt={`Thumbnail ${index + 1}`}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full bg-gray-700 flex items-center justify-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                        <polyline points="21 15 16 10 5 21" />
                                    </svg>
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}


