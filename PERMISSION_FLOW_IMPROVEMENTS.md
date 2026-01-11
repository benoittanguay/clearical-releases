# Permission Flow Improvements

## Overview
Implemented a robust permission request flow that prevents users from starting the Chrono timer without the necessary macOS permissions. The new system provides clear, user-friendly feedback and guidance for granting permissions.

## Changes Made

### 1. New Component: PermissionRequestModal
**File:** `/src/components/PermissionRequestModal.tsx`

A comprehensive modal that:
- **Checks both required permissions:**
  - Screen Recording (for screenshots)
  - Accessibility (for detecting active window/app)

- **Visual feedback:**
  - Color-coded status indicators (red/green/gray)
  - Clear icons for each permission state
  - Real-time status updates every 2 seconds
  - Auto-closes when all permissions are granted

- **User guidance:**
  - Explains WHY each permission is needed
  - Provides "Grant Permission" buttons that open System Settings
  - "Check Again" button to manually re-verify
  - Shows stale permission troubleshooting instructions
  - Displays success state with animation

- **Handles edge cases:**
  - Stale permission state (when macOS cache is incorrect)
  - Detailed instructions for removing/re-adding permissions
  - Graceful error handling

### 2. Enhanced useTimer Hook
**File:** `/src/hooks/useTimer.ts`

Added permission checking capability:
- **New interface:** `PermissionCheckResult`
  ```typescript
  {
    hasAccessibility: boolean;
    hasScreenRecording: boolean;
    allGranted: boolean;
  }
  ```

- **New function:** `checkPermissions()`
  - Checks screen recording permission via IPC
  - Checks accessibility permission by attempting to get active window
  - Returns comprehensive permission status
  - Exported for use in App component

### 3. Updated App Component
**File:** `/src/App.tsx`

Integrated permission modal into the timer flow:
- **Added state:** `showPermissionModal`
- **Updated `handleStartStop`:**
  - Checks permissions BEFORE starting timer
  - Shows permission modal if permissions are missing
  - Only starts timer if all permissions are granted

- **New handler:** `handlePermissionsGranted()`
  - Called when permission modal closes with success
  - Automatically starts the timer

- **Added component:** PermissionRequestModal in render tree

### 4. Existing IPC Infrastructure
**Files:** `/electron/main.ts`, `/electron/preload.cts`

Verified all necessary IPC handlers are already implemented:
- ✅ `check-screen-permission` - Check screen recording status
- ✅ `request-screen-permission` - Request screen recording permission
- ✅ `open-screen-permission-settings` - Open Screen Recording settings
- ✅ `check-accessibility-permission` - Check accessibility status
- ✅ `open-accessibility-settings` - Open Accessibility settings
- ✅ `get-active-window` - Used to test accessibility permission

## User Experience Flow

### Before Changes
1. User clicks START
2. Timer starts (or silently fails)
3. No screenshots/activity tracking if permissions missing
4. Confusing error state with no guidance

### After Changes
1. User clicks START
2. **Permission check runs automatically**
3. If permissions missing:
   - **Permission modal appears**
   - Clear explanation of what's needed
   - Visual indicators showing which permissions are missing
   - Direct buttons to grant each permission
   - Modal auto-closes when all granted
4. Timer starts only when permissions are ready
5. User has clear path forward if permissions fail

## Permission Modal Features

### Visual Design
- **Gradient background** - Professional, modern appearance
- **Color-coded indicators:**
  - 🔴 Red - Permission denied
  - 🟢 Green - Permission granted
  - ⚫ Gray - Permission status unknown
- **Warning header** - Amber gradient with warning icon
- **Info box** - Blue gradient explaining why permissions are needed

### User Actions
1. **Grant Permission buttons** - Opens System Settings to specific pane
2. **Check Again button** - Manually re-verify permissions
3. **Cancel button** - Close without starting timer
4. **Continue button** - Appears when all permissions granted

### Smart Features
- **Auto-refresh** - Checks permissions every 2 seconds
- **Auto-close** - Closes automatically when all permissions granted
- **Stale permission help** - Toggle to show troubleshooting instructions
- **Loading states** - Shows "Opening Settings..." when requesting

## Technical Architecture

### Permission Check Flow
```
User clicks START
    ↓
checkPermissions() called
    ↓
Query screen recording status (IPC)
    ↓
Test accessibility by calling getActiveWindow (IPC)
    ↓
Return PermissionCheckResult
    ↓
If !allGranted → Show PermissionRequestModal
    ↓
User grants permissions in System Settings
    ↓
Modal detects via auto-refresh
    ↓
onPermissionsGranted() called
    ↓
Timer starts
```

### Accessibility Permission Detection
Since macOS doesn't provide a direct API to check accessibility permission status, we use a clever workaround:
- Try to call `getActiveWindow()` (requires accessibility)
- If successful → accessibility is granted
- If error → accessibility is denied

### Screen Recording Permission
- Use Electron's `systemPreferences.getMediaAccessStatus('screen')`
- Returns: 'granted' | 'denied' | 'not-determined' | 'restricted'

## Error Handling

### Stale Permissions
Sometimes macOS caches incorrect permission states. The modal provides instructions:
1. Open System Settings → Privacy & Security
2. Find permission (Screen Recording or Accessibility)
3. Toggle Clearical OFF
4. Wait 2 seconds
5. Toggle Clearical ON
6. Restart Clearical

### Failed Permission Requests
- If system dialog is dismissed, modal remains open
- User can try again or check manually
- Clear feedback about current status

## Future Enhancements

Potential improvements:
1. **Permission history tracking** - Remember when user last granted
2. **One-time dismissal** - Allow user to skip once (advanced users)
3. **Detailed logging** - Track permission request patterns
4. **Notification integration** - Alert user if permissions revoked while running
5. **Partial functionality mode** - Allow timer without screenshots (degraded mode)

## Testing Checklist

- [ ] Start timer with no permissions → Modal appears
- [ ] Start timer with only screen recording → Modal shows accessibility needed
- [ ] Start timer with only accessibility → Modal shows screen recording needed
- [ ] Start timer with both permissions → Timer starts immediately
- [ ] Grant permissions while modal open → Modal auto-closes
- [ ] Click "Check Again" → Permissions refresh
- [ ] Click "Grant Permission" buttons → System Settings open correctly
- [ ] Stale permission help → Instructions display correctly
- [ ] Cancel modal → Timer doesn't start
- [ ] Modal auto-refresh → Updates every 2 seconds

## Files Modified

1. **NEW:** `/src/components/PermissionRequestModal.tsx` (360 lines)
2. **MODIFIED:** `/src/hooks/useTimer.ts`
   - Added `PermissionCheckResult` interface
   - Added `checkPermissions()` function
   - Exported `checkPermissions` in return statement
3. **MODIFIED:** `/src/App.tsx`
   - Imported `PermissionRequestModal`
   - Added `showPermissionModal` state
   - Updated `handleStartStop` with permission check
   - Added `handlePermissionsGranted` handler
   - Added modal to render tree

## Dependencies

No new dependencies required. Uses existing:
- Electron IPC (already configured)
- React hooks (useState, useEffect)
- Tailwind CSS (for styling)

## Backwards Compatibility

✅ **Fully backwards compatible**
- No breaking changes to existing code
- Existing permission handlers unchanged
- Onboarding modal still works independently
- No database migrations required

## Notes

- The permission modal is separate from onboarding to allow re-checking at any time
- Onboarding can still show permissions, but this modal is specifically for the START action
- All permission checks are async to avoid blocking the UI
- The modal is designed to be user-friendly for non-technical users
- Error messages are clear and actionable
