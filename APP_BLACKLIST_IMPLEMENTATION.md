# App Blacklist Feature - Backend Implementation

This document describes the backend implementation for the app blacklist feature in Clearical, which allows users to exclude specific applications from activity recording.

## Overview

The app blacklist feature enables users to prevent specific applications from being tracked in their activity logs. This is useful for excluding personal apps, system utilities, or any applications users don't want included in their time tracking.

## Architecture

### 1. Database Layer (`electron/databaseService.ts`)

**Table Schema:**
```sql
CREATE TABLE IF NOT EXISTS blacklisted_apps (
    bundle_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blacklisted_apps_name ON blacklisted_apps(name);
```

**CRUD Operations:**
- `getAllBlacklistedApps()`: Returns all blacklisted apps sorted by name
- `isAppBlacklisted(bundleId)`: Check if a specific app is blacklisted
- `addBlacklistedApp(bundleId, name, category?)`: Add an app to the blacklist
- `removeBlacklistedApp(bundleId)`: Remove an app from the blacklist
- `clearBlacklistedApps()`: Remove all apps from the blacklist

### 2. App Discovery Service (`electron/appDiscoveryService.ts`)

A new service that scans the macOS system to discover installed applications.

**Key Features:**
- Scans `/Applications`, `/System/Applications`, and `~/Applications`
- Extracts app metadata from `Info.plist` files:
  - Bundle identifier (e.g., `com.apple.Safari`)
  - Display name
  - Category (`LSApplicationCategoryType`)
  - Icon path
- Supports common macOS app categories (productivity, developer-tools, music, video, games, etc.)
- Handles edge cases (missing Info.plist, invalid bundles, etc.)

**Methods:**
- `getInstalledApps()`: Returns list of all installed apps with metadata
- `getAppByBundleId(bundleId)`: Find specific app by bundle ID
- `getCategoryName(category)`: Convert category identifier to human-readable name

### 3. IPC Handlers (`electron/main.ts`)

Five new IPC handlers provide the communication bridge:

1. **`get-blacklisted-apps`**
   - Returns: `{ success: boolean; data: BlacklistedApp[]; error?: string }`
   - Retrieves all currently blacklisted apps from the database

2. **`add-blacklisted-app`**
   - Parameters: `bundleId: string, name: string, category?: string`
   - Returns: `{ success: boolean; error?: string }`
   - Adds an app to the blacklist

3. **`remove-blacklisted-app`**
   - Parameters: `bundleId: string`
   - Returns: `{ success: boolean; error?: string }`
   - Removes an app from the blacklist

4. **`is-app-blacklisted`**
   - Parameters: `bundleId: string`
   - Returns: `{ success: boolean; isBlacklisted: boolean; error?: string }`
   - Checks if a specific app is blacklisted

5. **`get-installed-apps`**
   - Returns: `{ success: boolean; data: InstalledApp[]; error?: string }`
   - Scans the system and returns all installed apps with metadata
   - macOS only - returns error on other platforms

### 4. Preload Exposure (`electron/preload.cts`)

The IPC methods are exposed to the renderer process via `window.electron.appBlacklist`:

```typescript
window.electron.appBlacklist = {
    getBlacklistedApps: () => Promise<{ success: boolean; data: BlacklistedApp[]; error?: string }>,
    addBlacklistedApp: (bundleId: string, name: string, category?: string) => Promise<{ success: boolean; error?: string }>,
    removeBlacklistedApp: (bundleId: string) => Promise<{ success: boolean; error?: string }>,
    isAppBlacklisted: (bundleId: string) => Promise<{ success: boolean; isBlacklisted: boolean; error?: string }>,
    getInstalledApps: () => Promise<{ success: boolean; data: InstalledApp[]; error?: string }>
}
```

### 5. TypeScript Types (`src/types/electron.d.ts`)

Added type definitions for the blacklist feature:

```typescript
export interface BlacklistedApp {
    bundleId: string;
    name: string;
    category?: string;
}

export interface InstalledApp {
    bundleId: string;
    name: string;
    path: string;
    category?: string;
    categoryName?: string;
}
```

## Usage Examples

### Frontend Integration

```typescript
// Get all blacklisted apps
const result = await window.electron.appBlacklist.getBlacklistedApps();
if (result.success) {
    console.log('Blacklisted apps:', result.data);
}

// Get all installed apps
const installedApps = await window.electron.appBlacklist.getInstalledApps();
if (installedApps.success) {
    console.log('Installed apps:', installedApps.data);
}

// Add an app to blacklist
await window.electron.appBlacklist.addBlacklistedApp(
    'com.apple.Safari',
    'Safari',
    'public.app-category.productivity'
);

// Check if an app is blacklisted
const checkResult = await window.electron.appBlacklist.isAppBlacklisted('com.apple.Safari');
if (checkResult.success && checkResult.isBlacklisted) {
    console.log('Safari is blacklisted');
}

// Remove an app from blacklist
await window.electron.appBlacklist.removeBlacklistedApp('com.apple.Safari');
```

