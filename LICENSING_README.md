# TimePortal Licensing System - Implementation Guide

## Overview

The TimePortal licensing system has been implemented in **Phase 1**, providing a comprehensive foundation for commercial distribution. This README provides technical details on the implementation, usage, and next steps.

**Status**: Phase 1 Complete ✅
**Date**: January 8, 2026
**Version**: 1.0

---

## What Has Been Implemented

### Phase 1: Core Infrastructure ✅

The following components have been fully implemented and are ready for use:

#### 1. Type Definitions & Data Models
- **File**: `/electron/licensing/types.ts`
- Comprehensive TypeScript interfaces for licenses, validation, device management
- Enums for license status, plan types, validation modes
- Error codes and custom error classes
- Default configuration with sensible defaults

#### 2. Secure License Storage
- **File**: `/electron/licensing/licenseStorage.ts`
- Uses Electron `safeStorage` API (macOS Keychain integration)
- Encrypted license persistence
- CRUD operations (create, read, update, delete)
- File permissions security (0600)
- Backup and restore capabilities

#### 3. Device Fingerprinting
- **File**: `/electron/licensing/deviceFingerprint.ts`
- Hardware UUID extraction (macOS IOPlatformUUID)
- Electron machine ID integration
- Composite device ID generation (SHA-256 hash)
- User-friendly device naming
- PII sanitization for logging

#### 4. License Validator
- **File**: `/electron/licensing/licenseValidator.ts`
- Offline validation with grace periods
- Trial license generation (14-day default)
- Device limit enforcement (2 devices default)
- Grace period handling for expired subscriptions
- Event system for analytics and monitoring

#### 5. Paddle API Client (Stub)
- **File**: `/electron/licensing/paddleClient.ts`
- Interface defined for Phase 2 integration
- Mock implementation for development
- License verification structure
- Device activation/deactivation endpoints

#### 6. IPC Handlers
- **File**: `/electron/licensing/ipcHandlers.ts`
- Bridge between main process and renderer
- Handlers for all license operations
- Integrated into `/electron/main.ts`
- Error handling and logging

#### 7. React License Context
- **File**: `/src/context/LicenseContext.tsx`
- React context for license state management
- Hooks for license operations (`useLicense`)
- Automatic validation on mount
- Periodic validation (24-hour interval)
- Helper methods for status checks

#### 8. UI Components
- **File**: `/src/components/LicenseStatus.tsx`
- `LicenseStatusBanner` - Top banner for trial/warnings
- `LicenseStatusCard` - Detailed license information
- `LicenseExpiredOverlay` - Soft lock modal
- Tailwind CSS styling (matches existing theme)

---

## File Structure

```
TimePortal/
├── electron/
│   ├── licensing/
│   │   ├── index.ts                  # Main exports
│   │   ├── types.ts                  # Type definitions ✅
│   │   ├── licenseStorage.ts         # Secure storage ✅
│   │   ├── deviceFingerprint.ts      # Device ID generation ✅
│   │   ├── licenseValidator.ts       # Validation logic ✅
│   │   ├── paddleClient.ts           # Paddle API (stub) ✅
│   │   └── ipcHandlers.ts            # IPC bridge ✅
│   ├── main.ts                       # Main process (updated) ✅
│   └── preload.cts                   # Preload script (updated) ✅
├── src/
│   ├── context/
│   │   └── LicenseContext.tsx        # React context ✅
│   └── components/
│       └── LicenseStatus.tsx         # UI components ✅
├── LICENSING_ARCHITECTURE.md          # Full architecture doc ✅
└── LICENSING_README.md                # This file ✅
```

---

## Usage Examples

### 1. Using License Context in React Components

```tsx
import { useLicense } from '../context/LicenseContext';

function MyComponent() {
    const {
        license,
        isValid,
        isTrial,
        getTrialDaysRemaining,
        hasFeature
    } = useLicense();

    if (isTrial()) {
        return <p>Trial: {getTrialDaysRemaining()} days left</p>;
    }

    if (hasFeature('jiraIntegration')) {
        // Show Jira features
    }

    return <div>License is valid: {isValid() ? 'Yes' : 'No'}</div>;
}
```

### 2. Activating a License (IPC Call)

```typescript
// From renderer process
const result = await window.electron.invoke('license-activate', 'LICENSE-KEY', 'user@example.com');

if (result.success) {
    console.log('License activated:', result.license);
} else {
    console.error('Activation failed:', result.error);
}
```

### 3. Validating License (Main Process)

```typescript
import { LicenseValidator } from './licensing';

const validator = new LicenseValidator();
const result = await validator.validate();

if (result.valid) {
    console.log('License is valid:', result.license);
} else {
    console.error('Validation failed:', result.error);
}
```

