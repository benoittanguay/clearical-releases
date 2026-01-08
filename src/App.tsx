import { useState, useEffect } from 'react';
import { useTimer } from './hooks/useTimer';
import { useStorage } from './context/StorageContext';
import { useSettings } from './context/SettingsContext';
import { Settings } from './components/Settings';
import { HistoryDetail } from './components/HistoryDetail';
import { ExportDialog } from './components/ExportDialog';
import { DeleteButton } from './components/DeleteButton';
import { JiraIssuesSection } from './components/JiraIssuesSection';
import { AssignmentPicker } from './components/AssignmentPicker';
import { DevTools } from './components/DevTools';
import { FolderTree } from './components/FolderTree';
import type { WorkAssignment } from './context/StorageContext';
import './App.css'

type View = 'chrono' | 'worklog' | 'buckets' | 'settings' | 'worklog-detail';

function App() {
  const { buckets, entries, addEntry, addBucket, removeBucket, renameBucket, createFolder, moveBucket, updateEntry, removeEntry, unlinkJiraIssueFromBucket } = useStorage();
  const { settings } = useSettings();
  const [selectedAssignment, setSelectedAssignment] = useState<WorkAssignment | null>(null);
  const [currentView, setCurrentView] = useState<View>('chrono');
  const [newBucketName, setNewBucketName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { isRunning, isPaused, elapsed, start: startTimer, stop: stopTimer, pause: pauseTimer, resume: resumeTimer, formatTime } = useTimer();

  const handleBulkLogToTempo = async () => {
    if (!settings.tempo?.enabled) {
      setCurrentView('settings');
      return;
    }

    // For simplicity, we'll implement a basic bulk log that logs all entries from today
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries.filter(entry => {
      const entryDate = new Date(entry.startTime).toISOString().split('T')[0];
      return entryDate === today;
    });

    if (todayEntries.length === 0) {
      alert('No activities found for today to bulk log.');
      return;
    }

    const proceed = confirm(`Log ${todayEntries.length} activities from today to Tempo?`);
    if (!proceed) return;

    try {
      const { TempoService } = await import('./services/tempoService');
      const service = new TempoService(settings.tempo.baseUrl!, settings.tempo.apiToken!);
      
      let successCount = 0;
      for (const entry of todayEntries) {
        try {
          const worklog = {
            issueKey: settings.tempo.defaultIssueKey || 'DEFAULT-1',
            timeSpentSeconds: TempoService.durationMsToSeconds(entry.duration),
            startDate: TempoService.formatDate(entry.startTime),
            startTime: TempoService.formatTime(entry.startTime),
            description: entry.description || 'Time tracked via TimePortal',
          };
          
          await service.createWorklog(worklog);
          successCount++;
        } catch (error) {
          console.error(`Failed to log entry ${entry.id}:`, error);
        }
      }
      
      alert(`Successfully logged ${successCount} out of ${todayEntries.length} activities to Tempo.`);
    } catch (error) {
      alert(`Bulk logging failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleStartStop = async () => {
    if (!isRunning) {
      // Start timer fresh (elapsed should be 0)
      startTimer();
    } else {
      // Stop timer and save entry
      const finalActivity = stopTimer();
      const newEntry = addEntry({
        startTime: Date.now() - elapsed,
        endTime: Date.now(),
        duration: elapsed,
        assignment: selectedAssignment || undefined,
        windowActivity: finalActivity
      });

      // Navigate to the Activity Details view for the new entry
      setSelectedEntry(newEntry.id);
      setCurrentView('worklog-detail');
    }
  };

  const handlePauseResume = () => {
    if (isPaused) {
      resumeTimer();
    } else {
      pauseTimer();
    }
  };

  const handleClose = () => {
    // @ts-ignore
    if (window.electron) {
      // @ts-ignore
      window.electron.ipcRenderer.send('hide-window', null);
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

  return (
    <div className="flex h-screen bg-gray-900 text-white overflow-hidden font-sans w-full">
      {/* Sidebar */}
      <nav className="w-20 bg-gray-950 flex flex-col items-center py-4 border-r border-gray-800 z-50 drag-handle">
        <div className="mb-8 text-green-500 font-bold text-xl tracking-tighter">TP</div>

        <div className="flex flex-col gap-6 w-full items-center no-drag">
          <button onClick={() => setCurrentView('chrono')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'chrono' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'chrono' ? 'text-green-400' : 'text-gray-500'}`}>Chrono</span>
          </button>

          <button onClick={() => setCurrentView('worklog')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'worklog' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'worklog' ? 'text-green-400' : 'text-gray-500'}`}>Worklog</span>
          </button>

          <button onClick={() => setCurrentView('buckets')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'buckets' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'buckets' ? 'text-green-400' : 'text-gray-500'}`}>Buckets</span>
          </button>

          <button onClick={() => setCurrentView('settings')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'settings' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'settings' ? 'text-green-400' : 'text-gray-500'}`}>Settings</span>
          </button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col h-full bg-gray-900 border-l border-gray-800 min-w-0">
        {/* Title Bar */}
        <header className="h-8 flex justify-end items-center px-3 bg-gray-950 drag-handle select-none shrink-0">
          {/* Window Controls */}
          {/* @ts-ignore */}
          {window.electron && <div className="flex space-x-2 no-drag group">
            <button onClick={handleClose} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 text-[8px] font-bold text-black leading-none">x</span>
            </button>
            <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
          </div>}
        </header>

        {/* content */}
        <div className="flex-1 flex flex-col w-full relative overflow-hidden">
          {currentView === 'chrono' && (
            <div className="flex flex-col items-center justify-center h-full w-full p-6">
              {/* Assignment Picker - Above the counter */}
              <div className="w-full max-w-xs mb-8">
                <label className="text-xs text-gray-500 uppercase font-bold mb-2 block tracking-wider">Assignment</label>
                <AssignmentPicker
                  value={selectedAssignment}
                  onChange={setSelectedAssignment}
                  placeholder={isRunning && !isPaused ? "Assignment locked while running" : "Select assignment..."}
                  className={isRunning && !isPaused ? 'pointer-events-none opacity-60' : ''}
                />
              </div>

              {/* Timer Display */}
              <div className="relative mb-10">
                <div className={`text-7xl font-mono font-bold tabular-nums tracking-wider text-shadow-glow transition-colors ${
                  isPaused ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {formatTime(elapsed)}
                </div>
                {isPaused && (
                  <div className="absolute -top-8 left-1/2 transform -translate-x-1/2">
                    <div className="bg-yellow-500/20 text-yellow-400 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-yellow-500/30">
                      Paused
                    </div>
                  </div>
                )}
              </div>

              {/* Buttons - Side by side with stable layout */}
              <div className="w-full max-w-md flex gap-3 min-h-[60px]">
                <button
                  onClick={handleStartStop}
                  className={`
                    flex-1 py-4 rounded-xl text-xl font-bold transition-all transform hover:-translate-y-1 active:scale-95 shadow-lg
                    ${isRunning
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30'
                      : 'bg-green-500 hover:bg-green-600 shadow-green-500/30'
                    }
                  `}
                >
                  {isRunning ? 'STOP' : 'START'}
                </button>

                {/* Pause/Resume button - always takes up space to prevent layout shift */}
                <button
                  onClick={handlePauseResume}
                  disabled={!isRunning}
                  className={`
                    flex-1 py-4 rounded-xl text-xl font-bold transition-all transform shadow-lg
                    ${!isRunning
                      ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50'
                      : isPaused
                        ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/30 hover:-translate-y-1 active:scale-95'
                        : 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-500/30 hover:-translate-y-1 active:scale-95'
                    }
                  `}
                >
                  {isPaused ? 'RESUME' : 'PAUSE'}
                </button>
              </div>
            </div>
          )}

          {currentView === 'buckets' && (
            <div className="w-full h-full flex flex-col overflow-y-auto p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Manage Buckets</h2>
                {settings.tempo?.enabled && (
                  <div className="text-sm text-green-400 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                      <circle cx="12" cy="12" r="4"/>
                    </svg>
                    Tempo Connected
                  </div>
                )}
              </div>

              {/* Create Bucket and Folder inputs */}
              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  value={newBucketName}
                  onChange={(e) => setNewBucketName(e.target.value)}
                  placeholder="New Bucket Name"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newBucketName.trim()) {
                      addBucket(newBucketName, '#3b82f6');
                      setNewBucketName('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newBucketName.trim()) {
                      addBucket(newBucketName, '#3b82f6');
                      setNewBucketName('');
                    }
                  }}
                  className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Add Bucket
                </button>
              </div>

              <div className="flex gap-2 mb-6">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="New Folder Name"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFolderName.trim()) {
                      createFolder(newFolderName);
                      setNewFolderName('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newFolderName.trim()) {
                      createFolder(newFolderName);
                      setNewFolderName('');
                    }
                  }}
                  className="bg-yellow-600 hover:bg-yellow-500 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
                >
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
                  >
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                  Add Folder
                </button>
              </div>

              {/* Hierarchical bucket/folder display */}
              <FolderTree
                buckets={buckets}
                onRename={renameBucket}
                onDelete={removeBucket}
                onUnlinkJira={unlinkJiraIssueFromBucket}
                onMove={moveBucket}
              />

              {/* Jira Issues Section */}
              {(settings.jira?.enabled || settings.tempo?.enabled) && (
                <div className="mt-8">
                  <JiraIssuesSection />
                </div>
              )}
            </div>
          )}

          {currentView === 'settings' && (
            <div className="overflow-y-auto p-6">
              <Settings />
            </div>
          )}

          {currentView === 'worklog-detail' && selectedEntry && (
            <div className="overflow-y-auto p-6">
              <HistoryDetail
                entry={entries.find(e => e.id === selectedEntry)!}
                buckets={buckets}
                onBack={() => setCurrentView('worklog')}
                onUpdate={updateEntry}
                onNavigateToSettings={() => setCurrentView('settings')}
                formatTime={formatTime}
              />
            </div>
          )}

          {currentView === 'worklog' && (
            <>
              {/* Fixed Header */}
              <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-6 py-4 z-20">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">Worklog</h2>
                  {entries.length > 0 && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleBulkLogToTempo}
                        className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
                          settings.tempo?.enabled
                            ? 'bg-blue-600 hover:bg-blue-500'
                            : 'bg-gray-600 hover:bg-gray-500'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {settings.tempo?.enabled ? 'Bulk Log to Tempo' : 'Connect Tempo'}
                      </button>
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
              <div className="flex-1 overflow-y-auto px-6 pb-8">
                {entries.length === 0 ? (
                  <div className="text-gray-500 text-sm pt-6">No activities recorded yet.</div>
                ) : (
                  <div className="pt-6">
                    {(() => {
                      // Group entries by date
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

                      return Array.from(groupedByDate.entries()).map(([dateKey, dateEntries]) => {
                        const totalDuration = dateEntries.reduce((sum, entry) => sum + entry.duration, 0);

                        return (
                          <div key={dateKey} className="mb-6 last:mb-0">
                            {/* Date Separator Header - Sticky with solid background */}
                            <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 px-4 py-3 mb-3 -mx-6 flex items-center justify-between shadow-sm">
                              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                                {formatDateLabel(parseInt(dateKey))}
                              </h3>
                              <span className="text-xs font-mono text-gray-500">
                                {formatTime(totalDuration)}
                              </span>
                            </div>

                            {/* Activities for this date */}
                            <div className="space-y-3">
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

                                return (
                                  <div
                                    key={entry.id}
                                    onClick={() => {
                                      setSelectedEntry(entry.id);
                                      setCurrentView('worklog-detail');
                                    }}
                                    className="flex justify-between items-center bg-gray-800/50 p-3 rounded-lg border border-gray-800 hover:bg-gray-800/80 transition-colors cursor-pointer"
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
                                          <span className="text-sm font-medium text-gray-200">
                                            {assignment.type === 'bucket'
                                              ? assignment.bucket?.name || 'Unknown Bucket'
                                              : assignment.jiraIssue?.key || 'Unknown Issue'
                                            }
                                          </span>
                                          {assignment.type === 'jira' && assignment.jiraIssue && (
                                            <>
                                              <span className="text-xs text-gray-500">
                                                {assignment.jiraIssue.projectName}
                                              </span>
                                              <span className="text-xs px-1 py-0.5 bg-gray-700 text-gray-300 rounded">
                                                {assignment.jiraIssue.issueType}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      )}
                                      {/* Secondary info for Jira issues */}
                                      {assignment?.type === 'jira' && assignment.jiraIssue && (
                                        <div className="text-xs text-gray-400 mb-1 truncate">
                                          {assignment.jiraIssue.summary}
                                        </div>
                                      )}
                                      {entry.description && (
                                        <p className="text-xs text-gray-400 mb-1 truncate">{entry.description}</p>
                                      )}
                                      <span className="text-xs text-gray-500">{new Date(entry.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} - {new Date(entry.startTime + entry.duration).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      {entry.windowActivity && entry.windowActivity.length > 0 && (
                                        <span className="text-xs text-gray-500">{entry.windowActivity.length} activities</span>
                                      )}
                                      <div className="font-mono text-green-400 font-bold">
                                        {formatTime(entry.duration)}
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

      {/* DevTools - Only in development */}
      {import.meta.env.DEV && <DevTools />}

    </div>
  )
}

export default App
