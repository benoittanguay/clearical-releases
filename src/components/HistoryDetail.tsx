import { useState, useEffect, useMemo, useRef } from 'react';
import type { TimeEntry, TimeBucket, WindowActivity, WorkAssignment, LinkedJiraIssue } from '../context/StorageContext';
import { ScreenshotGallery } from './ScreenshotGallery';
import { DeleteButton } from './DeleteButton';
import { AssignmentPicker } from './AssignmentPicker';
import { TempoValidationModal } from './TempoValidationModal';
import { TempoAccountPicker } from './TempoAccountPicker';
import { InlineTimeEditor } from './InlineTimeEditor';
import { useStorage } from '../context/StorageContext';
import { useSettings } from '../context/SettingsContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useToast } from '../context/ToastContext';
import { useJiraCache } from '../context/JiraCacheContext';
import { useTimeRounding } from '../hooks/useTimeRounding';
import { useScreenshotAnalysis } from '../context/ScreenshotAnalysisContext';
import { TempoService, type TempoAccount } from '../services/tempoService';
import { JiraService } from '../services/jiraService';

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
    const { settings } = useSettings();
    const { hasFeature } = useSubscription();
    const { showToast } = useToast();
    const jiraCache = useJiraCache();
    const { roundTime, isRoundingEnabled } = useTimeRounding();
    const { totalAnalyzing } = useScreenshotAnalysis();
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
    const [availableAccounts, setAvailableAccounts] = useState<TempoAccount[]>([]);
    const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
    const [showAccountPicker, setShowAccountPicker] = useState(false);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const previousAssignmentRef = useRef<WorkAssignment | null>(null);

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
                setIsLoadingAccounts(false);
            }
        };

        // Only fetch if we have a Jira assignment and Tempo is enabled
        if (selectedAssignment?.type === 'jira' && selectedAssignment.jiraIssue) {
            fetchAccountsForAssignment(selectedAssignment.jiraIssue);
        } else {
            setAvailableAccounts([]);
        }
    }, [selectedAssignment, settings.tempo, settings.jira, entry.tempoAccount]);

    // Update local state when entry changes
    useEffect(() => {
        setDescription(entry.description || '');
        setSelectedAssignment(entry.assignment ||
            (entry.linkedJiraIssue ? {
                type: 'jira' as const,
                jiraIssue: entry.linkedJiraIssue
            } : entry.bucketId ? {
                type: 'bucket' as const,
                bucket: buckets.find(b => b.id === entry.bucketId)
            } : null));
    }, [entry.id, entry.description, entry.assignment, entry.bucketId, entry.linkedJiraIssue, buckets]);

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
    const autoAssignWork = async (description: string, metadata: any) => {
        // Check if auto-assignment is enabled in settings
        const autoAssignEnabled = settings.ai?.autoAssignWork !== false;
        if (!autoAssignEnabled) {
            console.log('[HistoryDetail] Auto-assignment disabled in settings');
            return;
        }

        // Don't override existing assignment
        if (selectedAssignment) return;

        try {
            console.log('[HistoryDetail] Requesting AI assignment suggestion');

            // Get Jira issues for suggestion
            let jiraIssues: LinkedJiraIssue[] = [];
            if (settings.jira?.enabled && jiraCache) {
                try {
                    const issues = await jiraCache.getAssignedIssues();
                    jiraIssues = issues.map(issue => ({
                        key: issue.key,
                        summary: issue.fields.summary,
                        issueType: issue.fields.issuetype.name,
                        status: issue.fields.status.name,
                        projectKey: issue.fields.project.key,
                        projectName: issue.fields.project.name
                    }));
                } catch (error) {
                    console.error('[HistoryDetail] Failed to fetch Jira issues:', error);
                }
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
                    startTime: entry.startTime
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

                // Show success toast with undo action
                const assignmentName = result.suggestion.assignment.type === 'bucket'
                    ? result.suggestion.assignment.bucket?.name
                    : result.suggestion.assignment.jiraIssue?.key;

                showToast({
                    type: 'success',
                    title: 'Auto-assigned',
                    message: `Auto-assigned to ${assignmentName}`,
                    duration: 7000,
                    action: {
                        label: 'Undo',
                        onClick: () => {
                            handleAssignmentChange(previousAssignmentRef.current, false);
                        }
                    }
                });

                // Log the reason
                console.log('[HistoryDetail] Assignment reason:', result.suggestion.reason);
            } else {
                console.log('[HistoryDetail] No assignment suggestion available');
            }
        } catch (error) {
            console.error('[HistoryDetail] Auto-assignment failed:', error);
        }
    };

    // Auto-select Tempo account based on AI suggestion
    const autoSelectTempoAccount = async (issue: LinkedJiraIssue, accounts: TempoAccount[]) => {
        // Check if auto-selection is enabled in settings
        const autoSelectEnabled = settings.ai?.autoSelectAccount !== false;
        if (!autoSelectEnabled) {
            console.log('[HistoryDetail] Auto-account selection disabled in settings');
            return;
        }

        if (!settings.tempo?.enabled || accounts.length === 0) return;

        // Don't override existing tempo account selection
        if (entry.tempoAccount) return;

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
            }
        } catch (error) {
            console.error('[HistoryDetail] Auto-account selection failed:', error);
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

    const handleCreateEntryFromActivity = async (activityIndex: number) => {
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

                // Navigate back to reload the entries list with the new entry
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

    const handleOpenTempoModal = () => {
        // Check if user has premium access for Tempo
        if (!hasTempoAccess) {
            setShowUpgradeModal(true);
            return;
        }

        // Check if Tempo is configured
        if (!settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
            onNavigateToSettings();
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

    const handleOpenUpgradeUrl = () => {
        window.electron.ipcRenderer.invoke('open-external-url', 'https://clearical.io/pricing');
        setShowUpgradeModal(false);
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

    // Auto-generate description when all screenshots are analyzed
    useEffect(() => {
        // Check if auto-generation is enabled in settings
        const autoGenerateEnabled = settings.ai?.autoGenerateDescription !== false;

        if (autoGenerateEnabled &&
            !entry.description &&
            screenshotStats.total > 0 &&
            screenshotStats.analyzed === screenshotStats.total &&
            !isGeneratingSummary) {
            handleGenerateSummary(true);
        }
    }, [screenshotStats, entry.description, isGeneratingSummary, settings.ai]);

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

            entry.windowActivity.forEach(activity => {
                // Collect app names and window titles
                if (activity.appName && !appNames.includes(activity.appName)) {
                    appNames.push(activity.appName);
                }
                const resolvedTitle = getWindowTitle(activity);
                if (resolvedTitle && resolvedTitle !== '(No window title available)' && !windowTitles.includes(resolvedTitle)) {
                    windowTitles.push(resolvedTitle);
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
            // @ts-ignore
            const result = await window.electron?.ipcRenderer?.generateActivitySummary?.({
                screenshotDescriptions,
                windowTitles,
                appNames,
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
            showToast({
                type: 'error',
                title: 'Generation Failed',
                message: `Failed to generate description: ${error instanceof Error ? error.message : 'Unknown error'}`,
                duration: 7000
            });
        } finally {
            setIsGeneratingSummary(false);
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
        <div className="w-full h-full flex flex-col">
            {/* Sticky Header with Back Button and Log to Tempo Button */}
            <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-4 py-3 z-20 drag-handle">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 no-drag">
                        <button
                            onClick={onBack}
                            className="p-1.5 hover:bg-gray-800 active:bg-gray-700 rounded-lg transition-all text-gray-400 hover:text-white active:scale-95"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <h2 className="text-xl font-bold">Activity Details</h2>
                    </div>

                    {/* Log to Tempo Button - moved to header */}
                    <div className="no-drag">
                        <button
                            onClick={handleOpenTempoModal}
                            className={`px-3 py-1.5 ${hasTempoAccess ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800' : 'bg-gray-600 hover:bg-gray-500 active:bg-gray-400'} text-white text-sm rounded-lg transition-all active:scale-[0.99] flex items-center justify-center gap-1.5`}
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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

            <div className="flex-1 overflow-y-auto px-4 pb-4">
                {/* Entry Summary - Reorganized */}
                <div className="bg-gray-800/50 rounded-lg border border-gray-700">
                    {/* Time Summary Section - Start/End times and Duration counter */}
                    <div className="flex items-center justify-between p-3 border-b border-gray-700">
                        <div className="flex flex-col gap-0.5">
                            <div className="text-xs text-gray-400">
                                <span className="font-semibold">Start:</span> {new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                            <div className="text-xs text-gray-400">
                                <span className="font-semibold">End:</span> {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <InlineTimeEditor
                                value={entry.duration}
                                onChange={handleDurationChange}
                                formatTime={formatTime}
                            />
                            {isRoundingEnabled && roundTime(entry.duration).isRounded && (
                                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                    <span className="text-gray-500">{formatTime(entry.duration)}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                    <span className="text-green-400 font-semibold">{formatTime(roundTime(entry.duration).rounded)}</span>
                                    <span className="text-purple-400">({roundTime(entry.duration).formattedDifference})</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Assignment Section */}
                    <div className="p-3 border-b border-gray-700">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs text-gray-400 uppercase font-semibold">Assignment</label>
                            {entry.assignmentAutoSelected && currentAssignment && (
                                <span className="text-xs text-purple-400 flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                        <path d="M2 17l10 5 10-5"/>
                                        <path d="M2 12l10 5 10-5"/>
                                    </svg>
                                    AI Selected
                                </span>
                            )}
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
                        <div className="p-3 border-b border-gray-700">
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="text-xs text-gray-400 uppercase font-semibold">
                                    Tempo Account
                                </label>
                                {entry.tempoAccountAutoSelected && entry.tempoAccount && (
                                    <span className="text-xs text-purple-400 flex items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                            <path d="M2 17l10 5 10-5"/>
                                            <path d="M2 12l10 5 10-5"/>
                                        </svg>
                                        AI Selected
                                    </span>
                                )}
                            </div>

                            {isLoadingAccounts ? (
                                <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Loading accounts...</span>
                                </div>
                            ) : availableAccounts.length === 0 ? (
                                <div className="text-sm text-gray-500 py-2">
                                    No accounts available for this issue
                                </div>
                            ) : entry.tempoAccount ? (
                                <div className="flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        <div className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2">
                                            <div className="text-sm text-white font-medium">
                                                {entry.tempoAccount.name}
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono">
                                                {entry.tempoAccount.key}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setShowAccountPicker(true)}
                                        className="ml-2 px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300 hover:text-white rounded-md transition-all active:scale-95"
                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                    >
                                        Change
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowAccountPicker(true)}
                                    className="w-full bg-gray-700 border border-gray-600 hover:border-gray-500 active:border-gray-400 text-gray-400 hover:text-gray-300 active:text-gray-200 text-sm rounded-lg px-3 py-2 text-left transition-all"
                                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                >
                                    Select account...
                                </button>
                            )}
                        </div>
                    )}

                    {/* Description Section */}
                    <div className="p-3">
                        <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-400 uppercase font-semibold">Description</label>
                                {entry.description && entry.descriptionAutoGenerated && (
                                    <span className="text-xs text-purple-400 flex items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                            <path d="M2 17l10 5 10-5"/>
                                            <path d="M2 12l10 5 10-5"/>
                                        </svg>
                                        AI Generated
                                    </span>
                                )}
                                {screenshotStats.total > 0 && (
                                    <div className="flex items-center gap-2">
                                        <div className="text-xs text-gray-500">
                                            {screenshotStats.analyzed}/{screenshotStats.total} screenshots analyzed
                                        </div>
                                        {totalAnalyzing > 0 && (
                                            <div className="flex items-center gap-1.5 text-xs bg-blue-900/20 text-blue-300 px-2 py-1 rounded-full border border-blue-500/30 animate-pulse">
                                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                <span>{totalAnalyzing} analyzing</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            {screenshotStats.analyzed > 0 && (
                                <button
                                    onClick={() => handleGenerateSummary(false)}
                                    disabled={isGeneratingSummary}
                                    className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 active:bg-purple-800 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded-md transition-all active:scale-[0.98] flex items-center gap-1"
                                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                >
                                    {isGeneratingSummary ? (
                                        <>
                                            <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                                <path d="M2 17l10 5 10-5"/>
                                                <path d="M2 12l10 5 10-5"/>
                                            </svg>
                                            Generate Summary
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Add a description for this time entry..."
                            className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                            rows={3}
                        />
                    </div>
                </div>

                {/* Window Activity - Grouped by App */}
                <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-base font-semibold text-gray-300">Window Activity</h3>
                        <button
                            onClick={() => setShowManualEntryForm(!showManualEntryForm)}
                            className="px-2.5 py-1 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-xs rounded-md transition-all active:scale-95 flex items-center gap-1"
                            style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Manual Entry
                        </button>
                    </div>
                {/* Manual Entry Form */}
                {showManualEntryForm && (
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 mb-3">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Add Manual Entry</h4>
                        <div className="space-y-2">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Description</label>
                                <input
                                    type="text"
                                    value={manualDescription}
                                    onChange={(e) => setManualDescription(e.target.value)}
                                    placeholder="Enter activity description..."
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Duration</label>
                                <input
                                    type="text"
                                    value={manualDuration}
                                    onChange={(e) => setManualDuration(e.target.value)}
                                    placeholder="e.g. 30m, 1h 30m, 90"
                                    className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                                <button
                                    onClick={() => {
                                        setShowManualEntryForm(false);
                                        setManualDescription('');
                                        setManualDuration('');
                                    }}
                                    className="px-3 py-1 text-gray-400 hover:text-white text-sm transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddManualEntry}
                                    disabled={!manualDescription.trim() || !manualDuration.trim()}
                                    className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
                                >
                                    Add Entry
                                </button>
                            </div>
                        </div>
                    </div>
                )}


                {appGroups.length === 0 ? (
                    <div className="text-gray-500 text-sm py-6 text-center animate-fade-in">
                        <svg className="w-12 h-12 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p>No window activity recorded for this session</p>
                        <p className="text-xs text-gray-600 mt-1">Click "Add Manual Entry" to add time manually</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {appGroups.map(group => {
                            const isExpanded = expandedApps.has(group.appName);
                            const icon = appIcons.get(group.appName);

                            return (
                                <div key={group.appName} className="bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden">
                                    {/* App Header */}
                                    <button
                                        onClick={() => toggleApp(group.appName)}
                                        className="w-full flex items-center justify-between p-2.5 hover:bg-gray-800/80 active:bg-gray-800 transition-all"
                                        style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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
                                                className={`text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                                            >
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                            {group.appName === 'Manual Entry' ? (
                                                <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
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
                                                <div className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                                        <line x1="9" y1="3" x2="9" y2="21" />
                                                    </svg>
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-white truncate">{group.appName}</div>
                                                <div className="text-xs text-gray-400">
                                                    {group.activities.length} {group.activities.length === 1 ? 'activity' : 'activities'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 ml-4">
                                            <div className="font-mono text-green-400 font-bold">
                                                {formatTime(group.totalDuration)}
                                            </div>
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
                                        <div className="border-t border-gray-700">
                                            {group.activities.map((activity, index) => (
                                                <div
                                                    key={`${activity.timestamp}-${index}`}
                                                    className="p-2.5 border-b border-gray-800/50 last:border-b-0 hover:bg-gray-800/30 transition-colors"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-medium text-gray-200 truncate mb-1">
                                                                {getWindowTitle(activity)}
                                                            </div>
                                                            <div className="text-xs text-gray-500 mb-1">
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
                                                                    className="text-xs text-green-400 hover:text-green-300 active:text-green-200 mt-1 flex items-center gap-1 hover:bg-green-500/10 active:bg-green-500/20 px-1.5 py-0.5 rounded transition-all"
                                                                    style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
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
                                                        <div className="flex items-center gap-2">
                                                            <div className="font-mono text-green-400 font-semibold text-sm">
                                                                {formatTime(activity.duration)}
                                                            </div>
                                                            <button
                                                                onClick={() => handleCreateEntryFromActivity(entry.windowActivity?.findIndex(act =>
                                                                    act.timestamp === activity.timestamp &&
                                                                    act.appName === activity.appName &&
                                                                    act.windowTitle === activity.windowTitle
                                                                ) ?? -1)}
                                                                className="p-1.5 hover:bg-blue-500/20 active:bg-blue-500/30 rounded text-blue-400 hover:text-blue-300 active:text-blue-200 transition-all active:scale-95"
                                                                style={{ transitionDuration: 'var(--duration-fast)', transitionTimingFunction: 'var(--ease-out)' }}
                                                                title="Create new entry from this activity"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                                    <polyline points="7 10 12 15 17 10" />
                                                                    <line x1="12" y1="15" x2="12" y2="3" />
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
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
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

            {/* Upgrade Modal for Free Users */}
            {showUpgradeModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-sm w-full mx-4 shadow-2xl">
                        <div className="text-center">
                            {/* Lock Icon */}
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>

                            <h3 className="text-xl font-bold text-white mb-2">Premium Feature</h3>
                            <p className="text-gray-400 mb-6">
                                Upgrade for Jira and Tempo integrations
                            </p>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={handleOpenUpgradeUrl}
                                    className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
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
                                    className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
                                >
                                    Maybe Later
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
