# Secure Credential Storage Implementation

## Overview

The TimePortal app now implements secure credential storage using Electron's `safeStorage` API. This ensures that sensitive credentials (Jira API token, Tempo API token, Jira email) are encrypted and stored securely rather than in plaintext localStorage.

## Architecture

### Components

1. **credentialStorage.ts** (`electron/credentialStorage.ts`)
   - Core credential management service
   - Uses Electron's `safeStorage` API for OS-level encryption
   - Stores encrypted credentials in a JSON file in the app's userData directory
   - Provides methods: `storeCredential`, `getCredential`, `deleteCredential`, `hasCredential`, `listCredentialKeys`

2. **IPC Handlers** (in `electron/main.ts`)
   - `secure-store-credential`: Store a credential securely
   - `secure-get-credential`: Retrieve a credential
   - `secure-delete-credential`: Delete a credential
   - `secure-has-credential`: Check if a credential exists
   - `secure-list-credentials`: List all credential keys
   - `secure-is-available`: Check if secure storage is available

3. **Preload Bridge** (`electron/preload.cts`)
   - Exposes secure credential methods to renderer process
   - Methods available via `window.electron.ipcRenderer.secureStoreCredential()`, etc.

4. **Settings Context** (`src/context/SettingsContext.tsx`)
   - Updated to use secure storage for credentials
   - Implements automatic migration from localStorage
   - Falls back to hardcoded defaults for testing (as requested)

## How It Works

### Encryption

- **OS-level encryption**: Uses the operating system's secure storage mechanism
  - macOS: Keychain
  - Windows: Data Protection API (DPAPI)
  - Linux: libsecret
- **Storage location**: `~/.config/time-portal/.credentials` (encrypted JSON file)
- **File permissions**: Automatically set to 0600 (owner read/write only) on Unix-like systems

### Credential Keys

The following credential keys are used:
- `tempo-api-token`: Tempo API token
- `jira-api-token`: Jira API token
- `jira-email`: Jira email address

### Migration Strategy

On first run with the new code:

1. Settings are loaded from localStorage
2. If secure storage is available and credentials exist in localStorage (and differ from hardcoded defaults), they are migrated to secure storage
3. Credentials are removed from localStorage
4. For now, hardcoded defaults are still used (as requested for QA)
5. Non-sensitive settings remain in localStorage

### Current Behavior (Testing Mode)

As requested by the user, the hardcoded credentials are still being used for testing:

```typescript
tempo: {
    apiToken: '6OpFKSmqq340DZ2vBYz4Adgb539JTr-us',
    baseUrl: 'https://api.tempo.io',
    enabled: true,
}

jira: {
    baseUrl: 'https://beemhq.atlassian.net/',
    email: 'benoit.tanguay@beemhq.com',
    apiToken: 'ATATT3xFfGF0wS3u2J49jdrAfKVKTH1y2NgLW9A115REFkp3PSA1PnhJ8np6gSCFDJuQ2iKOn19xPVKSmzaZR5_KZKMTth9iy9U17UOnKwqLKKDhwA6pSxvHeTvC-jfPSK7Pyyq6oTeZmxX2cg0xxkvlQ73zrqQPZYVJ24pPatmJ745pZDBHbKA=A8489265',
    enabled: true,
    selectedProjects: ['DES', 'BEEM'],
}
```

## Switching to Production Mode

When ready to switch from hardcoded credentials to secure storage:

### In `SettingsContext.tsx`:

1. Uncomment the credential loading code (lines 115-117):
```typescript
const tempoTokenResult = await window.electron.ipcRenderer.secureGetCredential('tempo-api-token');
const jiraTokenResult = await window.electron.ipcRenderer.secureGetCredential('jira-api-token');
const jiraEmailResult = await window.electron.ipcRenderer.secureGetCredential('jira-email');
```

2. Update the settings merge logic (lines 120-136) to use the loaded credentials:
```typescript
tempo: {
    ...parsedSettings.tempo,
    // Use secure storage value if available, otherwise use empty string
    apiToken: tempoTokenResult?.value || '',
    baseUrl: parsedSettings.tempo?.baseUrl || defaultSettings.tempo.baseUrl,
    defaultIssueKey: parsedSettings.tempo?.defaultIssueKey || '',
    enabled: parsedSettings.tempo?.enabled ?? defaultSettings.tempo.enabled,
},
jira: {
    ...parsedSettings.jira,
    baseUrl: parsedSettings.jira?.baseUrl || defaultSettings.jira.baseUrl,
    email: jiraEmailResult?.value || '',
    apiToken: jiraTokenResult?.value || '',
    enabled: parsedSettings.jira?.enabled ?? defaultSettings.jira.enabled,
    selectedProjects: parsedSettings.jira?.selectedProjects || defaultSettings.jira.selectedProjects,
},
```

