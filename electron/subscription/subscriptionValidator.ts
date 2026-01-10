/**
 * Subscription Validator Service
 *
 * Core subscription validation logic with support for:
 * - Online validation (Stripe API)
 * - Offline mode with grace periods
 * - Trial subscription management
 * - Feature access control
 */

import {
    Subscription,
    SubscriptionStatus,
    SubscriptionPlan,
    ValidationResult,
    ValidationMode,
    SubscriptionError,
    SubscriptionErrorCode,
    SubscriptionConfig,
    DEFAULT_SUBSCRIPTION_CONFIG,
    SubscriptionEvent,
    SubscriptionEventType,
    DeviceInfo,
    getFeaturesForPlan,
    isPremiumStatus,
} from './types.js';
import { SubscriptionStorage } from './subscriptionStorage.js';
import { StripeClient } from './stripeClient.js';
import { DeviceFingerprintService } from '../licensing/deviceFingerprint.js';

/**
 * Subscription validator service
 */
export class SubscriptionValidator {
    private config: SubscriptionConfig;
    private stripeClient: StripeClient;
    private eventListeners: ((event: SubscriptionEvent) => void)[] = [];

    constructor(config?: Partial<SubscriptionConfig>) {
        this.config = {
            ...DEFAULT_SUBSCRIPTION_CONFIG,
            ...config,
        };

        this.stripeClient = new StripeClient(this.config);
    }

