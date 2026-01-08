import { useState } from 'react';
import { useStorage } from '../context/StorageContext';
import { generateMockData } from '../utils/mockDataGenerator';

/**
 * DevTools component for development and testing.
 * Provides utilities to seed mock data, clear data, etc.
 *
 * This component should only be rendered in development mode.
 */
export function DevTools() {
  const { buckets, entries, seedEntries, clearAllEntries } = useStorage();
  const [isOpen, setIsOpen] = useState(false);
  const [daysBack, setDaysBack] = useState(14);
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedData = () => {
    setIsSeeding(true);
    try {
      const mockEntries = generateMockData(daysBack, buckets);

      // Add all mock entries in a single batch operation through the context
      seedEntries(mockEntries);

      alert(`Successfully seeded ${mockEntries.length} mock entries!`);
    } catch (error) {
      console.error('Failed to seed mock data:', error);
      alert(`Failed to seed data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to clear all entries? This cannot be undone.')) {
      clearAllEntries();
      alert('All entries cleared successfully!');
    }
  };

  const handleExportData = () => {
    const data = {
      buckets,
      entries,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeportal-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';

    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);

          if (data.buckets) {
            localStorage.setItem('timeportal-buckets', JSON.stringify(data.buckets));
          }
          if (data.entries) {
            localStorage.setItem('timeportal-entries', JSON.stringify(data.entries));
          }

          alert('Data imported successfully! Reload the app to see changes.');
          window.location.reload();
        } catch (error) {
          console.error('Failed to import data:', error);
          alert(`Failed to import data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-purple-600 hover:bg-purple-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50"
        title="Open DevTools"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <h3 className="text-sm font-bold text-white">DevTools</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="bg-gray-900/50 rounded p-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Buckets:</span>
            <span className="text-white font-mono">{buckets.length}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Entries:</span>
            <span className="text-white font-mono">{entries.length}</span>
          </div>
        </div>

        {/* Mock Data Seeding */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase font-bold tracking-wider">
            Seed Mock Data
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={daysBack}
              onChange={(e) => setDaysBack(Math.max(1, parseInt(e.target.value) || 1))}
              min="1"
              max="365"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
              placeholder="Days"
            />
            <button
              onClick={handleSeedData}
              disabled={isSeeding}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
            >
              {isSeeding ? 'Seeding...' : 'Seed'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Generate 1-2 activities per day (excludes weekends)
          </p>
        </div>

        {/* Data Management */}
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase font-bold tracking-wider">
            Data Management
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportData}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded transition-colors"
            >
              Export JSON
            </button>
            <button
              onClick={handleImportData}
              className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded transition-colors"
            >
              Import JSON
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="space-y-2 pt-2 border-t border-gray-700">
          <label className="text-xs text-red-400 uppercase font-bold tracking-wider">
            Danger Zone
          </label>
          <button
            onClick={handleClearData}
            className="w-full px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 text-red-400 text-xs font-medium rounded transition-colors"
          >
            Clear All Entries
          </button>
        </div>
      </div>
    </div>
  );
}
