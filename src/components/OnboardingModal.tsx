import { useState, useEffect } from 'react';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';

interface OnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

// Curated color palette for the first bucket
const BUCKET_COLORS = [
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Red', value: '#ef4444' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Cyan', value: '#06b6d4' },
];

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [bucketName, setBucketName] = useState('');
    const [selectedColor, setSelectedColor] = useState(BUCKET_COLORS[0].value);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const { addBucket } = useStorage();
    const { settings } = useSettings();

    // Permission states
    const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
    const [screenRecordingGranted, setScreenRecordingGranted] = useState<boolean | null>(null);
    const [checkingPermissions, setCheckingPermissions] = useState(false);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setCurrentStep(0);
            setBucketName('');
            setSelectedColor(BUCKET_COLORS[0].value);
            checkPermissions();
        }
    }, [isOpen]);

    // Periodically recheck permissions when on the permissions step
    useEffect(() => {
        if (isOpen && currentStep === 0) {
            const interval = setInterval(checkPermissions, 2000);
            return () => clearInterval(interval);
        }
    }, [isOpen, currentStep]);

    // Check permissions status
    const checkPermissions = async () => {
        try {
            const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
            // Treat 'stale' as not granted - requires user intervention
            setScreenRecordingGranted(screenStatus === 'granted');

            // Accessibility can't be checked programmatically on macOS, so we test it
            try {
                await window.electron.ipcRenderer.getActiveWindow();
                setAccessibilityGranted(true);
            } catch {
                setAccessibilityGranted(false);
            }
        } catch (error) {
            console.error('Error checking permissions:', error);
        }
    };

    // Request Screen Recording permission
    const requestScreenRecording = async () => {
        setCheckingPermissions(true);
        try {
            const status = await window.electron.ipcRenderer.requestScreenPermission();
            setScreenRecordingGranted(status === 'granted');

            if (status !== 'granted') {
                // Open System Settings if not granted
                await window.electron.ipcRenderer.openScreenPermissionSettings();
            }
        } catch (error) {
            console.error('Error requesting screen recording permission:', error);
        } finally {
            setCheckingPermissions(false);
            // Recheck after a delay
            setTimeout(checkPermissions, 1000);
        }
    };

    // Request Accessibility permission
    const requestAccessibility = async () => {
        setCheckingPermissions(true);
        try {
            await window.electron.ipcRenderer.openAccessibilitySettings();
            // Recheck after delay
            setTimeout(checkPermissions, 1000);
        } catch (error) {
            console.error('Error requesting accessibility permission:', error);
        } finally {
            setCheckingPermissions(false);
        }
    };

    if (!isOpen) return null;

    const handleNext = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentStep((prev) => prev + 1);
            setIsTransitioning(false);
        }, 200);
    };

    const handleBack = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentStep((prev) => prev - 1);
            setIsTransitioning(false);
        }, 200);
    };

    const handleCreateBucket = () => {
        const trimmedName = bucketName.trim();
        if (trimmedName) {
            addBucket(trimmedName, selectedColor);
        }
        handleNext();
    };

    const handleSkipBucket = () => {
        handleNext();
    };

    const handleFinish = () => {
        // Mark onboarding as complete
        localStorage.setItem('timeportal-onboarding-complete', 'true');
        onClose();
    };

    const handleSkipAll = () => {
        localStorage.setItem('timeportal-onboarding-complete', 'true');
        onClose();
    };

    const handleConfigureJira = () => {
        // Mark onboarding as complete and close
        // Users can navigate to Settings > Time Tracking Integration to configure
        localStorage.setItem('timeportal-onboarding-complete', 'true');
        onClose();
    };

    const totalSteps = 4;
    const progressPercentage = ((currentStep + 1) / totalSteps) * 100;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 backdrop-blur-sm">
            <div
                className="bg-gradient-to-b from-gray-800 to-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden border border-gray-700"
                style={{
                    animation: 'fadeInScale 0.3s ease-out',
                }}
            >
                {/* Progress Bar */}
                <div className="h-1.5 bg-gray-950">
                    <div
                        className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    />
                </div>

                {/* Content Container with Slide Animation */}
                <div className="relative overflow-hidden">
                    <div
                        className={`transition-all duration-200 ${
                            isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                        }`}
                    >
                        {/* Step 0: System Permissions */}
                        {currentStep === 0 && (
                            <div className="p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl mb-4 shadow-lg shadow-amber-500/30">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-3xl font-bold text-white mb-2">System Permissions</h2>
                                    <p className="text-gray-400 text-lg">Clearical needs access to track your activity</p>
                                </div>

                                {/* Info Box */}
                                <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-blue-300 mb-1">Why these permissions?</h4>
                                            <p className="text-sm text-blue-200/80">
                                                These permissions allow Clearical to automatically track your work and capture screenshots. All data stays on your device.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Permissions List */}
                                <div className="space-y-4 mb-6">
                                    {/* Accessibility Permission */}
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
                                        <div className="flex items-start gap-4">
                                            <div className="flex-shrink-0">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                                    accessibilityGranted
                                                        ? 'bg-gradient-to-br from-green-500 to-green-600'
                                                        : 'bg-gradient-to-br from-gray-600 to-gray-700'
                                                }`}>
                                                    {accessibilityGranted ? (
                                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h3 className="text-lg font-semibold text-white">Accessibility</h3>
                                                    {accessibilityGranted && (
                                                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900 text-green-400">
                                                            Granted
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-400 mb-3">
                                                    Required to detect which app and window you're currently using
                                                </p>
                                                {!accessibilityGranted && (
                                                    <button
                                                        onClick={requestAccessibility}
                                                        disabled={checkingPermissions}
                                                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-all"
                                                    >
                                                        {checkingPermissions ? 'Opening Settings...' : 'Grant Permission'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Screen Recording Permission */}
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5">
                                        <div className="flex items-start gap-4">
                                            <div className="flex-shrink-0">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                                    screenRecordingGranted
                                                        ? 'bg-gradient-to-br from-green-500 to-green-600'
                                                        : 'bg-gradient-to-br from-gray-600 to-gray-700'
                                                }`}>
                                                    {screenRecordingGranted ? (
                                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-2">
                                                    <h3 className="text-lg font-semibold text-white">Screen Recording</h3>
                                                    {screenRecordingGranted && (
                                                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900 text-green-400">
                                                            Granted
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-400 mb-3">
                                                    Required to capture screenshots of your work for AI-powered summaries
                                                </p>
                                                {!screenRecordingGranted && (
                                                    <button
                                                        onClick={requestScreenRecording}
                                                        disabled={checkingPermissions}
                                                        className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-semibold rounded-lg transition-all"
                                                    >
                                                        {checkingPermissions ? 'Opening Settings...' : 'Grant Permission'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Warning if permissions not granted */}
                                {(!accessibilityGranted || !screenRecordingGranted) && (
                                    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-4 py-3 mb-6">
                                        <div className="flex items-start gap-2 text-sm text-yellow-300">
                                            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span>
                                                You can skip this step, but Clearical won't be able to automatically track your activity without these permissions.
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex justify-between gap-3 pt-6 border-t border-gray-700">
                                    <button
                                        onClick={handleSkipAll}
                                        className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        Skip Setup
                                    </button>
                                    <button
                                        onClick={handleNext}
                                        className="px-6 py-2.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-600/30"
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 1: Create First Bucket */}
                        {currentStep === 1 && (
                            <div className="p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl mb-4 shadow-lg shadow-green-500/30">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="18" rx="2"/>
                                            <path d="M2 12h20"/>
                                            <path d="M10 7h4"/>
                                            <path d="M10 16h4"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-3xl font-bold text-white mb-2">Welcome to Clearical</h2>
                                    <p className="text-gray-400 text-lg">Let's get you started with your first bucket</p>
                                </div>

                                {/* Info Box */}
                                <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-blue-300 mb-1">What are buckets?</h4>
                                            <p className="text-sm text-blue-200/80">
                                                Buckets are categories that help you organize your time entries.
                                                Think of them as projects, clients, or types of work you want to track separately.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Form */}
                                <div className="space-y-5">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Bucket Name
                                        </label>
                                        <input
                                            type="text"
                                            value={bucketName}
                                            onChange={(e) => setBucketName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && bucketName.trim()) {
                                                    handleCreateBucket();
                                                }
                                            }}
                                            autoFocus
                                            className="w-full bg-gray-950 border border-gray-700 text-white text-base rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                                            placeholder="e.g., Client Work, Deep Focus, Meetings"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Choose a Color
                                        </label>
                                        <div className="grid grid-cols-8 gap-2.5">
                                            {BUCKET_COLORS.map((color) => (
                                                <button
                                                    key={color.value}
                                                    type="button"
                                                    onClick={() => setSelectedColor(color.value)}
                                                    className={`aspect-square rounded-lg transition-all transform ${
                                                        selectedColor === color.value
                                                            ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110 shadow-lg'
                                                            : 'hover:scale-105 opacity-70 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: color.value }}
                                                    title={color.name}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex justify-between gap-3 mt-8 pt-6 border-t border-gray-700">
                                    <button
                                        onClick={handleSkipAll}
                                        className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        Skip Setup
                                    </button>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleSkipBucket}
                                            className="px-5 py-2.5 text-gray-300 hover:text-white text-sm font-medium transition-colors rounded-lg hover:bg-gray-800"
                                        >
                                            Skip
                                        </button>
                                        <button
                                            onClick={handleCreateBucket}
                                            disabled={!bucketName.trim()}
                                            className="px-6 py-2.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-600/30 disabled:shadow-none"
                                        >
                                            Create & Continue
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Step 2: AI-Powered Features */}
                        {currentStep === 2 && (
                            <div className="p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl mb-4 shadow-lg shadow-purple-500/30">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-3xl font-bold text-white mb-2">AI-Powered Insights</h2>
                                    <p className="text-gray-400 text-lg">Clearical works smarter, not harder</p>
                                </div>

                                {/* Features List */}
                                <div className="space-y-4 mb-8">
                                    {/* Feature 1 */}
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 hover:bg-gray-800/70 transition-all">
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0">
                                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-white mb-1">Smart Summaries</h3>
                                                <p className="text-sm text-gray-400">
                                                    AI analyzes your screenshots to automatically generate detailed descriptions
                                                    of what you worked on, saving you time on manual entry.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Feature 2 */}
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 hover:bg-gray-800/70 transition-all">
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0">
                                                <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-white mb-1">Auto-Assignment</h3>
                                                <p className="text-sm text-gray-400">
                                                    Based on your activity patterns, Clearical suggests the right bucket or Jira
                                                    issue for each time entry, making tracking effortless.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Feature 3 */}
                                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 hover:bg-gray-800/70 transition-all">
                                        <div className="flex gap-4">
                                            <div className="flex-shrink-0">
                                                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-semibold text-white mb-1">Learns Your Workflow</h3>
                                                <p className="text-sm text-gray-400">
                                                    The more you use Clearical, the better it gets at understanding your work
                                                    patterns and providing accurate suggestions.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Privacy Note */}
                                <div className="bg-green-900/20 border border-green-700/50 rounded-lg px-4 py-3 mb-6">
                                    <div className="flex items-center gap-2 text-sm text-green-300">
                                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                        </svg>
                                        <span className="font-medium">All AI processing happens on-device. Your data never leaves your computer.</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex justify-between gap-3 pt-6 border-t border-gray-700">
                                    <button
                                        onClick={handleBack}
                                        className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleNext}
                                        className="px-6 py-2.5 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-green-600/30"
                                    >
                                        Continue
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Jira Integration */}
                        {currentStep === 3 && (
                            <div className="p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-500/30">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                            <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
                                            <polyline points="7.5 19.79 7.5 14.6 3 12"/>
                                            <polyline points="21 12 16.5 14.6 16.5 19.79"/>
                                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                                            <line x1="12" y1="22.08" x2="12" y2="12"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-3xl font-bold text-white mb-2">Connect Jira & Tempo</h2>
                                    <p className="text-gray-400 text-lg">Supercharge your time tracking workflow</p>
                                </div>

                                {/* Benefits */}
                                <div className="space-y-3 mb-8">
                                    <div className="flex items-start gap-3 bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-white mb-0.5">Automatic Issue Linking</h4>
                                            <p className="text-sm text-gray-400">
                                                Track time directly to Jira issues with AI-powered suggestions
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3 bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-white mb-0.5">One-Click Tempo Logging</h4>
                                            <p className="text-sm text-gray-400">
                                                Log time entries to Tempo with a single click, no manual entry needed
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3 bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-white mb-0.5">Smart Account Selection</h4>
                                            <p className="text-sm text-gray-400">
                                                AI automatically selects the correct Tempo account for each issue
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Current Status */}
                                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="text-sm font-semibold text-white mb-1">Integration Status</h4>
                                            <p className="text-xs text-gray-400">
                                                {settings.jira?.enabled && settings.tempo?.enabled
                                                    ? 'Jira and Tempo are configured'
                                                    : settings.jira?.enabled
                                                    ? 'Jira is configured, Tempo needs setup'
                                                    : settings.tempo?.enabled
                                                    ? 'Tempo is configured, Jira needs setup'
                                                    : 'Not configured yet'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                                                settings.jira?.enabled && settings.tempo?.enabled
                                                    ? 'bg-green-900 text-green-400'
                                                    : settings.jira?.enabled || settings.tempo?.enabled
                                                    ? 'bg-yellow-900 text-yellow-400'
                                                    : 'bg-gray-700 text-gray-400'
                                            }`}>
                                                {settings.jira?.enabled && settings.tempo?.enabled
                                                    ? 'Ready'
                                                    : settings.jira?.enabled || settings.tempo?.enabled
                                                    ? 'Partial'
                                                    : 'Not Set Up'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex justify-between gap-3 pt-6 border-t border-gray-700">
                                    <button
                                        onClick={handleBack}
                                        className="px-5 py-2.5 text-gray-400 hover:text-white text-sm font-medium transition-colors"
                                    >
                                        Back
                                    </button>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleFinish}
                                            className="px-5 py-2.5 text-gray-300 hover:text-white text-sm font-medium transition-colors rounded-lg hover:bg-gray-800"
                                        >
                                            Skip
                                        </button>
                                        <button
                                            onClick={handleConfigureJira}
                                            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-sm font-semibold rounded-lg transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-blue-600/30"
                                        >
                                            Configure Now
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Step Indicators */}
                <div className="flex justify-center gap-2 pb-6">
                    {Array.from({ length: totalSteps }).map((_, index) => (
                        <button
                            key={index}
                            onClick={() => {
                                if (index < currentStep) {
                                    setIsTransitioning(true);
                                    setTimeout(() => {
                                        setCurrentStep(index);
                                        setIsTransitioning(false);
                                    }, 200);
                                }
                            }}
                            disabled={index > currentStep}
                            className={`transition-all duration-300 rounded-full ${
                                index === currentStep
                                    ? 'w-8 h-2 bg-green-500'
                                    : index < currentStep
                                    ? 'w-2 h-2 bg-green-600 hover:bg-green-500 cursor-pointer'
                                    : 'w-2 h-2 bg-gray-700'
                            }`}
                        />
                    ))}
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
