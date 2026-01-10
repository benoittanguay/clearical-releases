/**
 * Subscription Storage Service
 *
 * Handles secure storage and retrieval of subscription data.
 * Uses encrypted file storage for subscription cache.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import {
    Subscription,
    SubscriptionError,
    SubscriptionErrorCode,
} from './types.js';
import { saveEncryptedFile, decryptFile } from '../encryption.js';

const SUBSCRIPTION_FILE = 'subscription.dat';

/**
 * Subscription storage service
 */
export class SubscriptionStorage {
    /**
     * Get storage directory path
     */
    private static getStorageDir(): string {
        return app.getPath('userData');
    }

    /**
     * Get subscription file path
     */
    private static getSubscriptionFilePath(): string {
        return path.join(this.getStorageDir(), SUBSCRIPTION_FILE);
    }

    /**
     * Save subscription to encrypted storage
     */
    static async saveSubscription(subscription: Subscription): Promise<void> {
        console.log('[SubscriptionStorage] Saving subscription:', {
            email: subscription.email,
            status: subscription.status,
            plan: subscription.plan,
        });

        try {
            const filePath = this.getSubscriptionFilePath();
            const data = JSON.stringify(subscription, null, 2);
            const buffer = Buffer.from(data, 'utf-8');

            // Save encrypted
            await saveEncryptedFile(filePath, buffer);

            console.log('[SubscriptionStorage] Subscription saved successfully');
        } catch (error) {
            console.error('[SubscriptionStorage] Failed to save subscription:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STORAGE_ERROR,
                'Failed to save subscription',
                error
            );
        }
    }

    /**
     * Load subscription from encrypted storage
     */
    static async getSubscription(): Promise<Subscription | null> {
        console.log('[SubscriptionStorage] Loading subscription from storage');

        try {
            const filePath = this.getSubscriptionFilePath();

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.log('[SubscriptionStorage] No subscription file found');
                return null;
            }

            // Decrypt and parse
            const buffer = await decryptFile(filePath);
            const data = buffer.toString('utf-8');
            const subscription = JSON.parse(data) as Subscription;

            console.log('[SubscriptionStorage] Subscription loaded:', {
                email: subscription.email,
                status: subscription.status,
                plan: subscription.plan,
                lastValidated: new Date(subscription.lastValidated).toISOString(),
            });

            return subscription;
        } catch (error) {
            console.error('[SubscriptionStorage] Failed to load subscription:', error);

            // If decryption fails, try to delete corrupted file
            try {
                const filePath = this.getSubscriptionFilePath();
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log('[SubscriptionStorage] Deleted corrupted subscription file');
                }
            } catch (deleteError) {
                console.error('[SubscriptionStorage] Failed to delete corrupted file:', deleteError);
            }

            return null;
        }
    }

    /**
     * Delete subscription from storage
     */
    static async deleteSubscription(): Promise<void> {
        console.log('[SubscriptionStorage] Deleting subscription');

        try {
            const filePath = this.getSubscriptionFilePath();

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('[SubscriptionStorage] Subscription deleted');
            } else {
                console.log('[SubscriptionStorage] No subscription file to delete');
            }
        } catch (error) {
            console.error('[SubscriptionStorage] Failed to delete subscription:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STORAGE_ERROR,
                'Failed to delete subscription',
                error
            );
        }
    }

    /**
     * Check if subscription exists in storage
     */
    static hasSubscription(): boolean {
        const filePath = this.getSubscriptionFilePath();
        return fs.existsSync(filePath);
    }

    /**
     * Update subscription fields (partial update)
     */
    static async updateSubscription(updates: Partial<Subscription>): Promise<void> {
        console.log('[SubscriptionStorage] Updating subscription fields:', Object.keys(updates));

        try {
            const currentSubscription = await this.getSubscription();

            if (!currentSubscription) {
                throw new SubscriptionError(
                    SubscriptionErrorCode.NO_SUBSCRIPTION,
                    'No subscription found to update'
                );
            }

            const updatedSubscription: Subscription = {
                ...currentSubscription,
                ...updates,
                updatedAt: Date.now(),
            };

            await this.saveSubscription(updatedSubscription);

            console.log('[SubscriptionStorage] Subscription updated successfully');
        } catch (error) {
            if (error instanceof SubscriptionError) {
                throw error;
            }

            console.error('[SubscriptionStorage] Failed to update subscription:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STORAGE_ERROR,
                'Failed to update subscription',
                error
            );
        }
    }

    /**
     * Add or update device in subscription
     */
    static async updateDevice(deviceInfo: {
        deviceId: string;
        deviceName: string;
        platform: string;
        osVersion: string;
    }): Promise<void> {
        console.log('[SubscriptionStorage] Updating device:', deviceInfo.deviceId);

        try {
            const subscription = await this.getSubscription();

            if (!subscription) {
                throw new SubscriptionError(
                    SubscriptionErrorCode.NO_SUBSCRIPTION,
                    'No subscription found to update device'
                );
            }

            const now = Date.now();
            const existingDeviceIndex = subscription.devices.findIndex(
                (d) => d.deviceId === deviceInfo.deviceId
            );

            if (existingDeviceIndex >= 0) {
                // Update existing device
                subscription.devices[existingDeviceIndex] = {
                    ...subscription.devices[existingDeviceIndex],
                    ...deviceInfo,
                    lastSeenAt: now,
                };
            } else {
                // Add new device
                subscription.devices.push({
                    ...deviceInfo,
                    lastSeenAt: now,
                    registeredAt: now,
                });
            }

            subscription.deviceId = deviceInfo.deviceId;
            subscription.updatedAt = now;

            await this.saveSubscription(subscription);

            console.log('[SubscriptionStorage] Device updated successfully');
        } catch (error) {
            if (error instanceof SubscriptionError) {
                throw error;
            }

            console.error('[SubscriptionStorage] Failed to update device:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STORAGE_ERROR,
                'Failed to update device',
                error
            );
        }
    }

    /**
     * Get storage file size
     */
    static getStorageSize(): number {
        try {
            const filePath = this.getSubscriptionFilePath();
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                return stats.size;
            }
            return 0;
        } catch (error) {
            console.error('[SubscriptionStorage] Failed to get storage size:', error);
            return 0;
        }
    }
}
