# Auto-Update Quick Start Guide

This guide will help you quickly set up and publish your first update for TimePortal.

## Quick Setup (5 minutes)

### 1. Set Up GitHub Repository

Your app is already configured to use:
- **Repository**: `clearical/timeportal`
- **Provider**: GitHub Releases

Make sure the repository exists and you have push access.

### 2. Get GitHub Token

```bash
# Create a GitHub Personal Access Token with 'repo' scope
# Visit: https://github.com/settings/tokens/new

# Set it as an environment variable
export GH_TOKEN=ghp_your_token_here

# Add to your ~/.zshrc or ~/.bashrc for persistence
echo 'export GH_TOKEN=ghp_your_token_here' >> ~/.zshrc
```

### 3. Build and Test Locally

```bash
# Build the app for your platform
npm run build:electron

# The built app will be in the 'dist' folder
# Install and test it
```

## Publishing Your First Update

### Step 1: Update Version

```bash
# Update version in package.json
npm version patch
# This creates version 0.0.1 if starting from 0.0.0
```

### Step 2: Build and Publish

```bash
# Make sure GH_TOKEN is set
export GH_TOKEN=ghp_your_token_here

# Build and publish to GitHub
npm run build:electron -- --publish always
```

This will:
- ✅ Build your app
- ✅ Create a GitHub Release
- ✅ Upload installers and update files
- ✅ Make the update available to users

### Step 3: Verify on GitHub

1. Go to: `https://github.com/clearical/timeportal/releases`
2. You should see a new release with:
   - Version tag (e.g., `v0.0.1`)
   - Release files (DMG, ZIP, YML)
   - Auto-generated release notes

3. Edit the release to add user-friendly release notes

## Testing Updates

### Test Update Flow

1. Install the version you just published
2. Increment the version: `npm version patch`
3. Build and publish again: `npm run build:electron -- --publish always`
4. Open the installed app
5. Within 5 seconds, you should see an update notification
6. Click "Download Update"
7. Once downloaded, click "Restart and Install"

## Integration in Your App

### Add Update Notification to Your Main App

```typescript
// In your main App component (e.g., App.tsx)
import { UpdateNotification } from './components/UpdateNotification';

function App() {
    return (
        <div>
            {/* Your existing app UI */}

            {/* Add update notification - it auto-hides when not needed */}
            <UpdateNotification />
        </div>
    );
}
```

### Add Settings Page (Optional)

```typescript
// In your Settings component
import { UpdateSettings } from './components/UpdateSettings';

function SettingsPage() {
    return (
        <div>
            {/* Other settings */}

            <UpdateSettings />
        </div>
    );
}
```

## Common Commands

```bash
# Check current version
npm version

# Update version (creates git tag)
npm version patch    # 0.0.0 → 0.0.1
npm version minor    # 0.0.0 → 0.1.0
npm version major    # 0.0.0 → 1.0.0

# Build without publishing
npm run build:electron

# Build and publish
npm run build:electron -- --publish always

# Build for specific platform
npm run build:electron -- --mac --publish always
npm run build:electron -- --win --publish always

# Create pre-release
npm version prerelease
npm run build:electron -- --publish always
# Then mark the release as "pre-release" on GitHub
```

## Update Flow (How It Works)

```
App Starts
    ↓
5 seconds delay
    ↓
Check GitHub for new version
    ↓
[Update Available?]
    ↓ YES
Show notification: "Update available"
    ↓
[Auto-download enabled?]
    ↓ YES
Download in background
    ↓
Show progress: "Downloading... 45%"
    ↓
Download complete
    ↓
Show notification: "Update ready - Restart to install"
    ↓
User clicks "Restart and Install"
    ↓
App restarts with new version
```

## Troubleshooting

### "No update available" (but you published one)

**Check:**
1. Is the published version higher than current version?
2. Are the `latest-*.yml` files in the GitHub release?
3. Is the app running in production mode? (Updates disabled in dev)

**Fix:**
```bash
# Verify version in package.json
cat package.json | grep version

# Check GitHub release has .yml files
open https://github.com/clearical/timeportal/releases
```

### "Failed to check for updates"

**Check:**
1. Internet connection
2. GitHub repository access
3. GH_TOKEN validity

**Debug:**
```typescript
// Check logs
// macOS: ~/Library/Logs/TimePortal/main.log
```

### Build fails

**Check:**
1. All dependencies installed: `npm install`
2. Build directory exists: `mkdir -p build`
3. Icons present: `ls -la build/icon.*`

**Fix:**
```bash
# Clean and rebuild
rm -rf dist dist-electron
npm install
npm run build:electron-main
npm run build:electron
```

## Platform-Specific Notes

### macOS

- **Auto-update works best with signed apps**
  - Users will see "unidentified developer" warnings without signing
  - For production, get an Apple Developer certificate

- **Update files:** `.dmg` for installer, `.zip` for auto-update

### Windows

- **Auto-update requires signed installers** for best experience
  - Windows SmartScreen will block unsigned apps
  - Get a code signing certificate for production

- **Update files:** `.exe` for installer, `.exe` for auto-update (NSIS)

### Linux

- Auto-update support varies by distribution
- AppImage has best auto-update support
- Consider using distribution-specific repositories for updates

## Next Steps

1. ✅ Set up code signing (for production)
2. ✅ Customize release notes template
3. ✅ Set up automated builds (CI/CD)
4. ✅ Monitor update adoption
5. ✅ Implement rollback strategy

## Resources

- **Full Documentation:** [AUTO_UPDATE_SETUP.md](../AUTO_UPDATE_SETUP.md)
- **electron-updater Docs:** https://www.electron.build/auto-update
- **GitHub Releases:** https://docs.github.com/en/repositories/releasing-projects-on-github

## Support

Questions? Issues?
- GitHub Issues: https://github.com/clearical/timeportal/issues
- Email: support@clearical.io

---

**You're all set!** Your app now has automatic updates. Users will be notified when new versions are available and can install them with a single click.
