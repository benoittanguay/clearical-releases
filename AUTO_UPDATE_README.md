# TimePortal Auto-Update System

> Complete automatic update architecture for delivering software updates to users.

## Overview

TimePortal now includes a production-ready auto-update system that automatically notifies users of new versions, downloads updates in the background, and installs them with a single click. The system is built on `electron-updater` and distributes updates via GitHub Releases.

## Features

- **Automatic Update Checks** - Checks for updates on app start and every 4 hours
- **Background Downloads** - Downloads updates silently in the background
- **Progress Tracking** - Shows download progress in real-time
- **User Notifications** - Non-intrusive notifications when updates are available
- **Configurable Behavior** - Users can customize update settings
- **Platform Support** - Works on macOS, Windows, and Linux
- **Secure Updates** - Signature verification and HTTPS-only downloads
- **Pre-release Support** - Opt-in to beta versions

## Quick Start

### For Developers

**1. Install the update notification in your app:**

```typescript
import { UpdateNotification } from './components/UpdateNotification';

function App() {
  return (
    <div>
      {/* Your app content */}

      {/* Add this - it auto-hides when not needed */}
      <UpdateNotification />
    </div>
  );
}
```

**2. (Optional) Add settings panel:**

```typescript
import { UpdateSettings } from './components/UpdateSettings';

function SettingsPage() {
  return (
    <div>
      {/* Your settings */}

      <UpdateSettings />
    </div>
  );
}
```

That's it! The auto-update system is now active.

### For Publishers

**1. Set up GitHub token:**

```bash
export GH_TOKEN=your_github_personal_access_token
```

**2. Bump version:**

```bash
npm version patch  # 0.0.0 → 0.0.1
```

**3. Build and publish:**

```bash
npm run build:electron -- --publish always
```

**4. Edit release notes on GitHub and publish**

Done! Users will automatically receive the update.

## Documentation

We've created comprehensive documentation for every use case:

### 📖 For New Users

**[Quick Start Guide](docs/AUTO_UPDATE_QUICKSTART.md)**
- 5-minute setup
- Publishing your first update
- Testing the update flow
- Common commands

### 🏗️ For Architects & DevOps

**[Complete Setup Guide](AUTO_UPDATE_SETUP.md)**
- Architecture deep-dive
- Security considerations
- Code signing setup
- Production deployment
- Troubleshooting
- API reference

### 💻 For Developers

**[Implementation Summary](AUTO_UPDATE_IMPLEMENTATION_SUMMARY.md)**
- What was implemented
- How it works
- File structure
- Testing checklist

**[Integration Examples](src/components/UpdateNotificationExample.tsx)**
- 8 different integration patterns
- Best practices
- Custom implementations

### ✅ For Project Managers

**[Implementation Checklist](AUTO_UPDATE_CHECKLIST.md)**
- Phase-by-phase completion status
- Testing requirements
- Production readiness
- Deployment tasks

## Architecture

```
┌─────────────────────────────────────────────────┐
│              GitHub Releases                     │
│  (Distribution & Update Hosting)                │
└──────────────────┬──────────────────────────────┘
                   │
                   │ HTTPS
                   │
┌──────────────────▼──────────────────────────────┐
│         electron-updater                        │
│  (Main Process - Auto-Update Logic)             │
│                                                  │
│  • Check for updates                            │
│  • Download update files                        │
│  • Verify signatures                            │
│  • Install on restart                           │
└──────────────────┬──────────────────────────────┘
                   │
                   │ IPC Communication
                   │
┌──────────────────▼──────────────────────────────┐
│         Renderer Process                        │
│  (React UI Components)                          │
│                                                  │
│  • UpdateNotification - Shows status            │
│  • UpdateSettings - User preferences            │
└──────────────────┬──────────────────────────────┘
                   │
                   │ User Actions
                   │
┌──────────────────▼──────────────────────────────┐
│              End User                           │
│  • Gets notified of updates                     │
│  • Downloads with one click                     │
│  • Installs on restart                          │
└─────────────────────────────────────────────────┘
```

## How It Works

### For End Users

1. App checks for updates automatically (5 seconds after startup)
2. If update available, notification appears in bottom-right
3. User can download update or dismiss
4. Download happens in background with progress shown
5. When ready, user clicks "Restart and Install"
6. App restarts with new version installed

### For Publishers

1. Make code changes
2. Bump version: `npm version patch`
3. Build and publish: `npm run build:electron -- --publish always`
4. electron-builder creates release on GitHub with all files
5. Users automatically notified of new version

## Files Created

```
TimePortal/
├── electron/
│   └── autoUpdater.ts                    ← Core update logic
├── src/
│   ├── components/
│   │   ├── UpdateNotification.tsx        ← Update UI
│   │   ├── UpdateSettings.tsx            ← Settings panel
│   │   └── UpdateNotificationExample.tsx ← Integration examples
│   └── types/
│       └── electron.d.ts                 ← TypeScript types (updated)
├── build/
│   └── entitlements.mac.plist            ← macOS permissions
├── docs/
│   └── AUTO_UPDATE_QUICKSTART.md         ← Quick start guide
├── AUTO_UPDATE_SETUP.md                  ← Complete guide
├── AUTO_UPDATE_IMPLEMENTATION_SUMMARY.md ← Implementation details
├── AUTO_UPDATE_CHECKLIST.md              ← Task checklist
└── AUTO_UPDATE_README.md                 ← This file
```

## Platform Support

### macOS ✅

- **Formats:** DMG (installer), ZIP (auto-update)
- **Auto-update:** Fully supported
- **Code Signing:** Recommended (requires Apple Developer account)
- **Update Method:** Background download, install on restart

### Windows ✅

