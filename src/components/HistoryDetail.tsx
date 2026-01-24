import { useState, useEffect, useMemo, useRef } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity, WorkAssignment, LinkedJiraIssue } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';
import { DeleteButton } from './DeleteButton';
import { AssignmentPicker } from './AssignmentPicker';
import { TempoValidationModal } from './TempoValidationModal';
import { TempoAccountPicker } from './TempoAccountPicker';
import { TempoConfigModal } from './TempoConfigModal';
import { InlineTimeEditor } from './InlineTimeEditor';
import { SplittingAssistant } from './SplittingAssistant';
import { TranscriptionActivityEntry, findMeetingApp } from './TranscriptionActivityEntry';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useJiraCache } from '../context/JiraCacheContext';
import { useTimeRounding } from '../hooks/useTimeRounding';
import { useScreenshotAnalysis } from '../context/ScreenshotAnalysisContext';
import { useAudioRecording } from '../context/AudioRecordingContext';
import { analytics } from '../services/analytics';
import { TempoService, type TempoAccount } from '../services/tempoService';
import { JiraService } from '../services/jiraService';
import type { SplitSuggestion } from '../types/electron';
import { FALLBACK_SCREENSHOT_DESCRIPTION } from '../constants';

/**
 * Extract window title from screenshot path as a fallback.
 * Screenshot filename format: {timestamp}|||{app_name}|||{window_title}.png
 */
function extractWindowTitleFromScreenshot(screenshotPaths?: string[]): string | undefined {
    if (!screenshotPaths || screenshotPaths.length === 0) return undefined;

    // Try to extract from the first screenshot path
    const firstPath = screenshotPaths[0];
    const filename = firstPath.split('/').pop() || firstPath.split('\\').pop() || '';

    if (filename.includes('|||')) {
        const parts = filename.replace('.png', '').split('|||');
        if (parts.length >= 3 && parts[2] && parts[2] !== 'Unknown') {
            // Clean up underscore replacements back to original characters
            return parts[2];
        }
    }

    return undefined;
}

/**
 * Get the best available window title for an activity.
 * Priority: activity.windowTitle > extracted from screenshot > fallback message
 */
function getWindowTitle(activity: { windowTitle?: string; screenshotPaths?: string[] }): string {
    // If we have a valid window title, use it
    if (activity.windowTitle && activity.windowTitle !== 'Unknown' && activity.windowTitle !== '') {
        return activity.windowTitle;
    }

    // Try to extract from screenshot filename
    const extractedTitle = extractWindowTitleFromScreenshot(activity.screenshotPaths);
    if (extractedTitle) {
        return extractedTitle;
    }

    // Fallback
    return '(No window title available)';
}

interface HistoryDetailProps {
    entry: TimeEntry;
    buckets: TimeBucket[];
    onBack: () => void;
    onUpdate: (id: string, updates: Partial<TimeEntry>) => void;
    onNavigateToSettings: () => void;
    formatTime: (ms: number) => string;
}

interface AppGroup {
    appName: string;
    totalDuration: number;
    activities: WindowActivity[];
    icon?: string;
}

