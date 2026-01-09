/**
 * License Validator Service
 *
 * Core license validation logic with support for:
 * - Online validation (Paddle API)
 * - Offline mode with grace periods
 * - Trial license generation
 * - Device limit enforcement
 * - Grace period handling for expired subscriptions
 */

import {
    License,
    LicenseStatus,
    PlanType,
    ValidationResult,
    ValidationMode,
    LicenseError,
    LicenseErrorCode,
    LicenseConfig,
    DEFAULT_LICENSE_CONFIG,
    LicenseEvent,
    LicenseEventType,
} from './types.js';
import { LicenseStorage } from './licenseStorage.js';
import { DeviceFingerprintService } from './deviceFingerprint.js';
import type { DeviceFingerprint } from './types.js';

/**
 * License validator service
 */
export class LicenseValidator {
    private config: LicenseConfig;
    private eventListeners: ((event: LicenseEvent) => void)[] = [];

    constructor(config?: Partial<LicenseConfig>) {
        this.config = {
            ...DEFAULT_LICENSE_CONFIG,
            ...config,
        };
    }

    /**
     * Main validation method - validates license from cache or online
     * @returns Validation result with license data
     */
    async validate(): Promise<ValidationResult> {
        try {
            // 1. Check if license exists in storage
            const cachedLicense = await LicenseStorage.getLicense();

            if (!cachedLicense) {
                // No license found - generate trial license
                return await this.handleNoLicense();
            }

            // 2. Check if cached license is fresh enough
            const cacheAge = Date.now() - cachedLicense.lastValidated;
            const isFresh = cacheAge < this.config.onlineCheckInterval;

            // 3. Validate license status
            const validationResult = this.validateLicenseStatus(cachedLicense);

            if (isFresh && validationResult.valid) {
                // Cache is fresh and valid, use it
                this.emitEvent({
                    type: LicenseEventType.VALIDATION_SUCCESS,
                    timestamp: Date.now(),
                    deviceId: cachedLicense.deviceId,
                    licenseStatus: cachedLicense.status,
                    metadata: { mode: 'cached', cacheAge },
                });

                return {
                    valid: true,
                    license: cachedLicense,
                    mode: ValidationMode.CACHED,
                };
            }

            // 4. Cache is stale or invalid, attempt online validation
            // Note: Online validation would be implemented when Paddle integration is added
            // For now, we use offline mode with grace period

            if (this.config.enableOfflineMode) {
                return this.handleOfflineMode(cachedLicense);
            } else {
                return {
                    valid: false,
                    license: cachedLicense,
                    mode: ValidationMode.FAILED,
                    error: 'Online validation required but offline mode disabled',
                };
            }
        } catch (error) {
            console.error('[LicenseValidator] Validation failed:', error);

            this.emitEvent({
                type: LicenseEventType.VALIDATION_FAILURE,
                timestamp: Date.now(),
                deviceId: 'unknown',
                licenseStatus: LicenseStatus.EXPIRED,
                metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
            });

            return {
                valid: false,
                mode: ValidationMode.FAILED,
                error: error instanceof Error ? error.message : 'Validation failed',
            };
        }
    }

    /**
     * Validate license status (expiration, grace period, device limits)
     * @param license - License to validate
     * @returns Validation result
     */
    private validateLicenseStatus(license: License): { valid: boolean; reason?: string } {
        const now = Date.now();

        // Check trial expiration
        if (license.status === LicenseStatus.TRIAL && license.trialEndsAt) {
            if (license.trialEndsAt < now) {
                return { valid: false, reason: 'Trial expired' };
            }
        }

        // Check subscription expiration
        if (license.expiresAt && license.expiresAt < now) {
            // Check grace period
            if (license.gracePeriodEndsAt && license.gracePeriodEndsAt > now) {
                return { valid: true, reason: 'Within grace period' };
            }
            return { valid: false, reason: 'Subscription expired' };
        }

        // Check device limit
        if (this.config.enableDeviceLimit) {
            if (license.devices.length > license.maxDevices) {
                return { valid: false, reason: 'Device limit exceeded' };
            }
        }

        // Check license status
        const validStatuses = [
            LicenseStatus.ACTIVE,
            LicenseStatus.TRIAL,
            LicenseStatus.LIFETIME,
            LicenseStatus.GRACE_PERIOD,
        ];

        if (!validStatuses.includes(license.status)) {
            return { valid: false, reason: `Invalid status: ${license.status}` };
        }

        return { valid: true };
    }

