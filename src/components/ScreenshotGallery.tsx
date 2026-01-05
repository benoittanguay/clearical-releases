import { useState } from 'react';

interface ScreenshotGalleryProps {
    screenshotPaths: string[];
    onClose: () => void;
}

export function ScreenshotGallery({ screenshotPaths, onClose }: ScreenshotGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    if (screenshotPaths.length === 0) {
        return null;
    }

    const currentScreenshot = screenshotPaths[selectedIndex];

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

    return (
        <div 
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            tabIndex={-1}
        >
            {/* Close Button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-10"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>

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
                <img
                    src={`file://${currentScreenshot}`}
                    alt={`Screenshot ${selectedIndex + 1}`}
                    className="max-w-full max-h-[90vh] object-contain rounded-lg"
                    onError={(e) => {
                        // Fallback if image fails to load
                        e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiM2NjY2NjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5TY3JlZW5zaG90IG5vdCBmb3VuZDwvdGV4dD48L3N2Zz4=';
                    }}
                />
            </div>

            {/* Counter */}
            {screenshotPaths.length > 1 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black/50 px-4 py-2 rounded-lg text-sm">
                    {selectedIndex + 1} / {screenshotPaths.length}
                </div>
            )}

            {/* Thumbnail Strip */}
            {screenshotPaths.length > 1 && (
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-2 max-w-4xl overflow-x-auto px-4">
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
                            <img
                                src={`file://${path}`}
                                alt={`Thumbnail ${index + 1}`}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}


