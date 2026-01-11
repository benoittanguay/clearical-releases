interface UpdateSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function UpdateSuccessModal({ isOpen, onClose }: UpdateSuccessModalProps) {
    // Hardcoded version for simplicity - this is just a test feature
    const appVersion = '0.1.7';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 backdrop-blur-sm">
            <div
                className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-gray-700"
                style={{
                    animation: 'fadeInScale 0.3s ease-out',
                }}
            >
                {/* Content */}
                <div className="p-8">
                    {/* Success Icon and Header */}
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-full mb-4 shadow-lg shadow-green-500/30">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h2 className="text-3xl font-bold text-white mb-2">
                            Auto-Updater Worked!
                        </h2>
                        <p className="text-gray-400 text-lg">
                            Your app has been successfully updated
                        </p>
                    </div>

                    {/* Version Info */}
                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 mb-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-300 mb-1">Current Version</h4>
                                <p className="text-2xl font-mono font-bold text-green-400">
                                    v{appVersion}
                                </p>
                            </div>
                            <div className="flex-shrink-0">
                                <div className="w-12 h-12 bg-gradient-to-br from-green-500/20 to-green-600/20 rounded-lg flex items-center justify-center border border-green-500/30">
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="24"
                                        height="24"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="text-green-400"
                                    >
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Success Message */}
                    <div className="bg-green-900/20 border border-green-700/50 rounded-lg px-4 py-3 mb-6">
                        <div className="flex items-start gap-2 text-sm text-green-300">
                            <svg
                                className="w-5 h-5 flex-shrink-0 mt-0.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                            <span className="font-medium">
                                The auto-update system is working correctly. You're now running the latest version of Clearical.
                            </span>
                        </div>
                    </div>

                    {/* Dismiss Button */}
                    <button
                        onClick={onClose}
                        className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-lg font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-600/30"
                    >
                        Dismiss
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: scale(0.95);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
            `}</style>
        </div>
    );
}