    /**
     * Handle offline mode with grace period
     * @param cachedLicense - Cached license data
     * @returns Validation result
     */
    private handleOfflineMode(cachedLicense: License): ValidationResult {
        const offlineAge = Date.now() - cachedLicense.lastValidated;

        if (offlineAge < this.config.offlineGracePeriod) {
            // Still within offline grace period
            this.emitEvent({
                type: LicenseEventType.OFFLINE_MODE_ENTERED,
                timestamp: Date.now(),
                deviceId: cachedLicense.deviceId,
                licenseStatus: cachedLicense.status,
                metadata: { offlineAge, gracePeriodRemaining: this.config.offlineGracePeriod - offlineAge },
            });

            return {
                valid: true,
                license: { ...cachedLicense, validatedOffline: true },
                mode: ValidationMode.OFFLINE,
                warning: `Using cached license. Last validated ${Math.round(offlineAge / (1000 * 60 * 60))} hours ago.`,
            };
        } else {
            // Offline grace period expired
            this.emitEvent({
                type: LicenseEventType.SOFT_LOCK_TRIGGERED,
                timestamp: Date.now(),
                deviceId: cachedLicense.deviceId,
                licenseStatus: LicenseStatus.EXPIRED,
                metadata: { offlineAge },
            });

            return {
                valid: false,
                license: cachedLicense,
                mode: ValidationMode.OFFLINE_EXPIRED,
                error: 'License validation required. Please connect to the internet.',
            };
        }
    }

    /**
     * Handle no license scenario - generate trial license
     * @returns Validation result with trial license
     */
    private async handleNoLicense(): Promise<ValidationResult> {
        // QA TESTING: Auto-trial generation disabled for testing licensing system behavior
        // TODO: REVERT THIS CHANGE before production release
        // Original behavior: Auto-generates 14-day trial on first launch
        // Current behavior: Returns no license / expired state immediately
        return {
            valid: false,
            mode: ValidationMode.FAILED,
            error: 'No valid license found. Please activate a license.',
        };

        /* ORIGINAL CODE - Uncomment to restore auto-trial generation
        try {
            const trialLicense = await this.createTrialLicense();
            await LicenseStorage.saveLicense(trialLicense);

            this.emitEvent({
                type: LicenseEventType.TRIAL_ACTIVATED,
                timestamp: Date.now(),
                deviceId: trialLicense.deviceId,
                licenseStatus: LicenseStatus.TRIAL,
                metadata: { trialEndsAt: trialLicense.trialEndsAt },
            });

            return {
                valid: true,
                license: trialLicense,
                mode: ValidationMode.TRIAL,
            };
        } catch (error) {
            console.error('[LicenseValidator] Failed to create trial license:', error);
            throw new LicenseError(
                LicenseErrorCode.STORAGE_ERROR,
                'Failed to create trial license',
                error
            );
        }
        */
    }

    /**
     * Create a trial license for first-time users
     * @returns Trial license
     */
    private async createTrialLicense(): Promise<License> {
        const deviceFingerprint = await DeviceFingerprintService.generate();
        const now = Date.now();
        const trialDuration = this.config.trialDurationDays * 24 * 60 * 60 * 1000;

        const trialLicense: License = {
            licenseKey: 'TRIAL-' + this.generateTrialKey(),
            email: '',
            status: LicenseStatus.TRIAL,
            subscriptionId: undefined,
            planType: PlanType.TRIAL,
            activatedAt: now,
            expiresAt: null,
            trialEndsAt: now + trialDuration,
            deviceId: deviceFingerprint.deviceId,
            devices: [deviceFingerprint],
            maxDevices: this.config.defaultMaxDevices,
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

        console.log('[LicenseValidator] Trial license created:', {
            deviceId: DeviceFingerprintService.getShortDeviceId(deviceFingerprint.deviceId),
            trialEndsAt: new Date(trialLicense.trialEndsAt!).toISOString(),
        });

        return trialLicense;
    }

    /**
     * Generate a unique trial license key
     * @returns Trial license key
     */
    private generateTrialKey(): string {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 10).toUpperCase();
        return `${timestamp}-${random}`;
    }

    /**
     * Check if license is in trial period
     * @param license - License to check
     * @returns True if in trial period
     */
    static isTrial(license: License): boolean {
        return license.status === LicenseStatus.TRIAL;
    }

    /**
     * Check if trial is ending soon
     * @param license - License to check
     * @param warningDays - Days before expiry to warn (default from config)
     * @returns True if trial is ending soon
     */
    isTrialEndingSoon(license: License, warningDays?: number): boolean {
        if (!LicenseValidator.isTrial(license) || !license.trialEndsAt) {
            return false;
        }

        const daysThreshold = warningDays || this.config.trialWarningDays;
        const warningTime = daysThreshold * 24 * 60 * 60 * 1000;
        const timeRemaining = license.trialEndsAt - Date.now();

        return timeRemaining > 0 && timeRemaining <= warningTime;
    }

