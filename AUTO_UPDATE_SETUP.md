# Auto-Update Setup for TimePortal

This document describes the auto-update architecture implemented for TimePortal using `electron-updater`.

## Overview

TimePortal uses GitHub Releases as the update distribution mechanism. When you publish a new release to GitHub, users will automatically receive update notifications.

## Architecture

### Components

1. **electron/autoUpdater.ts** - Core auto-update logic
   - Manages update checking, downloading, and installation
   - Handles progress tracking and error states
   - Configurable update behavior

2. **electron/main.ts** - IPC handlers
   - Exposes update APIs to renderer process
   - Initializes updater on app start
   - Manages update notifications

3. **src/components/UpdateNotification.tsx** - UI component
   - Displays update notifications to users
   - Shows download progress
   - Handles user interactions (download, install, dismiss)

4. **src/components/UpdateSettings.tsx** - Configuration UI
   - Allows users to configure update behavior
   - Settings for auto-download, check frequency, pre-releases

### Update Flow

1. **Automatic Check** (Default)
   - App checks for updates 5 seconds after startup
   - Periodic checks every 4 hours
   - Configurable via UpdateSettings

2. **Download**
   - Automatic background download when update found (configurable)
   - Manual download option available
   - Progress tracking with percent and bytes transferred

3. **Installation**
   - Update downloaded silently in background
   - User notified when ready to install
   - Install happens on app restart (user can choose when)
   - Auto-install on quit enabled by default

## Publishing Updates

### Prerequisites

1. **GitHub Repository**
   - Repository: `clearical/timeportal`
   - Must have releases enabled

2. **GitHub Token**
   - Create a personal access token with `repo` scope
   - Set as environment variable: `GH_TOKEN`

3. **Code Signing** (for macOS and Windows)
   - **macOS**: Apple Developer certificate
     - Set `CSC_LINK` (path to .p12) and `CSC_KEY_PASSWORD`
   - **Windows**: Code signing certificate
     - Set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`

### Publishing Process

#### 1. Update Version

```bash
# Update version in package.json
npm version patch  # or minor, major
# This creates a git tag
```

#### 2. Build and Publish

```bash
# Set GitHub token
export GH_TOKEN=your_github_token

# Build and publish for current platform
npm run build:electron -- --publish always

# Or for specific platforms
npm run build:electron -- --mac --publish always
npm run build:electron -- --win --publish always
npm run build:electron -- --linux --publish always
```

#### 3. GitHub Release

The `--publish always` flag will:
- Build the app
- Create a GitHub release (draft)
- Upload build artifacts
- Publish release notes from git commits

After publishing, edit the GitHub release to:
- Add release notes
- Mark as pre-release if needed
- Publish the release

### Build Artifacts

Each platform produces specific artifacts:

**macOS:**
- `TimePortal-{version}.dmg` - Installer
- `TimePortal-{version}-mac.zip` - Update package (used by auto-updater)
- `latest-mac.yml` - Update metadata

**Windows:**
- `TimePortal Setup {version}.exe` - Installer (NSIS)
- `TimePortal-{version}-win.zip` - Portable version
- `latest.yml` - Update metadata

**Linux:**
- `TimePortal-{version}.AppImage` - AppImage
- `TimePortal_{version}_amd64.deb` - Debian package
- `TimePortal-{version}.rpm` - RPM package
- `latest-linux.yml` - Update metadata

## Configuration

### electron-builder (package.json)

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "clearical",
      "repo": "timeportal",
      "releaseType": "release"
    }
  }
}
```

### Auto-Updater Options

```typescript
updater.configure({
  checkOnStartup: true,        // Check on app start
  checkOnStartupDelay: 5000,   // Delay in milliseconds
  autoDownload: true,          // Auto-download updates
  allowPrerelease: false       // Include pre-releases
});
```

## User Experience

### Update Notification

Users see a notification in the bottom-right corner when:
- Update is available
- Update is downloading (with progress)
- Update is ready to install

### User Actions

- **Download Update** - Manually download available update
- **Restart and Install** - Install downloaded update and restart
- **Later** - Dismiss notification (update remains available)
- **Check for Updates** - Manually check for new updates

### Settings

Users can configure:
- Automatic update checks on startup
- Delay before checking for updates
- Automatic download of updates
- Pre-release channel opt-in

