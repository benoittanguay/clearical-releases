# App Blacklist API Reference

Quick reference guide for using the App Blacklist feature in Clearical.

## Table of Contents
- [Overview](#overview)
- [TypeScript Types](#typescript-types)
- [API Methods](#api-methods)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)

## Overview

The App Blacklist feature allows users to exclude specific applications from activity tracking. All methods are exposed via `window.electron.appBlacklist` in the renderer process.

## TypeScript Types

```typescript
interface BlacklistedApp {
    bundleId: string;      // e.g., "com.apple.Safari"
    name: string;          // e.g., "Safari"
    category?: string;     // e.g., "public.app-category.productivity"
}

interface InstalledApp {
    bundleId: string;      // e.g., "com.apple.Safari"
    name: string;          // e.g., "Safari"
    path: string;          // e.g., "/Applications/Safari.app"
    category?: string;     // e.g., "public.app-category.productivity"
    categoryName?: string; // e.g., "Productivity"
}

interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
```

## API Methods

### `getBlacklistedApps()`

Retrieves all currently blacklisted applications.

**Returns:** `Promise<{ success: boolean; data: BlacklistedApp[]; error?: string }>`

**Example:**
```typescript
const result = await window.electron.appBlacklist.getBlacklistedApps();

if (result.success) {
    console.log('Blacklisted apps:', result.data);
    // result.data = [
    //   { bundleId: 'com.apple.Safari', name: 'Safari', category: 'public.app-category.productivity' },
    //   { bundleId: 'com.spotify.client', name: 'Spotify', category: 'public.app-category.music' }
    // ]
} else {
    console.error('Error:', result.error);
}
```

---

### `addBlacklistedApp(bundleId, name, category?)`

Adds an application to the blacklist.

**Parameters:**
- `bundleId` (string, required): The app's bundle identifier
- `name` (string, required): The app's display name
- `category` (string, optional): The app's category identifier

**Returns:** `Promise<{ success: boolean; error?: string }>`

**Example:**
```typescript
const result = await window.electron.appBlacklist.addBlacklistedApp(
    'com.apple.Safari',
    'Safari',
    'public.app-category.productivity'
);

if (result.success) {
    console.log('Safari added to blacklist');
} else {
    console.error('Error:', result.error);
}
```

---

### `removeBlacklistedApp(bundleId)`

Removes an application from the blacklist.

**Parameters:**
- `bundleId` (string, required): The app's bundle identifier

**Returns:** `Promise<{ success: boolean; error?: string }>`

**Example:**
```typescript
const result = await window.electron.appBlacklist.removeBlacklistedApp('com.apple.Safari');

if (result.success) {
    console.log('Safari removed from blacklist');
} else {
    console.error('Error:', result.error);
}
```

---

### `isAppBlacklisted(bundleId)`

Checks if a specific application is blacklisted.

**Parameters:**
- `bundleId` (string, required): The app's bundle identifier

**Returns:** `Promise<{ success: boolean; isBlacklisted: boolean; error?: string }>`

**Example:**
```typescript
const result = await window.electron.appBlacklist.isAppBlacklisted('com.apple.Safari');

if (result.success) {
    if (result.isBlacklisted) {
        console.log('Safari is blacklisted');
    } else {
        console.log('Safari is not blacklisted');
    }
} else {
    console.error('Error:', result.error);
}
```

---

### `getInstalledApps()`

Scans the system and returns all installed applications with metadata.

**Platform:** macOS only (returns error on Windows/Linux)

**Returns:** `Promise<{ success: boolean; data: InstalledApp[]; error?: string }>`

**Example:**
```typescript
const result = await window.electron.appBlacklist.getInstalledApps();

if (result.success) {
    console.log(`Found ${result.data.length} installed apps`);

    result.data.forEach(app => {
        console.log(`${app.name} (${app.bundleId})`);
        console.log(`  Path: ${app.path}`);
        console.log(`  Category: ${app.categoryName || 'Unknown'}`);
    });
} else {
    console.error('Error:', result.error);
}
```

## Common Patterns

### Building a Blacklist Manager UI

```typescript
import React, { useState, useEffect } from 'react';
import type { BlacklistedApp, InstalledApp } from '../types/electron';

function BlacklistManager() {
    const [blacklistedApps, setBlacklistedApps] = useState<BlacklistedApp[]>([]);
    const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);

        // Load blacklisted apps
        const blacklistResult = await window.electron.appBlacklist.getBlacklistedApps();
        if (blacklistResult.success) {
            setBlacklistedApps(blacklistResult.data);
        }

        // Load installed apps
        const installedResult = await window.electron.appBlacklist.getInstalledApps();
        if (installedResult.success) {
            setInstalledApps(installedResult.data);
        }

        setLoading(false);
    }

    async function handleToggleBlacklist(app: InstalledApp) {
        const isBlacklisted = blacklistedApps.some(ba => ba.bundleId === app.bundleId);

        if (isBlacklisted) {
            await window.electron.appBlacklist.removeBlacklistedApp(app.bundleId);
        } else {
            await window.electron.appBlacklist.addBlacklistedApp(
                app.bundleId,
                app.name,
                app.category
            );
        }

        await loadData();
    }

    if (loading) {
        return <div>Loading apps...</div>;
    }

    return (
        <div>
            <h2>Installed Applications</h2>
            {installedApps.map(app => {
                const isBlacklisted = blacklistedApps.some(ba => ba.bundleId === app.bundleId);

                return (
                    <div key={app.bundleId}>
                        <span>{app.name}</span>
                        <span>{app.categoryName}</span>
                        <button onClick={() => handleToggleBlacklist(app)}>
                            {isBlacklisted ? 'Unblacklist' : 'Blacklist'}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
```

### Checking Before Recording Activity

```typescript
async function shouldRecordActivity(appName: string): Promise<boolean> {
    // Get bundle ID from app name (you'll need to map this based on your active window tracking)
    const bundleId = await getBundleIdForApp(appName);

    if (!bundleId) {
        // If we can't determine bundle ID, allow recording
        return true;
    }

    const result = await window.electron.appBlacklist.isAppBlacklisted(bundleId);

    if (!result.success) {
        // On error, default to allowing recording
        console.error('Failed to check blacklist:', result.error);
        return true;
    }

    // Return inverse - if blacklisted, don't record
    return !result.isBlacklisted;
}

// Usage in timer/activity recording
async function recordActivity(appName: string, windowTitle: string) {
    if (!(await shouldRecordActivity(appName))) {
        console.log(`Skipping activity - ${appName} is blacklisted`);
        return;
    }

    // Proceed with normal recording
    // ...
}
```

### Bulk Operations

```typescript
async function blacklistMultipleApps(apps: InstalledApp[]) {
    const results = await Promise.all(
        apps.map(app =>
            window.electron.appBlacklist.addBlacklistedApp(
                app.bundleId,
                app.name,
                app.category
            )
        )
    );

    const successCount = results.filter(r => r.success).length;
    console.log(`Successfully blacklisted ${successCount} of ${apps.length} apps`);
}
```

### Filtering by Category

```typescript
async function blacklistByCategory(category: string) {
    const installedResult = await window.electron.appBlacklist.getInstalledApps();

    if (!installedResult.success) {
        console.error('Failed to get installed apps:', installedResult.error);
        return;
    }

    const appsInCategory = installedResult.data.filter(app => app.category === category);

    await blacklistMultipleApps(appsInCategory);
}

// Example: Blacklist all games
await blacklistByCategory('public.app-category.games');
```

## Error Handling

All API methods return a response object with a `success` boolean. Always check this before using the data:

```typescript
// ✅ Good - Proper error handling
const result = await window.electron.appBlacklist.getBlacklistedApps();
if (result.success) {
    // Use result.data safely
    setApps(result.data);
} else {
    // Handle error
    console.error('Failed to load apps:', result.error);
    showErrorToast(result.error || 'Unknown error');
}

// ❌ Bad - No error handling
const result = await window.electron.appBlacklist.getBlacklistedApps();
setApps(result.data); // Could be undefined if success === false!
```

### Common Errors

- **"App discovery is only available on macOS"**: `getInstalledApps()` was called on Windows/Linux
- **"Failed to parse Info.plist"**: An app bundle is corrupted or malformed
- **"No bundle ID found"**: An app's Info.plist is missing required fields
- **Database errors**: Usually indicate database corruption or permission issues

## Best Practices

1. **Cache installed apps**: The `getInstalledApps()` scan can be slow. Cache the results and only refresh when needed.

2. **Debounce blacklist checks**: If checking many apps rapidly, debounce the calls to avoid overwhelming the IPC bridge.

3. **Provide feedback**: Show loading states when scanning apps or updating the blacklist.

4. **Handle offline**: The blacklist is stored locally and doesn't require network access.

5. **Validate bundle IDs**: Always use the bundle ID (not the app name) as the unique identifier.

## App Categories

Common macOS app categories you might encounter:

- `public.app-category.productivity` - Productivity
- `public.app-category.developer-tools` - Developer Tools
- `public.app-category.music` - Music
- `public.app-category.video` - Video
- `public.app-category.graphics-design` - Graphics & Design
- `public.app-category.games` - Games
- `public.app-category.social-networking` - Social Networking
- `public.app-category.business` - Business
- `public.app-category.finance` - Finance
- `public.app-category.education` - Education
- `public.app-category.utilities` - Utilities

For a complete list, see the `AppCategories` export in `electron/appDiscoveryService.ts`.
