/**
 * Subscription types for renderer process
 *
 * These types match the subscription system in the main process
 * and are exposed through the Electron IPC bridge.
 */

export enum SubscriptionStatus {
    TRIAL = 'trial',
    ACTIVE = 'active',
    PAST_DUE = 'past_due',
    CANCELED = 'canceled',
    UNPAID = 'unpaid',
    INCOMPLETE = 'incomplete',
    INCOMPLETE_EXPIRED = 'incomplete_expired',
    PAUSED = 'paused',
    NONE = 'none',
}

export enum SubscriptionPlan {
    FREE = 'free',
    WORKPLACE_MONTHLY = 'workplace_monthly',
    WORKPLACE_YEARLY = 'workplace_yearly',
}

export enum ValidationMode {
    ONLINE = 'online',
    WEBHOOK = 'webhook',
    CACHED = 'cached',
    OFFLINE = 'offline',
    OFFLINE_EXPIRED = 'offline_expired',
    TRIAL = 'trial',
    FREE = 'free',
}

export interface SubscriptionFeatures {
    basicTimeTracking: boolean;
    localBuckets: boolean;
    screenshotCapture: boolean;
    jiraIntegration: boolean;
    tempoIntegration: boolean;
    aiAnalysis: boolean;
    advancedReporting: boolean;
    cloudSync: boolean;
    teamFeatures: boolean;
}

export interface DeviceInfo {
    deviceId: string;
    deviceName: string;
    platform: string;
    osVersion: string;
    lastSeenAt: number;
    registeredAt: number;
}

export interface Subscription {
    stripeCustomerId: string;
    stripeSubscriptionId?: string;
    stripePriceId?: string;
    email: string;
    status: SubscriptionStatus;
    plan: SubscriptionPlan;
    trialEndsAt?: number;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
    cancelAt?: number;
    canceledAt?: number;
    deviceId: string;
    devices: DeviceInfo[];
    lastValidated: number;
    lastWebhookReceived?: number;
    validatedOffline: boolean;
    offlineGracePeriodEndsAt?: number;
    features: SubscriptionFeatures;
    version: string;
    createdAt: number;
    updatedAt: number;
}

export interface ValidationResult {
    valid: boolean;
    subscription: Subscription;
    mode: ValidationMode;
    error?: string;
    warning?: string;
}

export interface SubscriptionAPI {
    // Validation
    validate(): Promise<{ success: boolean; result?: ValidationResult; error?: string }>;

    // Info
    getInfo(): Promise<{ success: boolean; subscription?: Subscription; error?: string }>;
    getStatus(): Promise<{
        success: boolean;
        status?: SubscriptionStatus;
        plan?: SubscriptionPlan;
        isPremium?: boolean;
        error?: string;
    }>;

    // Feature checks
    hasFeature(featureName: string): Promise<{ success: boolean; hasFeature?: boolean; error?: string }>;

    // Trial
    getTrialInfo(): Promise<{
        success: boolean;
        isTrial?: boolean;
        daysRemaining?: number;
        trialEndsAt?: number;
        error?: string;
    }>;

    // Checkout
    createCheckout(plan: SubscriptionPlan, email: string): Promise<{
        success: boolean;
        checkoutUrl?: string;
        error?: string;
    }>;

    // Portal
    openPortal(): Promise<{ success: boolean; portalUrl?: string; error?: string }>;

    // Subscribe
    subscribe(email: string, plan: SubscriptionPlan): Promise<{
        success: boolean;
        checkoutUrl?: string;
        error?: string;
    }>;

    // Cancel
    cancel(): Promise<{ success: boolean; error?: string }>;
}

// Declare the API on window object
declare global {
    interface Window {
        subscription: SubscriptionAPI;
    }
}
