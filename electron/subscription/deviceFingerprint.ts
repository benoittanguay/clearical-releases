/**
 * Device Fingerprinting Service
 *
 * Generates unique device identifiers for license device management.
 * Uses hardware UUID, machine ID, and other system information.
 */

import { app } from 'electron';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DeviceFingerprint } from './types.js';

const execAsync = promisify(exec);

/**
 * Device fingerprinting service
 */
export class DeviceFingerprintService {
    /**
     * Generate a complete device fingerprint
     * @returns Device fingerprint object
     */
    static async generate(): Promise<DeviceFingerprint> {
        const hardwareUUID = await DeviceFingerprintService.getMacOSHardwareUUID();
        const machineId = os.hostname() + '-' + os.userInfo().username;

        // Create composite device ID
        const deviceId = DeviceFingerprintService.createDeviceId(hardwareUUID, machineId);

        const deviceName = DeviceFingerprintService.getDeviceName();

        return {
            deviceId,
            hardwareUUID,
            machineId,
            hostname: os.hostname(),
            username: os.userInfo().username,
            deviceName,
            platform: process.platform,
            osVersion: os.release(),
            activatedAt: Date.now(),
            lastSeenAt: Date.now(),
        };
    }

    /**
     * Get macOS hardware UUID using ioreg
     * @returns Hardware UUID or 'unknown' if not available
     */
    private static async getMacOSHardwareUUID(): Promise<string> {
        if (process.platform !== 'darwin') {
            console.log('[DeviceFingerprint] Not macOS, using platform-specific ID');
            return `${process.platform}-unknown`;
        }

        try {
            // Use ioreg to get IOPlatformUUID (hardware UUID)
            const command = "ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID | awk '{print $3}'";
            const result = await execAsync(command);

            const uuid = result.stdout.trim().replace(/"/g, '');

            if (uuid && uuid.length > 0) {
                console.log('[DeviceFingerprint] Hardware UUID obtained successfully');
                return uuid;
            } else {
                console.warn('[DeviceFingerprint] Empty hardware UUID, using fallback');
                return 'unknown-uuid';
            }
        } catch (error) {
            console.error('[DeviceFingerprint] Failed to get hardware UUID:', error);
            return 'unknown-uuid';
        }
    }

    /**
     * Create deterministic device ID from hardware UUID and machine ID
     * @param hardwareUUID - Hardware UUID from system
     * @param machineId - Electron machine ID
     * @returns Hashed device ID (32 characters)
     */
    private static createDeviceId(hardwareUUID: string, machineId: string): string {
        // Create composite string
        const composite = `${hardwareUUID}-${machineId}-${os.platform()}`;

        // Hash using SHA-256 for consistency
        const hash = crypto.createHash('sha256').update(composite).digest('hex');

        // Return first 32 characters (sufficient uniqueness)
        return hash.substring(0, 32);
    }

    /**
     * Get user-friendly device name
     * @returns Device name (e.g., "john's MacBook-Pro")
     */
    private static getDeviceName(): string {
        try {
            const hostname = os.hostname();
            const username = os.userInfo().username;

            // Clean up hostname (remove .local, .lan, etc.)
            const cleanHostname = hostname
                .replace(/\.local$/, '')
                .replace(/\.lan$/, '')
                .replace(/\.home$/, '');

            // If hostname is just the username, don't duplicate
            if (cleanHostname.toLowerCase() === username.toLowerCase()) {
                return cleanHostname;
            }

            // Combine username and hostname
            return `${username}'s ${cleanHostname}`;
        } catch (error) {
            console.error('[DeviceFingerprint] Failed to get device name:', error);
            return 'Unknown Device';
        }
    }

    /**
     * Update last seen timestamp for a device fingerprint
     * @param fingerprint - Device fingerprint to update
     * @returns Updated fingerprint
     */
    static updateLastSeen(fingerprint: DeviceFingerprint): DeviceFingerprint {
        return {
            ...fingerprint,
            lastSeenAt: Date.now(),
        };
    }

    /**
     * Check if two device fingerprints match
     * @param fp1 - First fingerprint
     * @param fp2 - Second fingerprint
     * @returns True if fingerprints match
     */
    static match(fp1: DeviceFingerprint, fp2: DeviceFingerprint): boolean {
        return fp1.deviceId === fp2.deviceId;
    }

    /**
     * Get short device ID for display (last 8 characters)
     * @param deviceId - Full device ID
     * @returns Short device ID
     */
    static getShortDeviceId(deviceId: string): string {
        return deviceId.substring(deviceId.length - 8);
    }

    /**
     * Validate device fingerprint data integrity
     * @param fingerprint - Device fingerprint to validate
     * @returns True if fingerprint is valid
     */
    static isValid(fingerprint: DeviceFingerprint): boolean {
        try {
            // Check required fields
            if (!fingerprint.deviceId || fingerprint.deviceId.length !== 32) {
                return false;
            }

            if (!fingerprint.hardwareUUID || !fingerprint.machineId) {
                return false;
            }

            if (!fingerprint.hostname || !fingerprint.username || !fingerprint.deviceName) {
                return false;
            }

            if (!fingerprint.platform || !fingerprint.osVersion) {
                return false;
            }

            if (!fingerprint.activatedAt || !fingerprint.lastSeenAt) {
                return false;
            }

            // Timestamps should be reasonable
            const now = Date.now();
            if (fingerprint.activatedAt > now || fingerprint.lastSeenAt > now) {
                return false;
            }

            // All checks passed
            return true;
        } catch (error) {
            console.error('[DeviceFingerprint] Validation failed:', error);
            return false;
        }
    }

    /**
     * Get current device ID without full fingerprint generation
     * Useful for quick device identification
     * @returns Device ID string
     */
    static async getCurrentDeviceId(): Promise<string> {
        const hardwareUUID = await DeviceFingerprintService.getMacOSHardwareUUID();
        const machineId = os.hostname() + '-' + os.userInfo().username;
        return DeviceFingerprintService.createDeviceId(hardwareUUID, machineId);
    }

    /**
     * Compare device fingerprint with stored data to detect changes
     * @param current - Current device fingerprint
     * @param stored - Stored device fingerprint
     * @returns Object indicating what changed
     */
    static detectChanges(
        current: DeviceFingerprint,
        stored: DeviceFingerprint
    ): {
        changed: boolean;
        changes: string[];
    } {
        const changes: string[] = [];

        // Compare key identifiers
        if (current.deviceId !== stored.deviceId) {
            changes.push('deviceId');
        }

        if (current.hardwareUUID !== stored.hardwareUUID) {
            changes.push('hardwareUUID');
        }

        if (current.machineId !== stored.machineId) {
            changes.push('machineId');
        }

        if (current.hostname !== stored.hostname) {
            changes.push('hostname');
        }

        if (current.username !== stored.username) {
            changes.push('username');
        }

        if (current.osVersion !== stored.osVersion) {
            changes.push('osVersion');
        }

        return {
            changed: changes.length > 0,
            changes,
        };
    }

    /**
     * Sanitize device fingerprint for logging (remove PII)
     * @param fingerprint - Device fingerprint
     * @returns Sanitized version safe for logging
     */
    static sanitizeForLogging(fingerprint: DeviceFingerprint): any {
        return {
            deviceId: DeviceFingerprintService.getShortDeviceId(fingerprint.deviceId),
            platform: fingerprint.platform,
            osVersion: fingerprint.osVersion,
            activatedAt: new Date(fingerprint.activatedAt).toISOString(),
            lastSeenAt: new Date(fingerprint.lastSeenAt).toISOString(),
            // Omit PII: username, hostname, deviceName, hardwareUUID, machineId
        };
    }
}