### 4. Checking Device Limit

```typescript
import { LicenseValidator, LicenseStorage } from './licensing';

const license = await LicenseStorage.getLicense();
const limitReached = LicenseValidator.isDeviceLimitReached(license);

if (limitReached) {
    // Show "device limit reached" message
}
```

---

## Configuration

### Environment Variables

Set these in your build configuration or `.env` file:

```bash
# Paddle Configuration (Phase 2)
PADDLE_VENDOR_ID=your_vendor_id
PADDLE_API_KEY=your_api_key
NODE_ENV=development  # or 'production'
```

### Default Configuration

```typescript
// From electron/licensing/types.ts
export const DEFAULT_LICENSE_CONFIG = {
    onlineCheckInterval: 24 * 60 * 60 * 1000,        // 24 hours
    offlineGracePeriod: 7 * 24 * 60 * 60 * 1000,    // 7 days
    subscriptionGracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
    trialDurationDays: 14,                           // 14-day trial
    trialWarningDays: 2,                             // Warn 2 days before expiry
    defaultMaxDevices: 2,                            // 2 devices per license
    enableOfflineMode: true,
    enableDeviceLimit: true,
    enableGracePeriod: true,
};
```

---

## Testing

### Manual Testing Checklist

- [ ] **Trial Activation**: First launch generates trial license
- [ ] **Trial Countdown**: Banner shows correct days remaining
- [ ] **License Storage**: License persists across app restarts
- [ ] **Device Fingerprinting**: Consistent device ID generation
- [ ] **Offline Mode**: App works without network (7-day grace)
- [ ] **Device Limit**: Cannot exceed 2 devices (soft limit)
- [ ] **Grace Period**: Warning shown when subscription expires
- [ ] **UI Components**: License status displays correctly

### Development Mode

In development, the licensing system operates in a permissive mode:
- Trial licenses are automatically generated
- No Paddle API calls (stub implementation)
- All features enabled by default
- Logging is verbose for debugging

### Testing Commands

```bash
# Build and run in development
npm run dev:electron

# Build production version
npm run build:electron

# Check license file location
echo ~/Library/Application\ Support/TimePortal/.license
```

---

## Security Considerations

### Implemented Security Measures

1. **Encrypted Storage**: License data encrypted using Electron `safeStorage` (macOS Keychain)
2. **File Permissions**: License file set to 0600 (owner read/write only)
3. **No PII in Logs**: Device fingerprints sanitized before logging
4. **No License Key Exposure**: License keys masked in logs (last 4 chars only)
5. **Secure IPC**: All IPC handlers validate inputs

### Security Best Practices

- Never log full license keys or device UUIDs
- Always validate license data before trusting it
- Use HTTPS for all Paddle API calls (Phase 2)
- Implement rate limiting for validation attempts (Phase 2)
- Monitor for suspicious activity patterns (Phase 2)

---

## Phase 2: Next Steps (Paddle Integration)

### What's Not Yet Implemented

The following features are **stubbed** and will be completed in Phase 2:

1. **Paddle API Integration**
   - Real license verification with Paddle
   - Device activation/deactivation via Paddle
   - Webhook handler for subscription events
   - Payment processing integration

2. **In-App Purchase Flow**
   - License key entry UI
   - Paddle checkout overlay
   - Upgrade flow (trial → paid, monthly → yearly)
   - Payment method update

3. **Device Management UI**
   - View all activated devices
   - Deactivate remote devices
   - Device usage analytics

4. **Advanced Features**
   - Email notifications (trial ending, payment failed)
   - Usage analytics and monitoring
   - Customer support integration
   - Refund handling

### Phase 2 Timeline

**Estimated Duration**: 2 weeks

**Tasks**:
1. Create Paddle vendor account and configure products
2. Implement real Paddle API client
3. Build webhook listener for subscription events
4. Create in-app purchase UI components
5. Test payment flows (sandbox and production)
6. Security audit and penetration testing

---

## Integration with Existing App

### Adding License Provider to App

Wrap your app with `LicenseProvider`:

```tsx
// src/main.tsx or src/App.tsx
import { LicenseProvider } from './context/LicenseContext';
import { LicenseStatusBanner } from './components/LicenseStatus';

function App() {
    return (
        <LicenseProvider>
            <LicenseStatusBanner />
            {/* Your app components */}
        </LicenseProvider>
    );
}
```

### Feature Gating Example

```tsx
import { useLicense } from './context/LicenseContext';

function JiraIntegration() {
    const { hasFeature } = useLicense();

    if (!hasFeature('jiraIntegration')) {
        return (
            <div>
                <p>Jira integration requires a paid subscription</p>
                <button onClick={() => /* upgrade */}>Upgrade Now</button>
            </div>
        );
    }

    return <JiraIntegrationComponent />;
}
```