    /**
     * Main validation method - validates subscription from cache or online
     */
    async validate(): Promise<ValidationResult> {
        try {
            console.log('[SubscriptionValidator] Starting validation...');

            // 1. Check if subscription exists in storage
            const cachedSubscription = await SubscriptionStorage.getSubscription();

            if (!cachedSubscription) {
                // No subscription found - check if trial is enabled
                if (this.config.enableTrialMode) {
                    return await this.handleNoSubscription();
                } else {
                    return this.createFreeSubscription();
                }
            }

            // 2. Update device info
            await this.updateDeviceInfo(cachedSubscription);

            // 3. Check if cached subscription is fresh enough
            const cacheAge = Date.now() - cachedSubscription.lastValidated;
            const isFresh = cacheAge < this.config.onlineCheckInterval;

            // 4. Validate subscription status
            const isValid = this.isSubscriptionValid(cachedSubscription);

            if (isFresh && isValid) {
                // Cache is fresh and valid, use it
                this.emitEvent({
                    type: SubscriptionEventType.VALIDATION_SUCCESS,
                    timestamp: Date.now(),
                    deviceId: cachedSubscription.deviceId,
                    subscriptionStatus: cachedSubscription.status,
                    metadata: { mode: ValidationMode.CACHED, cacheAge },
                });

                return {
                    valid: true,
                    subscription: cachedSubscription,
                    mode: ValidationMode.CACHED,
                };
            }

            // 5. Cache is stale or invalid, attempt online validation
            try {
                const onlineResult = await this.validateOnline(cachedSubscription);
                return onlineResult;
            } catch (error) {
                console.warn('[SubscriptionValidator] Online validation failed:', error);

                // Fall back to offline mode if enabled
                if (this.config.enableOfflineMode) {
                    return this.handleOfflineMode(cachedSubscription);
                } else {
                    return {
                        valid: false,
                        subscription: cachedSubscription,
                        mode: ValidationMode.FAILED,
                        error: 'Online validation failed and offline mode is disabled',
                    };
                }
            }
        } catch (error) {
            console.error('[SubscriptionValidator] Validation failed:', error);

            this.emitEvent({
                type: SubscriptionEventType.VALIDATION_FAILURE,
                timestamp: Date.now(),
                deviceId: 'unknown',
                subscriptionStatus: SubscriptionStatus.NONE,
                metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
            });

            return {
                valid: false,
                subscription: this.createDefaultSubscriptionSync(),
                mode: ValidationMode.FAILED,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Validate subscription online with Stripe API
     */
    private async validateOnline(cachedSubscription: Subscription): Promise<ValidationResult> {
        console.log('[SubscriptionValidator] Validating online with Stripe...');

        try {
            // Get latest subscription from Stripe
            const stripeSubscription = await this.stripeClient.getCustomerSubscription(
                cachedSubscription.stripeCustomerId
            );

            if (!stripeSubscription) {
                // No active subscription in Stripe
                console.log('[SubscriptionValidator] No active Stripe subscription found');

                // Check if trial is still valid
                if (this.isTrialValid(cachedSubscription)) {
                    return {
                        valid: true,
                        subscription: cachedSubscription,
                        mode: ValidationMode.TRIAL,
                    };
                }

                // Revert to free plan
                const freeSubscription = await this.convertToFreePlan(cachedSubscription);
                return {
                    valid: true,
                    subscription: freeSubscription,
                    mode: ValidationMode.FREE,
                };
            }

            // Transform and save updated subscription
            const customer = await this.stripeClient.getCustomer(cachedSubscription.stripeCustomerId);
            const updatedSubscription = this.stripeClient.transformStripeSubscription(
                stripeSubscription,
                customer,
                cachedSubscription.deviceId,
                cachedSubscription.devices
            );

            // Preserve local metadata
            updatedSubscription.createdAt = cachedSubscription.createdAt;
            updatedSubscription.lastWebhookReceived = cachedSubscription.lastWebhookReceived;

            await SubscriptionStorage.saveSubscription(updatedSubscription);

            const isValid = isPremiumStatus(updatedSubscription.status);

            this.emitEvent({
                type: SubscriptionEventType.VALIDATION_SUCCESS,
                timestamp: Date.now(),
                deviceId: updatedSubscription.deviceId,
                subscriptionStatus: updatedSubscription.status,
                metadata: { mode: ValidationMode.ONLINE },
            });

            return {
                valid: isValid,
                subscription: updatedSubscription,
                mode: ValidationMode.ONLINE,
            };
        } catch (error) {
            console.error('[SubscriptionValidator] Online validation error:', error);
            throw error;
        }
    }

    /**
     * Handle offline validation mode
     */
    private handleOfflineMode(subscription: Subscription): ValidationResult {
        console.log('[SubscriptionValidator] Entering offline mode');

        const now = Date.now();
        const offlineAge = now - subscription.lastValidated;

        // Check if still within offline grace period
        if (offlineAge < this.config.offlineGracePeriod) {
            const gracePeriodEndsAt = subscription.lastValidated + this.config.offlineGracePeriod;

            // Update offline flag
            subscription.validatedOffline = true;
            subscription.offlineGracePeriodEndsAt = gracePeriodEndsAt;
            SubscriptionStorage.saveSubscription(subscription);

            this.emitEvent({
                type: SubscriptionEventType.OFFLINE_MODE_ENTERED,
                timestamp: now,
                deviceId: subscription.deviceId,
                subscriptionStatus: subscription.status,
                metadata: {
                    offlineAge,
                    gracePeriodEndsAt,
                },
            });

            const isValid = this.isSubscriptionValid(subscription);

            return {
                valid: isValid,
                subscription,
                mode: ValidationMode.OFFLINE,
                warning: `Operating in offline mode. Reconnect before ${new Date(gracePeriodEndsAt).toLocaleDateString()}`,
            };
        } else {
            // Grace period expired
            this.emitEvent({
                type: SubscriptionEventType.OFFLINE_GRACE_PERIOD_STARTED,
                timestamp: now,
                deviceId: subscription.deviceId,
                subscriptionStatus: subscription.status,
                metadata: { offlineAge },
            });

            return {
                valid: false,
                subscription,
                mode: ValidationMode.OFFLINE_EXPIRED,
                error: 'Offline grace period expired. Please connect to the internet to verify your subscription.',
            };
        }
    }

    /**
     * Handle case when no subscription exists
     */
    private async handleNoSubscription(): Promise<ValidationResult> {
        console.log('[SubscriptionValidator] No subscription found, creating trial');

        const trialSubscription = await this.createTrialSubscription();

        this.emitEvent({
            type: SubscriptionEventType.TRIAL_STARTED,
            timestamp: Date.now(),
            deviceId: trialSubscription.deviceId,
            subscriptionStatus: SubscriptionStatus.TRIAL,
        });

        return {
            valid: true,
            subscription: trialSubscription,
            mode: ValidationMode.TRIAL,
        };
    }

    /**
     * Create a trial subscription
     */
    private async createTrialSubscription(): Promise<Subscription> {
        const now = Date.now();
        const trialEndsAt = now + this.config.trialDurationDays * 24 * 60 * 60 * 1000;

        const deviceFingerprint = await DeviceFingerprintService.generate();

        const deviceInfo: DeviceInfo = {
            deviceId: deviceFingerprint.deviceId,
            deviceName: deviceFingerprint.deviceName,
            platform: deviceFingerprint.platform,
            osVersion: deviceFingerprint.osVersion,
            lastSeenAt: now,
            registeredAt: now,
        };

        const subscription: Subscription = {
            stripeCustomerId: '', // Will be set when user subscribes
            email: '', // Will be set when user subscribes
            status: SubscriptionStatus.TRIAL,
            plan: SubscriptionPlan.FREE,
            trialEndsAt,
            deviceId: deviceInfo.deviceId,
            devices: [deviceInfo],
            lastValidated: now,
            validatedOffline: false,
            features: getFeaturesForPlan(SubscriptionPlan.WORKPLACE_MONTHLY), // Full features during trial
            version: '1.0',
            createdAt: now,
            updatedAt: now,
        };

        await SubscriptionStorage.saveSubscription(subscription);
        return subscription;
    }

    /**
     * Create a free subscription (no premium features)
     */
    private createFreeSubscription(): ValidationResult {
        const subscription = this.createDefaultSubscriptionSync();

        return {
            valid: true,
            subscription,
            mode: ValidationMode.FREE,
        };
    }

    /**
     * Create default free subscription (synchronous version)
     */
    private createDefaultSubscriptionSync(): Subscription {
        const now = Date.now();

        return {
            stripeCustomerId: '',
            email: '',
            status: SubscriptionStatus.NONE,
            plan: SubscriptionPlan.FREE,
            deviceId: '',
            devices: [],
            lastValidated: now,
            validatedOffline: false,
            features: getFeaturesForPlan(SubscriptionPlan.FREE),
            version: '1.0',
            createdAt: now,
            updatedAt: now,
        };
    }

    /**
     * Create default free subscription (async version)
     */
    private async createDefaultSubscription(): Promise<Subscription> {
        const now = Date.now();
        const deviceFingerprint = await DeviceFingerprintService.generate();

        const deviceInfo: DeviceInfo = {
            deviceId: deviceFingerprint.deviceId,
            deviceName: deviceFingerprint.deviceName,
            platform: deviceFingerprint.platform,
            osVersion: deviceFingerprint.osVersion,
            lastSeenAt: now,
            registeredAt: now,
        };

        return {
            stripeCustomerId: '',
            email: '',
            status: SubscriptionStatus.NONE,
            plan: SubscriptionPlan.FREE,
            deviceId: deviceInfo.deviceId,
            devices: [deviceInfo],
            lastValidated: now,
            validatedOffline: false,
            features: getFeaturesForPlan(SubscriptionPlan.FREE),
            version: '1.0',
            createdAt: now,
            updatedAt: now,
        };
    }

    /**
     * Convert subscription to free plan
     */
    private async convertToFreePlan(subscription: Subscription): Promise<Subscription> {
        const freeSubscription: Subscription = {
            ...subscription,
            status: SubscriptionStatus.NONE,
            plan: SubscriptionPlan.FREE,
            features: getFeaturesForPlan(SubscriptionPlan.FREE),
            stripeSubscriptionId: undefined,
            stripePriceId: undefined,
            updatedAt: Date.now(),
        };

        await SubscriptionStorage.saveSubscription(freeSubscription);
        return freeSubscription;
    }

    /**
     * Check if subscription is valid (allows premium features)
     */
    private isSubscriptionValid(subscription: Subscription): boolean {
        // Check subscription status
        if (!isPremiumStatus(subscription.status)) {
            return false;
        }

        // Check if trial has expired
        if (subscription.status === SubscriptionStatus.TRIAL) {
            return this.isTrialValid(subscription);
        }

        // Check if subscription period has ended
        if (subscription.currentPeriodEnd) {
            const now = Date.now();
            if (now > subscription.currentPeriodEnd && subscription.status !== SubscriptionStatus.PAST_DUE) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if trial is still valid
     */
    private isTrialValid(subscription: Subscription): boolean {
        if (subscription.status !== SubscriptionStatus.TRIAL || !subscription.trialEndsAt) {
            return false;
        }

        return Date.now() < subscription.trialEndsAt;
    }

    /**
     * Update device info in subscription
     */
    private async updateDeviceInfo(subscription: Subscription): Promise<void> {
        try {
            const deviceFingerprint = await DeviceFingerprintService.generate();

            await SubscriptionStorage.updateDevice({
                deviceId: deviceFingerprint.deviceId,
                deviceName: deviceFingerprint.deviceName,
                platform: deviceFingerprint.platform,
                osVersion: deviceFingerprint.osVersion,
            });
        } catch (error) {
            console.error('[SubscriptionValidator] Failed to update device info:', error);
            // Non-fatal error, continue
        }
    }

    /**
     * Check if user has access to a specific feature
     */
    async hasFeature(featureName: keyof Subscription['features']): Promise<boolean> {
        try {
            const result = await this.validate();

            if (!result.valid) {
                return false;
            }

            return result.subscription.features[featureName] || false;
        } catch (error) {
            console.error('[SubscriptionValidator] Failed to check feature:', error);
            return false;
        }
    }

    /**
     * Get trial days remaining
     */
    static getTrialDaysRemaining(subscription: Subscription): number {
        if (subscription.status !== SubscriptionStatus.TRIAL || !subscription.trialEndsAt) {
            return 0;
        }

        const now = Date.now();
        const remaining = subscription.trialEndsAt - now;

        if (remaining <= 0) {
            return 0;
        }

        return Math.ceil(remaining / (24 * 60 * 60 * 1000));
    }

    /**
     * Register event listener
     */
    addEventListener(listener: (event: SubscriptionEvent) => void): void {
        this.eventListeners.push(listener);
    }

    /**
     * Remove event listener
     */
    removeEventListener(listener: (event: SubscriptionEvent) => void): void {
        const index = this.eventListeners.indexOf(listener);
        if (index >= 0) {
            this.eventListeners.splice(index, 1);
        }
    }

    /**
     * Emit event to all listeners
     */
    private emitEvent(event: SubscriptionEvent): void {
        this.eventListeners.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('[SubscriptionValidator] Event listener error:', error);
            }
        });
    }

    /**
     * Get Stripe client instance
     */
    getStripeClient(): StripeClient {
        return this.stripeClient;
    }
}
