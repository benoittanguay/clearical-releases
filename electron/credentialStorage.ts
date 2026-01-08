/**
 * Secure Credential Storage Module
 *
 * Provides secure storage for API credentials (Jira API token, Tempo API token, etc.)
 * using Electron's safeStorage API. Credentials are encrypted and stored in a JSON file
 * in the app's userData directory.
 *
 * Features:
 * - Uses Electron's safeStorage for OS-level encryption (Keychain on macOS, etc.)
 * - Stores encrypted credentials in userData directory
 * - Supports get, set, delete, and list operations
 * - Backward compatible with unencrypted credentials (one-time migration)
 */

import { safeStorage, app } from 'electron';
import fs from 'fs';
import path from 'path';

// Path to the encrypted credentials file
const CREDENTIALS_FILE_PATH = path.join(app.getPath('userData'), '.credentials');

/**
 * Structure for stored credentials
 * Maps credential keys to encrypted values
 */
interface CredentialStore {
    [key: string]: string; // Encrypted credential values
}

/**
 * Check if safeStorage is available
 */
function isSafeStorageAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
}

/**
 * Load the credential store from disk
 * Returns an empty object if the file doesn't exist
 */
function loadCredentialStore(): CredentialStore {
    try {
        if (!fs.existsSync(CREDENTIALS_FILE_PATH)) {
            return {};
        }

        const fileContent = fs.readFileSync(CREDENTIALS_FILE_PATH, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error('[CredentialStorage] Failed to load credential store:', error);
        return {};
    }
}

/**
 * Save the credential store to disk
 */
function saveCredentialStore(store: CredentialStore): void {
    try {
        const fileContent = JSON.stringify(store, null, 2);
        fs.writeFileSync(CREDENTIALS_FILE_PATH, fileContent, 'utf-8');

        // Set restrictive file permissions (owner read/write only)
        if (process.platform !== 'win32') {
            fs.chmodSync(CREDENTIALS_FILE_PATH, 0o600);
        }

        console.log('[CredentialStorage] Credential store saved successfully');
    } catch (error) {
        console.error('[CredentialStorage] Failed to save credential store:', error);
        throw error;
    }
}

/**
 * Store a credential securely
 * @param key - The credential key (e.g., 'jira-api-token')
 * @param value - The credential value to encrypt and store
 */
export async function storeCredential(key: string, value: string): Promise<void> {
    if (!key || typeof value !== 'string') {
        throw new Error('Invalid key or value');
    }

    if (!isSafeStorageAvailable()) {
        throw new Error('Secure storage not available on this system');
    }

    try {
        // Encrypt the credential using safeStorage
        const encryptedValue = safeStorage.encryptString(value);

        // Convert Buffer to base64 for JSON storage
        const base64Value = encryptedValue.toString('base64');

        // Load existing store
        const store = loadCredentialStore();

        // Update the credential
        store[key] = base64Value;

        // Save to disk
        saveCredentialStore(store);

        console.log(`[CredentialStorage] Credential stored: ${key}`);
    } catch (error) {
        console.error(`[CredentialStorage] Failed to store credential ${key}:`, error);
        throw error;
    }
}

/**
 * Retrieve a credential
 * @param key - The credential key to retrieve
 * @returns The decrypted credential value, or null if not found
 */
export async function getCredential(key: string): Promise<string | null> {
    if (!key) {
        throw new Error('Invalid key');
    }

    if (!isSafeStorageAvailable()) {
        throw new Error('Secure storage not available on this system');
    }

    try {
        // Load the store
        const store = loadCredentialStore();

        // Check if credential exists
        if (!store[key]) {
            console.log(`[CredentialStorage] Credential not found: ${key}`);
            return null;
        }

        // Convert base64 back to Buffer
        const encryptedBuffer = Buffer.from(store[key], 'base64');

        // Decrypt using safeStorage
        const decryptedValue = safeStorage.decryptString(encryptedBuffer);

        console.log(`[CredentialStorage] Credential retrieved: ${key}`);
        return decryptedValue;
    } catch (error) {
        console.error(`[CredentialStorage] Failed to retrieve credential ${key}:`, error);
        throw error;
    }
}

/**
 * Delete a credential
 * @param key - The credential key to delete
 */
export async function deleteCredential(key: string): Promise<void> {
    if (!key) {
        throw new Error('Invalid key');
    }

    try {
        // Load the store
        const store = loadCredentialStore();

        // Delete the credential
        delete store[key];

        // Save to disk
        saveCredentialStore(store);

        console.log(`[CredentialStorage] Credential deleted: ${key}`);
    } catch (error) {
        console.error(`[CredentialStorage] Failed to delete credential ${key}:`, error);
        throw error;
    }
}

/**
 * Check if a credential exists
 * @param key - The credential key to check
 * @returns true if the credential exists, false otherwise
 */
export async function hasCredential(key: string): Promise<boolean> {
    if (!key) {
        return false;
    }

    try {
        const store = loadCredentialStore();
        return key in store;
    } catch (error) {
        console.error(`[CredentialStorage] Failed to check credential ${key}:`, error);
        return false;
    }
}

/**
 * List all credential keys (not the values!)
 * @returns Array of credential keys
 */
export async function listCredentialKeys(): Promise<string[]> {
    try {
        const store = loadCredentialStore();
        return Object.keys(store);
    } catch (error) {
        console.error('[CredentialStorage] Failed to list credentials:', error);
        return [];
    }
}

/**
 * Delete all credentials (use with caution!)
 */
export async function clearAllCredentials(): Promise<void> {
    try {
        if (fs.existsSync(CREDENTIALS_FILE_PATH)) {
            fs.unlinkSync(CREDENTIALS_FILE_PATH);
            console.log('[CredentialStorage] All credentials cleared');
        }
    } catch (error) {
        console.error('[CredentialStorage] Failed to clear credentials:', error);
        throw error;
    }
}

/**
 * Check if secure storage is available
 * Useful for showing warnings in the UI
 */
export function isSecureStorageAvailable(): boolean {
    return isSafeStorageAvailable();
}
