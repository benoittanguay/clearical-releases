/**
 * Licensing Type Definitions
 *
 * Core TypeScript interfaces for TimePortal's licensing system.
 * Supports trial periods, subscriptions, and device management.
 */
/**
 * License status enum
 */
export var LicenseStatus;
(function (LicenseStatus) {
    LicenseStatus["TRIAL"] = "trial";
    LicenseStatus["ACTIVE"] = "active";
    LicenseStatus["GRACE_PERIOD"] = "grace_period";
    LicenseStatus["EXPIRED"] = "expired";
    LicenseStatus["CANCELED"] = "canceled";
    LicenseStatus["SUSPENDED"] = "suspended";
    LicenseStatus["LIFETIME"] = "lifetime";
})(LicenseStatus || (LicenseStatus = {}));
/**
 * Subscription plan types
 */
export var PlanType;
(function (PlanType) {
    PlanType["TRIAL"] = "trial";
    PlanType["MONTHLY"] = "monthly";
    PlanType["YEARLY"] = "yearly";
    PlanType["LIFETIME"] = "lifetime";
})(PlanType || (PlanType = {}));
/**
 * Validation mode enum
 */
export var ValidationMode;
(function (ValidationMode) {
    ValidationMode["ONLINE"] = "online";
    ValidationMode["CACHED"] = "cached";
    ValidationMode["OFFLINE"] = "offline";
    ValidationMode["OFFLINE_EXPIRED"] = "offline_expired";
    ValidationMode["TRIAL"] = "trial";
    ValidationMode["FAILED"] = "failed";
})(ValidationMode || (ValidationMode = {}));
/**
 * License event for logging and analytics
 */
export var LicenseEventType;
(function (LicenseEventType) {
    LicenseEventType["VALIDATION_SUCCESS"] = "validation_success";
    LicenseEventType["VALIDATION_FAILURE"] = "validation_failure";
    LicenseEventType["TRIAL_ACTIVATED"] = "trial_activated";
    LicenseEventType["LICENSE_ACTIVATED"] = "license_activated";
    LicenseEventType["DEVICE_ACTIVATED"] = "device_activated";
    LicenseEventType["DEVICE_DEACTIVATED"] = "device_deactivated";
    LicenseEventType["OFFLINE_MODE_ENTERED"] = "offline_mode_entered";
    LicenseEventType["GRACE_PERIOD_STARTED"] = "grace_period_started";
    LicenseEventType["SOFT_LOCK_TRIGGERED"] = "soft_lock_triggered";
    LicenseEventType["UPGRADE_PROMPTED"] = "upgrade_prompted";
    LicenseEventType["PAYMENT_FAILED"] = "payment_failed";
    LicenseEventType["LICENSE_RENEWED"] = "license_renewed";
})(LicenseEventType || (LicenseEventType = {}));
/**
 * Default license configuration
 */
export const DEFAULT_LICENSE_CONFIG = {
    onlineCheckInterval: 24 * 60 * 60 * 1000, // 24 hours
    offlineGracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
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
export var LicenseErrorCode;
(function (LicenseErrorCode) {
    LicenseErrorCode["INVALID_LICENSE_KEY"] = "INVALID_LICENSE_KEY";
    LicenseErrorCode["LICENSE_EXPIRED"] = "LICENSE_EXPIRED";
    LicenseErrorCode["DEVICE_LIMIT_REACHED"] = "DEVICE_LIMIT_REACHED";
    LicenseErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    LicenseErrorCode["API_ERROR"] = "API_ERROR";
    LicenseErrorCode["STORAGE_ERROR"] = "STORAGE_ERROR";
    LicenseErrorCode["VALIDATION_FAILED"] = "VALIDATION_FAILED";
    LicenseErrorCode["TRIAL_EXPIRED"] = "TRIAL_EXPIRED";
    LicenseErrorCode["SUBSCRIPTION_CANCELED"] = "SUBSCRIPTION_CANCELED";
    LicenseErrorCode["PAYMENT_FAILED"] = "PAYMENT_FAILED";
})(LicenseErrorCode || (LicenseErrorCode = {}));
/**
 * License error class
 */
export class LicenseError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'LicenseError';
        this.code = code;
        this.details = details;
    }
}
