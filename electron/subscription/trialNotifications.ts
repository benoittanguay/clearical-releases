/**
 * Trial Notification Service
 *
 * Handles notifications for trial expiration warnings.
 * Sends native notifications at 3 days and 1 day before trial expiry.
 */

import { Notification } from 'electron';
import { SubscriptionStorage } from './subscriptionStorage.js';
import { SubscriptionValidator } from './subscriptionValidator.js';
import { Subscription } from './types.js';

// Track which notifications have been sent to avoid duplicates
const sentNotifications = new Set<string>();

// Track the notification check interval for cleanup
let notificationCheckInterval: NodeJS.Timeout | null = null;

/**
 * Check and send trial expiration notifications if needed
 */
export async function checkTrialNotifications(): Promise<void> {
    try {
        const subscription = await SubscriptionStorage.getSubscription();

        if (!subscription) {
            return;
        }

        // Only send notifications for trial subscriptions
        if (subscription.status !== 'trial' || !subscription.trialEndsAt) {
            return;
        }

        const daysRemaining = SubscriptionValidator.getTrialDaysRemaining(subscription);

        // Send notification at 3 days remaining (only once)
        if (daysRemaining === 3 && !sentNotifications.has('trial-3-days')) {
            sendTrialExpirationNotification(daysRemaining, subscription);
            sentNotifications.add('trial-3-days');
        }

        // Send notification at 1 day remaining (only once)
        if (daysRemaining === 1 && !sentNotifications.has('trial-1-day')) {
            sendTrialExpirationNotification(daysRemaining, subscription);
            sentNotifications.add('trial-1-day');
        }

        // Send notification on last day (only once)
        if (daysRemaining === 0 && !sentNotifications.has('trial-today')) {
            sendTrialExpirationNotification(daysRemaining, subscription);
            sentNotifications.add('trial-today');
        }
    } catch (error) {
        console.error('[TrialNotifications] Failed to check trial notifications:', error);
    }
}

/**
 * Send a trial expiration notification
 */
function sendTrialExpirationNotification(daysRemaining: number, subscription: Subscription): void {
    try {
        const title = daysRemaining === 0
            ? 'Trial Ending Today!'
            : daysRemaining === 1
            ? 'Trial Ending Tomorrow!'
            : `Trial Ending in ${daysRemaining} Days`;

        const body = daysRemaining === 0
            ? 'Your Clearical trial expires today. Upgrade to Premium to keep access to Jira, Tempo, and AI features.'
            : daysRemaining === 1
            ? 'Your Clearical trial expires tomorrow. Upgrade now to continue using premium features.'
            : `Your Clearical trial will expire in ${daysRemaining} days. Upgrade to Premium to keep all features.`;

        const notification = new Notification({
            title,
            body,
            urgency: daysRemaining <= 1 ? 'critical' : 'normal',
            timeoutType: 'never',
        });

        notification.show();

        console.log('[TrialNotifications] Notification sent:', {
            daysRemaining,
            title,
        });
    } catch (error) {
        console.error('[TrialNotifications] Failed to send notification:', error);
    }
}

/**
 * Reset notification tracking (useful for testing)
 */
export function resetTrialNotifications(): void {
    sentNotifications.clear();
    console.log('[TrialNotifications] Notification tracking reset');
}

/**
 * Initialize trial notifications (start checking periodically)
 */
export function initializeTrialNotifications(): void {
    console.log('[TrialNotifications] Initializing trial notification service');

    // Check notifications immediately on startup
    checkTrialNotifications();

    // Check every 6 hours for trial expiration
    const checkInterval = 6 * 60 * 60 * 1000; // 6 hours
    notificationCheckInterval = setInterval(checkTrialNotifications, checkInterval);

    console.log('[TrialNotifications] Will check for trial expiration every 6 hours');
}

/**
 * Cleanup trial notification interval
 */
export function cleanupTrialNotifications(): void {
    if (notificationCheckInterval) {
        clearInterval(notificationCheckInterval);
        notificationCheckInterval = null;
        console.log('[TrialNotifications] Notification interval cleared');
    }
}
