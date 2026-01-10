/**
 * Stripe Subscription Type Definitions
 *
 * Type definitions for TimePortal's Stripe-based subscription system.
 * Replaces Paddle licensing with Stripe for subscription management.
 */

/**
 * Subscription status enum
 * Maps to Stripe subscription statuses
 */
export enum SubscriptionStatus {
    TRIAL = 'trial',                     // Free trial period (14 days)
    ACTIVE = 'active',                   // Paid subscription active (Stripe: active)
    PAST_DUE = 'past_due',              // Payment failed but still accessible (Stripe: past_due)
    CANCELED = 'canceled',               // User canceled (finish current period - Stripe: canceled)
    UNPAID = 'unpaid',                   // Payment failed, grace period ended (Stripe: unpaid)
    INCOMPLETE = 'incomplete',           // Initial payment pending (Stripe: incomplete)
    INCOMPLETE_EXPIRED = 'incomplete_expired', // Initial payment failed (Stripe: incomplete_expired)
    PAUSED = 'paused',                   // Subscription paused (Stripe: paused)
    NONE = 'none',                       // No subscription
}

/**
 * Subscription plan/price IDs
 * These correspond to Stripe Price IDs created in your Stripe Dashboard
 */
export enum SubscriptionPlan {
    FREE = 'free',                       // Free tier (no Stripe subscription)
    WORKPLACE_MONTHLY = 'workplace_monthly', // Workplace Plan - Monthly
    WORKPLACE_YEARLY = 'workplace_yearly',   // Workplace Plan - Yearly
}

/**
 * Feature flags based on subscription tier
 */
export interface SubscriptionFeatures {
    // Free tier features
    basicTimeTracking: boolean;          // Always true
    localBuckets: boolean;               // Always true
    screenshotCapture: boolean;          // Always true

    // Workplace Plan features
    jiraIntegration: boolean;            // Workplace Plan only
    tempoIntegration: boolean;           // Workplace Plan only
    aiAnalysis: boolean;                 // Workplace Plan only
    advancedReporting: boolean;          // Workplace Plan only
    cloudSync: boolean;                  // Future: Workplace Plan only
    teamFeatures: boolean;               // Future: Workplace Plan only
}

/**
 * Main subscription data structure
 */
export interface Subscription {
    // Stripe IDs
    stripeCustomerId: string;            // Stripe Customer ID (cus_xxx)
    stripeSubscriptionId?: string;       // Stripe Subscription ID (sub_xxx) - undefined for free tier
    stripePriceId?: string;              // Stripe Price ID (price_xxx)

    // User Identity
    email: string;                       // Customer email (primary identifier)

    // Subscription Status
    status: SubscriptionStatus;          // Current subscription status
    plan: SubscriptionPlan;              // Current plan

    // Validity Periods
    trialEndsAt?: number;                // Unix timestamp for trial end
    currentPeriodStart?: number;         // Unix timestamp (from Stripe)
    currentPeriodEnd?: number;           // Unix timestamp (from Stripe)
    cancelAt?: number;                   // Unix timestamp (scheduled cancellation)
    canceledAt?: number;                 // Unix timestamp (when user canceled)

    // Device Management
    deviceId: string;                    // Current device fingerprint
    devices: DeviceInfo[];               // All devices using this subscription

    // Validation Metadata
    lastValidated: number;               // Last successful Stripe API check timestamp
    lastWebhookReceived?: number;        // Last webhook event timestamp
    validatedOffline: boolean;           // True if using cached subscription
    offlineGracePeriodEndsAt?: number;   // Offline mode expiration

    // Feature Flags
    features: SubscriptionFeatures;

    // Metadata
    version: string;                     // Subscription schema version
    createdAt: number;                   // Unix timestamp
    updatedAt: number;                   // Unix timestamp
}

/**
 * Device information for multi-device tracking
 */
export interface DeviceInfo {
    deviceId: string;                    // Unique device identifier
    deviceName: string;                  // User-friendly device name
    platform: string;                    // OS platform (darwin, win32, linux)
    osVersion: string;                   // OS version string
    lastSeenAt: number;                  // Last activity timestamp
    registeredAt: number;                // First registration timestamp
}

/**
 * Subscription validation result
 */
export interface ValidationResult {
    valid: boolean;                      // Is the subscription valid for premium features?
    subscription: Subscription;          // Subscription data
    mode: ValidationMode;                // How was validation performed
    error?: string;                      // Error message (if any)
    warning?: string;                    // Warning message (e.g., offline mode)
}

/**
 * Validation mode enum
 */
export enum ValidationMode {
    ONLINE = 'online',                   // Successfully validated with Stripe API
    WEBHOOK = 'webhook',                 // Updated via webhook (most recent)
    CACHED = 'cached',                   // Using fresh cached subscription (< 24h)
    OFFLINE = 'offline',                 // Using stale cached subscription (grace period)
    OFFLINE_EXPIRED = 'offline_expired', // Offline grace period exceeded
    TRIAL = 'trial',                     // Trial subscription
    FREE = 'free',                       // Free tier (no subscription)
    FAILED = 'failed',                   // Validation failed
}

/**
 * Stripe webhook event types we care about
 */