## Testing

### Local Testing

1. **Build a test release:**
   ```bash
   npm run build:electron
   ```

2. **Test update flow:**
   - Install the built app
   - Increment version in package.json
   - Build again with `--publish never`
   - Copy new artifacts to a test server
   - Point app to test server (modify `electron/autoUpdater.ts`)

### Production Testing

1. Create a pre-release on GitHub
2. Enable pre-release in app settings
3. Test update flow with actual users

## Security Considerations

### Code Signing

**Critical for Production:**
- macOS requires notarization for auto-updates to work
- Windows SmartScreen will block unsigned updates
- Users will see security warnings without proper signing

### Update Verification

electron-updater automatically verifies:
- Signature verification (on signed builds)
- Checksum validation
- HTTPS-only downloads

### Permissions

The app requires:
- Network access (for downloading updates)
- Disk access (for installing updates)
- Elevated privileges on Windows (for system-wide install)

## Troubleshooting

### Updates Not Found

1. Check GitHub release exists and is published
2. Verify `latest-*.yml` files are present in release
3. Check app version is lower than release version
4. Review logs in `~/Library/Logs/TimePortal/` (macOS)

### Download Fails

1. Check network connectivity
2. Verify GitHub token permissions
3. Check firewall settings
4. Review error in update notification

### Installation Fails

1. Check disk space
2. Verify app permissions
3. Check if app is running from read-only location
4. Review logs for specific errors

### Debugging

Enable verbose logging:
```typescript
// In electron/autoUpdater.ts
import log from 'electron-log';
log.transports.file.level = 'debug';
```

Logs location:
- macOS: `~/Library/Logs/TimePortal/main.log`
- Windows: `%USERPROFILE%\\AppData\\Roaming\\TimePortal\\logs\\main.log`
- Linux: `~/.config/TimePortal/logs/main.log`

## API Reference

### IPC Handlers

**Main Process (electron/main.ts):**

```typescript
'updater:check-for-updates'  // Check for updates
'updater:get-status'         // Get current status
'updater:download-update'    // Download update
'updater:quit-and-install'   // Install and restart
'updater:configure'          // Configure updater
```

**Renderer Process (window.electron.ipcRenderer.updater):**

```typescript
// Check for updates
const { success, status } = await updater.checkForUpdates();

// Get current status
const { success, status } = await updater.getStatus();

// Download update
await updater.downloadUpdate();

// Install and restart
await updater.quitAndInstall();

// Configure
await updater.configure({
  checkOnStartup: true,
  autoDownload: true
});

// Listen for status updates
const unsubscribe = updater.onStatusUpdate((status) => {
  console.log('Update status:', status);
});
```

### Update Status Object

```typescript
interface UpdateStatus {
  available: boolean;       // Update available
  downloaded: boolean;      // Update downloaded
  downloading: boolean;     // Download in progress
  version?: string;         // New version number
  releaseDate?: string;     // Release date
  releaseNotes?: string;    // Release notes
  error?: string;          // Error message
  downloadProgress?: {     // Download progress
    percent: number;       // Percent complete
    transferred: number;   // Bytes transferred
    total: number;        // Total bytes
  };
}
```

## Best Practices

1. **Version Numbering**
   - Use semantic versioning (MAJOR.MINOR.PATCH)
   - Increment appropriately for changes
   - Tag releases in git

2. **Release Notes**
   - Write clear, user-friendly release notes
   - Highlight breaking changes
   - Include bug fixes and new features

3. **Testing**
   - Test updates on all platforms before release
   - Use pre-releases for beta testing
   - Monitor update success rates

4. **Communication**
   - Notify users of important updates
   - Provide rollback instructions if needed
   - Maintain changelog

5. **Monitoring**
   - Track update adoption rates
   - Monitor error reports
   - Collect user feedback

## Future Enhancements

- [ ] Differential updates (delta patches)
- [ ] Background update installation
- [ ] Rollback mechanism
- [ ] A/B testing for updates
- [ ] Update analytics
- [ ] Custom update server option
- [ ] Update scheduling (install at specific time)

## Support

For issues or questions:
- GitHub Issues: https://github.com/clearical/timeportal/issues
- Documentation: https://github.com/clearical/timeportal/wiki
- Email: support@clearical.io
