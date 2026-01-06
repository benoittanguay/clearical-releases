import { useState, useEffect } from 'react';
import { DeleteButton } from './DeleteButton';

interface ScreenshotMetadata {
    path: string;
    timestamp: number;
    appName?: string;
    windowTitle?: string;
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
    const [loadedImages, setLoadedImages] = useState<Map<string, string>>(new Map());

    // Load images via IPC
    useEffect(() => {
        const loadImages = async () => {
            console.log('[ScreenshotGallery] Loading images for paths:', screenshotPaths);
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
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Simple Header */}
            <div className="absolute top-4 left-4 right-4 flex justify-end items-center z-20">
                
                <div className="flex items-center gap-2">
                    {/* Open in Finder Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInFinder();
                        }}
                        className="text-white hover:text-blue-400 transition-colors bg-black/50 rounded-lg p-2"
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
                        className="text-white hover:text-gray-300 transition-colors bg-black/50 rounded-lg p-2"
                        title="Close (Esc)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Navigation Buttons */}
            {screenshotPaths.length > 1 && (
                <>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            prevScreenshot();
                        }}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-10 bg-black/50 rounded-full p-2"
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
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-10 bg-black/50 rounded-full p-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                        </svg>
                    </button>
                </>
            )}

            {/* Screenshot Display */}
            <div 
                className="max-w-full max-h-full p-4"
                onClick={(e) => e.stopPropagation()}
            >
                {loadedImages.get(currentScreenshot) ? (
                    <img
                        src={loadedImages.get(currentScreenshot)}
                        alt={`Screenshot ${selectedIndex + 1}`}
                        className="max-w-full max-h-[90vh] object-contain rounded-lg"
                    />
                ) : (
                    <div className="max-w-full max-h-[90vh] flex items-center justify-center bg-gray-800 rounded-lg p-8">
                        <div className="text-gray-400 text-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
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
                <div className="absolute top-20 left-4 bg-black/70 text-white rounded-lg p-4 max-w-md z-20">
                    <h3 className="text-lg font-semibold mb-2">Screenshot Info</h3>
                    <div className="space-y-2 text-sm">
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
                        {currentMetadata.windowTitle && (
                            <div>
                                <span className="text-gray-300">Window:</span>{' '}
                                <span className="text-white truncate block">{currentMetadata.windowTitle}</span>
                            </div>
                        )}
                        <div>
                            <span className="text-gray-300">File:</span>{' '}
                            <span className="text-white text-xs">{currentScreenshot.split('/').pop()}</span>
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
                                    : 'border-gray-600 opacity-60 hover:opacity-100'
                            }`}
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


