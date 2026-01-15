/**
 * TimePortal Subscription Module
 *
 * Main entry point for the Stripe-based subscription system.
 * Exports all subscription services and types.
 */

// Types
export * from './types.js';

// Services
export { SubscriptionStorage } from './subscriptionStorage.js';
export { StripeClient } from './stripeClient.js';
export { SubscriptionValidator } from './subscriptionValidator.js';
export { WebhookServer } from './webhookServer.js';

// IPC Handlers
export { initializeSubscription, getSubscriptionValidator } from './ipcHandlers.js';

// Premium Feature Gating
export {
    requirePremium,
    createPremiumHandler,
    isPremiumUser,
    checkPremiumAccess,
    PremiumRequiredError,
    PREMIUM_FEATURES,
    getPremiumFeatureNames,
} from './premiumGuard.js';
