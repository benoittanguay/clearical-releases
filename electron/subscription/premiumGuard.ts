/**
 * Premium Features Guard
 *
 * Provides a simple, centralized way to gate premium features behind subscription checks.
 * Use this to protect IPC handlers that should only be available to Workplace plan subscribers.
 *
 * Usage:
 * 1. For IPC handlers: Use `requirePremium` wrapper
 * 2. For direct checks: Use `isPremiumUser()` or `checkPremiumAccess()`
 *
 * Benefits:
 * - Single source of truth for premium access checks
 * - Easy to add new premium features without listing them individually
 * - Consistent error messages and logging
 * - Works with trials, active subscriptions, and grace periods
 */

import { SubscriptionStorage } from './subscriptionStorage.js';
import { SubscriptionStatus, isPremiumStatus } from './types.js';

/**
 * Error thrown when a user tries to access a premium feature without a valid subscription
 */
export class PremiumRequiredError extends Error {
    code = 'PREMIUM_REQUIRED';

    constructor(feature?: string) {
        super(
            feature
                ? `Premium subscription required to access ${feature}. Upgrade to Workplace Plan to unlock this feature.`
                : 'Premium subscription required. Upgrade to Workplace Plan to unlock this feature.'
        );
        this.name = 'PremiumRequiredError';
    }
}

/**
 * Check if the current user has premium access
 * Returns true if user has an active trial, active subscription, or is in grace period
 */
export async function isPremiumUser(): Promise<boolean> {
    try {
        const subscription = await SubscriptionStorage.getSubscription();

        if (!subscription) {
            return false;
        }

        // Check if status allows premium features
        // Trial, Active, and Past Due (grace period) all grant premium access
        return isPremiumStatus(subscription.status as SubscriptionStatus);
    } catch (error) {
        console.error('[PremiumGuard] Error checking premium status:', error);
        return false;
    }
}

/**
 * Check premium access and throw PremiumRequiredError if not authorized
 * Use this for direct checks in code
 */
export async function checkPremiumAccess(featureName?: string): Promise<void> {
    const hasPremium = await isPremiumUser();

    if (!hasPremium) {
        console.warn(`[PremiumGuard] Access denied to premium feature: ${featureName || 'unknown'}`);
        throw new PremiumRequiredError(featureName);
    }
}

/**
 * Wrapper for IPC handlers that require premium subscription
 *
 * Use this to protect any IPC handler that should only be available to
 * Workplace plan subscribers. The wrapper will:
 * - Check premium status before executing the handler
 * - Return a standardized error response if not premium
 * - Log access attempts for debugging
 *
 * @param featureName - Human-readable name of the feature (for error messages)
 * @param handler - The IPC handler function to wrap
 *
 * Example usage:
 * ```typescript
 * ipcMain.handle('jira-api-request', requirePremium('Jira Integration', async (event, args) => {
 *     // Your handler code here
 * }));
 * ```
 */
export function requirePremium<T extends (...args: any[]) => Promise<any>>(
    featureName: string,
    handler: T
): T {
    const wrappedHandler = async (...args: Parameters<T>): Promise<ReturnType<T> | { success: false; error: string; code: string }> => {
        try {
            // Check premium status
            const hasPremium = await isPremiumUser();

            if (!hasPremium) {
                console.warn(`[PremiumGuard] Blocked access to ${featureName} - no premium subscription`);
                return {
                    success: false,
                    error: `${featureName} requires a Workplace Plan subscription. Please upgrade to access this feature.`,
                    code: 'PREMIUM_REQUIRED',
                } as any;
            }

            // User has premium access, execute the handler
            return await handler(...args);
        } catch (error) {
            // If it's already a PremiumRequiredError, return standardized response
            if (error instanceof PremiumRequiredError) {
                return {
                    success: false,
                    error: error.message,
                    code: 'PREMIUM_REQUIRED',
                } as any;
            }

            // Re-throw other errors
            throw error;
        }
    };

    return wrappedHandler as T;
}

/**
 * Higher-order function to create a premium-gated IPC handler
 * This is an alternative syntax that some may find cleaner
 *
 * Example:
 * ```typescript
 * const premiumHandler = createPremiumHandler('Tempo Integration');
 * ipcMain.handle('tempo-api-request', premiumHandler(async (event, args) => {
 *     // Your handler code here
 * }));
 * ```
 */
export function createPremiumHandler(featureName: string) {
    return <T extends (...args: any[]) => Promise<any>>(handler: T): T => {
        return requirePremium(featureName, handler);
    };
}

/**
 * List of all premium features for documentation and UI purposes
 * This is NOT used for access control - access control just checks isPremiumUser()
 *
 * Use this list for:
 * - Displaying what features are included in Workplace Plan
 * - Showing upgrade prompts with specific features
 * - Marketing materials
 */
export const PREMIUM_FEATURES = [
    {
        id: 'jira',
        name: 'Jira Integration',
        description: 'Connect to Jira and link time entries to issues',
    },
    {
        id: 'tempo',
        name: 'Tempo Integration',
        description: 'Log time directly to Tempo from Clearical',
    },
    {
        id: 'ai',
        name: 'AI Analysis',
        description: 'Get AI-powered activity summaries and classifications',
    },
    {
        id: 'reporting',
        name: 'Advanced Reporting',
        description: 'Export detailed reports and analytics',
    },
] as const;

/**
 * Get the list of premium feature names (for UI)
 */
export function getPremiumFeatureNames(): string[] {
    return PREMIUM_FEATURES.map(f => f.name);
}
