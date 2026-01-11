# Permission Modal - Quick Reference

## When Does It Appear?

The permission modal automatically appears when:
1. User clicks **START** on the Chrono timer
2. Either Screen Recording OR Accessibility permission is missing
3. Both permissions are missing

## What Does It Show?

### Permission Status Indicators

#### Accessibility Permission
```
┌─────────────────────────────────────────┐
│ [🟢] Accessibility          [Granted]  │
│ Required to detect which app and       │
│ window you're currently using          │
└─────────────────────────────────────────┘
```

#### Screen Recording Permission
```
┌─────────────────────────────────────────┐
│ [🟢] Screen Recording      [Granted]   │
│ Required to capture screenshots of     │
│ your work for AI-powered summaries     │
└─────────────────────────────────────────┘
```

### When Permission is Missing
```
┌─────────────────────────────────────────┐
│ [🔴] Accessibility    [Not Granted]    │
│ Required to detect which app and       │
│ window you're currently using          │
│ [Grant Permission]                     │
└─────────────────────────────────────────┘
```

## User Actions

### 1. Grant Permission Button
- Opens macOS System Settings
- Navigates directly to the correct permission pane
- User must manually enable Clearical in the list

### 2. Check Again Button
- Manually re-verifies permission status
- Useful after granting permissions in System Settings
- Not usually needed (auto-checks every 2 seconds)

### 3. Cancel Button
- Closes the modal without starting timer
- User can fix permissions later
- Timer remains stopped

### 4. Continue Button
- Only appears when all permissions are granted
- Closes modal and starts timer
- Usually not needed (modal auto-closes)

## Automatic Behaviors

### Auto-Refresh (Every 2 Seconds)
The modal automatically checks permission status without user action:
- Detects when user grants permissions in System Settings
- Updates visual indicators in real-time
- No need to click "Check Again" in most cases

### Auto-Close
When both permissions are granted:
1. Modal shows success message (brief animation)
2. Modal auto-closes after 500ms
3. Timer starts automatically

## Troubleshooting

### "Permission shows as granted but doesn't work"
This is a "stale permission" issue where macOS has cached incorrect state.

**Fix:**
1. Click "Having trouble? Permission showing as granted but not working?"
2. Follow the displayed instructions:
   - Open System Settings → Privacy & Security
   - Go to Screen Recording (or Accessibility)
   - Find Clearical and toggle it OFF
   - Wait 2 seconds
   - Toggle it back ON
   - Restart Clearical

### Modal keeps appearing even with permissions
Possible causes:
1. **Accessibility permission test fails** - Try restarting Clearical
2. **Screen Recording not fully activated** - Check System Settings
3. **macOS security cache issue** - Follow stale permission fix above

### System Settings won't open
- Ensure you're on a supported macOS version (10.14+)
- Try opening System Settings manually
- Look for Privacy & Security → Screen Recording / Accessibility

## Permission Requirements

### Screen Recording
**Used for:** Capturing screenshots during timer sessions
**Without it:** Cannot take screenshots, AI summaries won't work
**Grant via:** System Settings → Privacy & Security → Screen Recording

### Accessibility
**Used for:** Detecting active application and window title
**Without it:** Cannot track which app you're using
**Grant via:** System Settings → Privacy & Security → Accessibility

## Developer Notes

### Triggering the Modal Manually
For testing purposes, you can trigger the modal by:
1. Revoking permissions in System Settings
2. Clicking START on the Chrono timer
3. Modal will appear if any permission is missing

### Permission Check Logic
```typescript
// Checks happen in this order:
1. Check screen recording via systemPreferences
2. Test accessibility by calling getActiveWindow
3. Return combined result
4. Show modal if !allGranted
```

### Modal State Machine
```
CLOSED → [User clicks START]
    ↓
CHECKING PERMISSIONS
    ↓
ALL GRANTED? → YES → START TIMER
    ↓
    NO → OPEN MODAL
    ↓
MODAL OPEN → Auto-refresh every 2s
    ↓
ALL GRANTED → Success animation → Auto-close → START TIMER
```

## Integration Points

### In App.tsx
```typescript
// Permission check before starting
const handleStartStop = async () => {
  if (!isRunning) {
    const permissions = await checkPermissions();
    if (!permissions.allGranted) {
      setShowPermissionModal(true);
      return;
    }
    startTimer();
  }
}
```

### In useTimer.ts
```typescript
// Permission check function
const checkPermissions = async () => {
  const screenStatus = await window.electron.ipcRenderer.checkScreenPermission();
  const hasScreenRecording = screenStatus === 'granted';

  let hasAccessibility = false;
  try {
    await window.electron.ipcRenderer.getActiveWindow();
    hasAccessibility = true;
  } catch {
    hasAccessibility = false;
  }

  return {
    hasAccessibility,
    hasScreenRecording,
    allGranted: hasAccessibility && hasScreenRecording
  };
};
```

## Best Practices

### For Users
1. Grant both permissions during onboarding
2. If modal appears, follow button prompts
3. Wait for auto-close before expecting timer to start
4. Use stale permission fix only if permissions seem stuck

### For Developers
1. Always check permissions before operations requiring them
2. Provide clear feedback about what's missing
3. Don't silently fail - show the modal
4. Test with permissions in all states (both, one, none)
5. Handle macOS permission cache issues gracefully

## Common Scenarios

### First-Time User
1. Installs Clearical
2. Clicks START
3. Modal appears (no permissions yet)
4. Clicks "Grant Permission" for each
5. Enables in System Settings
6. Returns to Clearical
7. Modal auto-detects and closes
8. Timer starts

### Returning User (Permissions Revoked)
1. Previously granted permissions
2. Permissions revoked (manually or by system)
3. Clicks START
4. Modal appears showing which were revoked
5. Re-grants permissions
6. Modal auto-closes
7. Timer starts

### Advanced User (Stale Cache)
1. Permissions show as granted
2. Screenshots/tracking doesn't work
3. Clicks START again
4. Modal appears despite "granted" status
5. Clicks troubleshooting link
6. Follows toggle OFF/ON instructions
7. Restarts Clearical
8. Permissions work correctly

## UI/UX Design Rationale

### Why Auto-Refresh?
- Eliminates need for user to click "Check Again"
- Provides immediate feedback when permissions are granted
- Creates seamless experience

### Why Auto-Close?
- Reduces friction in starting timer
- Confirms permissions are working
- Avoids extra click after granting

### Why Separate from Onboarding?
- Permissions can be revoked after onboarding
- Allows re-checking at any time
- Focused, specific to the START action
- Doesn't interfere with onboarding flow

### Why Color-Coded Indicators?
- Red = immediate attention needed
- Green = success, no action needed
- Gray = unknown/checking
- Quick visual scan of status

### Why Explain "Why"?
- Users more likely to grant when they understand
- Reduces perception of invasiveness
- Builds trust in the application
- Differentiates from malicious apps