export function HistoryDetail({ entry, buckets, onBack, onUpdate, onNavigateToSettings, formatTime }: HistoryDetailProps) {
    const { removeActivityFromEntry, removeAllActivitiesForApp, removeScreenshotFromEntry, addManualActivityToEntry, setEntryAssignment, createEntryFromActivity, entries } = useStorage();
    const { settings, updateSettings } = useSettings();
    const { hasFeature, upgrade } = useSubscription();
    const { user, refreshAuthStatus } = useAuth();
    const { showToast } = useToast();
    const jiraCache = useJiraCache();
    const { roundTime, isRoundingEnabled } = useTimeRounding();
    const { totalAnalyzing } = useScreenshotAnalysis();
    const { retryTranscription, transcriptionProgress } = useAudioRecording();
    const activityRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [description, setDescription] = useState(entry.description || '');
    const [selectedAssignment, setSelectedAssignment] = useState<WorkAssignment | null>(() => {
        // Get assignment from unified model or fallback to legacy fields
        return entry.assignment ||
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : entry.bucketId ? {
                type: 'bucket' as const,
                bucket: buckets.find(b => b.id === entry.bucketId)
            } : null);
    });
    const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
    const [appIcons, setAppIcons] = useState<Map<string, string>>(new Map());
    const [selectedScreenshots, setSelectedScreenshots] = useState<string[] | null>(null);
    const [selectedScreenshotMetadata, setSelectedScreenshotMetadata] = useState<Array<{ path: string; timestamp: number; appName?: string; windowTitle?: string; aiDescription?: string; }> | null>(null);
    const [saveTimeoutId, setSaveTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null);
    const [showManualEntryForm, setShowManualEntryForm] = useState(false);
    const [manualDescription, setManualDescription] = useState('');
    const [manualDuration, setManualDuration] = useState('');
    const [showTempoValidationModal, setShowTempoValidationModal] = useState(false);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [generationFailed, setGenerationFailed] = useState(false);  // Prevents infinite auto-retry loop on rate limit/error
    const [availableAccounts, setAvailableAccounts] = useState<TempoAccount[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [showAccountPicker, setShowAccountPicker] = useState(false);
    const [isAssigningBucket, setIsAssigningBucket] = useState(false);
    const [isAssigningTempoAccount, setIsAssigningTempoAccount] = useState(false);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [showTempoConfigModal, setShowTempoConfigModal] = useState(false);
    const previousAssignmentRef = useRef<WorkAssignment | null>(null);
    const accountsCacheRef = useRef<Map<string, TempoAccount[]>>(new Map());
    const isLoadingAccountsRef = useRef<Map<string, boolean>>(new Map());

    // Splitting Assistant state
    const [showSplittingAssistant, setShowSplittingAssistant] = useState(false);
    const [splitSuggestions, setSplitSuggestions] = useState<SplitSuggestion[]>([]);
    const [isAnalyzingSplits, setIsAnalyzingSplits] = useState(false);

    // AI Analysis retry state
    const [isRetryingAnalysis, setIsRetryingAnalysis] = useState(false);
    const [retryProgress, setRetryProgress] = useState<{ completed: number; total: number } | null>(null);

    // Transcription retry state
    const [isRetryingTranscription, setIsRetryingTranscription] = useState(false);

    // Note: JiraCache initialization is handled by JiraCacheContext
    useEffect(() => {
        const { jira } = settings;
        if (jira?.enabled && jira?.apiToken && jira?.baseUrl && jira?.email) {
            // JiraCache is already initialized by context, no need to initialize again
        }
    }, [settings.jira, jiraCache]);

    const hasJiraAccess = hasFeature('jira');
    const hasTempoAccess = hasFeature('tempo');

    // Fetch Tempo accounts when Jira assignment changes
    useEffect(() => {
        const fetchAccountsForAssignment = async (jiraIssue: LinkedJiraIssue) => {
            if (!hasTempoAccess || !settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
                setAvailableAccounts([]);
                return;
            }

            if (!hasJiraAccess || !settings.jira?.enabled || !settings.jira?.apiToken || !settings.jira?.baseUrl || !settings.jira?.email) {
                setAvailableAccounts([]);
                return;
            }

            const cacheKey = jiraIssue.key;

            // Check if we're already loading this issue's accounts
            if (isLoadingAccountsRef.current.get(cacheKey)) {
                console.log('[HistoryDetail] Already loading accounts for', cacheKey);
                return;
            }

            // Check cache first - instant load!
            const cachedAccounts = accountsCacheRef.current.get(cacheKey);
            if (cachedAccounts) {
                console.log('[HistoryDetail] Using cached accounts for', cacheKey, '- instant load!');
                setAvailableAccounts(cachedAccounts);
                setIsLoadingAccounts(false);

                // Only auto-select if entry has no tempo account selected
                if (cachedAccounts.length > 0 && !entry.tempoAccount) {
                    autoSelectTempoAccount(jiraIssue, cachedAccounts);
                }
                return;
            }

            // Not in cache - fetch from API
            console.log('[HistoryDetail] Cache miss for', cacheKey, '- fetching from API');
            isLoadingAccountsRef.current.set(cacheKey, true);
            setIsLoadingAccounts(true);

            try {
                // Initialize services
                const tempoService = new TempoService(settings.tempo.baseUrl, settings.tempo.apiToken);
                const jiraService = new JiraService(settings.jira.baseUrl, settings.jira.email, settings.jira.apiToken);

                // Fetch issue details to get project ID
                console.log('[HistoryDetail] Fetching issue details for accounts lookup:', jiraIssue.key);
                const issue = await jiraService.getIssue(jiraIssue.key);
                const projectId = issue.fields.project.id;
                const issueId = issue.id;
                console.log('[HistoryDetail] Got project ID:', projectId, 'and issue ID:', issueId);

                // Fetch accounts for the project/issue
                console.log('[HistoryDetail] Fetching accounts for project/issue:', projectId, issueId);
                const accounts = await tempoService.getAccountsForIssueOrProject(projectId, issueId);
                console.log('[HistoryDetail] Fetched accounts:', accounts);

                // Cache the results for instant future access
                accountsCacheRef.current.set(cacheKey, accounts);
                console.log('[HistoryDetail] Cached accounts for', cacheKey);

                setAvailableAccounts(accounts);

                // Auto-select account if we have accounts and no account is currently selected
                // This check is important: we only auto-select if the entry has no tempo account
                if (accounts.length > 0 && !entry.tempoAccount) {
                    autoSelectTempoAccount(jiraIssue, accounts);
                }
            } catch (error) {
                console.error('[HistoryDetail] Failed to fetch accounts:', error);
                setAvailableAccounts([]);
            } finally {
                isLoadingAccountsRef.current.set(cacheKey, false);
                setIsLoadingAccounts(false);
            }
        };

        // Only fetch if we have a Jira assignment and Tempo is enabled
        if (selectedAssignment?.type === 'jira' && selectedAssignment.jiraIssue) {
            fetchAccountsForAssignment(selectedAssignment.jiraIssue);
        } else {
            setAvailableAccounts([]);
        }
    }, [selectedAssignment, settings.tempo, settings.jira, hasTempoAccess, hasJiraAccess]);

    // Update local state when switching to a different entry
    // Note: description only syncs on entry.id change to prevent race condition with auto-save
    useEffect(() => {
        setDescription(entry.description || '');
        setGenerationFailed(false);  // Reset on entry change to allow retry on new entry
    }, [entry.id]);

    // Update assignment when entry changes (can depend on more fields since it's not auto-saved on keystroke)
    useEffect(() => {
        setSelectedAssignment(entry.assignment ||
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : entry.bucketId ? {
                type: 'bucket' as const,
                bucket: buckets.find(b => b.id === entry.bucketId)
            } : null));
    }, [entry.id, entry.assignment, entry.bucketId, entry.linkedJiraIssue, buckets]);

    // Auto-save function with debouncing
    const autoSave = () => {
        if (saveTimeoutId) {
            clearTimeout(saveTimeoutId);
        }

        const timeoutId = setTimeout(() => {
            onUpdate(entry.id, {
                description: description.trim() || undefined
            });
        }, 500); // 500ms debounce

        setSaveTimeoutId(timeoutId);
    };

    // Auto-save when description or bucket changes
    useEffect(() => {
        // Only auto-save if description is different from the original entry
        if (description !== (entry.description || '')) {
            autoSave();
        }

        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, [description]);

    // Handle duration changes from inline editor
    const handleDurationChange = (newDuration: number) => {
        // Update both the duration and the end time
        onUpdate(entry.id, {
            duration: newDuration,
            endTime: entry.startTime + newDuration
        });
    };

    // Handle assignment changes separately
    const handleAssignmentChange = (assignment: WorkAssignment | null, autoSelected: boolean = false) => {
        setSelectedAssignment(assignment);
        setEntryAssignment(entry.id, assignment);

        // Clear Tempo account when switching to a different Jira issue or changing assignment type
        // This allows auto-selection to run for the new issue
        const previousIssueKey = selectedAssignment?.type === 'jira' ? selectedAssignment.jiraIssue?.key : null;
        const newIssueKey = assignment?.type === 'jira' ? assignment.jiraIssue?.key : null;

        if (previousIssueKey !== newIssueKey) {
            // Different issue or assignment type changed - clear Tempo account
            onUpdate(entry.id, {
                tempoAccount: undefined,
                tempoAccountAutoSelected: false
            });
        }

        // Update auto-selected flag
        if (autoSelected && assignment) {
            onUpdate(entry.id, { assignmentAutoSelected: true });
        } else if (!autoSelected) {
            // Clear auto-selected flag when user manually changes assignment
            onUpdate(entry.id, { assignmentAutoSelected: false });
        }
    };

    // Auto-assign work based on AI suggestion
    const autoAssignWork = async (description: string, metadata: any, manualTrigger: boolean = false) => {
        // Check if auto-assignment is enabled in settings (skip check for manual trigger)
        if (!manualTrigger) {
            const autoAssignEnabled = settings.ai?.autoAssignWork !== false;
            if (!autoAssignEnabled) {
                console.log('[HistoryDetail] Auto-assignment disabled in settings');
                return;
            }

            // Don't override existing assignment for auto-trigger
            if (selectedAssignment) return;
        }

        // Set loading state for manual trigger
        if (manualTrigger) {
            setIsAssigningBucket(true);
        }

        try {
            console.log('[HistoryDetail] Requesting AI assignment suggestion');

            // Get Jira issues for suggestion - include ALL synced issues, not just assigned
            let jiraIssues: LinkedJiraIssue[] = [];
            if (settings.jira?.enabled && jiraCache) {
                try {
                    // Get assigned issues
                    const assignedIssues = await jiraCache.getAssignedIssues();

                    // Also get all issues from selected projects (from crawler/cache)
                    const selectedProjects = settings.jira.selectedProjects || [];
                    const projectIssuesPromises = selectedProjects.map(projectKey =>
                        jiraCache.getProjectIssues(projectKey).catch(() => [])
                    );
                    const projectIssuesArrays = await Promise.all(projectIssuesPromises);
                    const projectIssues = projectIssuesArrays.flat();

                    // Combine and deduplicate by issue key
                    const allIssues = [...assignedIssues, ...projectIssues];
                    const uniqueIssuesMap = new Map<string, typeof allIssues[0]>();
                    for (const issue of allIssues) {
                        if (!uniqueIssuesMap.has(issue.key)) {
                            uniqueIssuesMap.set(issue.key, issue);
                        }
                    }

                    jiraIssues = Array.from(uniqueIssuesMap.values()).map(issue => ({
                        key: issue.key,
                        summary: issue.fields.summary,
                        issueType: issue.fields.issuetype.name,
                        status: issue.fields.status.name,
                        projectKey: issue.fields.project.key,
                        projectName: issue.fields.project.name
                    }));

                    console.log(`[HistoryDetail] Found ${jiraIssues.length} Jira issues for AI suggestion (${assignedIssues.length} assigned, ${projectIssues.length} from projects)`);
                } catch (error) {
                    console.error('[HistoryDetail] Failed to fetch Jira issues:', error);
                }
            }

            // Fetch calendar context for the activity's start time
            let calendarContext = {
                currentEvent: null as string | null,
                recentEvents: [] as string[],
                upcomingEvents: [] as string[]
            };
            try {
                const calendarResult = await window.electron.ipcRenderer.calendar.getContext(entry.startTime);
                if (calendarResult?.success) {
                    calendarContext = {
                        currentEvent: calendarResult.currentEvent,
                        recentEvents: calendarResult.recentEvents || [],
                        upcomingEvents: calendarResult.upcomingEvents || []
                    };
                }
            } catch (error) {
                console.log('[HistoryDetail] Failed to fetch calendar context:', error);
                // Continue with empty calendar context
            }

            // Call the suggest-assignment IPC handler
            const result = await window.electron?.ipcRenderer?.suggestAssignment({
                context: {
                    description,
                    appNames: Array.from(new Set(entry.windowActivity?.map(a => a.appName) || [])),
                    windowTitles: Array.from(new Set(entry.windowActivity?.map(a => a.windowTitle) || [])),
                    detectedTechnologies: metadata?.technologies || [],
                    detectedActivities: metadata?.activities || [],
                    duration: entry.duration,
                    startTime: entry.startTime,
                    // Calendar context from CalendarService
                    currentCalendarEvent: calendarContext.currentEvent,
                    recentCalendarEvents: calendarContext.recentEvents,
                    upcomingCalendarEvents: calendarContext.upcomingEvents
                },
                buckets: buckets,
                jiraIssues: jiraIssues,
                historicalEntries: entries.slice(0, 50) // Last 50 entries for pattern learning
            });

            console.log('[HistoryDetail] AI suggestion result:', result);

            if (result?.success && result.suggestion?.assignment) {
                // Store previous assignment for undo
                previousAssignmentRef.current = selectedAssignment;

                // Auto-assign with notification
                console.log('[HistoryDetail] Auto-assigning with confidence:', result.suggestion.confidence);
                handleAssignmentChange(result.suggestion.assignment, true);

                // Track AI assignment usage
                analytics.track('assignment.ai_used');

                // Log the reason
                console.log('[HistoryDetail] Assignment reason:', result.suggestion.reason);
            } else {
                console.log('[HistoryDetail] No assignment suggestion available');
                if (manualTrigger) {
                    showToast({
                        type: 'info',
                        title: 'No suggestion',
                        message: 'Could not determine appropriate assignment',
                        duration: 4000
                    });
                }
            }
        } catch (error) {
            console.error('[HistoryDetail] Auto-assignment failed:', error);
            if (manualTrigger) {
                showToast({
                    type: 'error',
                    title: 'Assignment failed',
                    message: error instanceof Error ? error.message : 'Failed to assign bucket',
                    duration: 5000
                });
            }
        } finally {
            if (manualTrigger) {
                setIsAssigningBucket(false);
            }
        }
    };

    // Auto-select Tempo account based on AI suggestion
    const autoSelectTempoAccount = async (issue: LinkedJiraIssue, accounts: TempoAccount[], manualTrigger: boolean = false) => {
        // Check if auto-selection is enabled in settings (skip check for manual trigger)
        if (!manualTrigger) {
            const autoSelectEnabled = settings.ai?.autoSelectAccount !== false;
            if (!autoSelectEnabled) {
                console.log('[HistoryDetail] Auto-account selection disabled in settings');
                return;
            }

            // Don't override existing tempo account selection for auto-trigger
            if (entry.tempoAccount) return;
        }

        if (!settings.tempo?.enabled || accounts.length === 0) {
            if (manualTrigger) {
                showToast({
                    type: 'error',
                    title: 'Cannot assign',
                    message: accounts.length === 0 ? 'No accounts available' : 'Tempo is not enabled',
                    duration: 4000
                });
            }
            return;
        }

        // Set loading state for manual trigger
        if (manualTrigger) {
            setIsAssigningTempoAccount(true);
        }

        try {
            console.log('[HistoryDetail] Requesting AI tempo account selection');

            // Get historical account usage
            const historicalAccounts = entries
                .filter(e => e.assignment?.type === 'jira' && e.tempoAccount)
                .map(e => ({
                    issueKey: e.assignment!.jiraIssue!.key,
                    accountKey: e.tempoAccount!.key
                }));

            // Call the select-tempo-account IPC handler
            // NEW: Pass full entries for enhanced learning
            const result = await window.electron?.ipcRenderer?.selectTempoAccount?.({
                issue,
                accounts,
                description: entry.description || '',
                historicalAccounts,
                historicalEntries: entries  // Pass all entries for context-aware matching
            });

            console.log('[HistoryDetail] AI tempo account selection result:', result);

            if (result?.success && result.selection?.account) {
                // Auto-select account
                console.log('[HistoryDetail] Auto-selecting tempo account with confidence:', result.selection.confidence);
                onUpdate(entry.id, {
                    tempoAccount: {
                        key: result.selection.account.key,
                        name: result.selection.account.name,
                        id: result.selection.account.id
                    },
                    tempoAccountAutoSelected: true
                });

                // Show success toast
                showToast({
                    type: 'success',
                    title: 'Account Selected',
                    message: `Auto-selected account: ${result.selection.account.name}`,
                    duration: 5000
                });

                // Log the reason
                console.log('[HistoryDetail] Account selection reason:', result.selection.reason);
            } else {
                console.log('[HistoryDetail] No account selection available');
                if (manualTrigger) {
                    showToast({
                        type: 'info',
                        title: 'No suggestion',
                        message: 'Could not determine appropriate Tempo account',
                        duration: 4000
                    });
                }
            }
        } catch (error) {
            console.error('[HistoryDetail] Auto-account selection failed:', error);
            if (manualTrigger) {
                showToast({
                    type: 'error',
                    title: 'Selection failed',
                    message: error instanceof Error ? error.message : 'Failed to select Tempo account',
                    duration: 5000
                });
            }
        } finally {
            if (manualTrigger) {
                setIsAssigningTempoAccount(false);
            }
        }
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutId) {
                clearTimeout(saveTimeoutId);
            }
        };
    }, []);

    // Update metadata when entry changes and gallery is open
    useEffect(() => {
        if (selectedScreenshots && entry.windowActivity) {
            // Find activities that have the selected screenshots and rebuild metadata
            const updatedMetadata = selectedScreenshots.map(path => {
                // Find the activity that contains this screenshot
                const activity = entry.windowActivity?.find(act =>
                    act.screenshotPaths?.includes(path)
                );

                return {
                    path,
                    timestamp: activity?.timestamp || Date.now(),
                    appName: activity?.appName,
                    windowTitle: activity ? getWindowTitle(activity) : undefined,
                    aiDescription: activity?.screenshotDescriptions?.[path],
                    rawVisionData: activity?.screenshotVisionData?.[path],
                    visionData: activity?.screenshotVisionData?.[path] // Legacy fallback
                };
            });

            setSelectedScreenshotMetadata(updatedMetadata);
        }
    }, [entry.windowActivity, selectedScreenshots]);

    const handleDeleteActivity = async (activityIndex: number) => {
        // Check if there will be remaining activities after deletion
        const remainingActivitiesCount = (entry.windowActivity?.length || 0) - 1;

        // Check if remaining activities have screenshot descriptions
        const remainingActivities = entry.windowActivity?.filter((_, idx) => idx !== activityIndex) || [];
        const hasScreenshotDescriptions = remainingActivities.some(activity =>
            activity.screenshotDescriptions && Object.keys(activity.screenshotDescriptions).length > 0
        );

        await removeActivityFromEntry(entry.id, activityIndex);

        // Wait a brief moment for state to update
        await new Promise(resolve => setTimeout(resolve, 100));

        // Regenerate description after deletion
        if (remainingActivitiesCount > 0 && hasScreenshotDescriptions) {
            // Regenerate if there are remaining activities with screenshot descriptions
            await handleGenerateSummary(false);
        } else if (remainingActivitiesCount === 0) {
            // Clear description if no activities remain
            setDescription('');
            onUpdate(entry.id, {
                description: undefined,
                descriptionAutoGenerated: false,
                detectedTechnologies: [],
                detectedActivities: []
            });
        }
        // If activities remain but no screenshots, keep the existing description
    };

    const handleCreateEntryFromActivity = async (activityIndex: number, _activityKey: string) => {
        const activity = entry.windowActivity?.[activityIndex];
        if (!activity) return;

        const activityTitle = activity.appName === 'Manual Entry' ? activity.windowTitle : getWindowTitle(activity);

        try {
            const newEntryId = await createEntryFromActivity(entry.id, activityIndex);

            if (newEntryId) {
                showToast({
                    type: 'success',
                    title: 'Entry Created',
                    message: `Created new entry from "${activityTitle}"`,
                    duration: 3000
                });

                // Navigate back after successful creation
                onBack();
            } else {
                throw new Error('Failed to create entry');
            }
        } catch (error) {
            console.error('Failed to create entry from activity:', error);
            showToast({
                type: 'error',
                title: 'Creation Failed',
                message: `Failed to create entry from "${activityTitle}"`,
                duration: 5000
            });
        }
    };

    const handleCreateEntryFromApp = async (appName: string) => {
        const appActivities = entry.windowActivity?.filter(activity => activity.appName === appName) || [];
        if (appActivities.length === 0) return;

        try {
            // Get all activity indices for this app
            const activityIndices = appActivities.map(activity =>
                entry.windowActivity?.findIndex(act =>
                    act.timestamp === activity.timestamp &&
                    act.appName === activity.appName &&
                    act.windowTitle === activity.windowTitle
                ) ?? -1
            ).filter(idx => idx !== -1);

            if (activityIndices.length === 0) return;

            // Create new entry from all activities of this app
            // We'll split them one by one, starting from the last index to avoid index shifting issues
            const sortedIndices = [...activityIndices].sort((a, b) => b - a);
            let newEntryId: string | null = null;

            for (const activityIndex of sortedIndices) {
                newEntryId = await createEntryFromActivity(entry.id, activityIndex);
            }

            if (newEntryId) {
                showToast({
                    type: 'success',
                    title: 'Entry Created',
                    message: `Created new entry from ${appActivities.length} ${appName} ${appActivities.length === 1 ? 'activity' : 'activities'}`,
                    duration: 3000
                });

                // Navigate back to reload the entries list with the new entry
                onBack();
            } else {
                throw new Error('Failed to create entry');
            }
        } catch (error) {
            console.error('Failed to create entry from app:', error);
            showToast({
                type: 'error',
                title: 'Creation Failed',
                message: `Failed to create entry from "${appName}"`,
                duration: 5000
            });
        }
    };

    const handleDeleteApp = async (appName: string) => {
        // Check if there will be remaining activities after deletion
        const remainingActivities = entry.windowActivity?.filter(
            activity => activity.appName !== appName
        ) || [];
        const remainingActivitiesCount = remainingActivities.length;

        // Check if remaining activities have screenshot descriptions
        const hasScreenshotDescriptions = remainingActivities.some(activity =>
            activity.screenshotDescriptions && Object.keys(activity.screenshotDescriptions).length > 0
        );

        await removeAllActivitiesForApp(entry.id, appName);

        // Wait a brief moment for state to update
        await new Promise(resolve => setTimeout(resolve, 100));

        // Regenerate description after deletion
        if (remainingActivitiesCount > 0 && hasScreenshotDescriptions) {
            // Regenerate if there are remaining activities with screenshot descriptions
            await handleGenerateSummary(false);
        } else if (remainingActivitiesCount === 0) {
            // Clear description if no activities remain
            setDescription('');
            onUpdate(entry.id, {
                description: undefined,
                descriptionAutoGenerated: false,
                detectedTechnologies: [],
                detectedActivities: []
            });
        }
        // If activities remain but no screenshots, keep the existing description
    };

    const handleScreenshotDeleted = (screenshotPath: string) => {
        removeScreenshotFromEntry(screenshotPath);
        // Update selected screenshots if needed
        if (selectedScreenshots) {
            const updatedScreenshots = selectedScreenshots.filter(path => path !== screenshotPath);
            const updatedMetadata = selectedScreenshotMetadata?.filter(meta => meta.path !== screenshotPath);

            if (updatedScreenshots.length === 0) {
                setSelectedScreenshots(null);
                setSelectedScreenshotMetadata(null);
            } else {
                setSelectedScreenshots(updatedScreenshots);
                setSelectedScreenshotMetadata(updatedMetadata || null);
            }
        }
    };

    const handleAddManualEntry = () => {
        if (!manualDescription.trim() || !manualDuration.trim()) return;

        // Parse duration from user input (supports formats like "1h 30m", "90m", "1.5h", "90")
        const duration = parseDuration(manualDuration);
        if (duration <= 0) return;

        addManualActivityToEntry(entry.id, manualDescription.trim(), duration);

        // Reset form
        setManualDescription('');
        setManualDuration('');
        setShowManualEntryForm(false);
    };

    // Get all screenshots that have failed AI analysis (have fallback description)
    const getFailedAnalysisScreenshots = useMemo(() => {
        const failedScreenshots: Array<{ path: string; timestamp: number }> = [];

        if (!entry.windowActivity) return failedScreenshots;

        for (const activity of entry.windowActivity) {
            if (!activity.screenshotPaths) continue;

            for (const path of activity.screenshotPaths) {
                const description = activity.screenshotDescriptions?.[path];
                // Check if this screenshot has the fallback description (indicating failed AI analysis)
                if (description === FALLBACK_SCREENSHOT_DESCRIPTION) {
                    // Extract timestamp from filename or use activity timestamp
                    const filename = path.split('/').pop() || '';
                    const timestampMatch = filename.match(/^(\d+)/);
                    const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : activity.timestamp;
                    failedScreenshots.push({ path, timestamp });
                }
            }
        }

        return failedScreenshots;
    }, [entry.windowActivity]);

    const hasFailedAnalyses = getFailedAnalysisScreenshots.length > 0;

    // Handler to retry all failed AI analyses
    const handleRetryAIAnalysis = async () => {
        if (isRetryingAnalysis || getFailedAnalysisScreenshots.length === 0) return;

        setIsRetryingAnalysis(true);
        setRetryProgress({ completed: 0, total: getFailedAnalysisScreenshots.length });

        console.log(`[HistoryDetail] Retrying AI analysis for ${getFailedAnalysisScreenshots.length} screenshots`);

        // Track all successful updates to batch them at the end
        const successfulUpdates = new Map<string, {
            description: string;
            visionData: { confidence?: number; detectedText?: string[]; objects?: string[]; extraction?: any };
        }>();

        // Process screenshots one at a time to respect rate limits
        let completed = 0;
        const MAX_CONCURRENT = 2; // Process 2 at a time to balance speed and rate limits
        const queue = [...getFailedAnalysisScreenshots];

        const processOne = async (): Promise<void> => {
            const item = queue.shift();
            if (!item) return;

            const { path, timestamp } = item;
            try {
                console.log(`[HistoryDetail] Retrying analysis for: ${path.split('/').pop()}`);
                // @ts-ignore
                const result = await window.electron?.ipcRenderer?.analyzeScreenshot(path, `retry-${timestamp}`);

                if (result?.success && result.description && result.description !== FALLBACK_SCREENSHOT_DESCRIPTION) {
                    console.log(`[HistoryDetail] ✅ Retry successful for: ${path.split('/').pop()}`);

                    // Store the successful result for batch update later
                    successfulUpdates.set(path, {
                        description: result.description,
                        visionData: {
                            confidence: result.confidence,
                            detectedText: result.detectedText,
                            objects: result.objects,
                            extraction: result.extraction
                        }
                    });
                } else {
                    console.log(`[HistoryDetail] ⚠️ Retry failed for: ${path.split('/').pop()}`, result?.error);
                }
            } catch (error) {
                console.error(`[HistoryDetail] ❌ Retry error for: ${path.split('/').pop()}`, error);
            }

            completed++;
            setRetryProgress({ completed, total: getFailedAnalysisScreenshots.length });
        };

        // Process in batches
        while (queue.length > 0) {
            const batch = [];
            for (let i = 0; i < MAX_CONCURRENT && queue.length > 0; i++) {
                batch.push(processOne());
            }
            await Promise.all(batch);

            // Small delay between batches to respect rate limits
            if (queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Batch update: Apply all successful updates in a single database write
        if (successfulUpdates.size > 0) {
            console.log(`[HistoryDetail] Applying ${successfulUpdates.size} successful updates in batch`);

            const updatedActivity = entry.windowActivity?.map(activity => {
                if (!activity.screenshotPaths) return activity;

                // Check if any screenshots in this activity were successfully updated
                const hasUpdates = activity.screenshotPaths.some(path => successfulUpdates.has(path));
                if (!hasUpdates) return activity;

                // Build updated descriptions and vision data for this activity
                const newDescriptions: { [path: string]: string } = { ...(activity.screenshotDescriptions || {}) };
                const newVisionData: { [path: string]: { confidence?: number; detectedText?: string[]; objects?: string[]; extraction?: any } } = {
                    ...(activity.screenshotVisionData || {})
                };

                // Apply all updates for screenshots in this activity
                for (const path of activity.screenshotPaths) {
                    const update = successfulUpdates.get(path);
                    if (update) {
                        newDescriptions[path] = update.description;
                        newVisionData[path] = update.visionData;
                    }
                }

                return {
                    ...activity,
                    screenshotDescriptions: newDescriptions,
                    screenshotVisionData: newVisionData
                };
            });

            // Single database write with all changes
            if (updatedActivity) {
                onUpdate(entry.id, { windowActivity: updatedActivity });
            }
        }

        setIsRetryingAnalysis(false);
        setRetryProgress(null);
        showToast({
            type: 'success',
            title: 'Retry completed',
            message: `AI analysis retry completed. ${successfulUpdates.size} of ${getFailedAnalysisScreenshots.length} screenshots successfully analyzed.`,
            duration: 3000
        });
    };

    const handleRetryTranscription = async () => {
        if (!entry.pendingTranscription || isRetryingTranscription) return;

        setIsRetryingTranscription(true);

        try {
            console.log('[HistoryDetail] Retrying transcription for entry:', entry.id);
            const transcription = await retryTranscription(
                entry.id,
                entry.pendingTranscription.audioPath,
                entry.pendingTranscription.mimeType
            );

            if (transcription) {
                // Update entry with successful transcription and clear pending
                onUpdate(entry.id, {
                    transcription,
                    pendingTranscription: undefined,
                });

                showToast({
                    type: 'success',
                    title: 'Transcription successful',
                    message: `Transcribed ${transcription.wordCount} words`,
                    duration: 3000,
                });
            } else {
                showToast({
                    type: 'error',
                    title: 'Transcription failed',
                    message: 'Failed to transcribe audio. Please try again later.',
                    duration: 5000,
                });
            }
        } catch (error) {
            console.error('[HistoryDetail] Error retrying transcription:', error);
            showToast({
                type: 'error',
                title: 'Transcription error',
                message: error instanceof Error ? error.message : 'An unexpected error occurred',
                duration: 5000,
            });
        } finally {
            setIsRetryingTranscription(false);
        }
    };

    const handleOpenTempoModal = () => {
        // Check if user has premium access for Tempo
        if (!hasTempoAccess) {
            setShowUpgradeModal(true);
            return;
        }

        // Check if Tempo is configured - show config modal if not
        if (!settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
            setShowTempoConfigModal(true);
            return;
        }

        // Check if Jira is configured (required for Tempo to get issue IDs)
        if (!settings.jira?.enabled || !settings.jira?.apiToken || !settings.jira?.baseUrl || !settings.jira?.email) {
            alert('Please configure Jira settings first. Jira credentials are required to log time to Tempo.');
            onNavigateToSettings();
            return;
        }

        // Check if there's an assignment
        if (!selectedAssignment) {
            alert('Please select an assignment (bucket or Jira issue) before logging to Tempo.');
            return;
        }

        // Open the validation modal
        setShowTempoValidationModal(true);
    };

    const handleOpenUpgradeUrl = async () => {
        if (!user?.email) {
            console.error('[HistoryDetail] No user email available');
            return;
        }

        const result = await upgrade(user.email);
        setShowUpgradeModal(false);

        if (!result.success) {
            console.error('[HistoryDetail] Failed to start upgrade:', result.error);
            alert(`Failed to start upgrade: ${result.error}`);
        }
    };

    const handleTempoSuccess = () => {
        setShowTempoValidationModal(false);
    };

    const handleAccountSelect = (account: TempoAccount) => {
        onUpdate(entry.id, {
            tempoAccount: {
                key: account.key,
                name: account.name,
                id: account.id
            },
            tempoAccountAutoSelected: false // Clear auto-selected flag when user manually selects
        });
    };

    const parseDuration = (input: string): number => {
        const str = input.toLowerCase().trim();
        let totalMinutes = 0;

        // Parse "1h 30m" format
        const hoursMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
        const minutesMatch = str.match(/(\d+(?:\.\d+)?)\s*m/);

        if (hoursMatch) {
            totalMinutes += parseFloat(hoursMatch[1]) * 60;
        }
        if (minutesMatch) {
            totalMinutes += parseFloat(minutesMatch[1]);
        }

        // If no h/m found, treat as minutes
        if (!hoursMatch && !minutesMatch) {
            const numMatch = str.match(/^(\d+(?:\.\d+)?)$/);
            if (numMatch) {
                totalMinutes = parseFloat(numMatch[1]);
            }
        }

        return Math.round(totalMinutes * 60 * 1000); // Convert to milliseconds
    };

    // Calculate screenshot analysis statistics
    const screenshotStats = useMemo(() => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            return { total: 0, analyzed: 0 };
        }

        let totalScreenshots = 0;
        let analyzedScreenshots = 0;

        entry.windowActivity.forEach(activity => {
            if (activity.screenshotPaths) {
                totalScreenshots += activity.screenshotPaths.length;

                // Count how many have AI descriptions
                if (activity.screenshotDescriptions) {
                    activity.screenshotPaths.forEach(path => {
                        if (activity.screenshotDescriptions?.[path]) {
                            analyzedScreenshots++;
                        }
                    });
                }
            }
        });

        return { total: totalScreenshots, analyzed: analyzedScreenshots };
    }, [entry.windowActivity]);

    // Auto-generate description when all screenshots are analyzed OR when there's activity but no screenshots
    useEffect(() => {
        // Check if auto-generation is enabled in settings
        const autoGenerateEnabled = settings.ai?.autoGenerateDescription !== false;
        const hasWindowActivity = entry.windowActivity && entry.windowActivity.length > 0;
        const hasScreenshots = screenshotStats.total > 0;
        const allScreenshotsAnalyzed = screenshotStats.analyzed === screenshotStats.total;

        // Auto-generate if:
        // 1. Auto-generation is enabled AND no description exists AND not already generating
        // 2. AND generation hasn't already failed (prevents infinite retry on rate limit)
        // 3. AND either: all screenshots analyzed OR (no screenshots but has window activity)
        const shouldAutoGenerate = autoGenerateEnabled &&
            !entry.description &&
            !isGeneratingSummary &&
            !generationFailed &&
            hasWindowActivity &&
            (hasScreenshots ? allScreenshotsAnalyzed : true);

        if (shouldAutoGenerate) {
            handleGenerateSummary(true);
        }
    }, [screenshotStats, entry.description, isGeneratingSummary, generationFailed, settings.ai, entry.windowActivity]);

    // Handler for generating AI summary
    const handleGenerateSummary = async (isAutoGenerated: boolean = false) => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            alert('No activity data available to generate summary.');
            return;
        }

        setIsGeneratingSummary(true);

        try {
            // Collect all context data
            const screenshotDescriptions: string[] = [];
            const windowTitles: string[] = [];
            const appNames: string[] = [];
            const appDurations: Record<string, number> = {};

            entry.windowActivity.forEach(activity => {
                // Collect app names and window titles
                if (activity.appName && !appNames.includes(activity.appName)) {
                    appNames.push(activity.appName);
                }
                const resolvedTitle = getWindowTitle(activity);
                if (resolvedTitle && resolvedTitle !== '(No window title available)' && !windowTitles.includes(resolvedTitle)) {
                    windowTitles.push(resolvedTitle);
                }

                // Calculate time spent per app (key signal for identifying primary task)
                if (activity.appName && activity.duration) {
                    appDurations[activity.appName] = (appDurations[activity.appName] || 0) + activity.duration;
                }

                // Collect screenshot descriptions
                if (activity.screenshotDescriptions) {
                    Object.values(activity.screenshotDescriptions).forEach(desc => {
                        if (desc && desc.trim()) {
                            screenshotDescriptions.push(desc);
                        }
                    });
                }
            });

            // Call the IPC handler to generate summary
            // The signal aggregator will collect signals and filter by task type
            // @ts-ignore
            const result = await window.electron?.ipcRenderer?.generateActivitySummary?.({
                entryId: entry.id,  // Entry ID for signal aggregation
                screenshotDescriptions,
                windowTitles,
                appNames,
                appDurations,  // Time spent per app for weighting primary task
                duration: entry.duration,
                startTime: entry.startTime,
                endTime: entry.endTime
            });

            if (result?.success && result.summary) {
                // Populate the description field with the generated summary
                setDescription(result.summary);

                // Update the entry with metadata and auto-generated flag
                onUpdate(entry.id, {
                    description: result.summary,
                    descriptionAutoGenerated: isAutoGenerated,
                    detectedTechnologies: result.metadata?.technologies || [],
                    detectedActivities: result.metadata?.activities || []
                });

                // Auto-assign if no assignment yet
                if (!selectedAssignment) {
                    await autoAssignWork(result.summary, result.metadata);
                }
            } else {
                throw new Error(result?.error || 'Failed to generate summary');
            }

        } catch (error) {
            console.error('Failed to generate summary:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Mark generation as failed to prevent infinite auto-retry loop
            setGenerationFailed(true);

            // If auth error, refresh auth status to update UI state
            if (errorMessage.toLowerCase().includes('not authenticated') ||
                errorMessage.toLowerCase().includes('session expired')) {
                console.log('[HistoryDetail] Auth error detected, refreshing auth status');
                await refreshAuthStatus();
            }

            showToast({
                type: 'error',
                title: 'Generation Failed',
                message: `Failed to generate description: ${errorMessage}`,
                duration: 7000
            });
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    // Handler for suggesting splits
    const handleSuggestSplits = async () => {
        setIsAnalyzingSplits(true);
        try {
            // Gather activity data with screenshots
            const screenshots: Array<{ timestamp: number; description: string }> = [];

            if (entry.windowActivity) {
                entry.windowActivity.forEach(activity => {
                    if (activity.screenshotPaths && activity.screenshotPaths.length > 0) {
                        activity.screenshotPaths.forEach(path => {
                            const description = activity.screenshotDescriptions?.[path] ||
                                              activity.screenshotAnalysis?.[path]?.description ||
                                              '';
                            screenshots.push({
                                timestamp: activity.timestamp,
                                description
                            });
                        });
                    }
                });
            }

            const activityData = {
                id: entry.id,
                startTime: entry.startTime,
                endTime: entry.startTime + entry.duration,
                duration: entry.duration,
                screenshots
            };

            const result = await window.electron.ipcRenderer.analyzeSplits(activityData);

            if (result.success && result.suggestions.length > 0) {
                setSplitSuggestions(result.suggestions);
                setShowSplittingAssistant(true);

                analytics.track('splits_suggested', {
                    entry_id: entry.id,
                    suggestions_count: result.suggestions.length,
                    duration: entry.duration
                });
            } else {
                // No splits found - silently do nothing (as per requirements)
                console.log('[HistoryDetail] No splits suggested for entry:', entry.id);
            }
        } catch (error) {
            console.error('Failed to analyze splits:', error);
            showToast({
                type: 'error',
                title: 'Analysis Failed',
                message: 'Failed to analyze splits. Please try again.',
                duration: 5000
            });
        } finally {
            setIsAnalyzingSplits(false);
        }
    };

    // Handler for applying splits
    const handleApplySplits = async (splits: SplitSuggestion[]) => {
        try {
            // Create new time entries from splits
            const newEntryIds: string[] = [];

            for (const split of splits) {
                const newEntryId = crypto.randomUUID();
                // Calculate duration and round up to nearest 15 minutes (minimum 15 minutes)
                const rawDuration = split.endTime - split.startTime;
                const roundedDuration = Math.max(
                    15 * 60 * 1000, // Minimum 15 minutes
                    Math.ceil(rawDuration / (15 * 60 * 1000)) * (15 * 60 * 1000)
                );
                const newEntry: TimeEntry = {
                    id: newEntryId,
                    startTime: split.startTime,
                    endTime: split.endTime,
                    duration: roundedDuration,
                    description: split.description,
                    descriptionAutoGenerated: false,
                    // Try to find matching bucket
                    bucketId: split.suggestedBucket ?
                        buckets.find(b => b.name === split.suggestedBucket)?.id :
                        entry.bucketId,
                    // Copy Jira issue if suggested key matches current entry
                    linkedJiraIssue: split.suggestedJiraKey && entry.linkedJiraIssue?.key === split.suggestedJiraKey ?
                        entry.linkedJiraIssue :
                        undefined,
                    // Filter window activities that fall within this split's time range
                    windowActivity: entry.windowActivity?.filter(activity => {
                        const activityEnd = activity.timestamp + activity.duration;
                        return activity.timestamp >= split.startTime && activityEnd <= split.endTime;
                    })
                };

                // Insert the new entry
                const insertResult = await window.electron.ipcRenderer.db.insertEntry(newEntry);
                if (insertResult.success) {
                    newEntryIds.push(newEntryId);
                } else {
                    throw new Error(insertResult.error || 'Failed to insert entry');
                }
            }

            // Delete the original entry
            const deleteResult = await window.electron.ipcRenderer.db.deleteEntry(entry.id);
            if (!deleteResult.success) {
                console.error('Failed to delete original entry after splitting:', deleteResult.error);
            }

            analytics.track('splits_applied', {
                original_entry_id: entry.id,
                new_entries_count: newEntryIds.length,
                original_duration: entry.duration
            });

            showToast({
                type: 'success',
                title: 'Splits Applied',
                message: `Created ${newEntryIds.length} new entries from this recording.`,
                duration: 5000
            });

            // Close the modal and go back
            setShowSplittingAssistant(false);
            onBack();
        } catch (error) {
            console.error('Failed to apply splits:', error);
            showToast({
                type: 'error',
                title: 'Failed to Apply Splits',
                message: error instanceof Error ? error.message : 'Unknown error',
                duration: 7000
            });
        }
    };

    const currentAssignment = selectedAssignment;

    // Group activities by app
    const appGroups = useMemo(() => {
        if (!entry.windowActivity || entry.windowActivity.length === 0) {
            return [];
        }

        const groups = new Map<string, AppGroup>();

        entry.windowActivity.forEach(activity => {
            const appName = activity.appName;

            if (!groups.has(appName)) {
                groups.set(appName, {
                    appName,
                    totalDuration: 0,
                    activities: [],
                    icon: undefined
                });
            }

            const group = groups.get(appName)!;
            group.totalDuration += activity.duration;
            group.activities.push(activity);
        });

        // Sort activities within each group by timestamp
        groups.forEach(group => {
            group.activities.sort((a, b) => b.timestamp - a.timestamp);
        });

        // Convert to array and sort by total duration (descending)
        return Array.from(groups.values()).sort((a, b) => b.totalDuration - a.totalDuration);
    }, [entry.windowActivity]);

    // Load app icons
    useEffect(() => {
        const loadIcons = async () => {
            const uniqueApps = new Set(appGroups.map(g => g.appName));
            const iconPromises = Array.from(uniqueApps).map(async (appName) => {
                // @ts-ignore
                if (window.electron?.ipcRenderer?.getAppIcon) {
                    try {
                        console.log(`[Renderer] Loading icon for app: ${appName}`);
                        // @ts-ignore
                        const icon = await window.electron.ipcRenderer.getAppIcon(appName);
                        console.log(`[Renderer] Icon result for ${appName}:`, icon ? 'Found' : 'Not found');
                        if (icon) {
                            setAppIcons(prev => new Map(prev).set(appName, icon));
                        }
                    } catch (error) {
                        console.error(`[Renderer] Failed to load icon for ${appName}:`, error);
                    }
                } else {
                    console.warn(`[Renderer] getAppIcon not available in electron API`);
                }
            });

            await Promise.all(iconPromises);
        };

        if (appGroups.length > 0) {
            loadIcons();
        }
    }, [appGroups]);

    const toggleApp = (appName: string) => {
        setExpandedApps(prev => {
            const next = new Set(prev);
            if (next.has(appName)) {
                next.delete(appName);
            } else {
                next.add(appName);
            }
            return next;
        });
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
            {/* Sticky Header with Back Button and Log to Tempo Button */}
            <div className="flex-shrink-0 border-b px-4 py-3 z-20 drag-handle" style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 no-drag">
                        <button
                            onClick={onBack}
                            className="p-1.5 rounded-lg transition-all active:scale-95"
                            style={{
                                backgroundColor: 'var(--color-bg-secondary)',
                                color: 'var(--color-text-secondary)',
                                transitionDuration: 'var(--duration-fast)',
                                transitionTimingFunction: 'var(--ease-out)',
                                border: '1px solid var(--color-border-primary)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                                e.currentTarget.style.color = 'white';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                            title="Back to list"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Activity Details</h2>
                    </div>

                    {/* Action Buttons - Splitting Assistant and Log to dropdown */}
                    <div className="no-drag flex items-center gap-2">
                        {/* Splitting Assistant button - only show for activities > 15 minutes */}
                        {entry.duration > 15 * 60 * 1000 && (
                            <button
                                onClick={handleSuggestSplits}
                                disabled={isAnalyzingSplits}
                                className={`px-3 py-1.5 text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95`}
                                style={{
                                    backgroundColor: 'var(--color-bg-secondary)',
                                    color: isAnalyzingSplits ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                                    borderRadius: 'var(--btn-radius)',
                                    transitionDuration: 'var(--duration-fast)',
                                    transitionTimingFunction: 'var(--ease-out)',
                                    boxShadow: 'var(--shadow-sm)',
                                    border: '1px solid var(--color-border-primary)',
                                    opacity: isAnalyzingSplits ? 0.6 : 1,
                                    cursor: isAnalyzingSplits ? 'wait' : 'pointer'
                                }}
                                onMouseEnter={(e) => {
                                    if (!isAnalyzingSplits) {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.color = 'var(--color-text-primary)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isAnalyzingSplits) {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }
                                }}
                            >
                                {isAnalyzingSplits ? (
                                    <>
                                        <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                        Analyzing...
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M16 3h5v5M8 3H3v5M3 16v5h5M21 16v5h-5M12 8v8M8 12h8"/>
                                        </svg>
                                        Splitting Assistant
                                    </>
                                )}
                            </button>
                        )}
                        {/* Log to dropdown */}
                        <div className="relative">
                            <button
                                onClick={handleOpenTempoModal}
                                className={`px-3 py-1.5 text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95`}
                                style={{
                                    backgroundColor: hasTempoAccess ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                                    color: hasTempoAccess ? '#FFFFFF' : 'var(--color-text-secondary)',
                                    borderRadius: 'var(--btn-radius)',
                                    transitionDuration: 'var(--duration-fast)',
                                    transitionTimingFunction: 'var(--ease-out)',
                                    boxShadow: hasTempoAccess ? 'var(--shadow-accent)' : 'var(--shadow-sm)',
                                    border: hasTempoAccess ? 'none' : '1px solid var(--color-border-primary)'
                                }}
                                onMouseEnter={(e) => {
                                    if (hasTempoAccess) {
                                        e.currentTarget.style.backgroundColor = '#E64000';
                                    } else {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.color = 'var(--color-text-primary)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (hasTempoAccess) {
                                        e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                    } else {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }
                                }}
                            >
                                {hasTempoAccess ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"/>
                                        <path d="M12 6v6l4 2"/>
                                    </svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                )}
                                Log to Tempo
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-4">
                {/* Entry Summary - Reorganized */}
                <div className="border rounded-lg mt-4" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-md)' }}>
                    {/* Time Summary Section - Start/End times and Duration counter */}
                    <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--color-border-secondary)' }}>
                        <div className="flex flex-col gap-1">
                            {/* Start - End time range (matching Worklog format) */}
                            <span className="text-xs" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} - {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                            {/* Rounded difference label - aligned with time */}
                            {isRoundingEnabled && roundTime(entry.duration).isRounded && (
                                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                    {roundTime(entry.duration).formattedDifference}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col items-end gap-1" style={{ fontFamily: 'var(--font-mono)' }}>
                            {/* Recorded time - showing rounded time, edit icon on LEFT, using accent color */}
                            <InlineTimeEditor
                                value={isRoundingEnabled && roundTime(entry.duration).isRounded ? roundTime(entry.duration).rounded : entry.duration}
                                onChange={handleDurationChange}
                                formatTime={formatTime}
                            />
                        </div>
                    </div>

                    {/* Assignment Section */}
                    <div className="p-4 border-b" style={{ borderColor: 'var(--color-border-secondary)' }}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <label className="text-xs uppercase font-semibold" style={{ color: 'var(--color-text-secondary)', letterSpacing: 'var(--tracking-wider)' }}>Bucket</label>
                                {entry.assignmentAutoSelected && currentAssignment && (
                                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                            <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                            <path d="M12 18v4"/>
                                            <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                            <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                        </svg>
                                        AI Selected
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        if (entry.description) {
                                            await autoAssignWork(entry.description, {
                                                technologies: entry.detectedTechnologies,
                                                activities: entry.detectedActivities
                                            }, true);
                                        }
                                    }}
                                    disabled={isAssigningBucket || !entry.description}
                                    className="px-2.5 py-1 text-white text-xs rounded-md transition-all hover:scale-105 active:scale-95 flex items-center gap-1 disabled:cursor-not-allowed"
                                    style={{
                                        backgroundColor: isAssigningBucket || !entry.description ? '#9CA3AF' : 'var(--color-surface-dark)',
                                        opacity: 1,
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isAssigningBucket && entry.description) {
                                            e.currentTarget.style.backgroundColor = '#1a1919';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isAssigningBucket && entry.description) {
                                            e.currentTarget.style.backgroundColor = 'var(--color-surface-dark)';
                                        }
                                    }}
                                    title="AI assign bucket"
                                >
                                    {isAssigningBucket ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                            <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                            <path d="M12 18v4"/>
                                            <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                            <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                        </svg>
                                    )}
                                    {isAssigningBucket ? 'Assigning...' : 'Assign'}
                                </button>
                            </div>
                        </div>
                        <AssignmentPicker
                            value={currentAssignment}
                            onChange={(assignment) => handleAssignmentChange(assignment, false)}
                            placeholder="Select assignment..."
                            className="w-full"
                        />
                    </div>

                    {/* Tempo Account Section - Only visible when Jira assignment + Tempo enabled */}
                    {currentAssignment?.type === 'jira' && settings.tempo?.enabled && (
                        <div className="p-4 border-b" style={{ borderColor: 'var(--color-border-secondary)' }}>
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <label className="text-xs uppercase font-semibold" style={{ color: 'var(--color-text-secondary)', letterSpacing: 'var(--tracking-wider)' }}>
                                        Tempo Account
                                    </label>
                                    {entry.tempoAccountAutoSelected && entry.tempoAccount && (
                                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                                <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                                <path d="M12 18v4"/>
                                                <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                                <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                            </svg>
                                            AI Selected
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={async () => {
                                            if (currentAssignment?.type === 'jira' && currentAssignment.jiraIssue && availableAccounts.length > 0) {
                                                await autoSelectTempoAccount(currentAssignment.jiraIssue, availableAccounts, true);
                                            }
                                        }}
                                        className="px-2.5 py-1 text-white text-xs rounded-md transition-all hover:scale-105 active:scale-95 flex items-center gap-1 disabled:cursor-not-allowed"
                                        style={{
                                            backgroundColor: isAssigningTempoAccount || !currentAssignment?.jiraIssue || availableAccounts.length === 0 ? '#9CA3AF' : 'var(--color-surface-dark)',
                                            opacity: 1,
                                            transitionDuration: 'var(--duration-fast)',
                                            transitionTimingFunction: 'var(--ease-out)'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isAssigningTempoAccount && currentAssignment?.jiraIssue && availableAccounts.length > 0) {
                                                e.currentTarget.style.backgroundColor = '#1a1919';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isAssigningTempoAccount && currentAssignment?.jiraIssue && availableAccounts.length > 0) {
                                                e.currentTarget.style.backgroundColor = 'var(--color-surface-dark)';
                                            }
                                        }}
                                        title="AI assign tempo account"
                                        disabled={isAssigningTempoAccount || !currentAssignment?.jiraIssue || availableAccounts.length === 0}
                                    >
                                        {isAssigningTempoAccount ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                                                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                                <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                                <path d="M12 18v4"/>
                                                <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                                <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                            </svg>
                                        )}
                                        {isAssigningTempoAccount ? 'Assigning...' : 'Assign'}
                                    </button>
                                    {entry.tempoAccount && (
                                        <button
                                            onClick={() => setShowAccountPicker(true)}
                                            className="px-2 py-1 text-xs rounded transition-all active:scale-95 border"
                                            style={{
                                                backgroundColor: 'var(--color-bg-primary)',
                                                color: 'var(--color-text-secondary)',
                                                borderColor: 'var(--color-border-primary)',
                                                transitionDuration: 'var(--duration-fast)',
                                                transitionTimingFunction: 'var(--ease-out)'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                                                e.currentTarget.style.color = 'var(--color-text-primary)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                                            }}
                                        >
                                            Change
                                        </button>
                                    )}
                                </div>
                            </div>

                            {isLoadingAccounts ? (
                                <div className="flex items-center gap-2 text-sm py-2" style={{ color: 'var(--color-text-secondary)' }}>
                                    <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-text-secondary)', borderTopColor: 'transparent' }}></div>
                                    <span>Loading accounts...</span>
                                </div>
                            ) : availableAccounts.length === 0 ? (
                                <div className="text-sm py-2" style={{ color: 'var(--color-text-tertiary)' }}>
                                    No accounts available for this issue
                                </div>
                            ) : entry.tempoAccount ? (
                                <div className="border rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-primary)', borderColor: 'var(--color-border-primary)' }}>
                                    <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                                        {entry.tempoAccount.name}
                                    </div>
                                    <div className="text-xs font-mono" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                        {entry.tempoAccount.key}
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowAccountPicker(true)}
                                    className="w-full border text-sm rounded-lg px-3 py-2 text-left transition-all"
                                    style={{
                                        backgroundColor: 'var(--color-bg-primary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-secondary)',
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.color = 'var(--color-text-primary)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }}
                                >
                                    Select account...
                                </button>
                            )}
                        </div>
                    )}

                    {/* Description Section */}
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <label className="text-xs uppercase font-semibold" style={{ color: 'var(--color-text-secondary)', letterSpacing: 'var(--tracking-wider)' }}>Description</label>
                                {entry.description && entry.descriptionAutoGenerated && (
                                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                            <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                            <path d="M12 18v4"/>
                                            <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                            <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                        </svg>
                                        AI Generated
                                    </span>
                                )}
                                {totalAnalyzing > 0 && (
                                    <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border animate-pulse" style={{ backgroundColor: 'rgba(255, 72, 0, 0.1)', color: 'var(--color-accent)', borderColor: 'rgba(255, 72, 0, 0.3)' }}>
                                        <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span>{totalAnalyzing} analyzing</span>
                                    </div>
                                )}
                            </div>
                            {/* Show Generate button when there's window activity (screenshots optional) */}
                            {(entry.windowActivity && entry.windowActivity.length > 0) && (
                                <button
                                    onClick={() => handleGenerateSummary(true)}
                                    disabled={isGeneratingSummary}
                                    className="px-2.5 py-1 text-white text-xs rounded-md transition-all hover:scale-105 active:scale-95 flex items-center gap-1 disabled:cursor-not-allowed"
                                    style={{
                                        backgroundColor: isGeneratingSummary ? '#9CA3AF' : 'var(--color-surface-dark)',
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)',
                                        opacity: 1
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isGeneratingSummary) {
                                            e.currentTarget.style.backgroundColor = '#1a1919';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isGeneratingSummary) {
                                            e.currentTarget.style.backgroundColor = 'var(--color-surface-dark)';
                                        }
                                    }}
                                >
                                    {isGeneratingSummary ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                                <path d="M15 13a4.5 4.5 0 0 1-3 4 4.5 4.5 0 0 1-3-4"/>
                                                <path d="M12 18v4"/>
                                                <path d="M8.5 4.5a2.5 2.5 0 0 0-2.5 2.5"/>
                                                <path d="M15.5 4.5a2.5 2.5 0 0 1 2.5 2.5"/>
                                            </svg>
                                            Generate
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a description for this time entry..."
                            className="w-full border text-sm rounded-lg px-3 py-2 focus:outline-none resize-none transition-all"
                            style={{
                                backgroundColor: 'var(--color-bg-primary)',
                                borderColor: 'var(--color-border-primary)',
                                color: 'var(--color-text-primary)',
                                fontFamily: 'var(--font-body)',
                            }}
                            onMouseEnter={(e) => {
                                if (document.activeElement !== e.currentTarget) {
                                    e.currentTarget.style.borderColor = '#8c877d';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (document.activeElement !== e.currentTarget) {
                                    e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                }
                            }}
                            onFocus={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-accent)';
                                e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                            }}
                            onBlur={(e) => {
                                e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                            rows={5}
                        />
                    </div>
                </div>

                {/* Window Activity - Grouped by App */}
                <div className="mt-6">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>Window Activity</h3>
                        <div className="flex items-center gap-2">
                            {/* Retry AI Analysis button - only shows when there are failed analyses */}
                            {hasFailedAnalyses && (
                                <button
                                    onClick={handleRetryAIAnalysis}
                                    disabled={isRetryingAnalysis}
                                    className="px-3 py-1 text-xs rounded-lg transition-all flex items-center gap-1 border"
                                    style={{
                                        backgroundColor: isRetryingAnalysis ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: isRetryingAnalysis ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                                        cursor: isRetryingAnalysis ? 'not-allowed' : 'pointer',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isRetryingAnalysis) {
                                            e.currentTarget.style.borderColor = 'var(--color-accent)';
                                            e.currentTarget.style.color = 'var(--color-accent)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isRetryingAnalysis) {
                                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            e.currentTarget.style.color = 'var(--color-text-secondary)';
                                        }
                                    }}
                                    title={`${getFailedAnalysisScreenshots.length} screenshot${getFailedAnalysisScreenshots.length !== 1 ? 's' : ''} with failed analysis`}
                                >
                                    {isRetryingAnalysis ? (
                                        <>
                                            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                            </svg>
                                            {retryProgress ? `${retryProgress.completed}/${retryProgress.total}` : 'Retrying...'}
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                                                <path d="M21 3v5h-5" />
                                                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                                                <path d="M8 16H3v5" />
                                            </svg>
                                            Retry AI Analysis ({getFailedAnalysisScreenshots.length})
                                        </>
                                    )}
                                </button>
                            )}
                            <button
                                onClick={() => setShowManualEntryForm(!showManualEntryForm)}
                                className="px-3 py-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs rounded-lg transition-all flex items-center gap-1"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                                Add Manual Entry
                            </button>
                        </div>
                    </div>
                {/* Manual Entry Form */}
                {showManualEntryForm && (
                    <div className="rounded-lg p-4 border mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)' }}>
                        <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Add Manual Entry</h4>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>Description</label>
                                <input
                                    type="text"
                                    value={manualDescription}
                                    onChange={(e) => setManualDescription(e.target.value)}
                                    placeholder="Enter activity description..."
                                    className="w-full border text-sm rounded px-3 py-2 focus:outline-none transition-all"
                                    style={{
                                        backgroundColor: 'var(--color-bg-primary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (document.activeElement !== e.currentTarget) {
                                            e.currentTarget.style.borderColor = '#8c877d';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (document.activeElement !== e.currentTarget) {
                                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        }
                                    }}
                                    onFocus={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                                    }}
                                    onBlur={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                />
                            </div>
                            <div>
                                <label className="block text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>Duration</label>
                                <input
                                    type="text"
                                    value={manualDuration}
                                    onChange={(e) => setManualDuration(e.target.value)}
                                    placeholder="e.g. 30m, 1h 30m, 90"
                                    className="w-full border text-sm rounded px-3 py-2 focus:outline-none transition-all"
                                    style={{
                                        backgroundColor: 'var(--color-bg-primary)',
                                        borderColor: 'var(--color-border-primary)',
                                        color: 'var(--color-text-primary)',
                                        fontFamily: 'var(--font-mono)',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (document.activeElement !== e.currentTarget) {
                                            e.currentTarget.style.borderColor = '#8c877d';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (document.activeElement !== e.currentTarget) {
                                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        }
                                    }}
                                    onFocus={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                                    }}
                                    onBlur={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                />
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button
                                    onClick={() => {
                                        setShowManualEntryForm(false);
                                        setManualDescription('');
                                        setManualDuration('');
                                    }}
                                    className="px-3 py-1.5 text-sm transition-all active:scale-95 border rounded"
                                    style={{
                                        color: 'var(--color-text-secondary)',
                                        backgroundColor: 'var(--color-bg-primary)',
                                        borderColor: 'var(--color-border-primary)',
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.color = 'var(--color-text-primary)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddManualEntry}
                                    disabled={!manualDescription.trim() || !manualDuration.trim()}
                                    className="px-3 py-1.5 text-white text-sm rounded transition-all active:scale-95 disabled:cursor-not-allowed"
                                    style={{
                                        backgroundColor: (!manualDescription.trim() || !manualDuration.trim()) ? '#9CA3AF' : 'var(--color-accent)',
                                        opacity: 1,
                                        transitionDuration: 'var(--duration-fast)',
                                        transitionTimingFunction: 'var(--ease-out)'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (manualDescription.trim() && manualDuration.trim()) {
                                            e.currentTarget.style.backgroundColor = '#E64000';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (manualDescription.trim() && manualDuration.trim()) {
                                            e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                                        }
                                    }}
                                >
                                    Add Entry
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {appGroups.length === 0 ? (
                    <div className="text-sm py-8 text-center animate-fade-in" style={{ color: 'var(--color-text-tertiary)' }}>
                        <svg className="w-12 h-12 mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p>No window activity recorded for this session</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Click "Add Manual Entry" to add time manually</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {appGroups.map(group => {
                            const isExpanded = expandedApps.has(group.appName);
                            const icon = appIcons.get(group.appName);

                            return (
                                <div key={group.appName} className="border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)' }}>
                                    {/* App Header */}
                                    <button
                                        onClick={() => toggleApp(group.appName)}
                                        className="w-full flex items-center justify-between p-3 transition-all"
                                        data-hoverable
                                        data-default-bg="transparent"
                                        data-default-border=""
                                        data-hover-bg="#FAF5EE"
                                        style={{
                                            transitionDuration: 'var(--duration-fast)',
                                            transitionTimingFunction: 'var(--ease-out)',
                                            backgroundColor: 'transparent'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = '#FAF5EE';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="flex-shrink-0 transition-transform"
                                                style={{ color: 'var(--color-text-secondary)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--duration-base) var(--ease-out)' }}
                                            >
                                                <polyline points="9 18 15 12 9 6" />
                                            </svg>
                                            {group.appName === 'Manual Entry' ? (
                                                <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-accent)' }}>
                                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                                    </svg>
                                                </div>
                                            ) : icon ? (
                                                <img
                                                    src={icon}
                                                    alt={group.appName}
                                                    className="w-6 h-6 rounded flex-shrink-0"
                                                    onError={(e) => {
                                                        console.error(`[Renderer] Failed to load icon image for ${group.appName}`);
                                                        e.currentTarget.style.display = 'none';
                                                    }}
                                                    onLoad={() => {
                                                        console.log(`[Renderer] Successfully loaded icon for ${group.appName}`);
                                                    }}
                                                />
                                            ) : (
                                                <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}>
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                        <line x1="9" y1="3" x2="9" y2="21" />
                                                    </svg>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{group.appName}</div>
                                                <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                                    {group.activities.length} {group.activities.length === 1 ? 'activity' : 'activities'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 ml-4">
                                            <div className="font-mono font-bold" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>
                                                {formatTime(group.totalDuration)}
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCreateEntryFromApp(group.appName);
                                                }}
                                                className="p-1.5 rounded-lg transition-all active:scale-95"
                                                style={{
                                                    color: 'var(--color-text-secondary)',
                                                    transitionDuration: 'var(--duration-fast)',
                                                    transitionTimingFunction: 'var(--ease-out)'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.stopPropagation();
                                                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                    if (parent) {
                                                        parent.style.backgroundColor = parent.dataset.defaultBg || '';
                                                    }
                                                    e.currentTarget.style.backgroundColor = '#FAF5EE';
                                                    e.currentTarget.style.color = 'var(--color-text-primary)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.stopPropagation();
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                                                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                    if (parent && parent.contains(e.relatedTarget as Node)) {
                                                        parent.style.backgroundColor = parent.dataset.hoverBg || '#FAF5EE';
                                                    }
                                                }}
                                                title="Create new entry from all activities in this app"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="12" cy="18" r="3"/>
                                                    <circle cx="6" cy="6" r="3"/>
                                                    <circle cx="18" cy="6" r="3"/>
                                                    <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
                                                    <path d="M12 12v3"/>
                                                </svg>
                                            </button>
                                            <DeleteButton
                                                onDelete={() => handleDeleteApp(group.appName)}
                                                confirmMessage={`Delete all ${group.appName} activities?`}
                                                size="sm"
                                                variant="subtle"
                                            />
                                        </div>
                                    </button>

                                    {/* Activities List */}
                                    {isExpanded && (
                                        <div className="border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                                            {group.activities.map((activity, index) => {
                                                const activityKey = `${activity.timestamp}-${activity.appName}-${index}`;
                                                return (
                                                <div
                                                    key={`${activity.timestamp}-${index}`}
                                                    ref={(el) => {
                                                        if (el) {
                                                            activityRowRefs.current.set(activityKey, el);
                                                        } else {
                                                            activityRowRefs.current.delete(activityKey);
                                                        }
                                                    }}
                                                    className="p-3 border-b last:border-b-0 transition-colors"
                                                    data-hoverable
                                                    data-default-bg="transparent"
                                                    data-default-border=""
                                                    data-hover-bg="#FAF5EE"
                                                    style={{
                                                        borderColor: 'var(--color-border-primary)',
                                                        backgroundColor: 'transparent',
                                                        transitionDuration: 'var(--duration-fast)',
                                                        transitionTimingFunction: 'var(--ease-out)'
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#FAF5EE'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-medium truncate mb-1" style={{ color: 'var(--color-text-primary)' }}>
                                                                {getWindowTitle(activity)}
                                                            </div>
                                                            <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                                                {new Date(activity.timestamp).toLocaleTimeString()}
                                                            </div>
                                                            {activity.screenshotPaths && activity.screenshotPaths.length > 0 && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        console.log('[HistoryDetail] Opening screenshots:', activity.screenshotPaths);

                                                                        const screenshots = activity.screenshotPaths || [];
                                                                        const resolvedWindowTitle = getWindowTitle(activity);
                                                                        const metadata = screenshots.map(path => ({
                                                                            path,
                                                                            timestamp: activity.timestamp,
                                                                            appName: activity.appName,
                                                                            windowTitle: resolvedWindowTitle,
                                                                            aiDescription: activity.screenshotDescriptions?.[path],
                                                                            rawVisionData: activity.screenshotVisionData?.[path],
                                                                            visionData: activity.screenshotVisionData?.[path] // Legacy fallback
                                                                        }));

                                                                        setSelectedScreenshots(screenshots);
                                                                        setSelectedScreenshotMetadata(metadata);
                                                                    }}
                                                                    className="text-xs mt-1 flex items-center gap-1 px-1.5 py-0.5 rounded transition-all"
                                                                    style={{
                                                                        color: 'var(--color-accent)',
                                                                        transitionDuration: 'var(--duration-fast)',
                                                                        transitionTimingFunction: 'var(--ease-out)'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        e.stopPropagation();
                                                                        const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                                        if (parent) {
                                                                            parent.style.backgroundColor = parent.dataset.defaultBg || '';
                                                                        }
                                                                        e.currentTarget.style.backgroundColor = 'var(--color-accent-muted)';
                                                                        e.currentTarget.style.color = 'var(--color-accent-light)';
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.stopPropagation();
                                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                                        e.currentTarget.style.color = 'var(--color-accent)';
                                                                        const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                                        if (parent && parent.contains(e.relatedTarget as Node)) {
                                                                            parent.style.backgroundColor = parent.dataset.hoverBg || '#FAF5EE';
                                                                        }
                                                                    }}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                                        <circle cx="8.5" cy="8.5" r="1.5" />
                                                                        <polyline points="21 15 16 10 5 21" />
                                                                    </svg>
                                                                    {activity.screenshotPaths.length} screenshot{activity.screenshotPaths.length !== 1 ? 's' : ''}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-3 ml-4">
                                                            <div className="font-mono font-bold text-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>
                                                                {formatTime(activity.duration)}
                                                            </div>
                                                            <button
                                                                onClick={() => handleCreateEntryFromActivity(
                                                                    entry.windowActivity?.findIndex(act =>
                                                                        act.timestamp === activity.timestamp &&
                                                                        act.appName === activity.appName &&
                                                                        act.windowTitle === activity.windowTitle
                                                                    ) ?? -1,
                                                                    activityKey
                                                                )}
                                                                className="p-1.5 rounded-lg transition-all active:scale-95"
                                                                style={{
                                                                    color: 'var(--color-text-secondary)',
                                                                    transitionDuration: 'var(--duration-fast)',
                                                                    transitionTimingFunction: 'var(--ease-out)'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.stopPropagation();
                                                                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                                    if (parent) {
                                                                        parent.style.backgroundColor = parent.dataset.defaultBg || '';
                                                                    }
                                                                    e.currentTarget.style.backgroundColor = '#FAF5EE';
                                                                    e.currentTarget.style.color = 'var(--color-text-primary)';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.stopPropagation();
                                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                                                                    const parent = e.currentTarget.closest('[data-hoverable]') as HTMLElement;
                                                                    if (parent && parent.contains(e.relatedTarget as Node)) {
                                                                        parent.style.backgroundColor = parent.dataset.hoverBg || '#FAF5EE';
                                                                    }
                                                                }}
                                                                title="Create new entry from this activity"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <circle cx="12" cy="18" r="3"/>
                                                                    <circle cx="6" cy="6" r="3"/>
                                                                    <circle cx="18" cy="6" r="3"/>
                                                                    <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/>
                                                                    <path d="M12 12v3"/>
                                                                </svg>
                                                            </button>
                                                            <DeleteButton
                                                                onDelete={() => handleDeleteActivity(entry.windowActivity?.findIndex(act =>
                                                                    act.timestamp === activity.timestamp &&
                                                                    act.appName === activity.appName &&
                                                                    act.windowTitle === activity.windowTitle
                                                                ) ?? -1)}
                                                                confirmMessage="Delete this activity?"
                                                                size="sm"
                                                                variant="subtle"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Pending Transcription Section - Failed transcription with retry option */}
                {entry.pendingTranscription && (
                    <div className="mt-3 rounded-lg border p-4" style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        borderColor: 'var(--color-border-primary)',
                        borderRadius: 'var(--radius-xl)',
                    }}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-tertiary)' }}>
                                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                        <line x1="12" x2="12" y1="19" y2="22"/>
                                    </svg>
                                    <h4 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                                        Audio Recording Available
                                    </h4>
                                    <span className="px-2 py-0.5 text-xs rounded" style={{
                                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                                        color: 'rgb(217, 119, 6)',
                                    }}>
                                        Transcription Failed
                                    </span>
                                </div>
                                {entry.pendingTranscription.error && (
                                    <p className="text-xs mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                                        Error: {entry.pendingTranscription.error}
                                    </p>
                                )}
                                <p className="text-xs mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                                    An audio recording was saved, but the transcription service was unavailable.
                                </p>
                                {entry.pendingTranscription.attemptedAt && (
                                    <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                        Last attempted: {new Date(entry.pendingTranscription.attemptedAt).toLocaleString()}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={handleRetryTranscription}
                                disabled={isRetryingTranscription || (transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')}
                                className="px-3 py-2 text-xs rounded-lg transition-all flex items-center gap-2 border whitespace-nowrap"
                                style={{
                                    backgroundColor: (isRetryingTranscription || (transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
                                    borderColor: 'var(--color-border-primary)',
                                    color: (isRetryingTranscription || (transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                                    cursor: (isRetryingTranscription || (transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) ? 'not-allowed' : 'pointer',
                                }}
                                onMouseEnter={(e) => {
                                    if (!isRetryingTranscription && !(transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) {
                                        e.currentTarget.style.borderColor = 'var(--color-accent)';
                                        e.currentTarget.style.color = 'var(--color-accent)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isRetryingTranscription && !(transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) {
                                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                        e.currentTarget.style.color = 'var(--color-text-secondary)';
                                    }
                                }}
                            >
                                {(isRetryingTranscription || (transcriptionProgress?.entryId === entry.id && transcriptionProgress?.status === 'transcribing')) ? (
                                    <>
                                        <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                        </svg>
                                        Transcribing...
                                    </>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                                            <path d="M21 3v5h-5" />
                                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                                            <path d="M8 16H3v5" />
                                        </svg>
                                        Retry Transcription
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Transcription Section - Displayed as an activity entry */}
                {entry.transcription && (
                    <div className="mt-3">
                        <TranscriptionActivityEntry
                            transcription={entry.transcription}
                            appIcon={(() => {
                                const meetingApp = findMeetingApp(entry.windowActivity || []);
                                return meetingApp ? appIcons.get(meetingApp.appName) : undefined;
                            })()}
                            appName={(() => {
                                const meetingApp = findMeetingApp(entry.windowActivity || []);
                                return meetingApp?.appName || 'Meeting App';
                            })()}
                            formatTime={formatTime}
                        />
                    </div>
                )}
                </div>
            </div>

            {/* Screenshot Gallery Modal */}
            {selectedScreenshots && (
                <ScreenshotGallery
                    screenshotPaths={selectedScreenshots}
                    metadata={selectedScreenshotMetadata || undefined}
                    onClose={() => {
                        setSelectedScreenshots(null);
                        setSelectedScreenshotMetadata(null);
                    }}
                    onScreenshotDeleted={handleScreenshotDeleted}
                />
            )}

            {/* Tempo Validation Modal */}
            {showTempoValidationModal && settings.tempo?.enabled && settings.tempo?.apiToken && settings.tempo?.baseUrl && settings.jira?.enabled && settings.jira?.baseUrl && settings.jira?.email && settings.jira?.apiToken && (
                <TempoValidationModal
                    entry={entry}
                    assignment={selectedAssignment}
                    buckets={buckets}
                    onClose={() => setShowTempoValidationModal(false)}
                    onSuccess={handleTempoSuccess}
                    formatTime={formatTime}
                    tempoBaseUrl={settings.tempo.baseUrl}
                    tempoApiToken={settings.tempo.apiToken}
                    jiraBaseUrl={settings.jira.baseUrl}
                    jiraEmail={settings.jira.email}
                    jiraApiToken={settings.jira.apiToken}
                    defaultDescription={description}
                />
            )}

            {/* Tempo Account Picker Modal */}
            {showAccountPicker && (
                <TempoAccountPicker
                    accounts={availableAccounts}
                    selectedAccountKey={entry.tempoAccount?.key}
                    onSelect={handleAccountSelect}
                    onClose={() => setShowAccountPicker(false)}
                />
            )}

            {/* Tempo Configuration Modal */}
            <TempoConfigModal
                isOpen={showTempoConfigModal}
                onClose={() => setShowTempoConfigModal(false)}
                currentTempoSettings={settings.tempo || { enabled: false, apiToken: '', baseUrl: 'https://api.tempo.io' }}
                onSave={(tempoSettings) => {
                    updateSettings({
                        tempo: tempoSettings,
                    });
                }}
            />

            {/* Upgrade Modal for Free Users */}
            {showUpgradeModal && (
                <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(8px)' }}>
                    <div className="rounded-xl border p-6 max-w-sm w-full mx-4 shadow-2xl" style={{ backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-primary)', borderRadius: 'var(--radius-3xl)' }}>
                        <div className="text-center">
                            {/* Lock Icon */}
                            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'rgba(255, 72, 0, 0.12)' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>

                            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>Premium Feature</h3>
                            <p className="mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                                Upgrade for Jira and Tempo integrations
                            </p>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={handleOpenUpgradeUrl}
                                    className="w-full py-3 text-white font-medium rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                                    style={{
                                        backgroundColor: 'var(--color-accent)',
                                        borderRadius: 'var(--btn-radius)'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-accent)'}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                        <polyline points="15 3 21 3 21 9"/>
                                        <line x1="10" y1="14" x2="21" y2="3"/>
                                    </svg>
                                    View Plans
                                </button>
                                <button
                                    onClick={() => setShowUpgradeModal(false)}
                                    className="w-full py-2 text-sm transition-colors"
                                    style={{ color: 'var(--color-text-secondary)' }}
                                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'}
                                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Splitting Assistant Modal */}
            {showSplittingAssistant && (
                <SplittingAssistant
                    activity={{
                        id: entry.id,
                        startTime: entry.startTime,
                        endTime: entry.startTime + entry.duration,
                        duration: entry.duration
                    }}
                    suggestions={splitSuggestions}
                    isLoading={isAnalyzingSplits}
                    onClose={() => setShowSplittingAssistant(false)}
                    onApply={handleApplySplits}
                />
            )}
        </div>
    );
}
