# TimePortal Licensing Architecture Implementation Plan

**Date**: January 2026
**Version**: 1.0
**Author**: Production Architect
**Project**: TimePortal - macOS Time Tracking Application
**Price Point**: $4.99/month (subscription-based)

---

## Executive Summary

This document outlines the comprehensive licensing architecture for TimePortal, transforming it from a development prototype into a commercially viable SaaS product. The architecture prioritizes **user experience**, **security**, **reliability**, and **commercial viability** while maintaining the application's lightweight, privacy-first approach.

**Key Recommendations**:
1. **Paddle** as the preferred payment provider (best for indie/small SaaS)
2. **Hybrid validation**: Online verification with generous offline grace periods
3. **14-day free trial** with full feature access
4. **Device-based licensing** (soft limit of 2 devices per subscription)
5. **Subscription-first model** with optional yearly plan

**Critical Success Factors**:
- Minimal friction during trial activation
- Graceful degradation when offline
- Clear, empathetic error messaging
- Secure but not paranoid validation

---

## 1. Commercial Strategy & Business Model

### 1.1 Pricing Model Analysis

**Recommended Model**: Subscription-based with trial

| Plan | Price | Duration | Target Customer |
|------|-------|----------|-----------------|
| Free Trial | $0 | 14 days | All new users (no credit card required) |
| Monthly | $4.99/mo | Recurring | Individual users, try-before-commit |
| Yearly | $49.99/yr | Recurring | Committed users (17% discount = ~2 months free) |
| Lifetime* | $149.99 | One-time | Early adopters, grandfathered option |

**Rationale**:
- **$4.99/month**: Accessible price point for individual time trackers
- **No credit card for trial**: Removes friction, increases trial adoption
- **14-day trial**: Industry standard, enough time to build habit
- **Yearly discount**: Incentivizes annual commitments, improves cash flow
- **Lifetime option**: Consider ONLY for launch period (first 3-6 months) to build early adopter community

### 1.2 Revenue Projections & Churn Considerations

**Key Metrics to Track**:
- Trial-to-paid conversion rate (target: 15-25%)
- Monthly churn rate (target: <5%)
- Average customer lifetime value (LTV)
- Customer acquisition cost (CAC)
- LTV:CAC ratio (target: 3:1 minimum)

**Churn Mitigation**:
- Win-back campaigns for canceled subscriptions
- Pause subscription option (instead of cancel)
- Exit surveys to understand cancellation reasons
- Product usage analytics to predict at-risk customers

### 1.3 License Compliance & Auditing

**Audit Requirements**:
- Log all license validation attempts (success/failure/offline)
- Track device activations and deactivations
- Monitor for abuse patterns (excessive device switching, API key sharing)
- Compliance reporting for financial audits (revenue recognition)

---

## 2. Payment Provider Evaluation

### 2.1 Provider Comparison Matrix

| Feature | Paddle | Gumroad | LemonSqueezy | Stripe + Custom |
|---------|--------|---------|--------------|-----------------|
| **Merchant of Record** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No (you handle) |
| **VAT/Sales Tax** | ✅ Automatic | ✅ Automatic | ✅ Automatic | ⚠️ Manual (TaxJar) |
| **Subscription Mgmt** | ✅ Native | ✅ Native | ✅ Native | ⚠️ Build yourself |
| **License API** | ✅ Rich API | ⚠️ Basic API | ✅ Good API | ⚠️ Build yourself |
| **Webhook Reliability** | ✅ Excellent | ⚠️ Good | ✅ Excellent | ✅ Excellent |
| **Fee Structure** | 5% + payment | 10% + payment | 5% + payment | 2.9% + 0.30 |
| **macOS App Support** | ✅ Excellent | ✅ Good | ✅ Good | ⚠️ Custom |
| **Recovery & Dunning** | ✅ Built-in | ⚠️ Basic | ✅ Good | ⚠️ Build yourself |
| **Fraud Detection** | ✅ Advanced | ⚠️ Basic | ✅ Good | ⚠️ Build yourself |
| **Analytics** | ✅ Rich | ⚠️ Basic | ✅ Good | ⚠️ Build yourself |
| **Customer Support** | ✅ They handle | ⚠️ You handle | ⚠️ You handle | ⚠️ You handle |
| **Multi-currency** | ✅ Automatic | ✅ Automatic | ✅ Automatic | ⚠️ Manual |

### 2.2 Recommendation: Paddle

**Winner**: **Paddle** (Best for indie developers and small SaaS)

**Justification**:
1. **Merchant of Record**: Handles all tax compliance (VAT, GST, sales tax) globally
2. **Total Cost of Ownership**: 5% fee is worth it vs. building tax/subscription infrastructure
3. **License API**: Robust API for license validation and management
4. **Subscription Recovery**: Built-in dunning management increases retention
5. **Developer Experience**: Excellent documentation, SDKs, and developer tools
6. **Growth Path**: Scales from indie to enterprise without platform change

