/**
 * Standalone seed script that can be run from the browser console.
 *
 * Usage in browser console:
 * 1. Open the Clearical app
 * 2. Open browser DevTools (F12 or Cmd+Option+I)
 * 3. Go to Console tab
 * 4. Run: seedMockData(14)  // Seeds 14 days of data
 * 5. Reload the page to see the seeded data
 *
 * Additional commands:
 * - clearAllData() - Clears all entries
 * - exportData() - Downloads current data as JSON
 */

import { seedMockDataToLocalStorage, clearAllEntries } from './mockDataGenerator';

// Expose functions to window for console access
declare global {
  interface Window {
    seedMockData: (days?: number) => void;
    clearAllData: () => void;
    exportData: () => void;
  }
}

window.seedMockData = (days: number = 14) => {
  try {
    seedMockDataToLocalStorage(days);
    console.log(`%c✓ Successfully seeded ${days} days of mock data`, 'color: green; font-weight: bold');
    console.log('%cReload the page to see the changes', 'color: yellow');
  } catch (error) {
    console.error('Failed to seed mock data:', error);
  }
};

window.clearAllData = () => {
  try {
    clearAllEntries();
    console.log('%c✓ All entries cleared', 'color: green; font-weight: bold');
    console.log('%cReload the page to see the changes', 'color: yellow');
  } catch (error) {
    console.error('Failed to clear data:', error);
  }
};

window.exportData = () => {
  try {
    const buckets = localStorage.getItem('timeportal-buckets');
    const entries = localStorage.getItem('timeportal-entries');

    const data = {
      buckets: buckets ? JSON.parse(buckets) : [],
      entries: entries ? JSON.parse(entries) : [],
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timeportal-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('%c✓ Data exported successfully', 'color: green; font-weight: bold');
  } catch (error) {
    console.error('Failed to export data:', error);
  }
};

// Log available commands
console.log('%cClearical Dev Utils Available:', 'color: cyan; font-weight: bold; font-size: 14px');
console.log('%cseedMockData(days)', 'color: yellow', '- Seed mock data for N days (default: 14)');
console.log('%cclearAllData()', 'color: yellow', '- Clear all entries');
console.log('%cexportData()', 'color: yellow', '- Export current data as JSON');

export {};
