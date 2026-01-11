# macOS Permission Recognition Fix

## Problem Overview

When Clearical is updated (replaced with a newer version), macOS doesn't recognize the existing permissions due to changes in the app's code signature. This is a common issue with ad-hoc signed Electron apps.

### Symptoms
- System Preferences shows Clearical has Screen Recording permission (toggle is ON)
- The app itself can't actually capture screenshots
- Users must manually remove and re-add the app to permissions

### Root Cause
macOS's Transparency, Consent, and Control (TCC) database stores permissions by app signature. When an ad-hoc signed app is updated, the signature changes slightly, creating "zombie" or "stale" permission entries. The system UI shows the old entry as granted, but the new app binary can't use it.

## Solution Implemented

### 1. Permission Verification Function (`testScreenRecordingWorks`)

**Location:** `/electron/main.ts` (lines 1161-1188)

This function actively tests if screen recording actually works by attempting a real capture operation:

```typescript
async function testScreenRecordingWorks(): Promise<{ works: boolean; error?: string }> {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 100, height: 100 }
        });

        if (sources.length === 0) {
            return { works: false, error: 'no_sources' };
        }

        const thumbnail = sources[0].thumbnail;
        const size = thumbnail.getSize();

        if (size.width === 0 || size.height === 0) {
            return { works: false, error: 'empty_thumbnail' };
        }

        return { works: true };
    } catch (error) {
        return { works: false, error: String(error) };
    }
}
```

**Why this works:**
- `systemPreferences.getMediaAccessStatus()` only checks the TCC database entry
- Actually calling `desktopCapturer.getSources()` will fail if the permission is stale
- This gives us ground truth about whether permissions actually work

### 2. Enhanced Permission Checking

**Location:** `/electron/main.ts` `check-screen-permission` handler (lines 1190-1223)

The handler now:
1. Checks the TCC database status (as before)
2. If status is 'granted', verifies it actually works
3. Returns 'stale' if the permission is granted but doesn't work

```typescript
ipcMain.handle('check-screen-permission', async () => {
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen');

        // If status is 'granted', verify it actually works
        if (status === 'granted') {
            const testResult = await testScreenRecordingWorks();

            if (!testResult.works) {
                console.error('[Main] STALE PERMISSION DETECTED');
                return 'stale'; // Special status for zombie permissions
            }
        }

        return status;
    }
    return 'granted';
});
```

### 3. User-Friendly Reset Instructions

**Location:** `/electron/main.ts` `show-permission-reset-instructions` handler (lines 1302-1350)

Shows a native dialog with:
- Clear explanation of the issue
- Step-by-step instructions to fix
- Two options:
  - **Open System Settings** - Opens directly to Screen Recording permissions
  - **Copy Terminal Command** - Copies `tccutil reset` command to clipboard

**Location:** `/electron/preload.cts` (line 38)
Exposed to renderer as `window.electron.ipcRenderer.showPermissionResetInstructions()`

### 4. UI Updates

#### Settings Component
**Location:** `/src/components/Settings.tsx` (lines 786-863)

- Added 'stale' to `PermissionStatus` type
- Shows orange "NEEDS RESET" badge for stale permissions
- Displays prominent warning box explaining the issue
- "Fix Permission Issue" button that shows reset instructions

#### Onboarding Modal
**Location:** `/src/components/OnboardingModal.tsx` (lines 53-70)

- Updated to treat 'stale' status as not granted
- Users will be prompted to grant permissions again during onboarding

## User Experience Flow

### When Stale Permission is Detected

1. **Settings Page Shows:**
   ```
   Screen Recording: [NEEDS RESET]

   ⚠️ Permission Needs Reset
   After updating the app, macOS may have stale permission entries.
   System Settings shows the permission is granted, but it doesn't
   actually work.

   This is a known macOS issue with app updates. Your data is safe.

   [Fix Permission Issue]
   ```

2. **User Clicks "Fix Permission Issue"**

   Native dialog appears:
   ```
   Permission Reset Required

   After an app update, macOS may have stale permission entries. To fix this:

   1. Open System Settings (or System Preferences)
   2. Go to "Privacy & Security" → "Screen Recording"
   3. Find "Clearical" in the list
   4. Click the toggle to DISABLE it
   5. Click the toggle again to ENABLE it
   6. Restart Clearical

   Alternatively, you can reset using Terminal:
   tccutil reset ScreenCapture /path/to/Clearical.app/Contents/MacOS/Clearical

   This is a known macOS issue with app updates. Your data is safe.

   [Open System Settings] [Copy Terminal Command] [Cancel]
   ```

3. **After Following Instructions:**
   - Settings page automatically rechecks permissions every 2 seconds
   - Status updates to "GRANTED" once permissions are working
   - Warning disappears

## Technical Details

### Why This Happens

Ad-hoc signing (no Apple Developer certificate) creates a signature based on:
- Binary content
- Code resources
- Timestamp
- Build environment details

When any of these change (even minor updates), macOS treats it as a different app for TCC purposes.

### Why We Can't Auto-Fix It

- `tccutil reset` requires user interaction (Terminal or System Settings)
- No programmatic API exists to modify TCC entries
- This is intentional security design by Apple

### Performance Impact

The `testScreenRecordingWorks()` function:
- Runs only when checking permissions (not continuously)
- Uses minimal 100x100 thumbnail
- Completes in <100ms typically
- No impact on normal app operation

## Testing

### Simulating Stale Permissions

You can't easily simulate this in development, but it naturally occurs when:
1. Building a new version of the app
2. Replacing the old version in Applications folder
3. Launching the new version

### Verification Checklist

- [ ] Permission status correctly shows "STALE" when detected
- [ ] Orange warning box appears in Settings
- [ ] "Fix Permission Issue" button shows reset instructions
- [ ] "Open System Settings" button opens correct pane
- [ ] "Copy Terminal Command" copies correct path
- [ ] Status updates to "GRANTED" after fixing
- [ ] Screenshot capture works after fixing
- [ ] Onboarding handles stale permissions correctly

## Future Improvements

### Proper Code Signing
The permanent solution is to use proper Apple Developer code signing:
1. Enroll in Apple Developer Program ($99/year)
2. Generate Developer ID Application certificate
3. Sign app with `codesign --deep --force --sign "Developer ID Application: Your Name"`
4. Notarize the app with Apple

**Benefits:**
- Stable signature across updates
- No permission reset needed
- Better user trust
- Required for macOS Gatekeeper

### Automatic Detection on Launch
Could add a startup check that:
1. Tests permissions on app launch
2. Shows notification if stale
3. Offers to open fix instructions

### Analytics
Track how often this occurs to:
- Understand impact on users
- Justify investment in proper signing
- Improve messaging

## Related Files

- `/electron/main.ts` - Permission checking logic
- `/electron/preload.cts` - IPC bridge
- `/src/components/Settings.tsx` - UI for settings page
- `/src/components/OnboardingModal.tsx` - UI for onboarding
- `/ONBOARDING.md` - Onboarding documentation

## References

- [Apple TCC Documentation](https://developer.apple.com/documentation/bundleresources/entitlements)
- [Electron Security Documentation](https://www.electronjs.org/docs/latest/tutorial/security)
- [Code Signing Guide](https://www.electronjs.org/docs/latest/tutorial/code-signing)