**Alternative**: LemonSqueezy (if Paddle's onboarding requirements are too strict)

**Avoid**: Gumroad (10% fee too high, limited API capabilities)

**Avoid**: Stripe + Custom (too much operational overhead for a solo/small team)

---

## 3. Licensing Architecture Design

### 3.1 License Validation Strategy

**Hybrid Approach**: Online verification with offline grace periods

```
┌─────────────────────────────────────────────────────────────┐
│  License Validation Flow                                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. App Start → Check local license cache                    │
│     ├─ Valid & Fresh (< 24h) → Allow usage                  │
│     ├─ Valid & Stale (24h-7d) → Allow + Background verify   │
│     └─ Invalid/Expired → Online verification required       │
│                                                               │
│  2. Online Verification (every 24h when online)              │
│     ├─ Network available → Paddle API check                 │
│     │   ├─ Active subscription → Update cache, continue     │
│     │   └─ Inactive → Grace period or trial check           │
│     └─ Network unavailable → Use cached license (up to 7d)  │
│                                                               │
│  3. Grace Period Handling (subscription expired)             │
│     ├─ 0-3 days: Warning banner, full functionality         │
│     ├─ 4-7 days: Persistent modal, full functionality       │
│     └─ 8+ days: Soft lock (view-only mode)                  │
│                                                               │
│  4. Trial Period Handling                                    │
│     ├─ First launch: Generate trial license (14 days)       │
│     ├─ Trial active: Full functionality + trial banner      │
│     ├─ Trial ending (2 days left): Upgrade prompts          │
│     └─ Trial expired: Soft lock, upgrade required           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decisions**:
- **24-hour online check interval**: Balance between security and user experience
- **7-day offline grace period**: Allows travel, network issues without disruption
- **Soft lock on expiration**: Read-only mode preserves user data, encourages upgrade
- **No hard kill-switch**: Avoid data loss or sudden app breakage

### 3.2 Machine Binding & Device Management

**Device Activation Model**:
- **Soft limit**: 2 concurrent devices per subscription (reasonable for most users)
- **User-managed deactivation**: Users can deactivate devices from web dashboard
- **Automatic cleanup**: Devices inactive for 90+ days auto-deactivate
- **Generous overflow**: 3rd device triggers "manage devices" prompt, doesn't hard-block

**Device Fingerprinting**:
```typescript
interface DeviceFingerprint {
    hardwareUUID: string;      // macOS: IOPlatformUUID
    machineId: string;          // Electron app.getSystemId()
    hostname: string;           // os.hostname()
    username: string;           // os.userInfo().username
    deviceName: string;         // User-friendly name (for dashboard)
    activatedAt: number;        // Unix timestamp
    lastSeenAt: number;         // Last successful validation
}
```

**Anti-Abuse Measures** (without being draconian):
- Rate limit license checks per device (max 10/hour)
- Flag accounts with >5 device activations in 30 days (manual review)
- Allow device reactivation after deactivation (no cooldown penalty)

### 3.3 License Data Structure

```typescript
interface License {
    // Core License Data
    licenseKey: string;              // Unique license key (from Paddle)
    email: string;                   // Customer email
    status: LicenseStatus;           // active | trial | expired | canceled | suspended

    // Subscription Details
    subscriptionId?: string;         // Paddle subscription ID
    planType: 'trial' | 'monthly' | 'yearly' | 'lifetime';

    // Validity Periods
    activatedAt: number;             // Unix timestamp
    expiresAt: number;               // Unix timestamp (null for lifetime)
    trialEndsAt?: number;            // Unix timestamp (for trial period)

    // Device Management
    deviceId: string;                // Current device fingerprint
    devices: DeviceFingerprint[];    // All activated devices
    maxDevices: number;              // License device limit (default: 2)

    // Validation Metadata
    lastValidated: number;           // Last online validation timestamp
    validatedOffline: boolean;       // True if using cached license
    gracePeriodEndsAt?: number;      // Extended grace period for expired subs

    // Feature Flags (future use)
    features?: {
        jiraIntegration: boolean;
        tempoSync: boolean;
        aiAnalysis: boolean;
        teamFeatures: boolean;
    };

    // Metadata
    version: string;                 // License schema version
    createdAt: number;
    updatedAt: number;
}

enum LicenseStatus {
    TRIAL = 'trial',                 // Free trial period
    ACTIVE = 'active',               // Paid subscription active
    GRACE_PERIOD = 'grace_period',   // Expired but within grace period
    EXPIRED = 'expired',             // Expired beyond grace period
    CANCELED = 'canceled',           // User canceled (finish current period)
    SUSPENDED = 'suspended',         // Payment failed or fraud
    LIFETIME = 'lifetime',           // Lifetime license (no expiration)
}
```

### 3.4 Secure Storage Architecture

**License Storage Location**:
```
~/Library/Application Support/TimePortal/
├── .license                          # Encrypted license file
├── .credentials                      # Encrypted API credentials (existing)
└── userData/
    ├── screenshots/
    └── settings.json
```

**Encryption Strategy**:
- Use **Electron safeStorage API** (already implemented for credentials)
- License file encrypted with OS-level encryption (macOS Keychain)
- License key stored separately from validation metadata
- No plaintext license data in memory logs

**Security Measures**:
- File permissions: 0600 (owner read/write only)
- No license data in crash logs or analytics
- License key never logged or exposed to renderer process
- API requests use short-lived session tokens, not license keys

---

## 4. Implementation Roadmap

### 4.1 Phase 1: Foundation (Week 1)

**Deliverables**:
1. ✅ License data models and TypeScript interfaces
2. ✅ License storage service (using safeStorage)
3. ✅ Device fingerprinting utility
4. ✅ License validation logic (offline mode only)
5. ✅ Basic UI components (license status indicator)

**Files to Create**:
- `/electron/licensing/licenseStorage.ts` - Encrypted license storage
- `/electron/licensing/licenseValidator.ts` - Validation logic
- `/electron/licensing/deviceFingerprint.ts` - Device identification
- `/electron/licensing/types.ts` - TypeScript interfaces
- `/src/components/LicenseStatus.tsx` - Status indicator component
- `/src/context/LicenseContext.tsx` - React context for license state

### 4.2 Phase 2: Paddle Integration (Week 2)

**Deliverables**:
1. Paddle SDK integration (Node.js)
2. License activation flow (enter license key → validate with Paddle)
3. Trial activation flow (generate trial license on first launch)
4. Online license validation (Paddle API)
5. Webhook listener for subscription events
6. License refresh background service

**Files to Create**:
- `/electron/licensing/paddleClient.ts` - Paddle API client
- `/electron/licensing/webhookHandler.ts` - Paddle webhook processor
- `/src/components/LicenseActivation.tsx` - Activation UI
- `/src/components/TrialBanner.tsx` - Trial status banner

**Paddle Setup Tasks**:
- Create Paddle Vendor account
- Configure products (Monthly, Yearly, Lifetime plans)
- Set up webhooks (subscription events)
- Generate API keys (sandbox and production)
- Configure checkout overlay settings

### 4.3 Phase 3: User Experience (Week 3)

**Deliverables**:
1. Trial onboarding flow (first launch experience)
2. License management UI (view status, manage devices)
3. Upgrade prompts (trial ending, subscription expired)
4. Grace period notifications (warning banners, modals)
5. Soft lock implementation (read-only mode)
6. In-app purchase flow (deep link to Paddle checkout)

**Files to Create**:
- `/src/components/TrialOnboarding.tsx` - First launch wizard
- `/src/components/LicenseManagement.tsx` - License settings page
- `/src/components/UpgradeModal.tsx` - Upgrade prompt
- `/src/components/GracePeriodBanner.tsx` - Warning banner
- `/src/components/ReadOnlyMode.tsx` - Soft lock overlay

**UX Principles**:
- **Non-intrusive**: Banners, not modal takeovers (until critical)
- **Informative**: Clear messaging about license status and next steps
- **Actionable**: One-click upgrade, manage subscription, contact support
- **Empathetic**: Understanding tone for payment failures, network issues

### 4.4 Phase 4: Production Hardening (Week 4)

**Deliverables**:
1. Error handling and retry logic (network failures, API errors)
2. Logging and monitoring (license validation events)
3. Security audit (encryption, API key management)
4. Performance optimization (caching, background validation)
5. Edge case handling (clock skew, offline mode, device limits)
6. Beta testing with real users

**Critical Tasks**:
- Implement exponential backoff for API retries
- Add license validation event logging (for analytics)
- Security review: ensure no license data leaks
- Test offline mode thoroughly (7-day grace period)
- Test device activation limits and deactivation flows
- Handle clock manipulation attempts (use server time)

### 4.5 Phase 5: Launch Preparation (Week 5)

**Deliverables**:
1. Production Paddle account setup
2. Legal compliance (terms of service, privacy policy updates)
3. Licensing documentation (for users and support)
4. Analytics integration (license events, conversion tracking)
5. Support infrastructure (license issue troubleshooting)
6. App Store / website listing updates

**Marketing Preparation**:
- Paddle checkout page branding
- Email templates (welcome, trial ending, payment failed)
- Support documentation (how to activate, manage devices, etc.)
- Refund policy and process
- Feature comparison page (trial vs. paid)

---

## 5. Technical Implementation Details

### 5.1 License Validation Service Architecture

```typescript
// /electron/licensing/licenseValidator.ts

import { License, LicenseStatus } from './types';
import { LicenseStorage } from './licenseStorage';
import { PaddleClient } from './paddleClient';
import { DeviceFingerprint } from './deviceFingerprint';

export class LicenseValidator {
    private storage: LicenseStorage;
    private paddle: PaddleClient;
    private device: DeviceFingerprint;

    // Validation intervals
    private static ONLINE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    private static OFFLINE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days
    private static SUBSCRIPTION_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days

    async validateLicense(): Promise<ValidationResult> {
        // 1. Load cached license
        const cachedLicense = await this.storage.getLicense();
        if (!cachedLicense) {
            return this.handleNoLicense();
        }

        // 2. Check if cached license is fresh enough
        const cacheAge = Date.now() - cachedLicense.lastValidated;
        const isFresh = cacheAge < LicenseValidator.ONLINE_CHECK_INTERVAL;

        if (isFresh && this.isLicenseValid(cachedLicense)) {
            return { valid: true, license: cachedLicense, mode: 'cached' };
        }

        // 3. Attempt online validation
        try {
            const onlineLicense = await this.paddle.validateLicense(
                cachedLicense.licenseKey,
                this.device.getFingerprint()
            );

            // Update cache with fresh data
            await this.storage.updateLicense(onlineLicense);

            return { valid: true, license: onlineLicense, mode: 'online' };
        } catch (error) {
            // 4. Online validation failed, check offline grace period
            return this.handleOfflineMode(cachedLicense, error);
        }
    }

    private isLicenseValid(license: License): boolean {
        const now = Date.now();

        // Check expiration
        if (license.expiresAt && license.expiresAt < now) {
            // Check grace period
            if (license.gracePeriodEndsAt && license.gracePeriodEndsAt > now) {
                return true; // Within grace period
            }
            return false; // Expired beyond grace period
        }

        // Check device limit
        if (license.devices.length > license.maxDevices) {
            return false; // Too many devices activated
        }

        // Check status
        return ['active', 'trial', 'lifetime'].includes(license.status);
    }

    private async handleNoLicense(): Promise<ValidationResult> {
        // First launch: create trial license
        const trialLicense = await this.createTrialLicense();
        await this.storage.saveLicense(trialLicense);

        return { valid: true, license: trialLicense, mode: 'trial' };
    }

    private handleOfflineMode(
        cachedLicense: License,
        error: Error
    ): ValidationResult {
        const offlineAge = Date.now() - cachedLicense.lastValidated;

        if (offlineAge < LicenseValidator.OFFLINE_GRACE_PERIOD) {
            // Still within offline grace period, allow usage
            return {
                valid: true,
                license: { ...cachedLicense, validatedOffline: true },
                mode: 'offline',
                warning: 'Unable to verify license online. Using cached license.'
            };
        } else {
            // Offline grace period expired
            return {
                valid: false,
                license: cachedLicense,
                mode: 'offline_expired',
                error: 'License validation required. Please connect to the internet.'
            };
        }
    }
}
```

### 5.2 Paddle API Integration

```typescript
// /electron/licensing/paddleClient.ts

import { License, LicenseStatus } from './types';

export class PaddleClient {
    private vendorId: string;
    private apiKey: string;
    private apiEndpoint: string;

    constructor(config: { vendorId: string; apiKey: string; sandbox?: boolean }) {
        this.vendorId = config.vendorId;
        this.apiKey = config.apiKey;
        this.apiEndpoint = config.sandbox
            ? 'https://sandbox-vendors.paddle.com/api'
            : 'https://vendors.paddle.com/api';
    }

    async validateLicense(licenseKey: string, deviceId: string): Promise<License> {
        // Call Paddle License API to validate
        const response = await fetch(`${this.apiEndpoint}/2.0/license/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                vendor_id: this.vendorId,
                vendor_auth_code: this.apiKey,
                license_code: licenseKey,
                device_id: deviceId,
            }),
        });

        if (!response.ok) {
            throw new Error(`License validation failed: ${response.statusText}`);
        }

        const data = await response.json();

        // Transform Paddle response to our License model
        return this.transformPaddleResponse(data, licenseKey, deviceId);
    }

    async activateDevice(licenseKey: string, deviceFingerprint: DeviceFingerprint): Promise<void> {
        // Register device with Paddle
        await fetch(`${this.apiEndpoint}/2.0/license/activate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                vendor_id: this.vendorId,
                vendor_auth_code: this.apiKey,
                license_code: licenseKey,
                device_id: deviceFingerprint.deviceId,
                device_name: deviceFingerprint.deviceName,
            }),
        });
    }

    async deactivateDevice(licenseKey: string, deviceId: string): Promise<void> {
        // Deactivate device in Paddle
        await fetch(`${this.apiEndpoint}/2.0/license/deactivate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                vendor_id: this.vendorId,
                vendor_auth_code: this.apiKey,
                license_code: licenseKey,
                device_id: deviceId,
            }),
        });
    }
}
```

### 5.3 Device Fingerprinting

```typescript
// /electron/licensing/deviceFingerprint.ts

import { app } from 'electron';
import os from 'os';
import crypto from 'crypto';

export interface DeviceFingerprint {
    deviceId: string;           // Unique device identifier
    hardwareUUID: string;       // macOS hardware UUID
    machineId: string;          // Electron machine ID
    hostname: string;
    username: string;
    deviceName: string;         // User-friendly name
    platform: string;
    osVersion: string;
    activatedAt: number;
    lastSeenAt: number;
}

export class DeviceFingerprintGenerator {
    async generate(): Promise<DeviceFingerprint> {
        const hardwareUUID = await this.getMacOSHardwareUUID();
        const machineId = await app.getSystemId();

        // Create composite device ID
        const deviceId = this.createDeviceId(hardwareUUID, machineId);

        return {
            deviceId,
            hardwareUUID,
            machineId,
            hostname: os.hostname(),
            username: os.userInfo().username,
            deviceName: this.getDeviceName(),
            platform: process.platform,
            osVersion: os.release(),
            activatedAt: Date.now(),
            lastSeenAt: Date.now(),
        };
    }

    private async getMacOSHardwareUUID(): Promise<string> {
        if (process.platform !== 'darwin') {
            return 'not-macos';
        }

        // Use ioreg to get hardware UUID
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        try {
            const result = await execAsync(
                "ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk '{print $3}'"
            );
            return result.stdout.trim().replace(/"/g, '');
        } catch (error) {
            console.error('[DeviceFingerprint] Failed to get hardware UUID:', error);
            return 'unknown';
        }
    }

    private createDeviceId(hardwareUUID: string, machineId: string): string {
        // Create deterministic device ID from hardware UUID and machine ID
        const composite = `${hardwareUUID}-${machineId}`;
        return crypto.createHash('sha256').update(composite).digest('hex').substring(0, 32);
    }

    private getDeviceName(): string {
        // Try to get user-friendly device name
        const hostname = os.hostname();
        const username = os.userInfo().username;

        // Clean up hostname (remove .local, etc.)
        const cleanHostname = hostname.replace(/\.local$/, '').replace(/\.lan$/, '');

        return `${username}'s ${cleanHostname}`;
    }
}
```

---

## 6. User Experience & UI/UX Design

### 6.1 Trial Onboarding Flow

**First Launch Experience**:
```
┌─────────────────────────────────────────────────────────────┐
│  Welcome to TimePortal!                                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Track your time effortlessly with automatic screenshots     │
│  and Jira integration.                                       │
│                                                               │
│  Your 14-day free trial starts now!                          │
│  • Full access to all features                               │
│  • No credit card required                                   │
│  • Cancel anytime                                            │
│                                                               │
│  [Start Free Trial]                                          │
│                                                               │
│  Already have a license? [Enter License Key]                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**During Trial** (persistent banner):
```
┌─────────────────────────────────────────────────────────────┐
│ 🎉 Trial: 12 days left | [Upgrade Now] [Dismiss]            │
└─────────────────────────────────────────────────────────────┘
```

