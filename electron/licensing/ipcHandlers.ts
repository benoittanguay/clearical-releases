/**
 * License IPC Handlers
 *
 * Electron IPC handlers for license operations.
 * These handlers bridge the main process licensing logic with the renderer process.
 */

import { ipcMain } from 'electron';
import {
    LicenseValidator,
    LicenseStorage,
    DeviceFingerprintService,
    PaddleClient,
    ValidationResult,
    License,
    LicenseEvent,
    LicenseErrorCode,
    DEFAULT_LICENSE_CONFIG,
} from './index.js';

// Global license validator instance
let licenseValidator: LicenseValidator | null = null;

/**
 * Initialize licensing system
 */
export function initializeLicensing(): void {
    console.log('[Licensing] Initializing licensing system...');

    // Create validator instance
    licenseValidator = new LicenseValidator();

    // Register IPC handlers
    registerIpcHandlers();

    console.log('[Licensing] Licensing system initialized');
}

/**
 * Register all license-related IPC handlers
 */
function registerIpcHandlers(): void {
    // Validate license
    ipcMain.handle('license-validate', handleValidateLicense);

    // Get license info
    ipcMain.handle('license-get-info', handleGetLicenseInfo);

    // Activate license with key
    ipcMain.handle('license-activate', handleActivateLicense);

    // Deactivate license
    ipcMain.handle('license-deactivate', handleDeactivateLicense);

    // Device management
    ipcMain.handle('license-get-devices', handleGetDevices);
    ipcMain.handle('license-deactivate-device', handleDeactivateDevice);

    // Trial management
    ipcMain.handle('license-get-trial-info', handleGetTrialInfo);

    // License status checks
    ipcMain.handle('license-is-valid', handleIsLicenseValid);
    ipcMain.handle('license-has-feature', handleHasFeature);

    console.log('[Licensing] IPC handlers registered');
}

/**
 * Validate license handler
 */
