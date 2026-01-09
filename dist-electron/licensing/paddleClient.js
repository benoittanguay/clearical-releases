/**
 * Paddle API Client
 *
 * Client for interacting with Paddle's License API for:
 * - License verification
 * - Device activation/deactivation
 * - Subscription status checks
 *
 * NOTE: This is a Phase 2 implementation. For Phase 1, this serves as a stub
 * with the interface defined for future integration.
 */
import { LicenseStatus, PlanType, LicenseError, LicenseErrorCode, } from './types.js';
/**
 * Paddle API client
 */
export class PaddleClient {
    vendorId;
    apiKey;
    apiEndpoint;
    constructor(config) {
        this.vendorId = config.vendorId;
        this.apiKey = config.apiKey;
        // Use sandbox or production API endpoint
        this.apiEndpoint = config.sandbox
            ? 'https://sandbox-vendors.paddle.com/api'
            : 'https://vendors.paddle.com/api';
        console.log('[PaddleClient] Initialized:', {
            vendorId: this.vendorId,
            endpoint: this.apiEndpoint,
            sandbox: config.sandbox,
        });
    }
    /**
     * Verify license with Paddle API
     * @param licenseKey - License key to verify
     * @param deviceId - Device ID for activation
     * @returns Updated license data from Paddle
     */
    async verifyLicense(licenseKey, deviceId) {
        console.log('[PaddleClient] Verifying license:', { licenseKey: this.maskLicenseKey(licenseKey), deviceId: deviceId.substring(0, 8) });
        try {
            const response = await fetch(`${this.apiEndpoint}/2.0/license/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    vendor_id: this.vendorId,
                    vendor_auth_code: this.apiKey,
                    license_code: licenseKey,
                    device_id: deviceId,
                }),
            });
            if (!response.ok) {
                throw new LicenseError(LicenseErrorCode.API_ERROR, `Paddle API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new LicenseError(LicenseErrorCode.INVALID_LICENSE_KEY, 'License verification failed');
            }
            // Transform Paddle response to our License model
            return this.transformPaddleResponse(data, licenseKey, deviceId);
        }
        catch (error) {
            if (error instanceof LicenseError) {
                throw error;
            }
            console.error('[PaddleClient] License verification failed:', error);
            throw new LicenseError(LicenseErrorCode.NETWORK_ERROR, 'Failed to verify license with Paddle', error);
        }
    }
    /**
     * Activate device with Paddle
     * @param licenseKey - License key
     * @param deviceFingerprint - Device to activate
     */
    async activateDevice(licenseKey, deviceFingerprint) {
        console.log('[PaddleClient] Activating device:', {
            licenseKey: this.maskLicenseKey(licenseKey),
            deviceId: deviceFingerprint.deviceId.substring(0, 8),
            deviceName: deviceFingerprint.deviceName,
        });
        try {
            const response = await fetch(`${this.apiEndpoint}/2.0/license/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    vendor_id: this.vendorId,
                    vendor_auth_code: this.apiKey,
                    license_code: licenseKey,
                    device_id: deviceFingerprint.deviceId,
                    device_name: deviceFingerprint.deviceName,
                }),
            });
            if (!response.ok) {
                throw new LicenseError(LicenseErrorCode.API_ERROR, `Paddle API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new LicenseError(LicenseErrorCode.DEVICE_LIMIT_REACHED, 'Device activation failed');
            }
            console.log('[PaddleClient] Device activated successfully');
        }
        catch (error) {
            if (error instanceof LicenseError) {
                throw error;
            }
            console.error('[PaddleClient] Device activation failed:', error);
            throw new LicenseError(LicenseErrorCode.NETWORK_ERROR, 'Failed to activate device with Paddle', error);
        }
    }
    /**
     * Deactivate device with Paddle
     * @param licenseKey - License key
     * @param deviceId - Device ID to deactivate
     */
    async deactivateDevice(licenseKey, deviceId) {
        console.log('[PaddleClient] Deactivating device:', {
            licenseKey: this.maskLicenseKey(licenseKey),
            deviceId: deviceId.substring(0, 8),
        });
        try {
            const response = await fetch(`${this.apiEndpoint}/2.0/license/deactivate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    vendor_id: this.vendorId,
                    vendor_auth_code: this.apiKey,
                    license_code: licenseKey,
                    device_id: deviceId,
                }),
            });
            if (!response.ok) {
                throw new LicenseError(LicenseErrorCode.API_ERROR, `Paddle API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new LicenseError(LicenseErrorCode.VALIDATION_FAILED, 'Device deactivation failed');
            }
            console.log('[PaddleClient] Device deactivated successfully');
        }
        catch (error) {
            if (error instanceof LicenseError) {
                throw error;
            }
            console.error('[PaddleClient] Device deactivation failed:', error);
            throw new LicenseError(LicenseErrorCode.NETWORK_ERROR, 'Failed to deactivate device with Paddle', error);
        }
    }
    /**
     * Transform Paddle API response to our License model
     * @param paddleResponse - Paddle API response
     * @param licenseKey - License key
     * @param deviceId - Device ID
     * @returns License object
     */
    transformPaddleResponse(paddleResponse, licenseKey, deviceId) {
        const now = Date.now();
        const response = paddleResponse.response;
        // Parse expiry date
        let expiresAt = null;
        if (response.expiry_date) {
            expiresAt = new Date(response.expiry_date).getTime();
        }
        // Determine plan type from Paddle data
        let planType = PlanType.MONTHLY;
        if (!expiresAt) {
            planType = PlanType.LIFETIME;
        }
        // Additional logic could be added here to determine yearly vs monthly
        // based on product_id or passthrough data
        // Determine license status
        let status = LicenseStatus.ACTIVE;
        if (expiresAt && expiresAt < now) {
            status = LicenseStatus.EXPIRED;
        }
        // Parse passthrough data if present
        let customData = {};
        if (response.passthrough) {
            try {
                customData = JSON.parse(response.passthrough);
            }
            catch (error) {
                console.warn('[PaddleClient] Failed to parse passthrough data:', error);
            }
        }
        const license = {
            licenseKey,
            email: response.customer_email || response.activation_email,
            status,
            subscriptionId: customData.subscriptionId,
            planType,
            activatedAt: customData.activatedAt || now,
            expiresAt,
            deviceId,
            devices: customData.devices || [],
            maxDevices: response.allowed_activations || 2,
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
            createdAt: customData.createdAt || now,
            updatedAt: now,
        };
        return license;
    }
    /**
     * Mask license key for logging (show last 4 characters only)
     * @param licenseKey - Full license key
     * @returns Masked license key
     */
    maskLicenseKey(licenseKey) {
        if (licenseKey.length <= 4) {
            return '****';
        }
        return '****-****-****-' + licenseKey.substring(licenseKey.length - 4);
    }
    /**
     * Test Paddle API connection
     * @returns True if API is accessible
     */
    async testConnection() {
        try {
            const response = await fetch(`${this.apiEndpoint}/2.0/product/get_products`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    vendor_id: this.vendorId,
                    vendor_auth_code: this.apiKey,
                }),
            });
            return response.ok;
        }
        catch (error) {
            console.error('[PaddleClient] Connection test failed:', error);
            return false;
        }
    }
}
