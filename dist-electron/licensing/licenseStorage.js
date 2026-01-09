/**
 * License Storage Service
 *
 * Secure storage for license data using Electron's safeStorage API.
 * Handles encryption, persistence, and retrieval of license information.
 */
import { safeStorage, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { LicenseError, LicenseErrorCode } from './types.js';
// Path to the encrypted license file
const LICENSE_FILE_PATH = path.join(app.getPath('userData'), '.license');
/**
 * License storage service class
 */
export class LicenseStorage {
    /**
     * Check if safeStorage is available
     */
    static isSafeStorageAvailable() {
        return safeStorage.isEncryptionAvailable();
    }
    /**
     * Save license to encrypted storage
     * @param license - License data to save
     */
    static async saveLicense(license) {
        if (!LicenseStorage.isSafeStorageAvailable()) {
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Secure storage not available on this system');
        }
        try {
            // Serialize license to JSON
            const licenseJson = JSON.stringify(license, null, 2);
            // Encrypt using safeStorage
            const encryptedData = safeStorage.encryptString(licenseJson);
            // Convert to base64 for file storage
            const base64Data = encryptedData.toString('base64');
            // Write to file
            await fs.promises.writeFile(LICENSE_FILE_PATH, base64Data, 'utf-8');
            // Set restrictive file permissions (owner read/write only)
            if (process.platform !== 'win32') {
                await fs.promises.chmod(LICENSE_FILE_PATH, 0o600);
            }
            console.log('[LicenseStorage] License saved successfully');
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to save license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to save license', error);
        }
    }
    /**
     * Load license from encrypted storage
     * @returns License data or null if not found
     */
    static async getLicense() {
        if (!LicenseStorage.isSafeStorageAvailable()) {
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Secure storage not available on this system');
        }
        try {
            // Check if license file exists
            if (!fs.existsSync(LICENSE_FILE_PATH)) {
                console.log('[LicenseStorage] No license file found');
                return null;
            }
            // Read encrypted data from file
            const base64Data = await fs.promises.readFile(LICENSE_FILE_PATH, 'utf-8');
            // Convert base64 back to Buffer
            const encryptedData = Buffer.from(base64Data, 'base64');
            // Decrypt using safeStorage
            const licenseJson = safeStorage.decryptString(encryptedData);
            // Parse JSON
            const license = JSON.parse(licenseJson);
            console.log('[LicenseStorage] License loaded successfully');
            return license;
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to load license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to load license', error);
        }
    }
    /**
     * Update license data (partial update)
     * @param updates - Partial license data to update
     */
    static async updateLicense(updates) {
        try {
            // Load existing license
            const existingLicense = await LicenseStorage.getLicense();
            if (!existingLicense) {
                throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'No license found to update');
            }
            // Merge updates
            const updatedLicense = {
                ...existingLicense,
                ...updates,
                updatedAt: Date.now(),
            };
            // Save updated license
            await LicenseStorage.saveLicense(updatedLicense);
            console.log('[LicenseStorage] License updated successfully');
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to update license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to update license', error);
        }
    }
    /**
     * Delete license from storage
     */
    static async deleteLicense() {
        try {
            if (fs.existsSync(LICENSE_FILE_PATH)) {
                await fs.promises.unlink(LICENSE_FILE_PATH);
                console.log('[LicenseStorage] License deleted successfully');
            }
            else {
                console.log('[LicenseStorage] No license file to delete');
            }
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to delete license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to delete license', error);
        }
    }
    /**
     * Check if license exists
     * @returns True if license file exists
     */
    static async hasLicense() {
        try {
            return fs.existsSync(LICENSE_FILE_PATH);
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to check license existence:', error);
            return false;
        }
    }
    /**
     * Get license file path (for debugging)
     * @returns Path to license file
     */
    static getLicenseFilePath() {
        return LICENSE_FILE_PATH;
    }
    /**
     * Backup license to a specified location
     * @param backupPath - Path to save backup
     */
    static async backupLicense(backupPath) {
        try {
            if (!fs.existsSync(LICENSE_FILE_PATH)) {
                throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'No license to backup');
            }
            // Copy encrypted license file to backup location
            await fs.promises.copyFile(LICENSE_FILE_PATH, backupPath);
            console.log('[LicenseStorage] License backed up to:', backupPath);
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to backup license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to backup license', error);
        }
    }
    /**
     * Restore license from backup
     * @param backupPath - Path to backup file
     */
    static async restoreLicense(backupPath) {
        try {
            if (!fs.existsSync(backupPath)) {
                throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Backup file not found');
            }
            // Copy backup file to license location
            await fs.promises.copyFile(backupPath, LICENSE_FILE_PATH);
            // Set restrictive file permissions
            if (process.platform !== 'win32') {
                await fs.promises.chmod(LICENSE_FILE_PATH, 0o600);
            }
            console.log('[LicenseStorage] License restored from:', backupPath);
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to restore license:', error);
            throw new LicenseError(LicenseErrorCode.STORAGE_ERROR, 'Failed to restore license', error);
        }
    }
    /**
     * Validate license data integrity
     * @param license - License to validate
     * @returns True if license data is valid
     */
    static validateLicenseData(license) {
        try {
            // Check required fields
            if (!license.licenseKey || !license.email || !license.status) {
                return false;
            }
            if (!license.planType || !license.deviceId) {
                return false;
            }
            // Check timestamps
            if (!license.activatedAt || !license.lastValidated) {
                return false;
            }
            // Check feature flags
            if (!license.features) {
                return false;
            }
            // Check devices array
            if (!Array.isArray(license.devices)) {
                return false;
            }
            // All checks passed
            return true;
        }
        catch (error) {
            console.error('[LicenseStorage] License validation failed:', error);
            return false;
        }
    }
    /**
     * Get license storage metadata (for debugging)
     */
    static async getStorageMetadata() {
        try {
            const exists = fs.existsSync(LICENSE_FILE_PATH);
            if (exists) {
                const stats = await fs.promises.stat(LICENSE_FILE_PATH);
                return {
                    exists: true,
                    path: LICENSE_FILE_PATH,
                    size: stats.size,
                    modified: stats.mtime,
                };
            }
            else {
                return {
                    exists: false,
                    path: LICENSE_FILE_PATH,
                };
            }
        }
        catch (error) {
            console.error('[LicenseStorage] Failed to get metadata:', error);
            return {
                exists: false,
                path: LICENSE_FILE_PATH,
            };
        }
    }
}