### Integration with Activity Recording

The blacklist should be checked during activity recording. For example, in the timer or screenshot capture logic:

```typescript
// Example: Before recording activity
const activeWindow = await window.electron.ipcRenderer.getActiveWindow();
// Extract bundle ID from active window (implementation depends on your active window tracking)
const bundleId = extractBundleIdFromWindow(activeWindow);

const blacklistCheck = await window.electron.appBlacklist.isAppBlacklisted(bundleId);
if (blacklistCheck.success && blacklistCheck.isBlacklisted) {
    // Skip recording for this activity
    console.log('Skipping activity - app is blacklisted');
    return;
}

// Proceed with normal recording
await recordActivity(activeWindow);
```

## Platform Support

- **macOS**: Full support with app discovery and Info.plist parsing
- **Windows/Linux**: Database operations work, but `get-installed-apps` returns an error

To add Windows/Linux support in the future:
1. Implement app discovery for those platforms in `appDiscoveryService.ts`
2. Extract app identifiers from Windows registry or Linux .desktop files
3. Adapt the category mapping for platform-specific app categories

## Security Considerations

1. **Bundle ID Validation**: The database uses bundle IDs as primary keys, ensuring uniqueness
2. **SQL Injection Protection**: All database operations use prepared statements
3. **Input Sanitization**: App names and categories are stored as-is but queried safely
4. **File System Access**: App discovery only reads from standard application directories
5. **Error Handling**: All IPC handlers include try-catch blocks with proper error responses

## Performance Considerations

1. **App Discovery Caching**: Consider caching the installed apps list in the frontend to avoid repeated system scans
2. **Database Indexing**: The `name` column is indexed for faster searches
3. **Lazy Loading**: The `get-installed-apps` operation can be slow on first run; consider showing a loading state
4. **Batch Operations**: For bulk blacklisting, consider adding a batch insert method

## Future Enhancements

1. **App Icon Extraction**: The `appDiscoveryService` already finds icon paths - these could be extracted and cached
2. **Category Filtering**: Allow users to blacklist entire categories (e.g., all games)
3. **Regex Patterns**: Support pattern-based blacklisting (e.g., `com.apple.*`)
4. **Import/Export**: Allow users to export/import their blacklist configuration
5. **Smart Suggestions**: Use AI to suggest apps to blacklist based on usage patterns
6. **Temporary Blacklisting**: Add time-based blacklisting (e.g., block during work hours)

## Testing

To test the implementation:

1. **Database Operations**:
   ```typescript
   const db = DatabaseService.getInstance();
   db.addBlacklistedApp('com.test.app', 'Test App', 'public.app-category.productivity');
   console.log(db.getAllBlacklistedApps());
   console.log(db.isAppBlacklisted('com.test.app')); // true
   db.removeBlacklistedApp('com.test.app');
   ```

2. **App Discovery** (macOS only):
   ```typescript
   const apps = await AppDiscoveryService.getInstalledApps();
   console.log(`Found ${apps.length} apps`);
   apps.forEach(app => {
       console.log(`${app.name} (${app.bundleId}) - ${app.category || 'No category'}`);
   });
   ```

3. **IPC Integration**:
   - Test in the renderer process using the browser console
   - Verify all operations return proper success/error responses
   - Check that database persistence works across app restarts

## Migration Notes

The `blacklisted_apps` table is created automatically when the app starts via the `initializeSchema()` method in `DatabaseService`. Existing databases will have the table added on next launch.

No data migration is needed as this is a new feature.

## Dependencies

- **plist**: Used to parse macOS Info.plist files (already in package.json)
- **better-sqlite3**: Database operations (already in package.json)

## Files Modified/Created

### Created:
- `electron/appDiscoveryService.ts` - App discovery service for macOS

### Modified:
- `electron/databaseService.ts` - Added blacklisted_apps table and CRUD operations
- `electron/main.ts` - Added IPC handlers and service import
- `electron/preload.cts` - Exposed appBlacklist API to renderer
- `src/types/electron.d.ts` - Added TypeScript type definitions

## Next Steps

1. Create the frontend UI components:
   - Settings panel for managing blacklisted apps
   - App picker showing installed apps with search/filter
   - Category grouping for easier navigation
   - Visual feedback when apps are blacklisted

2. Integrate with activity recording:
   - Check blacklist before capturing screenshots
   - Skip timer updates for blacklisted apps
   - Optionally pause timer when switching to blacklisted app

3. Add user preferences:
   - Setting to auto-pause vs skip recording
   - Notification when blacklisted app is detected
   - Hotkey to quickly blacklist current app

4. Testing:
   - Unit tests for database operations
   - Integration tests for IPC handlers
   - UI tests for frontend components