---

## Troubleshooting

### Common Issues

**Issue**: License not persisting across restarts
**Solution**: Check that `safeStorage` is available and file permissions are correct

**Issue**: Device fingerprint changing
**Solution**: Hardware UUID should be stable. Check macOS IOPlatformUUID consistency

**Issue**: Trial license not generated
**Solution**: Check that licensing system initialized properly in `main.ts`

**Issue**: IPC calls not working
**Solution**: Verify preload script loaded correctly and IPC handlers registered

### Debug Commands

```bash
# View license file location
echo ~/Library/Application\ Support/TimePortal/.license

# Check if license file exists
ls -la ~/Library/Application\ Support/TimePortal/

# View license file permissions
stat ~/Library/Application\ Support/TimePortal/.license

# Clear license for testing (delete license file)
rm ~/Library/Application\ Support/TimePortal/.license
```

### Logging

All licensing operations are logged with `[Licensing]` or `[LicenseValidator]` prefix:

```
[Licensing] Initializing licensing system...
[LicenseValidator] Trial license created: deviceId=abc12345...
[LicenseStorage] License saved successfully
```

---

## API Reference

### IPC Handlers (Available from Renderer)

```typescript
// Validate license
window.electron.invoke('license-validate')
  → { success: boolean, result?: ValidationResult, error?: string }

// Get license info
window.electron.invoke('license-get-info')
  → { success: boolean, license?: License, error?: string }

// Activate license
window.electron.invoke('license-activate', licenseKey: string, email?: string)
  → { success: boolean, license?: License, error?: string }

// Deactivate license
window.electron.invoke('license-deactivate')
  → { success: boolean, error?: string }

// Get devices
window.electron.invoke('license-get-devices')
  → { success: boolean, devices?: Device[], error?: string }

// Deactivate device
window.electron.invoke('license-deactivate-device', deviceId: string)
  → { success: boolean, error?: string }

// Get trial info
window.electron.invoke('license-get-trial-info')
  → { success: boolean, isTrial?: boolean, daysRemaining?: number, error?: string }

// Check if valid
window.electron.invoke('license-is-valid')
  → { success: boolean, valid?: boolean, error?: string }

// Check feature access
window.electron.invoke('license-has-feature', featureName: string)
  → { success: boolean, hasFeature?: boolean, error?: string }
```

---

## License Status Flows

### First Launch (No License)
1. User launches app
2. Licensing system initializes
3. No license found → Generate 14-day trial
4. Trial banner displayed
5. Full app access

### Trial Ending (2 Days Left)
1. License validator detects trial ending
2. Warning banner changes to yellow
3. "Upgrade Now" button prominent
4. App fully functional

### Trial Expired
1. Trial period ends
2. Soft lock modal displayed
3. Read-only mode enabled
4. Export and view functions available
5. Time tracking disabled

### Paid Subscription Active
1. User activates license key
2. License validated online (or cached)
3. No banner displayed (clean UI)
4. All features unlocked

### Subscription Expired (Grace Period)
1. Payment fails or subscription canceled
2. Grace period starts (7 days)
3. Yellow warning banner displayed
4. App fully functional
5. "Update Payment" button available

### Hard Expiration
1. Grace period ends
2. Soft lock modal displayed
3. Read-only mode enabled
4. Renewal or support options available

---

## Support & Maintenance

### For Developers

- Primary maintainer: Production Architect
- Documentation: `/LICENSING_ARCHITECTURE.md` (comprehensive)
- Issues: File GitHub issues with `[licensing]` tag

### For Users

- Support email: support@timeportal.app
- Help center: help.timeportal.app
- License management: Account dashboard (Phase 2)

---

## Changelog

### Version 1.0 (January 8, 2026)
- ✅ Core licensing infrastructure implemented
- ✅ Trial license generation
- ✅ Offline mode with grace periods
- ✅ Device fingerprinting and management
- ✅ Secure encrypted storage
- ✅ React context and UI components
- ✅ IPC handlers and main process integration

### Planned for Version 1.1 (Phase 2)
- Paddle API integration
- Real payment processing
- In-app purchase flow
- Device management UI
- Webhook processing
- Email notifications

---

## License

TimePortal Licensing System - Proprietary
Copyright (c) 2026 TimePortal. All rights reserved.

This licensing system is part of TimePortal and is not open source.
Unauthorized copying, modification, or distribution is prohibited.

---

**Questions or Issues?**

Refer to `/LICENSING_ARCHITECTURE.md` for the comprehensive 500+ line architecture document, or reach out to the development team.
