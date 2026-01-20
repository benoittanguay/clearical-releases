import { useState, useEffect, useRef } from 'react';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { analytics } from '../services/analytics';
import type { JiraProject } from '../services/jiraService';
import jiraLogo from '../assets/jira-logo.png';

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
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [bucketName, setBucketName] = useState('');
    const [selectedColor, setSelectedColor] = useState(BUCKET_COLORS[0].value);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const { addBucket } = useStorage();
    const { settings, updateSettings } = useSettings();

    // Permission states
    const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
    const [screenRecordingGranted, setScreenRecordingGranted] = useState<boolean | null>(null);
    const [checkingPermissions, setCheckingPermissions] = useState(false);

    // Work role state
    const [selectedRole, setSelectedRole] = useState<string>('');
    const [customRoleDescription, setCustomRoleDescription] = useState('');

    // Calendar states
    const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
    const [calendarConnected, setCalendarConnected] = useState(false);
    const [calendarError, setCalendarError] = useState<string | null>(null);

    // Jira configuration states
    const [jiraBaseUrl, setJiraBaseUrl] = useState('');
    const [jiraEmail, setJiraEmail] = useState('');
    const [jiraApiToken, setJiraApiToken] = useState('');
    const [showApiToken, setShowApiToken] = useState(false);
    const [isTestingJira, setIsTestingJira] = useState(false);
    const [jiraConnected, setJiraConnected] = useState(false);
    const [showCredentials, setShowCredentials] = useState(true);
    const [availableProjects, setAvailableProjects] = useState<JiraProject[]>([]);
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [jiraError, setJiraError] = useState<string | null>(null);

    // Reset when modal opens
    useEffect(() => {
        if (isOpen) {
            setCurrentStep(0);
            setBucketName('');
            setSelectedColor(BUCKET_COLORS[0].value);
            setSelectedRole(settings.ai?.userRole || '');
            setCustomRoleDescription('');
            checkPermissions();
            // Reset Calendar states
            setIsConnectingCalendar(false);
            setCalendarConnected(false);
            setCalendarError(null);
            // Reset Jira states
            setJiraBaseUrl(settings.jira?.baseUrl || '');
            setJiraEmail(settings.jira?.email || '');
            setJiraApiToken(settings.jira?.apiToken || '');
            setJiraConnected(settings.jira?.enabled || false);
            setSelectedProjects(settings.jira?.selectedProjects || []);
            setAvailableProjects([]);
            setJiraError(null);
            // Check calendar connection status on modal open
            const checkCalendarStatus = async () => {
                try {
                    const result = await window.electron.ipcRenderer.calendar.isConnected();
                    if (result.success && result.connected) {
                        setCalendarConnected(true);
                    }
                } catch (error) {
                    console.error('[OnboardingModal] Failed to check calendar status:', error);
                }
            };
            checkCalendarStatus();
            // Track onboarding started
            analytics.track('onboarding.started');
        }
    }, [isOpen, settings.jira]);

    // Periodically recheck permissions when on the permissions step (now step 4)
    useEffect(() => {
        if (isOpen && currentStep === 4) {
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

    const stepNames = ['work_role', 'bucket', 'calendar', 'jira', 'permissions'];

    const scrollToTop = () => {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    };

    const handleNext = () => {
        // Track step completion before transitioning
        const currentStepName = stepNames[currentStep];
        analytics.track('onboarding.step_completed', { step: currentStepName });

        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentStep((prev) => prev + 1);
            scrollToTop();
            setIsTransitioning(false);
        }, 200);
    };

    const handleBack = () => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentStep((prev) => prev - 1);
            scrollToTop();
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

    // Save work role and continue
    const handleSaveRoleAndContinue = async () => {
        if (selectedRole) {
            await updateSettings({
                ai: {
                    ...settings.ai,
                    autoGenerateDescription: settings.ai?.autoGenerateDescription ?? true,
                    autoAssignWork: settings.ai?.autoAssignWork ?? true,
                    autoSelectAccount: settings.ai?.autoSelectAccount ?? true,
                    userRole: selectedRole === 'other' ? customRoleDescription : selectedRole,
                }
            });
            analytics.track('onboarding.role_selected', { role: selectedRole });
        }
        handleNext();
    };

    const handleFinish = () => {
        // Mark onboarding as complete
        localStorage.setItem('timeportal-onboarding-complete', 'true');
        analytics.track('onboarding.completed');
        onClose();
    };

    // Connect calendar
    const handleConnectCalendar = async () => {
        setIsConnectingCalendar(true);
        setCalendarError(null);
        try {
            const result = await window.electron.ipcRenderer.calendar.connect();
            if (result.success) {
                setCalendarConnected(true);
            } else {
                setCalendarError(result.error || 'Failed to connect calendar');
            }
        } catch (error) {
            setCalendarError(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsConnectingCalendar(false);
        }
    };

    // Test Jira connection
    const handleTestJiraConnection = async () => {
        if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
            setJiraError('Please fill in all Jira fields first.');
            return;
        }

        setIsTestingJira(true);
        setJiraError(null);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(jiraBaseUrl, jiraEmail, jiraApiToken);
            const isConnected = await service.testConnection();

            if (isConnected) {
                setJiraConnected(true);
                setShowCredentials(false);
                // Load available projects after successful connection
                loadJiraProjects();
            } else {
                setJiraError('Connection failed. Please check your credentials and URL.');
            }
        } catch (error) {
            setJiraError(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsTestingJira(false);
        }
    };

    // Load available Jira projects
    const loadJiraProjects = async () => {
        if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
            return;
        }

        setLoadingProjects(true);
        try {
            const { JiraService } = await import('../services/jiraService');
            const service = new JiraService(jiraBaseUrl, jiraEmail, jiraApiToken);
            const projects = await service.getProjects();
            setAvailableProjects(projects);
        } catch (error) {
            console.error('Failed to load projects:', error);
            setAvailableProjects([]);
        } finally {
            setLoadingProjects(false);
        }
    };

    // Handle project toggle
    const handleProjectToggle = (projectKey: string) => {
        setSelectedProjects(prev => {
            const isSelected = prev.includes(projectKey);
            return isSelected
                ? prev.filter(key => key !== projectKey)
                : [...prev, projectKey];
        });
    };

    // Select/clear all projects
    const selectAllProjects = () => {
        setSelectedProjects(availableProjects.map(p => p.key));
    };

    const clearAllProjects = () => {
        setSelectedProjects([]);
    };

    // Save Jira settings and continue
    const handleSaveJiraAndContinue = async () => {
        if (jiraConnected) {
            await updateSettings({
                jira: {
                    enabled: true,
                    baseUrl: jiraBaseUrl,
                    email: jiraEmail,
                    apiToken: jiraApiToken,
                    selectedProjects: selectedProjects,
                    autoSync: true,
                    syncInterval: 15,
                    lastSyncTimestamp: 0
                }
            });
        }
        localStorage.setItem('timeportal-onboarding-complete', 'true');
        // Track the final step completion and overall completion
        analytics.track('onboarding.step_completed', { step: 'jira' });
        analytics.track('onboarding.completed');
        onClose();
    };

    const totalSteps = 5;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
            <div
                className="bg-[var(--color-bg-secondary)] rounded-[12px] shadow-2xl w-full max-w-2xl mx-4 border border-[var(--color-border-primary)] max-h-[85vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
                style={{
                    animation: 'fadeInScale 0.3s ease-out',
                }}
            >
                {/* Step Indicators - Header */}
                <div className="flex justify-center gap-2 py-4 flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    {Array.from({ length: totalSteps }).map((_, index) => (
                        <button
                            key={index}
                            onClick={() => {
                                if (index < currentStep) {
                                    setIsTransitioning(true);
                                    setTimeout(() => {
                                        setCurrentStep(index);
                                        scrollToTop();
                                        setIsTransitioning(false);
                                    }, 200);
                                }
                            }}
                            disabled={index > currentStep}
                            className={`transition-all duration-300 rounded-full ${
                                index === currentStep
                                    ? 'w-8 h-2 bg-[var(--color-accent)]'
                                    : index < currentStep
                                    ? 'w-2 h-2 bg-[var(--color-accent)] opacity-60 hover:opacity-100 cursor-pointer'
                                    : 'w-2 h-2 bg-[var(--color-bg-tertiary)]'
                            }`}
                        />
                    ))}
                </div>

                {/* Content Container with Slide Animation - Scrollable */}
                <div ref={scrollContainerRef} className="relative overflow-y-auto flex-1">
                    <div
                        className={`transition-all duration-200 h-full ${
                            isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                        }`}
                    >
                        {/* Step 4: System Permissions */}
                        {currentStep === 4 && (
                            <div className="p-6 sm:p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-warning-muted)] rounded-2xl mb-4 shadow-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">System Permissions</h2>
                                    <p className="text-[var(--color-text-secondary)] text-lg">Clearical needs Accessibility access to track your activity</p>
                                </div>

                                {/* Info Box */}
                                <div className="bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">Why these permissions?</h4>
                                            <p className="text-sm text-[var(--color-text-secondary)]">
                                                <strong>Accessibility (Required):</strong> Tracks which apps you use. <strong>Screen Recording (Optional):</strong> Captures screenshots for better AI summaries. All data stays on your device.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Permissions List */}
                                <div className="space-y-4 mb-6">
                                    {/* Accessibility Permission */}
                                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-5">
                                        <div className="flex items-start gap-4">
                                            <div className="flex-shrink-0">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                                    accessibilityGranted
                                                        ? 'bg-[var(--color-success-muted)]'
                                                        : 'bg-[var(--color-bg-quaternary)]'
                                                }`}>
                                                    {accessibilityGranted ? (
                                                        <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-5 h-5 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] font-display">Accessibility</h3>
                                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--color-error-muted)] text-[var(--color-error)] border border-[var(--color-error)]/30">
                                                            Required
                                                        </span>
                                                    </div>
                                                    {accessibilityGranted && (
                                                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-success-muted)] text-[var(--color-success)] border border-[var(--color-success)]/30">
                                                            Granted
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                                                    Required to detect which app and window you're currently using
                                                </p>
                                                {!accessibilityGranted && (
                                                    <button
                                                        onClick={requestAccessibility}
                                                        disabled={checkingPermissions}
                                                        className="px-4 py-2 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-[var(--color-bg-primary)] text-sm font-semibold rounded-lg transition-all"
                                                    >
                                                        {checkingPermissions ? 'Opening Settings...' : 'Grant Permission'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Screen Recording Permission */}
                                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-5">
                                        <div className="flex items-start gap-4">
                                            <div className="flex-shrink-0">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                                    screenRecordingGranted
                                                        ? 'bg-[var(--color-success-muted)]'
                                                        : 'bg-[var(--color-bg-quaternary)]'
                                                }`}>
                                                    {screenRecordingGranted ? (
                                                        <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-5 h-5 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                        </svg>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] font-display">Screen Recording</h3>
                                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[var(--color-accent-muted)] text-[var(--color-accent)] border border-[var(--color-accent)]/30">
                                                            Optional
                                                        </span>
                                                    </div>
                                                    {screenRecordingGranted && (
                                                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[var(--color-success-muted)] text-[var(--color-success)] border border-[var(--color-success)]/30">
                                                            Granted
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-[var(--color-text-secondary)] mb-3">
                                                    Optional but recommended for AI-powered summaries and better activity insights
                                                </p>
                                                {!screenRecordingGranted && (
                                                    <button
                                                        onClick={requestScreenRecording}
                                                        disabled={checkingPermissions}
                                                        className="px-4 py-2 bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/90 disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-[var(--color-bg-primary)] text-sm font-semibold rounded-lg transition-all"
                                                    >
                                                        {checkingPermissions ? 'Opening Settings...' : 'Grant Permission'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Warning if accessibility not granted */}
                                {!accessibilityGranted && (
                                    <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 rounded-lg px-4 py-3 mb-6">
                                        <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                                            <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-error)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span>
                                                Accessibility permission is required to track your activity. The timer cannot start without it.
                                            </span>
                                        </div>
                                    </div>
                                )}


                            </div>
                        )}

                        {/* Step 0: Work Role Selection */}
                        {currentStep === 0 && (
                            <div className="p-6 sm:p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-info-muted)] rounded-2xl mb-4 shadow-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                                            <circle cx="9" cy="7" r="4"/>
                                            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">What's your role?</h2>
                                    <p className="text-[var(--color-text-secondary)] text-lg">Help our AI understand your work context</p>
                                </div>

                                {/* Info Box */}
                                <div className="bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">Why we ask</h4>
                                            <p className="text-sm text-[var(--color-text-secondary)]">
                                                Your role helps Clearical generate more accurate activity descriptions
                                                using terminology and context relevant to your field.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Role Selection */}
                                <div className="space-y-3">
                                    {[
                                        { id: 'developer', label: 'Software Developer', icon: '💻', desc: 'Engineering, coding, debugging' },
                                        { id: 'designer', label: 'Designer', icon: '🎨', desc: 'UI/UX, visual design, prototyping' },
                                        { id: 'product', label: 'Product Manager', icon: '📋', desc: 'Strategy, roadmaps, stakeholders' },
                                        { id: 'marketing', label: 'Marketing', icon: '📢', desc: 'Campaigns, content, analytics' },
                                        { id: 'sales', label: 'Sales', icon: '🤝', desc: 'Client calls, deals, CRM' },
                                        { id: 'consultant', label: 'Consultant', icon: '💼', desc: 'Client work, deliverables, billing' },
                                        { id: 'other', label: 'Other', icon: '✨', desc: 'Describe your role below' },
                                    ].map((role) => (
                                        <button
                                            key={role.id}
                                            onClick={() => setSelectedRole(role.id)}
                                            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                                                selectedRole === role.id
                                                    ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent)] shadow-md'
                                                    : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border-primary)] hover:bg-[var(--color-bg-quaternary)] hover:border-[var(--color-border-secondary)]'
                                            }`}
                                        >
                                            <span className="text-2xl">{role.icon}</span>
                                            <div className="flex-1">
                                                <div className={`font-semibold font-display ${
                                                    selectedRole === role.id ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'
                                                }`}>
                                                    {role.label}
                                                </div>
                                                <div className="text-sm text-[var(--color-text-secondary)]">{role.desc}</div>
                                            </div>
                                            {selectedRole === role.id && (
                                                <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                    ))}
                                </div>

                                {/* Custom role input (shown when "Other" is selected) */}
                                {selectedRole === 'other' && (
                                    <div className="mt-4 animate-fade-in">
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                                            Describe your role
                                        </label>
                                        <input
                                            type="text"
                                            value={customRoleDescription}
                                            onChange={(e) => setCustomRoleDescription(e.target.value)}
                                            autoFocus
                                            className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-base rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all"
                                            placeholder="e.g., Data Scientist, HR Manager, Content Writer"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Step 1: Create First Bucket */}
                        {currentStep === 1 && (
                            <div className="p-6 sm:p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-accent-muted)] rounded-2xl mb-4 shadow-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="2" y="3" width="20" height="18" rx="2"/>
                                            <path d="M2 12h20"/>
                                            <path d="M10 7h4"/>
                                            <path d="M10 16h4"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">Welcome to Clearical</h2>
                                    <p className="text-[var(--color-text-secondary)] text-lg">Let's get you started with your first bucket</p>
                                </div>

                                {/* Info Box */}
                                <div className="bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">What are buckets?</h4>
                                            <p className="text-sm text-[var(--color-text-secondary)]">
                                                Buckets are categories that help you organize your time entries.
                                                Think of them as projects, clients, or types of work you want to track separately.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Form */}
                                <div className="space-y-5">
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
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
                                            className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-base rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all"
                                            placeholder="e.g., Client Work, Deep Focus, Meetings"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
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
                                                            ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg-secondary)] scale-110 shadow-lg'
                                                            : 'hover:scale-105 opacity-70 hover:opacity-100'
                                                    }`}
                                                    style={{ backgroundColor: color.value }}
                                                    title={color.name}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        )}

                        {/* Step 2: Calendar Connection */}
                        {currentStep === 2 && (
                            <div className="p-6 sm:p-8">
                                {/* Header */}
                                <div className="text-center mb-8">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-[var(--color-success-muted)] rounded-2xl mb-4 shadow-lg">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                            <line x1="16" y1="2" x2="16" y2="6"/>
                                            <line x1="8" y1="2" x2="8" y2="6"/>
                                            <line x1="3" y1="10" x2="21" y2="10"/>
                                        </svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">Connect Your Calendar</h2>
                                    <p className="text-[var(--color-text-secondary)] text-lg">Help AI understand your schedule and context</p>
                                </div>

                                {/* Connection Status */}
                                {calendarConnected && (
                                    <div className="bg-[var(--color-success-muted)] border border-[var(--color-success)]/30 rounded-lg px-4 py-3 mb-6 animate-slide-down">
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                            <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                            <span className="font-medium">Calendar connected successfully!</span>
                                        </div>
                                    </div>
                                )}

                                {/* Error Message */}
                                {calendarError && (
                                    <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 rounded-lg px-4 py-3 mb-6">
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-error)]">
                                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span>{calendarError}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Info Box */}
                                <div className="bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-xl p-4 mb-6">
                                    <div className="flex gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">Why connect your calendar?</h4>
                                            <p className="text-sm text-[var(--color-text-secondary)]">
                                                Calendar integration helps the AI understand your meeting context and daily schedule,
                                                providing more accurate activity summaries and time tracking suggestions.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Benefits List */}
                                <div className="space-y-3 mb-6">
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            Automatically include meeting context in time entries
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            Better understand your work patterns and schedule
                                        </p>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </div>
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                            Get more accurate AI-powered activity summaries
                                        </p>
                                    </div>
                                </div>

                                {/* Connect Button */}
                                {!calendarConnected && (
                                    <button
                                        onClick={handleConnectCalendar}
                                        disabled={isConnectingCalendar}
                                        className="w-full px-6 py-4 bg-[var(--color-success)] hover:bg-[var(--color-success)]/90 disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-base font-semibold rounded-lg transition-all flex items-center justify-center gap-3 shadow-lg mb-4"
                                    >
                                        {isConnectingCalendar ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                Connecting...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                                </svg>
                                                Connect Google Calendar
                                            </>
                                        )}
                                    </button>
                                )}

                                {/* Privacy Note */}
                                <div className="bg-[var(--color-info-muted)] border border-[var(--color-info)]/30 rounded-lg px-4 py-3 mb-6">
                                    <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-info)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                        </svg>
                                        <span>
                                            Your calendar data stays private. We only read event titles and times to provide context.
                                        </span>
                                    </div>
                                </div>

                            </div>
                        )}

                        {/* Step 3: Jira Integration */}
                        {currentStep === 3 && (
                            <div className="p-6 sm:p-8">
                                {/* Header */}
                                <div className="text-center mb-6">
                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4 shadow-lg">
                                        <img src={jiraLogo} alt="Jira" className="w-10 h-10 object-contain" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2 font-display tracking-tight">Connect Jira</h2>
                                    <p className="text-[var(--color-text-secondary)] text-lg">Link your Jira issues for smarter time tracking</p>
                                </div>

                                {/* Connection Status - with animation */}
                                {jiraConnected && (
                                    <div className="bg-[var(--color-success-muted)] border border-[var(--color-success)]/30 rounded-lg px-4 py-3 mb-6 animate-slide-down">
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                            <svg className="w-5 h-5 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                            </svg>
                                            <span className="font-medium">Connected to Jira successfully!</span>
                                        </div>
                                    </div>
                                )}

                                {/* Error Message */}
                                {jiraError && (
                                    <div className="bg-[var(--color-error-muted)] border border-[var(--color-error)]/30 rounded-lg px-4 py-3 mb-6">
                                        <div className="flex items-center gap-2 text-sm text-[var(--color-error)]">
                                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span>{jiraError}</span>
                                        </div>
                                    </div>
                                )}

                                {/* Configuration Form or Connected Summary */}
                                {jiraConnected && !showCredentials ? (
                                    <div className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-xl p-5 mb-6">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1">
                                                <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1 font-display">
                                                    Connected to Jira
                                                </h3>
                                                <p className="text-sm text-[var(--color-text-secondary)]">
                                                    {jiraBaseUrl}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => setShowCredentials(true)}
                                                className="px-3 py-1.5 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-medium border border-[var(--color-accent)]/30 hover:border-[var(--color-accent)]/50 rounded-lg transition-all"
                                            >
                                                Change
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4 mb-6">
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                                                Jira Base URL
                                            </label>
                                            <input
                                                type="text"
                                                value={jiraBaseUrl}
                                                onChange={(e) => setJiraBaseUrl(e.target.value)}
                                                className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all"
                                                placeholder="https://your-domain.atlassian.net"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                                                Email
                                            </label>
                                            <input
                                                type="email"
                                                value={jiraEmail}
                                                onChange={(e) => setJiraEmail(e.target.value)}
                                                className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all"
                                                placeholder="your.email@company.com"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                                                API Token
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showApiToken ? "text" : "password"}
                                                    value={jiraApiToken}
                                                    onChange={(e) => setJiraApiToken(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && jiraBaseUrl && jiraEmail && jiraApiToken) {
                                                            handleTestJiraConnection();
                                                        }
                                                    }}
                                                    className="w-full bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-4 py-3 pr-10 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent transition-all"
                                                    placeholder="Enter your Jira API token"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowApiToken(!showApiToken)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                                                >
                                                    {showApiToken ? (
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                            <p className="text-xs text-[var(--color-text-tertiary)] mt-1.5">
                                                Generate at: Jira → Profile → Security → Create API token
                                            </p>
                                        </div>

                                        {/* Test Connection Button */}
                                        {!jiraConnected && (
                                            <button
                                                onClick={handleTestJiraConnection}
                                                disabled={isTestingJira || !jiraBaseUrl || !jiraEmail || !jiraApiToken}
                                                className="w-full px-4 py-3 bg-[var(--color-info)] hover:bg-[var(--color-info)]/90 disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                                            >
                                                {isTestingJira ? (
                                                    <>
                                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                        Testing Connection...
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                        Test Connection
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Project Selection */}
                                {jiraConnected && (
                                    <div className="mb-6">
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wide">
                                            Select Projects
                                        </label>
                                        <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
                                            Choose which projects to sync. This improves AI suggestions.
                                        </p>

                                        {loadingProjects ? (
                                            <div className="flex items-center justify-center py-6 text-sm text-[var(--color-text-secondary)]">
                                                <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mr-2"></div>
                                                Loading projects...
                                            </div>
                                        ) : availableProjects.length > 0 ? (
                                            <>
                                                <div className="flex items-center gap-2 mb-3">
                                                    <button
                                                        onClick={selectAllProjects}
                                                        className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                                    >
                                                        Select All
                                                    </button>
                                                    <span className="text-xs text-[var(--color-text-tertiary)]">|</span>
                                                    <button
                                                        onClick={clearAllProjects}
                                                        className="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] underline"
                                                    >
                                                        Clear All
                                                    </button>
                                                    <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                                                        {selectedProjects.length} of {availableProjects.length} selected
                                                    </span>
                                                </div>

                                                <div className="max-h-40 overflow-y-auto bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded-lg">
                                                    {availableProjects.map((project) => (
                                                        <div
                                                            key={project.key}
                                                            className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border-primary)] last:border-b-0 hover:bg-[var(--color-bg-quaternary)] transition-colors"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                id={`onboard-project-${project.key}`}
                                                                checked={selectedProjects.includes(project.key)}
                                                                onChange={() => handleProjectToggle(project.key)}
                                                                className="w-4 h-4 text-[var(--color-accent)] bg-[var(--color-bg-tertiary)] border border-[var(--color-border-primary)] rounded focus:ring-[var(--color-accent)] focus:ring-1"
                                                            />
                                                            <label
                                                                htmlFor={`onboard-project-${project.key}`}
                                                                className="flex-1 text-sm cursor-pointer"
                                                            >
                                                                <span className="font-medium text-[var(--color-accent)]">{project.key}</span>
                                                                <span className="text-[var(--color-text-tertiary)] ml-2">- {project.name}</span>
                                                            </label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ) : !loadingProjects ? (
                                            <div className="bg-[var(--color-warning-muted)] border border-[var(--color-warning)]/30 rounded-lg px-4 py-3">
                                                <div className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
                                                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                    </svg>
                                                    <span>
                                                        No projects found. Make sure your Jira account has access to at least one project.
                                                    </span>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                {/* Info Note */}
                                <div className="bg-[var(--color-accent-muted)] border border-[var(--color-accent)]/30 rounded-lg px-4 py-3 mb-6">
                                    <div className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
                                        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span>
                                            Tempo integration can be configured later in Settings → Time Tracking Integration.
                                        </span>
                                    </div>
                                </div>

                            </div>
                        )}
                    </div>
                </div>

                {/* Sticky Footer with Navigation Buttons */}
                <div className="flex items-center px-6 py-4 border-t border-[var(--color-border-primary)] flex-shrink-0 bg-[var(--color-bg-secondary)]">
                    {/* Left Side - Back Button */}
                    <div className="flex-1 flex items-center">
                        {currentStep > 0 && (
                            <button
                                onClick={handleBack}
                                className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                            >
                                Back
                            </button>
                        )}
                    </div>

                    {/* Right Side Buttons */}
                    <div className="flex gap-3">
                        {/* Skip Button - show on steps 0, 1, 2, 3 */}
                        {currentStep === 0 && (
                            <button
                                onClick={handleNext}
                                className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                            >
                                Skip
                            </button>
                        )}
                        {currentStep === 1 && (
                            <button
                                onClick={handleSkipBucket}
                                className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                            >
                                Skip
                            </button>
                        )}
                        {currentStep === 2 && (
                            <button
                                onClick={handleNext}
                                className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                            >
                                Skip for now
                            </button>
                        )}
                        {currentStep === 3 && (
                            <button
                                onClick={handleNext}
                                className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-colors rounded-lg hover:bg-[#FAF5EE]"
                            >
                                Skip
                            </button>
                        )}

                        {/* Primary Action Button */}
                        {currentStep === 0 && (
                            <button
                                onClick={handleSaveRoleAndContinue}
                                disabled={!selectedRole || (selectedRole === 'other' && !customRoleDescription.trim())}
                                className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
                            >
                                Continue
                            </button>
                        )}
                        {currentStep === 1 && (
                            <button
                                onClick={handleCreateBucket}
                                disabled={!bucketName.trim()}
                                className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
                            >
                                Create & Continue
                            </button>
                        )}
                        {currentStep === 2 && (
                            <button
                                onClick={handleNext}
                                disabled={!calendarConnected}
                                className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
                            >
                                Continue
                            </button>
                        )}
                        {currentStep === 3 && (
                            <button
                                onClick={handleSaveJiraAndContinue}
                                disabled={!jiraConnected}
                                className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
                            >
                                Continue
                            </button>
                        )}
                        {currentStep === 4 && (
                            <button
                                onClick={handleFinish}
                                disabled={!accessibilityGranted}
                                className="px-6 py-2.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] disabled:cursor-not-allowed text-white text-sm font-semibold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
                            >
                                Finish Setup
                            </button>
                        )}
                    </div>
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
                @keyframes slide-down {
                    from {
                        opacity: 0;
                        transform: translateY(-8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-slide-down {
                    animation: slide-down 0.3s ease-out;
                }
            `}</style>
        </div>
    );
}
