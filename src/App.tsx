import { useState, useEffect, useRef } from 'react';
import { useTimer } from './hooks/useTimer';
import { useStorage } from './context/StorageContext';
import { useSettings } from './context/SettingsContext';
import { useAudioRecording } from './context/AudioRecordingContext';
import { analytics } from './services/analytics';
import { TempoService } from './services/tempoService';
import { JiraService } from './services/jiraService';
import { useTimeRounding } from './hooks/useTimeRounding';
import { Settings } from './components/Settings';
import { HistoryDetail } from './components/HistoryDetail';
import { ExportDialog } from './components/ExportDialog';
import { DeleteButton } from './components/DeleteButton';
import { JiraIssuesSection } from './components/JiraIssuesSection';
import { FolderTree } from './components/FolderTree';
import { CreateBucketModal } from './components/CreateBucketModal';
import { CreateFolderModal } from './components/CreateFolderModal';
import { CrawlerProgressBar } from './components/CrawlerProgressBar';
import { OnboardingModal } from './components/OnboardingModal';
import { JiraConfigModal } from './components/JiraConfigModal';
import { TempoConfigModal } from './components/TempoConfigModal';
import { UpdateNotification } from './components/UpdateNotification';
import { UpdateSuccessModal } from './components/UpdateSuccessModal';
import { PermissionRequestModal } from './components/PermissionRequestModal';
import { SplitFlapDisplay, FlipClockContainer } from './components/SplitFlapDisplay';
import { BucketDetailView } from './components/BucketDetailView';
import { JiraDetailView } from './components/JiraDetailView';
import { RecordingControls } from './components/RecordingControls';
import type { WorkAssignment, TimeBucket, LinkedJiraIssue } from './context/StorageContext';
import './App.css'

type View = 'chrono' | 'worklog' | 'buckets' | 'settings' | 'worklog-detail' | 'bucket-detail' | 'jira-detail';

