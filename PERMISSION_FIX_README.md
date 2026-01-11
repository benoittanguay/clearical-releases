# macOS Permission Fix - Quick Reference

## What Was Fixed

After app updates, macOS can have "stale" or "zombie" permissions where System Settings shows Clearical has Screen Recording permission, but the app can't actually capture screenshots. This happened because ad-hoc signing creates different signatures on each build.

## The Solution

Clearical now **detects** stale permissions and **guides users** through fixing them.

## User Experience

### Before This Fix
```
User: "The app can't take screenshots!"
Support: "Check System Settings..."
User: "It shows permission is granted though?"
Support: "Try removing and re-adding the app..."
User: "How do I do that?"
```

### After This Fix
```
Settings Page: [Screen Recording: NEEDS RESET]

⚠️ Permission Needs Reset
After updating the app, macOS may have stale permission entries.
System Settings shows the permission is granted, but it doesn't
actually work.

This is a known macOS issue with app updates. Your data is safe.

[Fix Permission Issue]  ← User clicks this

Dialog appears with clear step-by-step instructions:
1. Open System Settings → Privacy & Security → Screen Recording
2. Find Clearical in the list
3. Toggle it OFF then ON again
4. Restart Clearical

OR copy this Terminal command:
tccutil reset ScreenCapture /path/to/Clearical.app

Status automatically updates to GRANTED when fixed ✓
```

## How It Works

### Detection
1. App checks if permission status is 'granted' (via macOS API)
2. **NEW:** Actually tests if screen capture works (attempts small capture)
3. If test fails, returns 'stale' status instead of 'granted'
4. UI shows orange "NEEDS RESET" badge

### Recovery
1. User clicks "Fix Permission Issue"
2. Native dialog shows with two options:
   - **Open System Settings** - Direct link to Screen Recording pane
   - **Copy Terminal Command** - Copies `tccutil reset` command
3. User follows clear instructions
4. Settings page auto-detects fix (polls every 2s)
5. Status updates to "GRANTED" ✓

## Files Changed

### Backend
- `/electron/main.ts` - Permission verification logic
- `/electron/preload.cts` - IPC bridge

### Frontend
- `/src/components/Settings.tsx` - Stale permission UI
- `/src/components/OnboardingModal.tsx` - Handle during onboarding

### Documentation
- `/MACOS_PERMISSION_FIX.md` - Technical deep-dive
- `/PERMISSION_FIX_SUMMARY.md` - Implementation summary
- `/PERMISSION_FIX_README.md` - This file
- `/CHANGELOG.md` - Version history

### Testing
- `/scripts/test-permission-fix.sh` - Test helper script

## Key Features

✅ **Automatic Detection** - App knows when permissions are broken, not just what macOS says
✅ **Clear Communication** - Users understand it's a macOS issue, not their fault
✅ **Self-Service** - Users can fix it without support
✅ **Automatic Verification** - Status updates when fixed
✅ **Two Fix Options** - GUI (System Settings) or CLI (Terminal)
✅ **Non-Invasive** - No forced actions, just helpful guidance

## Testing

Use the test script:
```bash
./scripts/test-permission-fix.sh
```

Or manually:
1. Build and install v1 → Grant permissions → Verify works
2. Touch binary to change signature: `touch /Applications/Clearical.app/Contents/MacOS/Clearical`
3. Launch app → Should show "NEEDS RESET"
4. Click "Fix Permission Issue" → Follow instructions
5. Verify status becomes "GRANTED"

## What Logs to Look For

### Stale Permission Detected
```
[Main] check-screen-permission status: granted
[Main] Screen recording test: No sources returned (permission may be stale)
[Main] STALE PERMISSION DETECTED: System says granted but capture fails!
[Main] This typically happens after app updates with ad-hoc signing
[Main] User needs to remove and re-add the app in System Settings
```

### Working Correctly
```
[Main] check-screen-permission status: granted
[Main] Screen recording test: SUCCESS - captured thumbnail { width: 100, height: 100 }
```

## Future Improvements

### Short-term
- Add detection on app launch
- Show notification when stale permission detected
- Analytics on how often this occurs

### Long-term
**The permanent fix is proper Apple Developer code signing:**
- Enroll in Apple Developer Program ($99/year)
- Sign with Developer ID certificate
- Notarize the app
- Signature stays stable across updates
- This entire problem goes away

## Architecture Decision

We chose **detection + user guidance** over attempting automatic fixes because:
1. No API exists to modify TCC entries programmatically
2. `tccutil reset` requires Terminal or System Settings access
3. Apple intentionally designed TCC to require user interaction
4. Better to guide users clearly than silently fail

## Success Criteria

This implementation is successful because:
1. ✅ Users can identify the problem (clear status badge)
2. ✅ Users understand it's not their fault (macOS issue messaging)
3. ✅ Users can resolve it themselves (step-by-step guide)
4. ✅ Resolution is automatic (status auto-updates)
5. ✅ No support tickets needed

## Related Issues

This also helps with:
- First-time permission grants (same detection flow)
- Debugging screenshot capture issues
- Educating users about macOS permission system

## Questions?

See comprehensive documentation:
- Technical details: `/MACOS_PERMISSION_FIX.md`
- Implementation: `/PERMISSION_FIX_SUMMARY.md`
- Changelog: `/CHANGELOG.md`