**Trial Ending** (2 days left - modal):
```
┌─────────────────────────────────────────────────────────────┐
│  Your trial ends in 2 days                                   │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Upgrade to continue using TimePortal and keep your data.    │
│                                                               │
│  • Monthly: $4.99/mo                                         │
│  • Yearly: $49.99/yr (Save 17%)                              │
│                                                               │
│  [Upgrade to Monthly] [Upgrade to Yearly]                    │
│                                                               │
│  Not ready? [Remind me tomorrow]                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 License Activation Flow

**Enter License Key**:
```
┌─────────────────────────────────────────────────────────────┐
│  Activate TimePortal                                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Enter your license key:                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ XXXX-XXXX-XXXX-XXXX                                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  Your license key can be found in your purchase email.       │
│                                                               │
│  [Activate]  [Cancel]                                        │
│                                                               │
│  Don't have a license? [Buy Now]                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Activation Success**:
```
┌─────────────────────────────────────────────────────────────┐
│  ✅ License Activated!                                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Thank you for purchasing TimePortal!                        │
│                                                               │
│  • Plan: Monthly Subscription                                │
│  • Renews: February 8, 2026                                  │
│  • Devices: 1 of 2 activated                                 │
│                                                               │
│  [Continue]                                                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 License Management UI

**Settings → License Tab**:
```
┌─────────────────────────────────────────────────────────────┐
│  License Information                                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Status: ✅ Active                                            │
│  Plan: Monthly Subscription ($4.99/mo)                       │
│  Next billing: February 8, 2026                              │
│  Email: user@example.com                                     │
│                                                               │
│  [Manage Subscription] [Upgrade to Yearly]                   │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  Device Management (1 of 2 devices)                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  • MacBook Pro (Current device)                              │
│    Activated: Jan 8, 2026                                    │
│                                                               │
│  [Add Device] [Manage Devices on Web]                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 6.4 Grace Period & Expiration Handling