export enum StripeWebhookEvent {
    CUSTOMER_SUBSCRIPTION_CREATED = 'customer.subscription.created',
    CUSTOMER_SUBSCRIPTION_UPDATED = 'customer.subscription.updated',
    CUSTOMER_SUBSCRIPTION_DELETED = 'customer.subscription.deleted',
    CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END = 'customer.subscription.trial_will_end',
    INVOICE_PAYMENT_SUCCEEDED = 'invoice.payment_succeeded',
    INVOICE_PAYMENT_FAILED = 'invoice.payment_failed',
}

/**
 * Stripe Customer Portal session
 */
export interface CustomerPortalSession {
    url: string;                         // Customer Portal URL
    expiresAt: number;                   // Session expiration timestamp
}

/**
 * Stripe Checkout session for new subscriptions
 */
export interface CheckoutSession {
    sessionId: string;                   // Checkout Session ID
    url: string;                         // Checkout URL to redirect user
    expiresAt: number;                   // Session expiration timestamp
}

/**
 * Subscription configuration
 */
export interface SubscriptionConfig {
    // Validation intervals (milliseconds)
    onlineCheckInterval: number;         // Default: 24 hours
    offlineGracePeriod: number;          // Default: 7 days

    // Trial configuration
    trialDurationDays: number;           // Default: 14 days
    trialWarningDays: number;            // Default: 2 days before expiry

    // Stripe API configuration
    stripeSecretKey: string;             // Stripe Secret Key (from env)
    stripeWebhookSecret: string;         // Webhook signing secret (from env)
    stripePublishableKey: string;        // Publishable key (for frontend)

    // API endpoint for webhook server
    webhookServerUrl?: string;           // Optional: dedicated webhook server URL
    webhookServerPort?: number;          // Optional: webhook server port (default: 3001)

    // Feature flags
    enableOfflineMode: boolean;
    enableTrialMode: boolean;
    enableWebhooks: boolean;
}

/**
 * Default subscription configuration
 */
export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
    onlineCheckInterval: 24 * 60 * 60 * 1000,        // 24 hours
    offlineGracePeriod: 7 * 24 * 60 * 60 * 1000,     // 7 days
    trialDurationDays: 14,
    trialWarningDays: 2,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookServerPort: 3001,
    enableOfflineMode: true,
    enableTrialMode: true,
    enableWebhooks: true,
};

/**
 * Error codes for subscription operations
 */
export enum SubscriptionErrorCode {
    NO_SUBSCRIPTION = 'NO_SUBSCRIPTION',
    SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
    SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
    PAYMENT_FAILED = 'PAYMENT_FAILED',
    TRIAL_EXPIRED = 'TRIAL_EXPIRED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    STRIPE_API_ERROR = 'STRIPE_API_ERROR',
    STORAGE_ERROR = 'STORAGE_ERROR',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INVALID_CUSTOMER = 'INVALID_CUSTOMER',
    WEBHOOK_ERROR = 'WEBHOOK_ERROR',
}

/**
 * Subscription error class
 */
export class SubscriptionError extends Error {
    code: SubscriptionErrorCode;
    details?: any;

    constructor(code: SubscriptionErrorCode, message: string, details?: any) {
        super(message);
        this.name = 'SubscriptionError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Subscription event for logging and analytics
 */
export enum SubscriptionEventType {
    VALIDATION_SUCCESS = 'validation_success',
    VALIDATION_FAILURE = 'validation_failure',
    TRIAL_STARTED = 'trial_started',
    TRIAL_ENDING_SOON = 'trial_ending_soon',
    TRIAL_EXPIRED = 'trial_expired',
    SUBSCRIPTION_CREATED = 'subscription_created',
    SUBSCRIPTION_UPDATED = 'subscription_updated',
    SUBSCRIPTION_CANCELED = 'subscription_canceled',
    SUBSCRIPTION_RENEWED = 'subscription_renewed',
    PAYMENT_SUCCEEDED = 'payment_succeeded',
    PAYMENT_FAILED = 'payment_failed',
    OFFLINE_MODE_ENTERED = 'offline_mode_entered',
    OFFLINE_GRACE_PERIOD_STARTED = 'offline_grace_period_started',
    FEATURE_ACCESS_DENIED = 'feature_access_denied',
    DEVICE_REGISTERED = 'device_registered',
}

/**
 * Subscription event data
 */
export interface SubscriptionEvent {
    type: SubscriptionEventType;
    timestamp: number;
    deviceId: string;
    subscriptionStatus: SubscriptionStatus;
    metadata?: Record<string, any>;
}

/**
 * Helper function to get feature flags for a subscription plan
 */
export function getFeaturesForPlan(plan: SubscriptionPlan): SubscriptionFeatures {
    const baseFeatures: SubscriptionFeatures = {
        basicTimeTracking: true,
        localBuckets: true,
        screenshotCapture: true,
        jiraIntegration: false,
        tempoIntegration: false,
        aiAnalysis: false,
        advancedReporting: false,
        cloudSync: false,
        teamFeatures: false,
    };

    if (plan === SubscriptionPlan.WORKPLACE_MONTHLY || plan === SubscriptionPlan.WORKPLACE_YEARLY) {
        return {
            ...baseFeatures,
            jiraIntegration: true,
            tempoIntegration: true,
            aiAnalysis: true,
            advancedReporting: true,
        };
    }

    return baseFeatures;
}

/**
 * Helper function to determine if subscription status allows premium features
 */
export function isPremiumStatus(status: SubscriptionStatus): boolean {
    return [
        SubscriptionStatus.TRIAL,
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PAST_DUE, // Grace period - keep features enabled
    ].includes(status);
}