function App() {
  const { buckets, entries, addEntry, addBucket, removeBucket, renameBucket, createFolder, moveBucket, updateEntry, removeEntry, unlinkJiraIssueFromBucket } = useStorage();
  const { settings, updateSettings } = useSettings();
  const [selectedAssignment, setSelectedAssignment] = useState<WorkAssignment | null>(null);
  const [currentView, setCurrentView] = useState<View>('chrono');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<TimeBucket | null>(null);
  const [selectedJiraIssue, setSelectedJiraIssue] = useState<LinkedJiraIssue | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showCreateBucketModal, setShowCreateBucketModal] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [, setMigrationComplete] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [showTempoModal, setShowTempoModal] = useState(false);
  const [showUpdateSuccessModal, setShowUpdateSuccessModal] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [bucketsTab, setBucketsTab] = useState<'buckets' | 'jira'>('buckets');
  const [jiraRefreshFn, setJiraRefreshFn] = useState<(() => void) | null>(null);
  const [isAudioRecording, setIsAudioRecording] = useState(false);

  const { isRunning, isPaused, elapsed, start: startTimer, stop: stopTimer, pause: pauseTimer, resume: resumeTimer, formatTime, checkPermissions, setActiveRecordingEntry } = useTimer();
  const { clearPendingTranscription, waitForTranscriptions, getPendingAudio, clearPendingAudio } = useAudioRecording();
  const { roundTime, isRoundingEnabled } = useTimeRounding();
  const recordingSessionIdRef = useRef<string | null>(null);
  const handleStartStopRef = useRef<() => void>(() => {});

  // Check for onboarding BEFORE migration - prevents flash of main UI
  useEffect(() => {
    const onboardingComplete = localStorage.getItem('timeportal-onboarding-complete');
    if (!onboardingComplete) {
      setShowOnboarding(true);
    }
  }, []);

  // Initialize analytics service
  useEffect(() => {
    analytics.initialize();
    analytics.refreshEnabledState();
    analytics.track('app.started');

    return () => {
      analytics.destroy();
    };
  }, []);

  // Check if we should show the update success modal
  // TEST FEATURE: To verify auto-updater is working
  // The modal will show once per version when the app detects a new version number
  // To test manually: Open DevTools Console and run: localStorage.removeItem('timeportal-last-seen-version')
  useEffect(() => {
    const checkVersion = async () => {
        try {
            // Get the actual app version from Electron
            const envInfo = await window.electron.ipcRenderer.getEnvironmentInfo();
            const currentVersion = envInfo.version;
            setAppVersion(currentVersion);

            const lastSeenVersion = localStorage.getItem('timeportal-last-seen-version');
            const onboardingComplete = localStorage.getItem('timeportal-onboarding-complete');

            // Show modal if this is a new version and onboarding is complete
            if (onboardingComplete && lastSeenVersion !== currentVersion) {
                // Try to get release notes from updater status
                try {
                    const updaterStatus = await window.electron.ipcRenderer.updater.getStatus();
                    if (updaterStatus.success && updaterStatus.status?.releaseNotes) {
                        setReleaseNotes(updaterStatus.status.releaseNotes);
                    }
                } catch {
                    // Release notes not available, that's ok
                }

                setTimeout(() => {
                    setShowUpdateSuccessModal(true);
                }, 1000);
            }
        } catch (error) {
            console.error('[App] Failed to get version info:', error);
        }
    };
    checkVersion();
  }, []);

  // Migration trigger logic - runs once on app startup
  useEffect(() => {
    const runMigration = async () => {
      try {
        console.log('[App] Checking if migration is needed...');
        const needsMigrationResult = await window.electron.ipcRenderer.db.needsMigration();

        if (needsMigrationResult.success && needsMigrationResult.needsMigration) {
          console.log('[App] Migration needed - gathering localStorage data...');

          // Gather all localStorage data
          const localStorageData: Record<string, string> = {};
          const keysToMigrate = [
            'timeportal-buckets',
            'timeportal-entries',
            'timeportal-settings',
            'jira-issues-cache',
            'jira-crawler-state'
          ];

          for (const key of keysToMigrate) {
            const value = localStorage.getItem(key);
            if (value) {
              localStorageData[key] = value;
            }
          }

          console.log('[App] Migrating data to SQLite database...');
          const migrationResult = await window.electron.ipcRenderer.db.migrateFromLocalStorage(localStorageData);

          if (migrationResult.success && migrationResult.result) {
            console.log('[App] Migration successful:', migrationResult.result);

            // Clear localStorage after successful migration
            keysToMigrate.forEach(key => localStorage.removeItem(key));
            console.log('[App] localStorage cleared');

            // Only show migration modal if actual data was migrated (not a fresh install)
            const totalMigrated =
              migrationResult.result.entriesMigrated +
              migrationResult.result.bucketsMigrated +
              migrationResult.result.jiraIssuesMigrated +
              migrationResult.result.settingsMigrated;

            if (totalMigrated > 0) {
              alert(
                `Migration Complete!\n\n` +
                `Successfully migrated to SQLite database:\n` +
                `- ${migrationResult.result.entriesMigrated} time entries\n` +
                `- ${migrationResult.result.bucketsMigrated} buckets\n` +
                `- ${migrationResult.result.jiraIssuesMigrated} Jira issues\n` +
                `- ${migrationResult.result.settingsMigrated} settings\n\n` +
                `Your data is now stored in a more robust database.`
              );
            } else {
              console.log('[App] No data to migrate - fresh install, skipping migration modal');
            }
          } else {
            console.error('[App] Migration failed:', migrationResult.error);
            alert(
              `Migration Failed!\n\n` +
              `There was an error migrating your data: ${migrationResult.error}\n\n` +
              `Your data in localStorage is preserved. Please report this issue.`
            );
          }
        } else {
          console.log('[App] No migration needed');
        }

        setMigrationComplete(true);
      } catch (error) {
        console.error('[App] Migration error:', error);
        setMigrationComplete(true);
      }
    };

    runMigration();
  }, []);

  // Clean up legacy integration modal auto-open flag
  useEffect(() => {
    // Remove the flag if it exists from previous versions
    localStorage.removeItem('timeportal-open-jira-config');
  }, []);

  // DevTools trigger for resetting onboarding
  useEffect(() => {
    // Expose reset function globally for devtools
    (window as any).__resetOnboarding = () => {
      localStorage.removeItem('timeportal-onboarding-complete');
      setShowOnboarding(true);
      console.log('[DevTools] Onboarding reset triggered');
    };

    // Keyboard shortcut: Cmd+Shift+O (or Ctrl+Shift+O on Windows/Linux)
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        localStorage.removeItem('timeportal-onboarding-complete');
        setShowOnboarding(true);
        console.log('[DevTools] Onboarding reset triggered via keyboard shortcut');
      }
    };

    window.addEventListener('keydown', handleKeyPress);

    // Cleanup
    return () => {
      delete (window as any).__resetOnboarding;
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);

  const handleCloseUpdateSuccessModal = () => {
    if (appVersion) {
        localStorage.setItem('timeportal-last-seen-version', appVersion);
    }
    setShowUpdateSuccessModal(false);
  };

  const handleBulkLogToTempo = async (dateKey?: string) => {
    if (!dateKey) return;

    // Check if Tempo is configured
    if (!settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
      setCurrentView('settings');
      return;
    }

    // Check if Jira is configured (required for Tempo)
    if (!settings.jira?.enabled || !settings.jira?.apiToken || !settings.jira?.baseUrl || !settings.jira?.email) {
      alert('Please configure Jira settings first. Jira credentials are required to log time to Tempo.');
      setCurrentView('settings');
      return;
    }

    // Parse the key to determine date range
    const keyTimestamp = parseInt(dateKey);
    const keyDate = new Date(keyTimestamp);

    // Determine if this is a week key by checking if it's a Monday (week start)
    // Note: getWeekStart() returns Monday, not Sunday
    const isWeekKey = keyDate.getDay() === 1;

    // Calculate the date range to filter entries
    let startDate: Date, endDate: Date;
    if (isWeekKey) {
      startDate = new Date(keyTimestamp);
      endDate = new Date(keyTimestamp);
      endDate.setDate(endDate.getDate() + 7); // Week is 7 days
    } else {
      startDate = new Date(keyTimestamp);
      endDate = new Date(keyTimestamp);
      endDate.setDate(endDate.getDate() + 1); // Single day
    }

    // Filter entries in the date range
    const entriesInRange = entries.filter(entry => {
      const entryDate = new Date(entry.startTime);
      entryDate.setHours(0, 0, 0, 0);
      return entryDate >= startDate && entryDate < endDate;
    });

    // Categorize entries
    const entriesToLog: typeof entries = [];
    const entriesWithoutAccount: typeof entries = [];

    entriesInRange.forEach(entry => {
      // Get Jira key from assignment
      const assignment = entry.assignment ||
        (entry.linkedJiraIssue ? { type: 'jira' as const, jiraIssue: entry.linkedJiraIssue } : null);

      const hasJiraIssue = assignment?.type === 'jira' && assignment.jiraIssue;

      if (hasJiraIssue && entry.tempoAccount?.key) {
        entriesToLog.push(entry);
      } else if (hasJiraIssue && !entry.tempoAccount?.key) {
        entriesWithoutAccount.push(entry);
      }
      // Entries without Jira issue are silently ignored
    });

    if (entriesToLog.length === 0) {
      if (entriesWithoutAccount.length > 0) {
        alert(
          `No entries could be logged.\n\n` +
          `${entriesWithoutAccount.length} ${entriesWithoutAccount.length === 1 ? 'entry has' : 'entries have'} a Jira issue but no Tempo account assigned.\n\n` +
          `Please assign a Tempo account to each entry before bulk logging.`
        );
      } else {
        alert('No entries with Jira issues found in this time period.');
      }
      return;
    }

    // Build detailed confirmation message based on granularity
    let confirmMessage: string;

    if (isWeekKey) {
      // Week view: show days with entry counts
      const entriesByDay = new Map<string, typeof entriesToLog>();
      entriesToLog.forEach(entry => {
        const entryDate = new Date(entry.startTime);
        const dayLabel = entryDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        if (!entriesByDay.has(dayLabel)) {
          entriesByDay.set(dayLabel, []);
        }
        entriesByDay.get(dayLabel)!.push(entry);
      });

      const dayLines = Array.from(entriesByDay.entries())
        .map(([day, dayEntries]) => `• ${day}: ${dayEntries.length} ${dayEntries.length === 1 ? 'entry' : 'entries'}`)
        .join('\n');

      confirmMessage = `Log ${entriesToLog.length} ${entriesToLog.length === 1 ? 'entry' : 'entries'} to Tempo?\n\n${dayLines}`;
    } else {
      // Day view: show each entry
      const entryLines = entriesToLog
        .map(entry => {
          const assignment = entry.assignment ||
            (entry.linkedJiraIssue ? { type: 'jira' as const, jiraIssue: entry.linkedJiraIssue } : null);
          const jiraKey = assignment?.type === 'jira' ? assignment.jiraIssue?.key : 'Unknown';
          const duration = isRoundingEnabled ? roundTime(entry.duration).rounded : entry.duration;
          return `• ${jiraKey}: ${formatTime(duration)}`;
        })
        .join('\n');

      confirmMessage = `Log ${entriesToLog.length} ${entriesToLog.length === 1 ? 'entry' : 'entries'} to Tempo?\n\n${entryLines}`;
    }

    if (entriesWithoutAccount.length > 0) {
      confirmMessage += `\n\n⚠️ ${entriesWithoutAccount.length} ${entriesWithoutAccount.length === 1 ? 'entry' : 'entries'} will be skipped (no Tempo account assigned).`;
    }

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // Initialize services
      const tempoService = new TempoService(settings.tempo.baseUrl, settings.tempo.apiToken);
      const jiraService = new JiraService(settings.jira.baseUrl, settings.jira.email, settings.jira.apiToken);

      // Get current user's account ID (required by Tempo API)
      const currentUser = await jiraService.getCurrentUser();

      let successCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      // Log each entry
      for (const entry of entriesToLog) {
        try {
          const assignment = entry.assignment ||
            (entry.linkedJiraIssue ? { type: 'jira' as const, jiraIssue: entry.linkedJiraIssue } : null);

          const jiraKey = assignment?.type === 'jira' ? assignment.jiraIssue?.key : null;
          if (!jiraKey || !entry.tempoAccount?.key) continue;

          // Get numeric issue ID from Jira
          const issueId = await jiraService.getIssueIdFromKey(jiraKey);
          const numericIssueId = parseInt(issueId, 10);
          if (isNaN(numericIssueId) || numericIssueId <= 0) {
            throw new Error(`Invalid issue ID for ${jiraKey}`);
          }

          // Calculate duration (respect rounding settings)
          const durationToLog = isRoundingEnabled ? roundTime(entry.duration).rounded : entry.duration;

          // Create worklog
          const worklog = {
            issueId: numericIssueId,
            timeSpentSeconds: TempoService.durationMsToSeconds(durationToLog),
            startDate: TempoService.formatDate(entry.startTime),
            startTime: TempoService.formatTime(entry.startTime),
            description: entry.description?.trim() || `Time logged from Clearical for ${formatTime(durationToLog)}`,
            authorAccountId: currentUser.accountId,
            attributes: [
              {
                key: '_Account_',
                value: entry.tempoAccount.key
              }
            ],
          };

          await tempoService.createWorklog(worklog);
          successCount++;
        } catch (error) {
          failedCount++;
          const jiraKey = entry.assignment?.type === 'jira'
            ? entry.assignment.jiraIssue?.key
            : entry.linkedJiraIssue?.key;
          errors.push(`${jiraKey || 'Unknown'}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Show results
      let resultMessage = `Logged ${successCount} of ${entriesToLog.length} ${entriesToLog.length === 1 ? 'entry' : 'entries'} to Tempo.`;

      if (failedCount > 0) {
        resultMessage += `\n\n${failedCount} ${failedCount === 1 ? 'entry' : 'entries'} failed to log:\n${errors.slice(0, 5).join('\n')}`;
        if (errors.length > 5) {
          resultMessage += `\n... and ${errors.length - 5} more`;
        }
      }

      if (entriesWithoutAccount.length > 0) {
        resultMessage += `\n\n${entriesWithoutAccount.length} ${entriesWithoutAccount.length === 1 ? 'entry was' : 'entries were'} skipped (no Tempo account assigned).`;
      }

      alert(resultMessage);
    } catch (error) {
      console.error('Bulk log to Tempo failed:', error);
      alert(`Failed to log to Tempo: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCreateBucket = (name: string, color: string, parentId?: string | null) => {
    addBucket(name, color, parentId || null);
  };

  const handleCreateFolder = (name: string, parentId?: string | null) => {
    createFolder(name, parentId || null);
  };

  const handleStartStop = async () => {
    if (!isRunning) {
      // Check permissions before starting
      const permissions = await checkPermissions();

      // Show permission modal if ANY permission is missing (prompt once per recording)
      if (!permissions.requiredGranted || !permissions.hasScreenRecording) {
        setShowPermissionModal(true);
        return;
      }

      // Start timer fresh (elapsed should be 0)
      startTimer();

      // Notify recording manager of active session for mic/camera recording
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      recordingSessionIdRef.current = sessionId;
      setActiveRecordingEntry(sessionId);
      setIsAudioRecording(true);
    } else {
      try {
        // Set stopping state to show loading UI
        setIsStopping(true);

        // Get the session ID before clearing
        const sessionId = recordingSessionIdRef.current;

        // Clear recording session - must happen before stopTimer for proper cleanup
        setActiveRecordingEntry(null);
        recordingSessionIdRef.current = null;
        setIsAudioRecording(false);

        // Stop timer and save entry - await to ensure AI analyses complete
        const finalActivity = await stopTimer();

        // Wait for any pending transcriptions from the recording session (with timeout)
        // This handles the race condition where transcription may still be in progress
        // Each recording is stored separately for better navigation
        console.log('[App] Waiting for transcription to complete (if recording was active)...');
        const pendingTranscriptions = sessionId ? await waitForTranscriptions(sessionId, 15000) : [];
        if (pendingTranscriptions.length > 0) {
          console.log('[App] Found', pendingTranscriptions.length, 'transcription(s) from recording session');
        } else {
          console.log('[App] No transcription available (no recording or timed out)');
        }

        // Check for pending audio (failed transcription)
        const pendingAudio = sessionId ? getPendingAudio(sessionId) : null;
        if (pendingAudio) {
          console.log('[App] Found pending audio from failed transcription:', pendingAudio.audioPath);
        }

        const newEntry = await addEntry({
          startTime: Date.now() - elapsed,
          endTime: Date.now(),
          duration: elapsed,
          assignment: selectedAssignment || undefined,
          windowActivity: finalActivity,
          // Store transcriptions as array for separate display
          transcriptions: pendingTranscriptions.length > 0 ? pendingTranscriptions : undefined,
          // Keep legacy field for backwards compatibility
          transcription: pendingTranscriptions.length === 1 ? pendingTranscriptions[0] : undefined,
          pendingTranscription: pendingAudio || undefined,
        });

        // Clear the pending transcription after it's been applied
        if (sessionId && pendingTranscriptions.length > 0) {
          clearPendingTranscription(sessionId);
        }

        // Clear the pending audio after it's been saved to entry
        if (sessionId && pendingAudio) {
          clearPendingAudio(sessionId);
        }

        console.log('[App] Activity saved, navigating to details for entry:', newEntry.id);

        // Navigate to the Activity Details view for the new entry
        // Use setTimeout to ensure state update completes before navigation
        setSelectedEntry(newEntry.id);
        setCurrentView('worklog-detail');

        // Navigation happens immediately, but the worklog-detail view will show
        // a loading state until the entry appears in the entries array
      } catch (error) {
        console.error('[App] Error stopping timer:', error);
        alert('Failed to save activity. Please try again.');
      } finally {
        // Reset stopping state
        setIsStopping(false);
      }
    }
  };

  // Keep ref updated with latest handleStartStop
  handleStartStopRef.current = handleStartStop;

  const handlePermissionsGranted = () => {
    // Permissions are now granted, start the timer
    startTimer();

    // Notify recording manager of active session for mic/camera recording
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    recordingSessionIdRef.current = sessionId;
    setActiveRecordingEntry(sessionId);
    setIsAudioRecording(true);
  };

  const handlePauseResume = () => {
    if (isPaused) {
      resumeTimer();
    } else {
      pauseTimer();
    }
  };

  // Toggle audio recording independently of timer
  const handleToggleRecording = () => {
    if (recordingSessionIdRef.current) {
      // Stop recording
      console.log('[App] Stopping recording from controls');
      setActiveRecordingEntry(null);
      recordingSessionIdRef.current = null;
      setIsAudioRecording(false);
    } else if (isRunning) {
      // Start recording (only when timer is running)
      console.log('[App] Starting recording from controls');
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      recordingSessionIdRef.current = sessionId;
      setActiveRecordingEntry(sessionId);
      setIsAudioRecording(true);
    }
  };

  useEffect(() => {
    // Check if Electron bridge is available
    // @ts-ignore
    if (window.electron) {
      console.log('[Renderer] Sending ping...');
      // @ts-ignore
      window.electron.ipcRenderer.send('ping', null);
    } else {
      console.error('[Renderer] window.electron is UNDEFINED');
    }

    // If selectedAssignment references a deleted bucket, reset to first available
    if (selectedAssignment?.type === 'bucket' && selectedAssignment.bucket &&
        buckets.length > 0 && !buckets.find(b => b.id === selectedAssignment.bucket!.id)) {
      setSelectedAssignment({
        type: 'bucket',
        bucket: {
          id: buckets[0].id,
          name: buckets[0].name,
          color: buckets[0].color
        }
      });
    }
  }, [buckets, selectedAssignment]);

  // Listen for window opened from tray and navigate to chrono if timer is running
  useEffect(() => {
    // @ts-ignore
    if (window.electron?.ipcRenderer?.on) {
      console.log('[Renderer] Setting up tray-open listener');
      // @ts-ignore
      const unsubscribe = window.electron.ipcRenderer.on('window-opened-from-tray', () => {
        console.log('[Renderer] Window opened from tray, isRunning:', isRunning);
        if (isRunning) {
          console.log('[Renderer] Timer is running, navigating to chrono page');
          setCurrentView('chrono');
        }
      });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [isRunning]);

  // Listen for tray menu commands
  useEffect(() => {
    // @ts-ignore
    if (window.electron?.ipcRenderer?.on) {
      console.log('[Renderer] Setting up tray command listeners');

      // @ts-ignore
      const unsubscribeChrono = window.electron.ipcRenderer.on('tray:toggle-chrono', () => {
        console.log('[Renderer] Tray toggle chrono command received');
        handleStartStopRef.current();
      });

      // @ts-ignore
      const unsubscribeRecording = window.electron.ipcRenderer.on('tray:toggle-recording', async () => {
        console.log('[Renderer] Tray toggle recording command received');
        // Toggle recording state
        if (recordingSessionIdRef.current) {
          // Stop recording
          setActiveRecordingEntry(null);
          recordingSessionIdRef.current = null;
          setIsAudioRecording(false);
        } else {
          // Start recording - also start timer if not running (same as widget prompt)
          if (!isRunning) {
            console.log('[Renderer] Timer not running, starting timer first');
            // Check permissions before starting
            const permissions = await checkPermissions();
            if (!permissions.requiredGranted || !permissions.hasScreenRecording) {
              console.log('[Renderer] Missing permissions, showing modal');
              setShowPermissionModal(true);
              return;
            }
            // Start timer
            startTimer();
          }
          // Start recording session
          const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          recordingSessionIdRef.current = sessionId;
          setActiveRecordingEntry(sessionId);
          setIsAudioRecording(true);
        }
      });

      return () => {
        if (unsubscribeChrono) unsubscribeChrono();
        if (unsubscribeRecording) unsubscribeRecording();
      };
    }
  }, [setActiveRecordingEntry, isRunning, checkPermissions, startTimer]);

  // Listen for widget prompt to start timer (meeting detected but timer not running)
  useEffect(() => {
    // @ts-ignore
    if (window.electron?.ipcRenderer?.on) {
      console.log('[Renderer] Setting up meeting:request-start-timer listener');

      // @ts-ignore
      const unsubscribe = window.electron.ipcRenderer.on('meeting:request-start-timer', async (data: { meetingApp: { appName: string; bundleId: string } | null; timestamp: number }) => {
        console.log('[Renderer] Received request-start-timer from widget prompt:', data);

        // Don't start if timer is already running
        if (isRunning) {
          console.log('[Renderer] Timer already running, ignoring request');
          return;
        }

        // Check permissions before starting
        const permissions = await checkPermissions();

        // Show permission modal if ANY permission is missing
        if (!permissions.requiredGranted || !permissions.hasScreenRecording) {
          console.log('[Renderer] Missing permissions, showing modal');
          setShowPermissionModal(true);
          return;
        }

        // Start timer
        console.log('[Renderer] Starting timer from widget prompt');
        startTimer();

        // Notify recording manager of active session for mic/camera recording
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        recordingSessionIdRef.current = sessionId;
        setActiveRecordingEntry(sessionId);
        setIsAudioRecording(true);

        // Navigate to chrono view
        setCurrentView('chrono');
      });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [isRunning, checkPermissions, startTimer, setActiveRecordingEntry]);

  return (
    <div className="flex h-screen overflow-hidden font-sans w-full flex-col" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* Main app content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Dark sidebar for contrast against light content */}
        <nav
          className="flex flex-col items-center py-6 border-r z-50 drag-handle"
          style={{
            width: 'var(--sidebar-width)',
            backgroundColor: 'var(--color-surface-dark)',
            borderColor: 'var(--color-border-primary)',
          }}
        >
        {/* Logo */}
        <div className="mb-6 select-none">
          <img
            src="./icon.png"
            alt="Clearical"
            className="w-10 h-10 rounded-lg"
            style={{
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          />
        </div>

        {/* Navigation Items */}
        <div className="flex flex-col gap-4 w-full items-center no-drag">
          {/* Chrono */}
          <button
            onClick={() => setCurrentView('chrono')}
            className="flex flex-col items-center gap-1.5 group w-full px-4 relative"
            style={{
              transition: 'var(--transition-colors)',
            }}
          >
            <div
              className="p-2.5 rounded-xl relative"
              style={{
                backgroundColor: currentView === 'chrono' ? 'var(--color-accent-muted)' : 'transparent',
                color: currentView === 'chrono' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'all var(--duration-base) var(--ease-out)',
                boxShadow: currentView === 'chrono' ? 'var(--glow-accent)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {currentView === 'chrono' && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'var(--color-accent-muted)',
                    filter: 'blur(8px)',
                    zIndex: -1,
                  }}
                />
              )}
            </div>
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{
                fontFamily: 'var(--font-display)',
                color: currentView === 'chrono' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'var(--transition-colors)',
              }}
            >
              Chrono
            </span>
          </button>

          {/* Worklog */}
          <button
            onClick={() => setCurrentView('worklog')}
            className="flex flex-col items-center gap-1.5 group w-full px-4 relative"
            style={{
              transition: 'var(--transition-colors)',
            }}
          >
            <div
              className="p-2.5 rounded-xl relative"
              style={{
                backgroundColor: currentView === 'worklog' ? 'var(--color-accent-muted)' : 'transparent',
                color: currentView === 'worklog' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'all var(--duration-base) var(--ease-out)',
                boxShadow: currentView === 'worklog' ? 'var(--glow-accent)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              {currentView === 'worklog' && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'var(--color-accent-muted)',
                    filter: 'blur(8px)',
                    zIndex: -1,
                  }}
                />
              )}
            </div>
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{
                fontFamily: 'var(--font-display)',
                color: currentView === 'worklog' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'var(--transition-colors)',
              }}
            >
              Worklog
            </span>
          </button>

          {/* Buckets */}
          <button
            onClick={() => setCurrentView('buckets')}
            className="flex flex-col items-center gap-1.5 group w-full px-4 relative"
            style={{
              transition: 'var(--transition-colors)',
            }}
          >
            <div
              className="p-2.5 rounded-xl relative"
              style={{
                backgroundColor: currentView === 'buckets' ? 'var(--color-accent-muted)' : 'transparent',
                color: currentView === 'buckets' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'all var(--duration-base) var(--ease-out)',
                boxShadow: currentView === 'buckets' ? 'var(--glow-accent)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2"/>
                <path d="M2 12h20"/>
                <path d="M10 7h4"/>
                <path d="M10 16h4"/>
              </svg>
              {currentView === 'buckets' && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'var(--color-accent-muted)',
                    filter: 'blur(8px)',
                    zIndex: -1,
                  }}
                />
              )}
            </div>
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{
                fontFamily: 'var(--font-display)',
                color: currentView === 'buckets' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'var(--transition-colors)',
              }}
            >
              Buckets
            </span>
          </button>
        </div>

        {/* Settings - Bottom aligned */}
        <div className="mt-auto w-full items-center no-drag pb-2">
          <button
            onClick={() => setCurrentView('settings')}
            className="flex flex-col items-center gap-1.5 group w-full px-4 relative"
            style={{
              transition: 'var(--transition-colors)',
            }}
          >
            <div
              className="p-2.5 rounded-xl relative"
              style={{
                backgroundColor: currentView === 'settings' ? 'var(--color-accent-muted)' : 'transparent',
                color: currentView === 'settings' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'all var(--duration-base) var(--ease-out)',
                boxShadow: currentView === 'settings' ? 'var(--glow-accent)' : 'none',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {currentView === 'settings' && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'var(--color-accent-muted)',
                    filter: 'blur(8px)',
                    zIndex: -1,
                  }}
                />
              )}
            </div>
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{
                fontFamily: 'var(--font-display)',
                color: currentView === 'settings' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'var(--transition-colors)',
              }}
            >
              Settings
            </span>
          </button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col h-full min-w-0" style={{ backgroundColor: 'var(--color-bg-primary)', borderLeft: '1px solid var(--color-border-primary)' }}>
        {/* Title Bar - Drag region for window movement */}
        <header className="h-0 drag-handle select-none shrink-0" style={{ backgroundColor: 'var(--color-bg-primary)' }}></header>

        {/* content */}
        <div className="flex-1 flex flex-col w-full relative overflow-hidden">
          {currentView === 'chrono' && (
            <div className="relative flex flex-col items-center justify-center h-full w-full px-4 pb-4 overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
              {/* Stopping overlay with redesigned aesthetic */}
              {isStopping && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-50" style={{ backgroundColor: 'rgba(242, 240, 237, 0.9)', backdropFilter: 'blur(8px)' }}>
                  <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                      <div className="animate-spin rounded-full h-16 w-16 border-2 border-transparent border-t-[var(--color-accent)] border-r-[var(--color-accent)]"
                           style={{ boxShadow: 'var(--shadow-accent)' }}></div>
                      <div className="absolute inset-0 rounded-full"
                           style={{
                             background: 'radial-gradient(circle, rgba(255, 72, 0, 0.1) 0%, transparent 70%)',
                             animation: 'pulse 2s ease-in-out infinite'
                           }}></div>
                    </div>
                    <div style={{
                      color: 'var(--color-accent)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 'var(--font-bold)',
                      letterSpacing: 'var(--tracking-tight)'
                    }}>
                      Finalizing activity
                    </div>
                    <div style={{
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--text-sm)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      Processing activities and analyzing for splits.
                    </div>
                  </div>
                </div>
              )}

              {/* Timer and Buttons Container - Ensures buttons match timer width exactly */}
              <div className="relative mb-8 inline-flex flex-col items-stretch gap-6">
                {/* Timer Display - Split-flap display with retro flip clock housing */}
                <div className="relative flex justify-center">
                  <FlipClockContainer>
                    <SplitFlapDisplay value={formatTime(elapsed)} size="large" />
                  </FlipClockContainer>
                  {isPaused && (
                    <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 animate-fade-in">
                      <div style={{
                        backgroundColor: 'var(--color-warning-muted)',
                        color: 'var(--color-warning)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--font-bold)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-wider)',
                        fontFamily: 'var(--font-display)',
                        padding: 'var(--space-1) var(--space-3)',
                        borderRadius: 'var(--radius-full)',
                        border: '1px solid var(--color-warning)',
                        boxShadow: '0 0 20px rgba(254, 188, 46, 0.3)'
                      }}>
                        Paused
                      </div>
                    </div>
                  )}
                </div>

                {/* Recording Controls with Waveform */}
                <div className="flex justify-center">
                  <RecordingControls
                    isRecording={isAudioRecording}
                    onToggleRecording={handleToggleRecording}
                    disabled={!isRunning || isStopping}
                  />
                </div>

                {/* Buttons - Pill style with design system colors - Full width of timer */}
                <div className="flex gap-3 min-h-[56px] w-full">
                <button
                  onClick={handleStartStop}
                  disabled={isStopping}
                  className="flex-1 transition-all duration-200 transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: isStopping
                      ? 'var(--color-bg-tertiary)'
                      : isRunning
                        ? 'var(--color-error)'
                        : 'var(--color-accent)',
                    color: isStopping ? 'var(--color-text-tertiary)' : 'white',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 'var(--font-bold)',
                    fontFamily: 'var(--font-display)',
                    letterSpacing: 'var(--tracking-wide)',
                    padding: 'var(--space-3) var(--space-8)',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    boxShadow: isStopping
                      ? 'none'
                      : isRunning
                        ? 'var(--shadow-error)'
                        : 'var(--shadow-accent)',
                    cursor: isStopping ? 'not-allowed' : 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (!isStopping) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = isRunning
                        ? '0 12px 32px -8px rgba(239, 68, 68, 0.6)'
                        : '0 12px 32px -8px rgba(255, 72, 0, 0.6)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isStopping) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = isRunning
                        ? 'var(--shadow-error)'
                        : 'var(--shadow-accent)';
                    }
                  }}
                >
                  {isRunning ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                      STOP
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      START
                    </span>
                  )}
                </button>

                {/* Pause/Resume button - always takes up space to prevent layout shift */}
                <button
                  onClick={handlePauseResume}
                  disabled={!isRunning || isStopping}
                  className="flex-1 transition-all duration-200 transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: (!isRunning || isStopping)
                      ? 'var(--color-bg-tertiary)'
                      : isPaused
                        ? 'var(--color-accent)'
                        : 'var(--color-warning)',
                    color: (!isRunning || isStopping) ? 'var(--color-text-tertiary)' : 'white',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 'var(--font-bold)',
                    fontFamily: 'var(--font-display)',
                    letterSpacing: 'var(--tracking-wide)',
                    padding: 'var(--space-3) var(--space-8)',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    boxShadow: (!isRunning || isStopping)
                      ? 'none'
                      : isPaused
                        ? 'var(--shadow-accent)'
                        : '0 8px 24px -8px rgba(254, 188, 46, 0.5)',
                    cursor: (!isRunning || isStopping) ? 'not-allowed' : 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    if (isRunning && !isStopping) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = isPaused
                        ? '0 12px 32px -8px rgba(255, 72, 0, 0.6)'
                        : '0 12px 32px -8px rgba(254, 188, 46, 0.6)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (isRunning && !isStopping) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = isPaused
                        ? 'var(--shadow-accent)'
                        : '0 8px 24px -8px rgba(254, 188, 46, 0.5)';
                    }
                  }}
                >
                  {isPaused ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      RESUME
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                      </svg>
                      PAUSE
                    </span>
                  )}
                </button>
                </div>
              </div>
            </div>
          )}

          {currentView === 'buckets' && (
            <>
              {/* Sticky Header with Tabs */}
              <div className="flex-shrink-0 z-20 drag-handle" style={{ backgroundColor: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                {/* Title Section */}
                <div className="px-6 pt-5 pb-3 flex items-center justify-between">
                  <h2
                    className="text-2xl font-bold tracking-tight"
                    style={{
                      fontFamily: 'var(--font-display)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    Manage Buckets
                  </h2>
                  {bucketsTab === 'jira' && jiraRefreshFn && (
                    <button
                      onClick={jiraRefreshFn}
                      className="no-drag px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
                      style={{
                        backgroundColor: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-body)',
                        border: '1px solid var(--color-border-primary)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-quaternary)';
                        e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                        e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                      }}
                    >
                      Refresh
                    </button>
                  )}
                </div>

                {/* Tab Bar - Underline style */}
                <div className="px-6" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <div className="flex gap-6 no-drag">
                    <button
                      onClick={() => setBucketsTab('buckets')}
                      className="relative pb-3 text-sm font-medium transition-colors hover:text-[var(--color-accent)]"
                      style={{
                        color: bucketsTab === 'buckets' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                        fontFamily: 'var(--font-body)',
                        cursor: 'pointer',
                      }}
                    >
                      My Buckets
                      {bucketsTab === 'buckets' && (
                        <span
                          className="absolute bottom-0 left-0 right-0 h-0.5"
                          style={{ backgroundColor: 'var(--color-accent)' }}
                        />
                      )}
                    </button>

                    {(settings.jira?.enabled || settings.tempo?.enabled) && (
                      <button
                        onClick={() => setBucketsTab('jira')}
                        className="relative pb-3 text-sm font-medium transition-colors flex items-center gap-1.5 hover:text-[var(--color-accent)]"
                        style={{
                          color: bucketsTab === 'jira' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                          fontFamily: 'var(--font-body)',
                          cursor: 'pointer',
                        }}
                      >
                        Jira Issues
                        {bucketsTab === 'jira' && (
                          <span
                            className="absolute bottom-0 left-0 right-0 h-0.5"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable Content - Tab Content */}
              <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                {bucketsTab === 'buckets' && (
                  <>
                    {/* Action Buttons */}
                    <div className="flex gap-3 mb-6">
                      <button
                        onClick={() => setShowCreateBucketModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
                        style={{
                          backgroundColor: 'var(--color-accent)',
                          color: 'white',
                          fontFamily: 'var(--font-body)',
                          transitionDuration: 'var(--duration-base)',
                          transitionTimingFunction: 'var(--ease-out)',
                          border: '1px solid var(--color-accent)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--color-accent-hover)';
                          e.currentTarget.style.borderColor = 'var(--color-accent-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--color-accent)';
                          e.currentTarget.style.borderColor = 'var(--color-accent)';
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Bucket
                      </button>

                      <button
                        onClick={() => setShowCreateFolderModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
                        style={{
                          backgroundColor: 'white',
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-body)',
                          transitionDuration: 'var(--duration-base)',
                          transitionTimingFunction: 'var(--ease-out)',
                          border: '1px solid var(--color-border-primary)'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#FAF5EE';
                          e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'white';
                          e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                        </svg>
                        New Folder
                      </button>
                    </div>

                    {/* Hierarchical bucket/folder display */}
                    <FolderTree
                      buckets={buckets}
                      onRename={renameBucket}
                      onDelete={removeBucket}
                      onUnlinkJira={unlinkJiraIssueFromBucket}
                      onMove={moveBucket}
                      onBucketClick={(bucket) => {
                        setSelectedBucket(bucket);
                        setCurrentView('bucket-detail');
                      }}
                    />
                  </>
                )}

                {bucketsTab === 'jira' && (settings.jira?.enabled || settings.tempo?.enabled) && (
                  <div className="mt-2">
                    <JiraIssuesSection
                      onIssueClick={(issue) => {
                        setSelectedJiraIssue({
                          key: issue.key,
                          summary: issue.fields.summary,
                          issueType: issue.fields.issuetype.name,
                          status: issue.fields.status.name,
                          projectKey: issue.fields.project.key,
                          projectName: issue.fields.project.name
                        });
                        setCurrentView('jira-detail');
                      }}
                      onRefreshReady={(fn) => setJiraRefreshFn(() => fn)}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {currentView === 'settings' && (
            <>
              {/* Sticky Header */}
              <div className="flex-shrink-0 px-4 py-3 z-20 drag-handle" style={{ backgroundColor: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>Settings</h2>
              </div>
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                <Settings
                  onOpenJiraModal={() => setShowJiraModal(true)}
                  onOpenTempoModal={() => setShowTempoModal(true)}
                />
              </div>
            </>
          )}

          {currentView === 'worklog-detail' && selectedEntry && (() => {
            const entry = entries.find(e => e.id === selectedEntry);
            if (!entry) {
              // Entry not found yet - show loading state while state updates
              return (
                <div className="flex flex-col items-center justify-center h-full gap-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderBottomColor: 'var(--color-success)' }}></div>
                  <div className="font-medium text-lg" style={{ color: 'var(--color-success)' }}>Loading activity...</div>
                </div>
              );
            }
            return (
              <HistoryDetail
                entry={entry}
                buckets={buckets}
                onBack={() => setCurrentView('worklog')}
                onUpdate={updateEntry}
                onNavigateToSettings={() => setCurrentView('settings')}
                formatTime={formatTime}
              />
            );
          })()}

          {currentView === 'bucket-detail' && selectedBucket && (
            <BucketDetailView
              bucket={selectedBucket}
              entries={entries}
              buckets={buckets}
              formatTime={formatTime}
              onBack={() => setCurrentView('buckets')}
              onEntryClick={(entryId) => {
                setSelectedEntry(entryId);
                setCurrentView('worklog-detail');
              }}
              onDeleteEntry={removeEntry}
              onBulkLogToTempo={handleBulkLogToTempo}
              tempoEnabled={settings.tempo?.enabled}
            />
          )}

          {currentView === 'jira-detail' && selectedJiraIssue && (
            <JiraDetailView
              jiraIssue={selectedJiraIssue}
              entries={entries}
              buckets={buckets}
              formatTime={formatTime}
              onBack={() => setCurrentView('buckets')}
              onEntryClick={(entryId) => {
                setSelectedEntry(entryId);
                setCurrentView('worklog-detail');
              }}
              onDeleteEntry={removeEntry}
              onBulkLogToTempo={handleBulkLogToTempo}
              tempoEnabled={settings.tempo?.enabled}
            />
          )}

          {currentView === 'worklog' && (
            <>
              {/* Fixed Header */}
              <div className="flex-shrink-0 px-6 py-4 z-20 drag-handle" style={{ backgroundColor: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>Worklog</h2>
                  {entries.length > 0 && (
                    <div className="flex items-center gap-3 no-drag">
                      <button
                        onClick={() => setShowExportDialog(true)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export CSV
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
                {entries.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No activities recorded yet.</div>
                ) : (
                  <div>
                    {(() => {
                      // Helper function to get the start of week (Monday) for a given date
                      const getWeekStart = (date: Date): Date => {
                        const d = new Date(date);
                        const day = d.getDay(); // 0 = Sunday, 1 = Monday, etc.
                        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
                        const weekStart = new Date(d.setDate(diff));
                        weekStart.setHours(0, 0, 0, 0);
                        return weekStart;
                      };

                      // Helper function to get the end of week (Sunday) for a given date
                      const getWeekEnd = (date: Date): Date => {
                        const weekStart = getWeekStart(date);
                        const weekEnd = new Date(weekStart);
                        weekEnd.setDate(weekStart.getDate() + 6);
                        return weekEnd;
                      };

                      // Group entries by date first
                      const sortedEntries = entries.sort((a, b) => b.startTime - a.startTime);
                      const groupedByDate = new Map<string, typeof sortedEntries>();

                      sortedEntries.forEach(entry => {
                        const date = new Date(entry.startTime);
                        date.setHours(0, 0, 0, 0);
                        const dateKey = date.getTime().toString();

                        if (!groupedByDate.has(dateKey)) {
                          groupedByDate.set(dateKey, []);
                        }
                        groupedByDate.get(dateKey)!.push(entry);
                      });

                      // Group dates by week
                      const groupedByWeek = new Map<string, Array<[string, typeof sortedEntries]>>();

                      Array.from(groupedByDate.entries()).forEach(([dateKey, dateEntries]) => {
                        const date = new Date(parseInt(dateKey));
                        const weekStart = getWeekStart(date);
                        const weekKey = weekStart.getTime().toString();

                        if (!groupedByWeek.has(weekKey)) {
                          groupedByWeek.set(weekKey, []);
                        }
                        groupedByWeek.get(weekKey)!.push([dateKey, dateEntries]);
                      });

                      // Format date labels
                      const formatDateLabel = (timestamp: number): string => {
                        const date = new Date(timestamp);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);

                        if (date.getTime() === today.getTime()) {
                          return 'Today';
                        } else if (date.getTime() === yesterday.getTime()) {
                          return 'Yesterday';
                        } else {
                          return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                        }
                      };

                      // Format week range label
                      const formatWeekLabel = (weekStartTimestamp: number): string => {
                        const weekStart = new Date(weekStartTimestamp);
                        const weekEnd = getWeekEnd(weekStart);

                        const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
                        const startStr = weekStart.toLocaleDateString('en-US', formatOptions);
                        const endStr = weekEnd.toLocaleDateString('en-US', formatOptions);

                        return `Week of ${startStr} - ${endStr}`;
                      };

                      return Array.from(groupedByWeek.entries()).map(([weekKey, weekDays]) => {
                        // Helper to calculate rounded duration (15-minute increments)
                        const getRoundedDuration = (duration: number) =>
                          Math.ceil(duration / (15 * 60 * 1000)) * (15 * 60 * 1000);

                        // Calculate total duration for the week using rounded values
                        const weekTotalDuration = weekDays.reduce((weekSum, [, dateEntries]) =>
                          weekSum + dateEntries.reduce((daySum, entry) => daySum + getRoundedDuration(entry.duration), 0), 0
                        );

                        // Check if this week has any Jira activities
                        const weekHasLoggableJiraActivities = weekDays.some(([, dateEntries]) =>
                          dateEntries.some(entry => {
                            const assignment = entry.assignment ||
                              (entry.linkedJiraIssue ? {
                                type: 'jira' as const,
                                jiraIssue: entry.linkedJiraIssue
                              } : null);

                            return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
                          })
                        );

                        return (
                          <div key={weekKey} className="mb-6 last:mb-0">
                            {/* Week Header - Sticky and more prominent */}
                            <div
                              className="sticky top-0 z-20 px-4 py-2 -mx-4 flex items-center justify-between"
                              style={{
                                backgroundColor: 'var(--color-bg-primary)',
                                borderBottom: '1px solid var(--color-border-primary)',
                                backdropFilter: 'blur(8px)'
                              }}
                            >
                              <h2
                                className="text-xs font-bold uppercase tracking-wider"
                                style={{
                                  color: 'var(--color-text-secondary)',
                                  fontFamily: 'var(--font-display)'
                                }}
                              >
                                {formatWeekLabel(parseInt(weekKey))}
                              </h2>
                              <div className="flex items-center gap-3">
                                {settings.tempo?.enabled && weekHasLoggableJiraActivities && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleBulkLogToTempo(weekKey);
                                    }}
                                    className="no-drag flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)]"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                      <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    Log to Tempo
                                  </button>
                                )}
                                <span
                                  className="text-sm font-mono font-bold"
                                  style={{
                                    color: 'var(--color-accent)',
                                    fontFamily: 'var(--font-mono)'
                                  }}
                                >
                                  {formatTime(weekTotalDuration)}
                                </span>
                              </div>
                            </div>

                            {/* Days within the week */}
                            <div>
                              {weekDays.map(([dateKey, dateEntries], dayIndex) => {
                                // Calculate total using rounded durations
                                const totalDuration = dateEntries.reduce((sum, entry) => sum + getRoundedDuration(entry.duration), 0);

                                // Check if this day has any Jira activities with all required info
                                const hasLoggableJiraActivities = dateEntries.some(entry => {
                                  const assignment = entry.assignment ||
                                    (entry.linkedJiraIssue ? {
                                      type: 'jira' as const,
                                      jiraIssue: entry.linkedJiraIssue
                                    } : null);

                                  return assignment?.type === 'jira' && assignment.jiraIssue && entry.description;
                                });

                                return (
                                  <div key={dateKey} className={dayIndex > 0 ? 'mt-3' : ''}>
                                    {/* Date Separator Header - Sticky below week header */}
                                    <div
                                      className="sticky z-10 px-4 py-2 -mx-4 flex items-center justify-between"
                                      style={{
                                        backgroundColor: 'var(--color-bg-secondary)',
                                        borderBottom: '1px solid var(--color-border-primary)',
                                        top: '37px',
                                        marginTop: dayIndex === 0 ? '-1px' : undefined
                                      }}
                                    >
                                      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                                        {formatDateLabel(parseInt(dateKey))}
                                      </h3>
                                      <div className="flex items-center gap-3">
                                        {settings.tempo?.enabled && hasLoggableJiraActivities && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleBulkLogToTempo(dateKey);
                                            }}
                                            className="no-drag flex items-center gap-1.5 px-3 py-1.5 bg-transparent hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-xs rounded-lg transition-all border border-[var(--color-border-primary)]"
                                          >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <circle cx="12" cy="12" r="10" />
                                              <polyline points="12 6 12 12 16 14" />
                                            </svg>
                                            Log to Tempo
                                          </button>
                                        )}
                                        <span className="text-xs font-mono" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                                          {formatTime(totalDuration)}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Activities for this date */}
                                    <div className="space-y-2 mt-4">
                                      {dateEntries.map(entry => {
                                        // Get assignment info from unified model or fallback to legacy fields
                                        const assignment = entry.assignment ||
                                          (entry.linkedJiraIssue ? {
                                            type: 'jira' as const,
                                            jiraIssue: entry.linkedJiraIssue
                                          } : entry.bucketId ? {
                                            type: 'bucket' as const,
                                            bucket: buckets.find(b => b.id === entry.bucketId)
                                          } : null);

                                        // Calculate rounded time
                                        const actualDuration = entry.duration;
                                        const roundedDuration = Math.ceil(actualDuration / (15 * 60 * 1000)) * (15 * 60 * 1000); // Round up to nearest 15 minutes
                                        const roundedDiff = roundedDuration - actualDuration;

                                        return (
                                          <div
                                            key={entry.id}
                                            onClick={() => {
                                              setSelectedEntry(entry.id);
                                              setCurrentView('worklog-detail');
                                            }}
                                            className="flex justify-between items-center p-2.5 rounded-lg cursor-pointer"
                                            data-hoverable
                                            data-default-bg="white"
                                            data-default-border="var(--color-border-primary)"
                                            data-hover-bg="#FAF5EE"
                                            data-hover-border="var(--color-border-secondary)"
                                            style={{
                                              backgroundColor: 'white',
                                              border: '1px solid var(--color-border-primary)',
                                              transition: 'all var(--duration-base) var(--ease-out)'
                                            }}
                                            onMouseEnter={(e) => {
                                              e.currentTarget.style.backgroundColor = '#FAF5EE';
                                              e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                                            }}
                                            onMouseLeave={(e) => {
                                              e.currentTarget.style.backgroundColor = 'white';
                                              e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                                            }}
                                          >
                                            <div className="flex flex-col flex-1 min-w-0">
                                              {/* Display assignment info */}
                                              {assignment && (
                                                <div className="flex items-center gap-2 mb-1">
                                                  <div
                                                    className="w-2 h-2 rounded-full"
                                                    style={{
                                                      backgroundColor: assignment.type === 'bucket'
                                                        ? assignment.bucket?.color || '#6b7280'
                                                        : '#3b82f6' // Blue for Jira issues
                                                    }}
                                                  />
                                                  <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                                                    {assignment.type === 'bucket'
                                                      ? assignment.bucket?.name || 'Unknown Bucket'
                                                      : assignment.jiraIssue?.key || 'Unknown Issue'
                                                    }
                                                  </span>
                                                  {assignment.type === 'jira' && assignment.jiraIssue && (
                                                    <>
                                                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                                                        {assignment.jiraIssue.projectName}
                                                      </span>
                                                      <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}>
                                                        {assignment.jiraIssue.issueType}
                                                      </span>
                                                    </>
                                                  )}
                                                </div>
                                              )}
                                              {/* Secondary info for Jira issues */}
                                              {assignment?.type === 'jira' && assignment.jiraIssue && (
                                                <div className="text-xs mb-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                                  {assignment.jiraIssue.summary}
                                                </div>
                                              )}
                                              <div className="flex flex-col gap-0.5">
                                                <span className="text-xs" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} - {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                                {roundedDiff > 0 && (
                                                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                                    +{formatTime(roundedDiff)}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                              <div className="font-mono font-bold" style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                                                {formatTime(roundedDuration)}
                                              </div>
                                              <DeleteButton
                                                onDelete={() => removeEntry(entry.id)}
                                                confirmMessage="Delete this activity?"
                                                size="sm"
                                                variant="subtle"
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <ExportDialog
          entries={entries}
          buckets={buckets}
          onClose={() => setShowExportDialog(false)}
          onExport={() => {
            // Could show a success notification here
            console.log('Export completed');
          }}
        />
      )}

      {/* Create Bucket Modal */}
      <CreateBucketModal
        isOpen={showCreateBucketModal}
        onClose={() => setShowCreateBucketModal(false)}
        onCreateBucket={handleCreateBucket}
        availableFolders={buckets.filter(b => b.isFolder)}
      />

      {/* Create Folder Modal */}
      <CreateFolderModal
        isOpen={showCreateFolderModal}
        onClose={() => setShowCreateFolderModal(false)}
        onCreateFolder={handleCreateFolder}
        availableFolders={buckets.filter(b => b.isFolder)}
      />

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
      />

      {/* Jira Configuration Modal */}
      <JiraConfigModal
        isOpen={showJiraModal}
        onClose={() => setShowJiraModal(false)}
        currentJiraSettings={settings.jira || { enabled: false, apiToken: '', baseUrl: '', email: '', selectedProjects: [], autoSync: true, syncInterval: 30, lastSyncTimestamp: 0 }}
        onSave={(jiraSettings) => {
          updateSettings({
            jira: {
              ...jiraSettings,
              // Preserve sync settings when updating integration config
              autoSync: settings.jira?.autoSync ?? true,
              syncInterval: settings.jira?.syncInterval || 30,
              lastSyncTimestamp: settings.jira?.lastSyncTimestamp || 0,
            }
          });
        }}
      />

      {/* Tempo Configuration Modal */}
      <TempoConfigModal
        isOpen={showTempoModal}
        onClose={() => setShowTempoModal(false)}
        currentTempoSettings={settings.tempo || { enabled: false, apiToken: '', baseUrl: 'https://api.tempo.io' }}
        onSave={(tempoSettings) => {
          updateSettings({
            tempo: tempoSettings,
          });
        }}
      />

      {/* Auto-Update Notification - shows when updates are available */}
      <UpdateNotification showManualCheck={false} />

      {/* Update Success Modal - shows after successful auto-update */}
      <UpdateSuccessModal
        isOpen={showUpdateSuccessModal}
        onClose={handleCloseUpdateSuccessModal}
        version={appVersion}
        releaseNotes={releaseNotes}
      />

      {/* Permission Request Modal - shows when permissions are missing */}
      <PermissionRequestModal
        isOpen={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        onPermissionsGranted={handlePermissionsGranted}
      />

      {/* Global Crawler Progress Bar - Fixed at bottom */}
      <CrawlerProgressBar />

      </div>
    </div>
  )
}

export default App