**Grace Period Warning** (Day 1-3):
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  Payment failed | [Update Payment] [Dismiss]              │
└─────────────────────────────────────────────────────────────┘
```

**Grace Period Alert** (Day 4-7 - persistent modal):
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️  Action Required: Payment Issue                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  We couldn't process your payment for TimePortal.            │
│                                                               │
│  Your subscription expires in 3 days.                        │
│  Update your payment method to continue using the app.       │
│                                                               │
│  [Update Payment Method]                                     │
│                                                               │
│  Need help? [Contact Support]                                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Soft Lock** (Expired, read-only mode):
```
┌─────────────────────────────────────────────────────────────┐
│  TimePortal - Read-Only Mode                                 │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Your subscription has expired.                              │
│                                                               │
│  • You can view your past time entries                       │
│  • You can export your data                                  │
│  • Time tracking is disabled                                 │
│                                                               │
│  Renew your subscription to resume time tracking.            │
│                                                               │
│  [Renew Subscription]                                        │
│                                                               │
│  [View History] [Export Data] [Contact Support]              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Security & Compliance

### 7.1 Encryption & Data Protection

**Sensitive Data Protection**:
- License keys encrypted using Electron `safeStorage` (macOS Keychain)
- API keys and tokens stored in encrypted credential store (already implemented)
- No plaintext license data in logs or memory dumps
- Secure communication with Paddle API (HTTPS only)

