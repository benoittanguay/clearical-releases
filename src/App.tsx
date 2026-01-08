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
import type { JiraIssue } from './services/jiraService';
import type { LinkedJiraIssue, WorkAssignment } from './context/StorageContext';
import './App.css'

type View = 'timer' | 'history' | 'buckets' | 'settings' | 'history-detail';

function App() {
  const { buckets, entries, addEntry, addBucket, removeBucket, updateEntry, removeEntry, linkJiraIssueToBucket, unlinkJiraIssueFromBucket, linkJiraIssueToEntry, unlinkJiraIssueFromEntry, setEntryAssignment } = useStorage();
  const { settings } = useSettings();
  const [selectedAssignment, setSelectedAssignment] = useState<WorkAssignment | null>(null);
  const [currentView, setCurrentView] = useState<View>('timer');
  const [newBucketName, setNewBucketName] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { isRunning, isPaused, elapsed, start: startTimer, stop: stopTimer, pause: pauseTimer, resume: resumeTimer, reset: resetTimer, formatTime } = useTimer();

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
      alert('No entries found for today to bulk log.');
      return;
    }

    const proceed = confirm(`Log ${todayEntries.length} entries from today to Tempo?`);
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
      
      alert(`Successfully logged ${successCount} out of ${todayEntries.length} entries to Tempo.`);
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
      addEntry({
        startTime: Date.now() - elapsed,
        endTime: Date.now(),
        duration: elapsed,
        assignment: selectedAssignment,
        windowActivity: finalActivity
      });
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
          <button onClick={() => setCurrentView('timer')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'timer' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'timer' ? 'text-green-400' : 'text-gray-500'}`}>Timer</span>
          </button>

          <button onClick={() => setCurrentView('history')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'history' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /></svg>
            </div>
            <span className={`text-[10px] font-medium ${currentView === 'history' ? 'text-green-400' : 'text-gray-500'}`}>History</span>
          </button>

          <button onClick={() => setCurrentView('buckets')} className={`flex flex-col items-center gap-1 group w-full`}>
            <div className={`p-2 rounded-lg transition-colors ${currentView === 'buckets' ? 'bg-gray-800 text-green-400' : 'text-gray-500 group-hover:text-gray-300'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.2 7.8l-7.7 7.7a2 2 0 0 1-2.8 0l-4.7-4.7a2 2 0 0 1 0-2.8l7.7-7.7a2 2 0 0 1 2.8 0l4.7 4.7a2 2 0 0 1 0 2.8z" /><path d="M7.3 14.7l-2.3 2.3a2 2 0 0 0 0 2.8l4.7 4.7a2 2 0 0 0 2.8 0l2.3-2.3" /></svg>
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
        <div className="flex-1 overflow-y-auto p-6 w-full relative">
          {currentView === 'timer' && (
            <div className="flex flex-col items-center justify-center h-full w-full">
              <div className="relative">
                <div className={`text-7xl font-mono mb-10 font-bold tabular-nums tracking-wider text-shadow-glow transition-colors ${
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

              <div className="w-full max-w-xs">
                <label className="text-xs text-gray-500 uppercase font-bold mb-2 block tracking-wider">Assignment</label>
                <AssignmentPicker
                  value={selectedAssignment}
                  onChange={setSelectedAssignment}
                  placeholder={isRunning && !isPaused ? "Assignment locked while running" : "Select assignment..."}
                  className={`mb-10 ${isRunning && !isPaused ? 'pointer-events-none opacity-60' : ''}`}
                />
              </div>

              <div className="w-full max-w-xs space-y-3">
                <button
                  onClick={handleStartStop}
                  className={`
                              w-full py-4 rounded-xl text-xl font-bold transition-all transform hover:-translate-y-1 active:scale-95 shadow-lg
                              ${isRunning
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30'
                      : 'bg-green-500 hover:bg-green-600 shadow-green-500/30'
                    }
                          `}
                >
                  {isRunning ? 'STOP TRACKING' : 'START TRACKING'}
                </button>

                {isRunning && (
                  <button
                    onClick={handlePauseResume}
                    className={`
                                w-full py-3 rounded-lg text-lg font-medium transition-all transform hover:-translate-y-0.5 active:scale-95 shadow-md
                                ${isPaused
                        ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/30'
                        : 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-500/30'
                      }
                            `}
                  >
                    {isPaused ? 'RESUME' : 'PAUSE'}
                  </button>
                )}
              </div>
            </div>
          )}

          {currentView === 'buckets' && (
            <div className="w-full h-full flex flex-col">
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
                  Add
                </button>
              </div>
              <div className="text-white mb-4">DEBUG: Buckets count: {buckets.length}</div>
              <ul className="space-y-3">
                {buckets.map(bucket => (
                  <li key={bucket.id} className="bg-gray-800/50 p-4 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors group">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-4 h-4 rounded-full shadow-sm flex-shrink-0" style={{ backgroundColor: bucket.color }}></div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-white">{bucket.name}</span>
                          {bucket.linkedIssue && (
                            <div className="mt-2 bg-gray-900/50 rounded p-2 border border-gray-700">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-blue-400 font-mono text-xs">
                                  {bucket.linkedIssue.key}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {bucket.linkedIssue.projectName}
                                </span>
                                <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                  {bucket.linkedIssue.issueType}
                                </span>
                              </div>
                              <p className="text-sm text-gray-300 truncate">
                                {bucket.linkedIssue.summary}
                              </p>
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-gray-400">
                                  Status: {bucket.linkedIssue.status}
                                </span>
                                <button
                                  onClick={() => unlinkJiraIssueFromBucket(bucket.id)}
                                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                                >
                                  Unlink
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
{/* Temporarily disabled until JiraIssueBrowser is fixed */}
                        <button
                          onClick={() => removeBucket(bucket.id)}
                          className="text-gray-600 hover:text-red-500 p-1.5 rounded-md hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100"
                          title="Delete Bucket"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Jira Issues Section */}
              {(settings.jira?.enabled || settings.tempo?.enabled) && (
                <>
                  {console.log('[App] Rendering JiraIssuesSection')}
                  <JiraIssuesSection />
                </>
              )}
            </div>
          )}

          {currentView === 'settings' && <Settings />}
          {currentView === 'history-detail' && selectedEntry && (
            <HistoryDetail
              entry={entries.find(e => e.id === selectedEntry)!}
              buckets={buckets}
              onBack={() => setCurrentView('history')}
              onUpdate={updateEntry}
              onNavigateToSettings={() => setCurrentView('settings')}
              formatTime={formatTime}
            />
          )}
          {currentView === 'history' && (
            <div className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">History</h2>
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
              {entries.length === 0 ? (
                <div className="text-gray-500 text-sm">No time entries recorded yet.</div>
              ) : (
                <div className="space-y-3 pb-8">
                  {entries.sort((a, b) => b.startTime - a.startTime).map(entry => {
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
                          setCurrentView('history-detail');
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
                          <span className="text-xs text-gray-500">{new Date(entry.startTime).toLocaleString()}</span>
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
                            confirmMessage="Delete this time entry?"
                            size="sm"
                            variant="subtle"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
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

    </div>
  )
}

export default App