async function handleValidateLicense(): Promise<{
    success: boolean;
    result?: ValidationResult;
    error?: string;
}> {
    try {
        if (!licenseValidator) {
            throw new Error('License validator not initialized');
        }

        const result = await licenseValidator.validate();

        console.log('[Licensing] License validation result:', {
            valid: result.valid,
            mode: result.mode,
            status: result.license?.status,
        });

        return {
            success: true,
            result,
        };
    } catch (error) {
        console.error('[Licensing] License validation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get license info handler
 */
async function handleGetLicenseInfo(): Promise<{
    success: boolean;
    license?: License;
    error?: string;
}> {
    try {
        const license = await LicenseStorage.getLicense();

        if (!license) {
            return {
                success: true,
                license: undefined,
            };
        }

        console.log('[Licensing] License info retrieved:', {
            status: license.status,
            planType: license.planType,
            email: license.email,
        });

        return {
            success: true,
            license,
        };
    } catch (error) {
        console.error('[Licensing] Failed to get license info:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Activate license with key handler
 */
async function handleActivateLicense(
    event: Electron.IpcMainInvokeEvent,
    licenseKey: string,
    email?: string
): Promise<{
    success: boolean;
    license?: License;
    error?: string;
}> {
    try {
        console.log('[Licensing] Activating license:', {
            licenseKey: maskLicenseKey(licenseKey),
            email,
        });

        // Get device fingerprint
        const deviceFingerprint = await DeviceFingerprintService.generate();

        // For Phase 1, we'll create a mock activated license
        // In Phase 2, this will use PaddleClient to verify with Paddle API
        const now = Date.now();

        const activatedLicense: License = {
            licenseKey,
            email: email || '',
            status: 'active' as any,
            planType: 'monthly' as any,
            activatedAt: now,
            expiresAt: now + 30 * 24 * 60 * 60 * 1000, // 30 days from now
            deviceId: deviceFingerprint.deviceId,
            devices: [deviceFingerprint],
            maxDevices: DEFAULT_LICENSE_CONFIG.defaultMaxDevices,
            lastValidated: now,
            validatedOffline: false,
            features: {
                jiraIntegration: true,
                tempoSync: true,
                aiAnalysis: true,
                teamFeatures: false,
                exportFeatures: true,
                screenshotStorage: true,
            },
            version: '1.0',
            createdAt: now,
            updatedAt: now,
        };

        // Save license
        await LicenseStorage.saveLicense(activatedLicense);

        console.log('[Licensing] License activated successfully');

        return {
            success: true,
            license: activatedLicense,
        };
    } catch (error) {
        console.error('[Licensing] License activation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Deactivate license handler
 */
async function handleDeactivateLicense(): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        console.log('[Licensing] Deactivating license...');

        await LicenseStorage.deleteLicense();

        console.log('[Licensing] License deactivated successfully');

        return {
            success: true,
        };
    } catch (error) {
        console.error('[Licensing] License deactivation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get devices handler
 */
async function handleGetDevices(): Promise<{
    success: boolean;
    devices?: any[];
    error?: string;
}> {
    try {
        const license = await LicenseStorage.getLicense();

        if (!license) {
            return {
                success: true,
                devices: [],
            };
        }

        // Sanitize device data (remove PII)
        const sanitizedDevices = license.devices.map((device) => ({
            deviceId: DeviceFingerprintService.getShortDeviceId(device.deviceId),
            deviceName: device.deviceName,
            platform: device.platform,
            osVersion: device.osVersion,
            activatedAt: device.activatedAt,
            lastSeenAt: device.lastSeenAt,
            isCurrent: device.deviceId === license.deviceId,
        }));

        return {
            success: true,
            devices: sanitizedDevices,
        };
    } catch (error) {
        console.error('[Licensing] Failed to get devices:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Deactivate device handler
 */
async function handleDeactivateDevice(
    event: Electron.IpcMainInvokeEvent,
    deviceId: string
): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        if (!licenseValidator) {
            throw new Error('License validator not initialized');
        }

        const license = await LicenseStorage.getLicense();
        if (!license) {
            throw new Error('No license found');
        }

        await licenseValidator.deactivateDevice(license, deviceId);

        console.log('[Licensing] Device deactivated:', deviceId.substring(0, 8));

        return {
            success: true,
        };
    } catch (error) {
        console.error('[Licensing] Device deactivation failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get trial info handler
 */
async function handleGetTrialInfo(): Promise<{
    success: boolean;
    isTrial?: boolean;
    daysRemaining?: number;
    trialEndsAt?: number;
    error?: string;
}> {
    try {
        const license = await LicenseStorage.getLicense();

        if (!license) {
            return {
                success: true,
                isTrial: false,
                daysRemaining: 0,
            };
        }

        const isTrial = LicenseValidator.isTrial(license);
        const daysRemaining = LicenseValidator.getTrialDaysRemaining(license);

        return {
            success: true,
            isTrial,
            daysRemaining,
            trialEndsAt: license.trialEndsAt,
        };
    } catch (error) {
        console.error('[Licensing] Failed to get trial info:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Check if license is valid handler
 */
async function handleIsLicenseValid(): Promise<{
    success: boolean;
    valid?: boolean;
    error?: string;
}> {
    try {
        if (!licenseValidator) {
            throw new Error('License validator not initialized');
        }

        const result = await licenseValidator.validate();

        return {
            success: true,
            valid: result.valid,
        };
    } catch (error) {
        console.error('[Licensing] Failed to check license validity:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Check if license has feature handler
 */
async function handleHasFeature(
    event: Electron.IpcMainInvokeEvent,
    featureName: string
): Promise<{
    success: boolean;
    hasFeature?: boolean;
    error?: string;
}> {
    try {
        const license = await LicenseStorage.getLicense();

        if (!license) {
            return {
                success: true,
                hasFeature: false,
            };
        }

        const hasFeature = license.features[featureName as keyof typeof license.features] || false;

        return {
            success: true,
            hasFeature,
        };
    } catch (error) {
        console.error('[Licensing] Failed to check feature:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Mask license key for logging
 */
function maskLicenseKey(licenseKey: string): string {
    if (licenseKey.length <= 4) {
        return '****';
    }
    return '****-****-****-' + licenseKey.substring(licenseKey.length - 4);
}

/**
 * Get license validator instance (for internal use)
 */
export function getLicenseValidator(): LicenseValidator | null {
    return licenseValidator;
}