**Security Best Practices**:
- License validation uses short-lived session tokens
- API rate limiting to prevent brute-force attacks
- Device fingerprints hashed before transmission
- No customer PII stored locally beyond email address

### 7.2 GDPR & Privacy Compliance

**Data Processing**:
- **User Consent**: Trial activation implies consent to process email for licensing
- **Data Minimization**: Only collect email, device info, and subscription status
- **Right to Access**: Users can view all license data in Settings
- **Right to Deletion**: Account deletion removes all license data (via Paddle)
- **Data Portability**: Export license history and device list

**Privacy Policy Updates Required**:
- Add section on license validation and device tracking
- Explain Paddle as payment processor (sub-processor disclosure)
- Detail what license data is collected and why
- Explain retention periods (active subscription + 90 days)

### 7.3 PCI Compliance

**Payment Security**:
- **Paddle as Merchant of Record**: Handles all payment processing
- **No Card Data Handling**: TimePortal never sees or stores card numbers
- **PCI DSS Compliance**: Paddle is PCI DSS Level 1 certified
- **Scope Reduction**: Using Paddle removes PCI compliance burden from TimePortal

---

## 8. Edge Cases & Error Handling

### 8.1 Offline Scenarios

| Scenario | Behavior | User Experience |
|----------|----------|-----------------|
| **Online validation fails (network down)** | Use cached license (up to 7 days) | Banner: "Offline mode - using cached license" |
| **Offline for 8+ days** | Soft lock (read-only mode) | Modal: "Verification required - please connect to internet" |
| **First launch (offline)** | Allow trial, queue online activation | Trial starts, sync when online |
| **License expired (offline)** | Extended grace period (14 days total) | Warning banner, full functionality |

