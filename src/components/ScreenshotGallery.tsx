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
    const [showMetadata, setShowMetadata] = useState(true);
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

    const formatTimestamp = (timestamp: number) => {
        return new Date(timestamp).toLocaleString();
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

    const handleOpenInFinder = async () => {
        try {
            // @ts-ignore
            if (window.electron?.ipcRenderer?.showItemInFolder) {
                // @ts-ignore
                const result = await window.electron.ipcRenderer.showItemInFolder(currentScreenshot);
                
                if (!result.success) {
                    console.error('Failed to open in finder:', result.error);
                }
            }
        } catch (error) {
            console.error('Failed to open in finder:', error);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center modal-backdrop"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Simple Header */}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-20 no-drag">
                    {/* Info Toggle Button */}
                    {currentMetadata && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMetadata(!showMetadata);
                            }}
                            className={`transition-all bg-black/50 hover:bg-black/70 rounded-lg p-2 active:scale-95 ${
                                showMetadata
                                    ? 'text-green-400 hover:text-green-300'
                                    : 'text-white hover:text-blue-400'
                            }`}
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                            title={showMetadata ? "Hide screenshot info" : "Show screenshot info"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="16" x2="12" y2="12"/>
                                <line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                        </button>
                    )}

                    {/* Open in Finder Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInFinder();
                        }}
                        className="text-white hover:text-blue-400 transition-all bg-black/50 hover:bg-black/70 rounded-lg p-2 active:scale-95"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        title="Open in Finder"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2Z"/>
                        </svg>
                    </button>

                    {/* Delete Button */}
                    <div className="bg-black/50 rounded-lg p-1">
                        <DeleteButton
                            onDelete={handleDeleteScreenshot}
                            confirmMessage="Delete this screenshot?"
                            size="md"
                            variant="subtle"
                            className="text-white hover:text-red-400"
                        />
                    </div>

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="text-white hover:text-gray-300 transition-all bg-black/50 hover:bg-black/70 rounded-lg p-2 active:scale-95"
                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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

            {/* Metadata Panel */}
            {showMetadata && currentMetadata && (
                <div className="absolute top-20 left-4 bg-black/70 backdrop-blur-sm text-white rounded-lg p-4 max-w-lg z-20 animate-slide-in-right no-drag" style={{ boxShadow: 'var(--shadow-lg)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-lg font-semibold">Screenshot Info</h3>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMetadata(false);
                            }}
                            className="text-gray-400 hover:text-white transition-all active:scale-95"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                            title="Hide info panel"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <div>
                            <span className="text-gray-300">Time:</span>{' '}
                            <span className="text-white">{formatTimestamp(currentMetadata.timestamp)}</span>
                        </div>
                        {currentMetadata.appName && (
                            <div>
                                <span className="text-gray-300">App:</span>{' '}
                                <span className="text-white">{currentMetadata.appName}</span>
                            </div>
                        )}
                        <div>
                            <span className="text-gray-300">Window:</span>{' '}
                            {currentMetadata.windowTitle && currentMetadata.windowTitle !== 'Unknown' ? (
                                <span className="text-white break-words">{currentMetadata.windowTitle}</span>
                            ) : (
                                <span className="text-gray-500 italic">(No window title available)</span>
                            )}
                        </div>

                        {/* Permission issue warning - shown when window title is missing */}
                        {(!currentMetadata.windowTitle || currentMetadata.windowTitle === 'Unknown') && (
                            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 mt-2">
                                <div className="flex items-start gap-2">
                                    <svg className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <div className="flex-1">
                                        <p className="text-xs text-amber-300">
                                            Window title not captured. This may be due to accessibility permission issues.
                                        </p>
                                        <button
                                            onClick={() => window.electron.ipcRenderer.openAccessibilitySettings()}
                                            className="mt-2 text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-md font-medium transition-colors"
                                        >
                                            Reset Permissions
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {/* AI Description Section - On-Device AI Narrative (Stage 2) */}
                        <div className="border-t border-gray-600 pt-3">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-purple-400 font-medium">AI Narrative:</span>
                                <span className="text-xs bg-purple-900/30 text-purple-300 px-2 py-1 rounded-full">
                                    FastVLM
                                </span>
                                {isAnalyzing(currentScreenshot) && (
                                    <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded-full flex items-center gap-1 animate-pulse">
                                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Analyzing...
                                    </span>
                                )}
                            </div>
                            {currentMetadata.aiDescription ? (
                                <div className="text-white text-sm leading-relaxed bg-gray-900/50 rounded p-3 border-l-2 border-purple-500 animate-fade-in">
                                    <p className="whitespace-pre-wrap break-words">
                                        {currentMetadata.aiDescription}
                                    </p>
                                </div>
                            ) : currentMetadata.llmError ? (
                                <div className="text-yellow-400 text-sm bg-gray-900/50 rounded p-3 border-l-2 border-yellow-500 animate-fade-in">
                                    <div className="flex items-center gap-2 mb-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <span className="font-semibold">AI Description Unavailable</span>
                                    </div>
                                    <p className="text-xs text-gray-300 mt-1">{currentMetadata.llmError}</p>
                                </div>
                            ) : isAnalyzing(currentScreenshot) ? (
                                <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-lg p-4 border border-blue-500/30 animate-fade-in">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="relative">
                                            <svg className="animate-spin h-6 w-6 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <div className="absolute inset-0 bg-blue-400/20 rounded-full blur-md animate-pulse"></div>
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-blue-300 font-medium text-sm">Analyzing screenshot with FastVLM...</div>
                                            <div className="text-blue-400/60 text-xs mt-0.5">Extracting visual information and generating description</div>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="h-2 bg-gray-800/50 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-shimmer" style={{ width: '100%' }}></div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-gray-400 text-sm bg-gray-900/50 rounded p-3 border-l-2 border-gray-500 animate-fade-in">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="12" y1="12" x2="12" y2="16"/>
                                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                                    </svg>
                                    <span>Waiting for AI analysis...</span>
                                </div>
                            )}
                        </div>

                        {/* Raw Vision Framework Data Section (Stage 1) */}
                        {(currentMetadata.rawVisionData || currentMetadata.visionData) && (
                            <div className="border-t border-gray-600 pt-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-green-400 font-medium text-sm">Raw Vision Framework Data</span>
                                    <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded-full">
                                        Stage 1: Extraction
                                    </span>
                                </div>

                                <div className="space-y-3 text-xs font-mono">
                                        {/* Use rawVisionData if available, fall back to legacy visionData */}
                                        {(() => {
                                            const visionData = currentMetadata.rawVisionData || currentMetadata.visionData;
                                            if (!visionData) return null;

                                            return (
                                                <>
                                                    {/* Confidence Score */}
                                                    {visionData.confidence !== undefined && (
                                                        <div>
                                                            <div className="text-gray-400 mb-1">Vision Framework Confidence:</div>
                                                            <div className="bg-gray-900/50 rounded p-2 border-l-2 border-green-500 text-green-300">
                                                                {(visionData.confidence * 100).toFixed(1)}%
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Detected Text (OCR Results) */}
                                                    {visionData.detectedText && visionData.detectedText.length > 0 && (
                                                        <div>
                                                            <div className="text-gray-400 mb-1">OCR Text ({visionData.detectedText.length} items):</div>
                                                            <div className="bg-gray-900/50 rounded p-2 border-l-2 border-green-500 max-h-40 overflow-y-auto">
                                                                <ul className="space-y-1">
                                                                    {visionData.detectedText.map((text, idx) => (
                                                                        <li key={idx} className="text-white break-words">
                                                                            <span className="text-gray-500">{idx + 1}.</span> {text}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Detected Objects */}
                                                    {visionData.objects && visionData.objects.length > 0 && (
                                                        <div>
                                                            <div className="text-gray-400 mb-1">Visual Objects ({visionData.objects.length} items):</div>
                                                            <div className="bg-gray-900/50 rounded p-2 border-l-2 border-green-500">
                                                                <div className="flex flex-wrap gap-1">
                                                                    {visionData.objects.map((obj, idx) => (
                                                                        <span key={idx} className="bg-green-900/30 text-green-300 px-2 py-1 rounded">
                                                                            {obj}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Structured Extraction (Detailed Analysis) */}
                                                    {visionData.extraction && (
                                                        <div>
                                                            <div className="text-gray-400 mb-1">Structured Analysis (JSON):</div>
                                                            <div className="bg-gray-900/50 rounded p-2 border-l-2 border-green-500 max-h-60 overflow-y-auto">
                                                                <pre className="text-white whitespace-pre-wrap break-words text-xs">
                                                                    {JSON.stringify(visionData.extraction, null, 2)}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                </div>
                            </div>
                        )}
                        
                        <div className="border-t border-gray-600 pt-3">
                            <span className="text-gray-300">File:</span>{' '}
                            <span className="text-white text-xs break-all">{currentScreenshot.split('/').pop()}</span>
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


