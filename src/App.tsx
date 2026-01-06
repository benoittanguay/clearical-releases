import { useState, useEffect } from 'react';
import { useTimer } from './hooks/useTimer';
import { useStorage } from './context/StorageContext';
import { Settings } from './components/Settings';
import { HistoryDetail } from './components/HistoryDetail';
import { ExportDialog } from './components/ExportDialog';
import { DeleteButton } from './components/DeleteButton';
import './App.css'

type View = 'timer' | 'history' | 'buckets' | 'settings' | 'history-detail';

function App() {
  const { buckets, entries, addEntry, addBucket, removeBucket, updateEntry, removeEntry } = useStorage();
  const [selectedBucket, setSelectedBucket] = useState<string>('1');
  const [currentView, setCurrentView] = useState<View>('timer');
  const [newBucketName, setNewBucketName] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const { isRunning, elapsed, start: startTimer, stop: stopTimer, formatTime } = useTimer();


  const handleToggle = async () => {
    if (isRunning) {
      const finalActivity = stopTimer();
      addEntry({
        startTime: Date.now() - elapsed,
        endTime: Date.now(),
        duration: elapsed,
        bucketId: selectedBucket,
        windowActivity: finalActivity
      });
    } else {
      startTimer();
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

    // If selectedBucket doesn't exist (e.g. was deleted), default to the first one
    if (buckets.length > 0 && !buckets.find(b => b.id === selectedBucket)) {
      setSelectedBucket(buckets[0].id);
    }
  }, [buckets, selectedBucket]);

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
              <div className="text-7xl font-mono mb-10 font-bold text-green-400 tabular-nums tracking-wider text-shadow-glow">
                {formatTime(elapsed)}
              </div>

              <div className="w-full max-w-xs">
                <label className="text-xs text-gray-500 uppercase font-bold mb-2 block tracking-wider">Project / Bucket</label>
                <select
                  value={selectedBucket}
                  onChange={(e) => setSelectedBucket(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white text-sm rounded-lg focus:ring-green-500 focus:border-green-500 block p-3 mb-10 transition-colors hover:bg-gray-800"
                >
                  {buckets.map(bucket => (
                    <option key={bucket.id} value={bucket.id}>{bucket.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleToggle}
                className={`
                            w-full max-w-xs py-4 rounded-xl text-xl font-bold transition-all transform hover:-translate-y-1 active:scale-95 shadow-lg
                            ${isRunning
                    ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30'
                    : 'bg-green-500 hover:bg-green-600 shadow-green-500/30'
                  }
                        `}
              >
                {isRunning ? 'STOP TRACKING' : 'START TRACKING'}
              </button>
            </div>
          )}

          {currentView === 'buckets' && (
            <div className="w-full h-full flex flex-col">
              <h2 className="text-2xl font-bold mb-6">Manage Buckets</h2>
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
              <ul className="space-y-3">
                {buckets.map(bucket => (
                  <li key={bucket.id} className="flex justify-between items-center bg-gray-800/50 p-3 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: bucket.color }}></div>
                      <span className="font-medium">{bucket.name}</span>
                    </div>
                    <button
                      onClick={() => removeBucket(bucket.id)}
                      className="text-gray-600 hover:text-red-500 p-2 rounded-md hover:bg-gray-800 transition-all opacity-0 group-hover:opacity-100"
                      title="Delete Bucket"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {currentView === 'settings' && <Settings />}
          {currentView === 'history-detail' && selectedEntry && (
            <HistoryDetail
              entry={entries.find(e => e.id === selectedEntry)!}
              buckets={buckets}
              onBack={() => setCurrentView('history')}
              onUpdate={updateEntry}
              formatTime={formatTime}
            />
          )}
          {currentView === 'history' && (
            <div className="w-full h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">History</h2>
                {entries.length > 0 && (
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
                )}
              </div>
              {entries.length === 0 ? (
                <div className="text-gray-500 text-sm">No time entries recorded yet.</div>
              ) : (
                <div className="space-y-3 pb-8">
                  {entries.sort((a, b) => b.startTime - a.startTime).map(entry => {
                    const bucket = buckets.find(b => b.id === entry.bucketId);
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
                          <div className="flex items-center gap-2 mb-1">
                            {bucket && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bucket.color }}></div>}
                            <span className="text-sm font-medium text-gray-200">{bucket?.name || 'Unknown'}</span>
                          </div>
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