### 8.2 Device Limit Scenarios

| Scenario | Behavior | User Experience |
|----------|----------|-----------------|
| **2 devices activated, adding 3rd** | Allow with warning prompt | "2 devices active. Manage devices to add more." |
| **Device limit exceeded (3+)** | Soft block with manage option | Modal: "Device limit reached. Deactivate a device to continue." |
| **User deactivates old device** | Immediate activation on new device | Success message: "Device activated" |
| **Device auto-cleanup (90+ days inactive)** | Automatic deactivation | Email notification: "Device deactivated due to inactivity" |

### 8.3 Clock Manipulation

**Detection**:
- Compare local time to server time during validation
- Flag devices with >1 hour clock skew
- Use server timestamp for all expiration checks

**Mitigation**:
- Store last validated timestamp, detect backward jumps
- Require online validation if clock skew detected
- Log suspicious activity for manual review

### 8.4 Subscription Lifecycle Events

| Paddle Event | TimePortal Action | User Notification |
|--------------|-------------------|-------------------|
| **subscription.created** | Activate license, send welcome email | In-app: "Subscription activated!" |
| **subscription.updated** | Update plan details in cache | In-app: "Subscription updated" |
| **subscription.canceled** | Set grace period, prompt renewal | In-app: "Subscription canceled. Access until [date]" |
| **subscription.payment_succeeded** | Reset grace period, continue service | Email: "Payment received" |
| **subscription.payment_failed** | Start grace period countdown | In-app banner: "Payment failed - update payment method" |
| **subscription.paused** | Set pause status, maintain data access | In-app: "Subscription paused. Resume anytime." |

---

## 9. Analytics & Monitoring

### 9.1 Key Metrics to Track

**License Validation Events**:
- License validation attempts (success/failure)
- Online vs. offline validation ratio
- Grace period usage (how often users rely on offline mode)
- Device activation/deactivation frequency
- License key validation errors (invalid keys, expired, etc.)

**Business Metrics**:
- Trial activation rate (% of first launches that activate trial)
- Trial-to-paid conversion rate
- Monthly churn rate (subscriptions canceled)
- Average device count per license
- Payment failure rate and recovery rate

**Technical Metrics**:
- API latency (Paddle validation response time)
- Network timeout rate (failed validations due to network)
- Cache hit rate (successful offline validations)
- Device fingerprint collision rate (duplicate device IDs)

### 9.2 Logging Strategy

**License Events to Log**:
```typescript
enum LicenseEventType {
    VALIDATION_SUCCESS = 'validation_success',
    VALIDATION_FAILURE = 'validation_failure',
    TRIAL_ACTIVATED = 'trial_activated',
    LICENSE_ACTIVATED = 'license_activated',
    DEVICE_ACTIVATED = 'device_activated',
    DEVICE_DEACTIVATED = 'device_deactivated',
    OFFLINE_MODE_ENTERED = 'offline_mode_entered',
    GRACE_PERIOD_STARTED = 'grace_period_started',
    SOFT_LOCK_TRIGGERED = 'soft_lock_triggered',
    UPGRADE_PROMPTED = 'upgrade_prompted',
    PAYMENT_FAILED = 'payment_failed',
}

interface LicenseEvent {
    type: LicenseEventType;
    timestamp: number;
    deviceId: string;
    licenseStatus: LicenseStatus;
    metadata?: Record<string, any>;
}
```

**Privacy Considerations**:
- Never log full license keys (use last 4 chars only)
- Hash email addresses before logging
- No PII in error messages or stack traces
- Aggregate analytics data before sending to analytics service

---

## 10. Customer Support Infrastructure

### 10.1 Common Support Scenarios

| Issue | Self-Service Solution | Support Action |
|-------|----------------------|----------------|
| **Lost license key** | "Resend license" link on website | Paddle auto-resends email |
| **Device limit reached** | "Manage Devices" in-app link | User can deactivate devices self-service |
| **Payment failed** | "Update Payment" in-app button | Deep link to Paddle billing portal |
| **Offline validation failed** | Help article on offline mode | Manual license reset if needed |
| **License not activating** | "Validate License" button retries | Check Paddle API for subscription status |
| **Refund request** | Contact support email | Process via Paddle (auto-deactivates license) |

### 10.2 Support Documentation Required

**User-Facing Documentation**:
1. **How to Activate Your License** (with screenshots)
2. **Managing Multiple Devices** (activate/deactivate)
3. **Offline Mode Explained** (grace periods, limitations)
4. **Subscription Management** (change plan, update payment, cancel)
5. **Troubleshooting License Issues** (common errors, solutions)
6. **Refund Policy** (14-day money-back guarantee)

**Internal Support Docs**:
1. **License Verification Tool** (for support agents)
2. **Manual License Reset Procedure** (edge cases)
3. **Paddle Dashboard Guide** (lookup subscriptions, process refunds)
4. **Fraud Detection Playbook** (flagged accounts, abuse patterns)

### 10.3 Support Contact Integration

**In-App Support**:
- Help button in license management screen
- "Contact Support" option in error modals
- Pre-filled support form with license details (email, license key last 4 digits, device ID)