- **Formats:** NSIS installer, ZIP
- **Auto-update:** Fully supported
- **Code Signing:** Recommended (requires certificate)
- **Update Method:** NSIS installer auto-run

### Linux ✅

- **Formats:** AppImage, DEB, RPM
- **Auto-update:** Supported (AppImage best)
- **Code Signing:** Not required
- **Update Method:** Varies by format

## Configuration

### User Settings (via UpdateSettings component)

- ✅ Enable/disable automatic checks
- ✅ Configure check delay (0-30 seconds)
- ✅ Enable/disable auto-download
- ✅ Opt-in to pre-release versions

### Developer Settings (electron/autoUpdater.ts)

```typescript
updater.configure({
  checkOnStartup: true,        // Check when app starts
  checkOnStartupDelay: 5000,   // Wait 5 seconds
  autoDownload: true,          // Download automatically
  allowPrerelease: false       // Only stable releases
});
```

## Security

- ✅ HTTPS-only downloads
- ✅ Signature verification (on signed builds)
- ✅ Checksum validation
- ✅ Hardened runtime (macOS)
- ✅ Code signing support
- ✅ Secure credential storage

## Testing

### Local Testing

```bash
# Build for your platform
npm run build:electron

# Install and test the built app
```

### Update Flow Testing

1. Install version 0.0.1
2. Publish version 0.0.2
3. Open 0.0.1 app
4. Wait 5 seconds
5. Update notification should appear
6. Click "Download"
7. Click "Restart and Install"
8. Verify running 0.0.2

## Production Deployment

### Prerequisites

- [x] ✅ Code implemented
- [ ] GitHub repository: `clearical/timeportal`
- [ ] GitHub token with `repo` scope
- [ ] Code signing certificates (recommended)

### Deployment Steps

1. **Set up GitHub:**
   ```bash
   export GH_TOKEN=your_token_here
   ```

2. **Version bump:**
   ```bash
   npm version 1.0.0
   ```

3. **Build and publish:**
   ```bash
   npm run build:electron -- --publish always
   ```

4. **Verify release on GitHub**

5. **Monitor adoption**

## Troubleshooting

### Common Issues

**"No updates available" (but you published one)**

- Check version numbers (published must be higher)
- Verify `latest-*.yml` files in release
- Confirm app is in production mode

**"Failed to check for updates"**

- Check internet connection
- Verify GitHub token validity
- Check repository access

**Downloads fail**

- Check disk space
- Verify network stability
- Review error logs

### Logs Location

- **macOS:** `~/Library/Logs/TimePortal/main.log`
- **Windows:** `%USERPROFILE%\AppData\Roaming\TimePortal\logs\main.log`
- **Linux:** `~/.config/TimePortal/logs/main.log`

## API Reference

### IPC Methods

```typescript
// Check for updates
const { success, status } = await window.electron.ipcRenderer.updater.checkForUpdates();

// Get current status
const { success, status } = await window.electron.ipcRenderer.updater.getStatus();

// Download update
await window.electron.ipcRenderer.updater.downloadUpdate();

// Install and restart
await window.electron.ipcRenderer.updater.quitAndInstall();

// Configure
await window.electron.ipcRenderer.updater.configure({
  checkOnStartup: true,
  autoDownload: true
});

// Listen for updates
const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate((status) => {
  console.log('Update status:', status);
});
```

### Update Status Object

```typescript
interface UpdateStatus {
  available: boolean;       // Update available
  downloaded: boolean;      // Update downloaded
  downloading: boolean;     // Currently downloading
  version?: string;         // New version
  releaseDate?: string;     // Release date
  releaseNotes?: string;    // Release notes
  error?: string;          // Error message
  downloadProgress?: {     // Download progress
    percent: number;
    transferred: number;
    total: number;
  };
}
```

## Best Practices

1. **Always test updates** before publishing to production
2. **Use semantic versioning** (major.minor.patch)
3. **Write clear release notes** for users
4. **Code sign your apps** for production
5. **Monitor update adoption** and error rates
6. **Have a rollback plan** ready
7. **Communicate breaking changes** to users
8. **Test on all platforms** before release

## Roadmap

### Current (v1.0)

- ✅ Automatic update checks
- ✅ Background downloads
- ✅ User notifications
- ✅ Progress tracking
- ✅ Configurable settings
- ✅ Platform support (macOS, Windows, Linux)

### Future Enhancements

- [ ] Differential updates (smaller downloads)
- [ ] Staged rollouts
- [ ] A/B testing
- [ ] Update analytics
- [ ] Custom update server
- [ ] Scheduled updates

## Support

### Documentation

- 📘 [Quick Start](docs/AUTO_UPDATE_QUICKSTART.md)
- 📗 [Complete Setup](AUTO_UPDATE_SETUP.md)
- 📙 [Implementation Summary](AUTO_UPDATE_IMPLEMENTATION_SUMMARY.md)
- 📕 [Checklist](AUTO_UPDATE_CHECKLIST.md)

### Resources

- electron-updater: https://www.electron.build/auto-update
- electron-builder: https://www.electron.build
- GitHub Releases: https://docs.github.com/en/repositories/releasing-projects-on-github

### Getting Help

- GitHub Issues: https://github.com/clearical/timeportal/issues
- Email: support@clearical.io

## License

Same as TimePortal main application.

---

**Status:** ✅ Complete and ready for use

**Next Steps:**
1. Integrate UpdateNotification component into your app
2. Test locally
3. Set up GitHub repository
4. Publish your first update!

**Questions?** See the [Quick Start Guide](docs/AUTO_UPDATE_QUICKSTART.md) or [Complete Setup Guide](AUTO_UPDATE_SETUP.md).