    /**
     * Get days remaining in trial
     * @param license - License to check
     * @returns Days remaining, or 0 if expired/not trial
     */
    static getTrialDaysRemaining(license: License): number {
        if (!LicenseValidator.isTrial(license) || !license.trialEndsAt) {
            return 0;
        }

        const timeRemaining = license.trialEndsAt - Date.now();
        return Math.max(0, Math.ceil(timeRemaining / (1000 * 60 * 60 * 24)));
    }

    /**
     * Check if subscription is in grace period
     * @param license - License to check
     * @returns True if in grace period
     */
    static isInGracePeriod(license: License): boolean {
        if (!license.gracePeriodEndsAt) {
            return false;
        }

        return Date.now() < license.gracePeriodEndsAt;
    }

    /**
     * Start grace period for expired subscription
     * @param license - License to update
     * @returns Updated license
     */
    async startGracePeriod(license: License): Promise<License> {
        const now = Date.now();
        const gracePeriodEndsAt = now + this.config.subscriptionGracePeriod;

        const updatedLicense: License = {
            ...license,
            status: LicenseStatus.GRACE_PERIOD,
            gracePeriodEndsAt,
            updatedAt: now,
        };

        await LicenseStorage.updateLicense(updatedLicense);

        this.emitEvent({
            type: LicenseEventType.GRACE_PERIOD_STARTED,
            timestamp: now,
            deviceId: license.deviceId,
            licenseStatus: LicenseStatus.GRACE_PERIOD,
            metadata: { gracePeriodEndsAt },
        });

        return updatedLicense;
    }

    /**
     * Check if device limit is reached
     * @param license - License to check
     * @returns True if device limit reached
     */
    static isDeviceLimitReached(license: License): boolean {
        return license.devices.length >= license.maxDevices;
    }

    /**
     * Activate device on license
     * @param license - License to update
     * @param deviceFingerprint - Device to activate
     * @returns Updated license
     */
    async activateDevice(license: License, deviceFingerprint: DeviceFingerprint): Promise<License> {
        // Check if device already activated
        const existingDevice = license.devices.find(
            (d) => d.deviceId === deviceFingerprint.deviceId
        );

        if (existingDevice) {
            // Device already activated, just update last seen
            const updatedDevices = license.devices.map((d) =>
                d.deviceId === deviceFingerprint.deviceId
                    ? DeviceFingerprintService.updateLastSeen(d)
                    : d
            );

            await LicenseStorage.updateLicense({ devices: updatedDevices });

            return {
                ...license,
                devices: updatedDevices,
            };
        }

        // Check device limit
        if (LicenseValidator.isDeviceLimitReached(license)) {
            throw new LicenseError(
                LicenseErrorCode.DEVICE_LIMIT_REACHED,
                `Device limit reached (${license.maxDevices} devices)`
            );
        }

        // Add new device
        const updatedDevices = [...license.devices, deviceFingerprint];
        await LicenseStorage.updateLicense({ devices: updatedDevices });

        this.emitEvent({
            type: LicenseEventType.DEVICE_ACTIVATED,
            timestamp: Date.now(),
            deviceId: deviceFingerprint.deviceId,
            licenseStatus: license.status,
            metadata: {
                deviceName: deviceFingerprint.deviceName,
                totalDevices: updatedDevices.length,
            },
        });

        return {
            ...license,
            devices: updatedDevices,
        };
    }

    /**
     * Deactivate device from license
     * @param license - License to update
     * @param deviceId - Device ID to deactivate
     * @returns Updated license
     */
    async deactivateDevice(license: License, deviceId: string): Promise<License> {
        const updatedDevices = license.devices.filter((d) => d.deviceId !== deviceId);

        if (updatedDevices.length === license.devices.length) {
            throw new LicenseError(
                LicenseErrorCode.VALIDATION_FAILED,
                'Device not found in license'
            );
        }

        await LicenseStorage.updateLicense({ devices: updatedDevices });

        this.emitEvent({
            type: LicenseEventType.DEVICE_DEACTIVATED,
            timestamp: Date.now(),
            deviceId,
            licenseStatus: license.status,
            metadata: { totalDevices: updatedDevices.length },
        });

        return {
            ...license,
            devices: updatedDevices,
        };
    }

    /**
     * Register event listener
     * @param listener - Event listener function
     */
    addEventListener(listener: (event: LicenseEvent) => void): void {
        this.eventListeners.push(listener);
    }

    /**
     * Remove event listener
     * @param listener - Event listener to remove
     */
    removeEventListener(listener: (event: LicenseEvent) => void): void {
        this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    }

    /**
     * Emit license event
     * @param event - Event to emit
     */
    private emitEvent(event: LicenseEvent): void {
        this.eventListeners.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('[LicenseValidator] Event listener error:', error);
            }
        });
    }
}