**Support Channels**:
- Email: support@timeportal.app
- Help Center: help.timeportal.app (knowledge base)
- Live Chat: (consider Intercom or Crisp for paid customers)

---

## 11. Testing Strategy

### 11.1 Test Scenarios

**Functional Tests**:
- ✅ Trial activation on first launch
- ✅ License key activation (valid/invalid keys)
- ✅ Device activation and deactivation
- ✅ Device limit enforcement (2 device limit)
- ✅ Online license validation (Paddle API)
- ✅ Offline mode with cached license
- ✅ Grace period countdown (trial ending, payment failed)
- ✅ Soft lock on expiration
- ✅ Subscription upgrade flow
- ✅ License expiration and renewal

**Security Tests**:
- ✅ License encryption verification (safeStorage)
- ✅ API key security (no exposure in logs)
- ✅ License key validation (no brute-force)
- ✅ Device fingerprint tampering detection
- ✅ Clock manipulation detection

**Edge Case Tests**:
- ⚠️ Offline for 7+ days (offline grace period)
- ⚠️ Clock changed backward/forward
- ⚠️ Network timeout during validation
- ⚠️ Paddle API down/unavailable
- ⚠️ Multiple devices activating simultaneously
- ⚠️ License key shared across multiple accounts
- ⚠️ Device factory reset (deactivation required)

**Performance Tests**:
- License validation latency (target: <500ms)
- Background validation overhead (minimal CPU/network)
- Cache lookup performance (<10ms)
- App startup time impact (<100ms added)

### 11.2 Beta Testing Plan

**Beta User Cohorts**:
1. **Internal Alpha** (Week 1): Team members and trusted advisors
2. **Private Beta** (Week 2-3): 20-50 early adopters (invite-only)
3. **Public Beta** (Week 4): Open beta with trial licenses

**Beta Testing Checklist**:
- [ ] Trial activation works on first launch
- [ ] License activation flow is intuitive
- [ ] Device management is clear and functional
- [ ] Offline mode gracefully handles network issues
- [ ] Grace period notifications are helpful, not annoying
- [ ] Upgrade prompts are clear and actionable
- [ ] No license data leaks in logs or UI
- [ ] App performance not impacted by licensing
- [ ] Support documentation is clear and complete

---

## 12. Launch Checklist

### 12.1 Pre-Launch (Week -1)

**Technical**:
- [ ] Production Paddle account configured
- [ ] Webhook endpoints deployed and tested
- [ ] License validation tested in production environment
- [ ] Security audit completed (encryption, API keys)
- [ ] Performance testing passed (validation latency)
- [ ] Error handling tested (network failures, edge cases)

**Business**:
- [ ] Pricing finalized (Monthly, Yearly, Lifetime)
- [ ] Payment flow tested (Paddle checkout)
- [ ] Email templates configured (welcome, trial ending, payment failed)
- [ ] Refund policy published
- [ ] Terms of Service and Privacy Policy updated

**Marketing**:
- [ ] Landing page updated with pricing
- [ ] Paddle checkout page branded
- [ ] Help center articles published
- [ ] Support email configured
- [ ] Launch announcement prepared

### 12.2 Launch Day

- [ ] Switch to production Paddle API keys
- [ ] Enable license validation in production build
- [ ] Monitor license validation success rate
- [ ] Monitor trial activation rate
- [ ] Watch for support tickets (license issues)
- [ ] Analytics tracking verified (conversion events)

### 12.3 Post-Launch (Week +1)

- [ ] Review trial-to-paid conversion rate
- [ ] Review payment failure rate
- [ ] Review device activation patterns
- [ ] Review support tickets (common issues)
- [ ] Iterate on UX based on user feedback
- [ ] Optimize validation logic (reduce latency)

---

## 13. Cost Analysis & Revenue Projections

### 13.1 Platform Costs

| Cost Category | Provider | Monthly Cost | Notes |
|---------------|----------|--------------|-------|
| **Payment Processing** | Paddle | 5% + payment fees | ~$0.25 per $4.99 transaction |
| **Hosting (Webhooks)** | Vercel/Railway | $0-20 | Serverless functions for webhooks |
| **Analytics** | Mixpanel/Amplitude | $0-50 | Free tier for <100K events |
| **Customer Support** | Intercom (optional) | $0-74 | Start with email, add chat later |
| **Infrastructure** | N/A | $0 | No servers (Electron desktop app) |
| **Total Fixed Costs** | | ~$0-150/mo | Scales with revenue |

### 13.2 Break-Even Analysis

**Fixed Costs**: ~$150/month (support + analytics + hosting)
**Variable Costs**: 5% payment processing + $0.30 per transaction

**Break-Even Point**:
- Monthly: 31 subscribers ($4.99 × 31 = $154.69 revenue)
- After 5% fee: $146.96 net
- Break-even: ~30-35 paying subscribers

**Revenue Projections** (Conservative):
- Month 1: 10 paying customers = $50 revenue
- Month 3: 50 paying customers = $250 revenue
- Month 6: 150 paying customers = $750 revenue
- Month 12: 400 paying customers = $2,000 revenue

**Churn Impact**:
- At 5% monthly churn: Need 5 new customers/month to maintain 100 subscribers
- At 3% monthly churn: Need 3 new customers/month (healthier)

---

## 14. Risk Assessment & Mitigation