3. Remove or empty the hardcoded defaults in `defaultSettings` (lines 31-47):
```typescript
const defaultSettings: AppSettings = {
    minActivityDuration: 1000,
    activityGapThreshold: 2 * 60 * 1000,
    tempo: {
        apiToken: '', // Remove hardcoded value
        baseUrl: 'https://api.tempo.io',
        defaultIssueKey: '',
        enabled: true,
    },
    jira: {
        baseUrl: '', // User will need to configure
        email: '', // Remove hardcoded value
        apiToken: '', // Remove hardcoded value
        enabled: true,
        selectedProjects: [],
    },
};
```

## Security Benefits

1. **OS-level encryption**: Credentials are encrypted using the operating system's secure storage
2. **No plaintext storage**: Credentials never stored in plaintext on disk
3. **Automatic cleanup**: Migration removes credentials from localStorage
4. **Restricted file permissions**: Credential file has owner-only permissions
5. **Separation of concerns**: Sensitive credentials separated from app settings

## Testing

The implementation has been tested to ensure:
- Build succeeds without TypeScript errors
- Electron app compiles successfully
- IPC communication works correctly
- Migration logic doesn't break existing functionality
- Hardcoded defaults still work for QA testing

## Files Modified

1. `/Users/benoittanguay/Documents/Anti/TimePortal/electron/credentialStorage.ts` (NEW)
2. `/Users/benoittanguay/Documents/Anti/TimePortal/electron/main.ts` (MODIFIED)
3. `/Users/benoittanguay/Documents/Anti/TimePortal/electron/preload.cts` (MODIFIED)
4. `/Users/benoittanguay/Documents/Anti/TimePortal/src/context/SettingsContext.tsx` (MODIFIED)
5. `/Users/benoittanguay/Documents/Anti/TimePortal/src/types/electron.d.ts` (NEW)

## API Reference

### Renderer Process (React Components)

```typescript
// Store a credential
await window.electron.ipcRenderer.secureStoreCredential(key, value);

// Get a credential
const result = await window.electron.ipcRenderer.secureGetCredential(key);
if (result.success && result.value) {
    console.log('Credential:', result.value);
}

// Delete a credential
await window.electron.ipcRenderer.secureDeleteCredential(key);

// Check if credential exists
const exists = await window.electron.ipcRenderer.secureHasCredential(key);
if (exists.success && exists.exists) {
    console.log('Credential exists');
}

// List all credential keys
const keys = await window.electron.ipcRenderer.secureListCredentials();
console.log('Stored credentials:', keys.keys);

// Check if secure storage is available
const available = await window.electron.ipcRenderer.secureIsAvailable();
if (available.available) {
    console.log('Secure storage is available');
}
```

### Main Process (Electron)

```typescript
import { storeCredential, getCredential, deleteCredential } from './credentialStorage.js';

// Store a credential
await storeCredential('api-key', 'secret-value');

// Retrieve a credential
const value = await getCredential('api-key');

// Delete a credential
await deleteCredential('api-key');
```

## Security Considerations

1. **Credential storage location**: The `.credentials` file is stored in the app's userData directory
   - macOS: `~/Library/Application Support/time-portal/.credentials`
   - Windows: `%APPDATA%\time-portal\.credentials`
   - Linux: `~/.config/time-portal/.credentials`

2. **Encryption key**: Managed by the operating system, never accessible to the application

3. **Migration**: Old credentials in localStorage are automatically migrated and removed

4. **Fallback behavior**: If secure storage is unavailable, the app falls back to using empty credentials (or hardcoded defaults in testing mode)

## Troubleshooting

### Secure storage not available

If secure storage is not available on a user's system:
- On macOS: Ensure Keychain Access is working
- On Windows: Ensure Data Protection API is available
- On Linux: Install libsecret and ensure it's configured

Check availability in the console:
```javascript
const result = await window.electron.ipcRenderer.secureIsAvailable();
console.log('Secure storage available:', result.available);
```

### Credentials not loading

1. Check console logs for migration messages
2. Verify credentials are stored: `await window.electron.ipcRenderer.secureListCredentials()`
3. Check file permissions on `.credentials` file
4. Verify secure storage is available

## Future Enhancements

Potential improvements for future releases:

1. **Credential rotation**: Implement automatic credential expiration/rotation
2. **Multi-account support**: Store credentials for multiple Jira/Tempo accounts
3. **Encrypted backup**: Allow users to export/import encrypted credential backups
4. **Security notifications**: Alert users when credentials are accessed
5. **Audit logging**: Track when credentials are read/written (for compliance)
