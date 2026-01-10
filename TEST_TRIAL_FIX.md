# Testing the Trial Fix for benoit.tanguay@clearical.io

## Quick Test for Affected User

### Option 1: Reset Subscription (Recommended)
This will trigger the trial creation for the existing user:

```bash
# 1. Quit the Clearical app completely

# 2. Delete the subscription file to reset
rm ~/Library/Application\ Support/Clearical/subscription.dat

# 3. Launch Clearical
# The app should now create a fresh 14-day trial

# 4. Check Settings page - you should see:
#    - "Trial (14 days remaining)" status
#    - Blue trial banner at top
#    - Jira and Tempo integrations unlocked
```

### Option 2: Verify Without Reset
If you want to check the current state first:

```bash
# 1. Build the latest version
cd ~/Documents/Anti/TimePortal
npm run build:electron-main

# 2. Run in development mode
npm run dev:electron

# 3. Check the console logs for:
#    - "[Subscription] No subscription found, triggering validation to create trial"
#    - "[SubscriptionValidator] No subscription found, creating trial"
#    - "[Subscription] Validation result: { valid: true, mode: 'trial', status: 'trial' }"
```

## Expected Behavior After Fix

### Settings Page Should Show:
```
┌─────────────────────────────────────────┐
│ Trial (14 days remaining)         TRIAL │
│ benoit.tanguay@clearical.io             │
│ [Upgrade to Workplace Plan]             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ TRIAL BANNER                            │
│ 14 Days Left in Trial                   │
│ You are currently enjoying full access  │
│ to all Workplace Plan features.         │
│ [Upgrade Now]  Expires Jan 24, 2026     │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ TIME TRACKING INTEGRATION               │
│ Jira Status            ✓ CONNECTED      │
│ Tempo Status           ✓ CONNECTED      │
│ [Configure Integration]                 │
└─────────────────────────────────────────┘
```

### Jira Integration Should:
- ✅ Allow configuration
- ✅ Show issues in AssignmentPicker
- ✅ Allow creating Tempo worklogs
- ✅ Not show "Upgrade to Unlock" messages

### AI Features Should:
- ✅ Auto-generate descriptions
- ✅ Auto-assign work to buckets/issues
- ✅ Auto-select Tempo accounts

## Debugging Steps

If the trial is still not working:

### 1. Check Subscription File
```bash
# View the encrypted subscription file (won't be readable)
ls -lh ~/Library/Application\ Support/Clearical/subscription.dat

# If it exists, check when it was created
stat ~/Library/Application\ Support/Clearical/subscription.dat
```

### 2. Check App Logs
```bash
# Run the app from terminal to see logs
cd ~/Documents/Anti/TimePortal
npm run dev:electron

# Look for subscription-related logs:
# [Subscription] Initializing subscription system...
# [Subscription] No subscription found, triggering validation to create trial
# [SubscriptionValidator] No subscription found, creating trial
# [Subscription] Validation result: { valid: true, mode: 'trial', status: 'trial' }
```

### 3. Check Build Output
```bash
# Verify the fix is in the compiled code
grep -A 5 "triggering validation to create trial" \
  ~/Documents/Anti/TimePortal/dist-electron/subscription/ipcHandlers.js

# Should show:
# console.log('[Subscription] No subscription found, triggering validation to create trial');
# if (subscriptionValidator) {
#     const validationResult = await subscriptionValidator.validate();
#     subscription = validationResult.subscription;
#     ...
```

### 4. Inspect Subscription State in DevTools
```bash
# 1. Open the app
# 2. In the app, press Cmd+Option+I to open DevTools
# 3. In Console, run:
window.electron.ipcRenderer.invoke('subscription:get-status')
  .then(status => console.log('Subscription Status:', status))

window.electron.ipcRenderer.invoke('subscription:get-trial-info')
  .then(info => console.log('Trial Info:', info))

# Should see:
# Subscription Status: {
#   tier: 'workplace',
#   isActive: true,
#   features: ['jira', 'tempo', 'ai', 'reporting']
# }
# Trial Info: {
#   success: true,
#   isTrial: true,
#   daysRemaining: 14,
#   trialEndsAt: 1737849600000
# }
```

## Success Criteria

✅ Trial created automatically on first launch
✅ User sees "Trial (14 days remaining)" in Settings
✅ Blue trial banner appears at top of Settings
✅ Jira integration is unlocked and configurable
✅ Tempo integration is unlocked and configurable
✅ AI features are enabled
✅ No "Upgrade to Unlock" messages appear
✅ User can assign time entries to Jira issues

## If Problems Persist

If after following these steps the trial is still not working:

1. **Check for Multiple Subscription Files:**
   ```bash
   find ~/Library/Application\ Support/Clearical -name "subscription*"
   ```

2. **Check Node Version:**
   ```bash
   node --version  # Should be v18 or higher
   npm --version   # Should be v9 or higher
   ```

3. **Rebuild Everything:**
   ```bash
   cd ~/Documents/Anti/TimePortal
   rm -rf node_modules dist dist-electron
   npm install
   npm run build:electron-main
   npm run dev:electron
   ```

4. **Check for TypeScript Errors:**
   ```bash
   npx tsc -b 2>&1 | grep -i error
   ```

## Contact
If issues persist, provide these details:
- Console logs from DevTools
- Output of `subscription:get-status` IPC call
- Output of `subscription:get-trial-info` IPC call
- Screenshot of Settings page
- Date when user first logged in