### 14.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Paddle API downtime** | Low | High | Offline grace period, cached licenses |
| **License key leakage** | Medium | Medium | Device limits, deactivation on abuse |
| **Clock manipulation** | Low | Medium | Server-time validation, skew detection |
| **Device fingerprint collision** | Very Low | Low | Use composite hash (UUID + machine ID) |
| **Network issues (user)** | Medium | Low | 7-day offline grace period |
| **Payment failures** | Medium | Medium | Grace period, dunning emails (Paddle) |

### 14.2 Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Low trial-to-paid conversion** | Medium | High | Improve onboarding, add value demos |
| **High churn rate** | Medium | High | Proactive support, usage monitoring |
| **Refund abuse** | Low | Low | Clear refund policy, fraud detection |
| **Competitor pricing pressure** | Medium | Medium | Focus on unique features (AI, Jira) |
| **Paddle account issues** | Low | High | Have backup processor ready (Stripe) |

### 14.3 Legal Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **GDPR non-compliance** | Low | High | Privacy policy, data minimization |
| **Tax compliance issues** | Very Low | Medium | Paddle handles all tax as MoR |
| **License agreement disputes** | Low | Low | Clear ToS, refund policy |
| **User data breach** | Very Low | High | Encryption, security audit |

---

## 15. Future Enhancements

### 15.1 Phase 2 Features (3-6 months post-launch)

**Team Plans**:
- Multi-user subscriptions (5, 10, 25 seats)
- Centralized billing and license management
- Admin dashboard for team license allocation
- SSO integration (Google, Azure AD)

**Advanced Licensing**:
- Feature-based licensing (e.g., Jira integration as add-on)
- Usage-based pricing (e.g., $0.10 per 100 screenshots analyzed)
- Enterprise licensing (annual contracts, custom terms)
- Reseller program (volume discounts, white-label options)

### 15.2 Operational Improvements

**Automation**:
- Automated refund processing (within policy)
- Automated abuse detection and license suspension
- Automated device cleanup (90+ days inactive)
- Automated trial extension for high-value leads

**Analytics**:
- Cohort analysis (trial → paid conversion by signup date)
- Lifetime value prediction (ML-based churn prediction)
- Feature usage correlation with retention
- Payment recovery rate optimization

---

## 16. Conclusion & Next Steps

### 16.1 Summary of Recommendations

1. **Use Paddle** as the payment provider (MoR, tax handling, subscription management)
2. **Implement hybrid validation** (online + offline grace period)
3. **Start with generous trial** (14 days, no credit card required)
4. **Soft device limits** (2 devices, graceful overflow handling)
5. **Empathetic UX** (clear messaging, grace periods, no hard kill-switch)
6. **Security-first design** (encryption, safeStorage, no PII leaks)

### 16.2 Implementation Timeline

- **Week 1**: Core licensing infrastructure (storage, validation, device fingerprinting)
- **Week 2**: Paddle integration (API client, webhooks, license activation)
- **Week 3**: User experience (trial onboarding, upgrade prompts, license management)
- **Week 4**: Production hardening (error handling, security audit, testing)
- **Week 5**: Launch preparation (Paddle setup, documentation, marketing)

### 16.3 Critical Success Factors

**Must-Have for Launch**:
- ✅ Trial activation works on first launch
- ✅ License key activation is simple and reliable
- ✅ Offline mode works without disruption (7-day grace)
- ✅ Paddle checkout flow is smooth
- ✅ License encryption is secure

**Nice-to-Have (Post-Launch)**:
- Device management web dashboard
- In-app usage analytics
- Automated win-back campaigns
- Team plans and SSO

---

## Appendix A: Paddle API Endpoints

**License Verification**:
```
POST https://vendors.paddle.com/api/2.0/license/verify
```

**Device Activation**:
```
POST https://vendors.paddle.com/api/2.0/license/activate
```

**Device Deactivation**:
```
POST https://vendors.paddle.com/api/2.0/license/deactivate
```

**Subscription Management** (via Paddle.js SDK):
```javascript
Paddle.Checkout.open({
    product: 12345, // Product ID from Paddle dashboard
    email: 'user@example.com',
    passthrough: { deviceId: 'abc123' },
    successCallback: (data) => {
        // Handle successful purchase
    }
});
```

---

## Appendix B: License Key Format

**Format**: `XXXX-XXXX-XXXX-XXXX-XXXX` (20 characters, alphanumeric)

**Example**: `TP5K-J8N2-M9Q7-P4W6-L3D1`

**Validation**:
- 4 blocks of 4 characters
- Characters: A-Z, 0-9 (excluding ambiguous: 0, O, I, 1)
- Checksum validation (last character)

---

## Appendix C: Webhook Event Examples

**Subscription Created**:
```json
{
  "alert_name": "subscription_created",
  "subscription_id": "123456",
  "subscription_plan_id": "678910",
  "user_email": "user@example.com",
  "status": "active",
  "next_bill_date": "2026-02-08",
  "passthrough": "{\"deviceId\": \"abc123\"}",
  "p_signature": "..."
}
```

**Payment Failed**:
```json
{
  "alert_name": "subscription_payment_failed",
  "subscription_id": "123456",
  "amount": "4.99",
  "currency": "USD",
  "next_retry_date": "2026-01-15",
  "p_signature": "..."
}
```

---

**Document Version**: 1.0
**Last Updated**: January 8, 2026
**Status**: Implementation Ready
**Next Review**: Post-Launch (February 2026)
