/**
 * Licensing Type Definitions
 *
 * Core TypeScript interfaces for TimePortal's licensing system.
 * Supports trial periods, subscriptions, and device management.
 */

/**
 * License status enum
 */
export enum LicenseStatus {
    TRIAL = 'trial',                 // Free trial period (14 days)
    ACTIVE = 'active',               // Paid subscription active
    GRACE_PERIOD = 'grace_period',   // Expired but within grace period
    EXPIRED = 'expired',             // Expired beyond grace period
    CANCELED = 'canceled',           // User canceled (finish current period)
    SUSPENDED = 'suspended',         // Payment failed or fraud
    LIFETIME = 'lifetime',           // Lifetime license (no expiration)
}

/**
 * Subscription plan types
 */
export enum PlanType {
    TRIAL = 'trial',
    MONTHLY = 'monthly',
    YEARLY = 'yearly',
    LIFETIME = 'lifetime',
}

/**
 * Device fingerprint for machine identification
 */
export interface DeviceFingerprint {
    deviceId: string;           // Unique device identifier (hash)
    hardwareUUID: string;       // macOS hardware UUID (IOPlatformUUID)
    machineId: string;          // Electron machine ID
    hostname: string;           // Computer hostname
    username: string;           // OS username
    deviceName: string;         // User-friendly device name
    platform: string;           // OS platform (darwin, win32, linux)
    osVersion: string;          // OS version string
    activatedAt: number;        // Unix timestamp of activation
    lastSeenAt: number;         // Last successful validation timestamp
}

/**
 * Feature flags for license-based feature gating
 */
export interface LicenseFeatures {
    jiraIntegration: boolean;
    tempoSync: boolean;
    aiAnalysis: boolean;
    teamFeatures: boolean;
    exportFeatures: boolean;
    screenshotStorage: boolean;
}

/**
 * Main license data structure
 */
export interface License {
    // Core License Data
    licenseKey: string;              // Unique license key (from Paddle)
    email: string;                   // Customer email
    status: LicenseStatus;           // Current license status

    // Subscription Details
    subscriptionId?: string;         // Paddle subscription ID
    planType: PlanType;              // Subscription plan type

    // Validity Periods
    activatedAt: number;             // Unix timestamp of first activation
    expiresAt: number | null;        // Unix timestamp (null for lifetime)
    trialEndsAt?: number;            // Unix timestamp (for trial period)

    // Device Management
    deviceId: string;                // Current device fingerprint
    devices: DeviceFingerprint[];    // All activated devices
    maxDevices: number;              // License device limit (default: 2)

    // Validation Metadata
    lastValidated: number;           // Last online validation timestamp
    validatedOffline: boolean;       // True if using cached license
    gracePeriodEndsAt?: number;      // Extended grace period for expired subs

    // Feature Flags
    features: LicenseFeatures;

    // Metadata
    version: string;                 // License schema version
    createdAt: number;               // Unix timestamp
    updatedAt: number;               // Unix timestamp
}

/**
 * License validation result
 */
export interface ValidationResult {
    valid: boolean;                  // Is the license valid?
    license?: License;               // License data (if valid)
    mode: ValidationMode;            // How was validation performed
    error?: string;                  // Error message (if invalid)
    warning?: string;                // Warning message (if degraded)
}

/**
 * Validation mode enum
 */
export enum ValidationMode {
    ONLINE = 'online',               // Successfully validated online
    CACHED = 'cached',               // Using fresh cached license (< 24h)
    OFFLINE = 'offline',             // Using stale cached license (grace period)
    OFFLINE_EXPIRED = 'offline_expired', // Offline grace period exceeded
    TRIAL = 'trial',                 // Trial license generated
    FAILED = 'failed',               // Validation failed
}

/**
 * Paddle API response structure (for license verification)
 */
export interface PaddleLicenseResponse {
    success: boolean;
    response: {
        product_id: number;
        activated: boolean;
        allowed_activations: number;
        times_activated: number;
        activation_limit: number;
        expiry_date: string | null;  // ISO 8601 date or null for lifetime
        activation_email: string;
        customer_name: string;
        customer_email: string;
        passthrough?: string;        // JSON string with custom data
    };
}

/**
 * License activation request
 */
export interface LicenseActivationRequest {
    licenseKey: string;
    deviceFingerprint: DeviceFingerprint;
}

/**
 * License deactivation request
 */
export interface LicenseDeactivationRequest {
    licenseKey: string;
    deviceId: string;
}

/**
 * License event for logging and analytics
 */
export enum LicenseEventType {
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
    LICENSE_RENEWED = 'license_renewed',
}

/**
 * License event data structure
 */
export interface LicenseEvent {
    type: LicenseEventType;
    timestamp: number;
    deviceId: string;
    licenseStatus: LicenseStatus;
    metadata?: Record<string, any>;
}

/**
 * Configuration for license validation
 */
export interface LicenseConfig {
    // Validation intervals (milliseconds)
    onlineCheckInterval: number;     // Default: 24 hours
    offlineGracePeriod: number;      // Default: 7 days
    subscriptionGracePeriod: number; // Default: 7 days

    // Trial configuration
    trialDurationDays: number;       // Default: 14 days
    trialWarningDays: number;        // Default: 2 days before expiry

    // Device limits
    defaultMaxDevices: number;       // Default: 2 devices

    // API configuration
    paddleVendorId: string;
    paddleApiKey: string;
    paddleSandbox: boolean;          // Use sandbox environment

    // Feature flags
    enableOfflineMode: boolean;
    enableDeviceLimit: boolean;
    enableGracePeriod: boolean;
}

/**
 * Default license configuration
 */
export const DEFAULT_LICENSE_CONFIG: LicenseConfig = {
    onlineCheckInterval: 24 * 60 * 60 * 1000,        // 24 hours
    offlineGracePeriod: 7 * 24 * 60 * 60 * 1000,    // 7 days
    subscriptionGracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
    trialDurationDays: 14,
    trialWarningDays: 2,
    defaultMaxDevices: 2,
    paddleVendorId: process.env.PADDLE_VENDOR_ID || '',
    paddleApiKey: process.env.PADDLE_API_KEY || '',
    paddleSandbox: process.env.NODE_ENV !== 'production',
    enableOfflineMode: true,
    enableDeviceLimit: true,
    enableGracePeriod: true,
};

/**
 * Error codes for license operations
 */
export enum LicenseErrorCode {
    INVALID_LICENSE_KEY = 'INVALID_LICENSE_KEY',
    LICENSE_EXPIRED = 'LICENSE_EXPIRED',
    DEVICE_LIMIT_REACHED = 'DEVICE_LIMIT_REACHED',
    NETWORK_ERROR = 'NETWORK_ERROR',
    API_ERROR = 'API_ERROR',
    STORAGE_ERROR = 'STORAGE_ERROR',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    TRIAL_EXPIRED = 'TRIAL_EXPIRED',
    SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
    PAYMENT_FAILED = 'PAYMENT_FAILED',
}

/**
 * License error class
 */
export class LicenseError extends Error {
    code: LicenseErrorCode;
    details?: any;

    constructor(code: LicenseErrorCode, message: string, details?: any) {
        super(message);
        this.name = 'LicenseError';
        this.code = code;
        this.details = details;
    }
}
