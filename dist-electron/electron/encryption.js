/**
 * Screenshot Encryption Module
 *
 * Provides AES-256-GCM encryption for screenshot files using Electron's safeStorage API.
 * Supports backward compatibility with unencrypted screenshots.
 *
 * File Format for Encrypted Screenshots:
 * - Header: 'ENCRYPTED' (9 bytes) + version (1 byte, currently 0x01)
 * - IV: 12 bytes (GCM standard)
 * - Auth Tag: 16 bytes (GCM authentication tag)
 * - Encrypted Data: Variable length
 *
 * Total header overhead: 38 bytes
 */
import { safeStorage } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
// Constants
const ENCRYPTION_HEADER = Buffer.from('ENCRYPTED', 'utf-8'); // 9 bytes
const ENCRYPTION_VERSION = 0x01; // 1 byte
const HEADER_SIZE = 10; // ENCRYPTED + version byte
const IV_SIZE = 12; // GCM standard IV size
const AUTH_TAG_SIZE = 16; // GCM authentication tag size
const ALGORITHM = 'aes-256-gcm';
// Key management
let encryptionKey = null;
/**
 * Initialize or retrieve the encryption key using Electron's safeStorage
 * The key is stored encrypted in the OS keychain
 */
export function getEncryptionKey() {
    if (encryptionKey) {
        return encryptionKey;
    }
    // Check if safeStorage is available
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('System encryption not available. Screenshots cannot be encrypted.');
    }
    // Try to load existing key from a secure location
    const keyPath = getKeyStoragePath();
    try {
        if (fs.existsSync(keyPath)) {
            // Read the encrypted key
            const encryptedKey = fs.readFileSync(keyPath);
            // Decrypt using OS keychain
            const decryptedKey = safeStorage.decryptString(encryptedKey);
            encryptionKey = Buffer.from(decryptedKey, 'hex');
            console.log('[Encryption] Loaded existing encryption key');
        }
        else {
            // Generate new key
            encryptionKey = crypto.randomBytes(32); // 256 bits
            // Encrypt the key using OS keychain
            const encryptedKey = safeStorage.encryptString(encryptionKey.toString('hex'));
            // Store encrypted key
            fs.writeFileSync(keyPath, encryptedKey);
            console.log('[Encryption] Generated new encryption key');
        }
    }
    catch (error) {
        console.error('[Encryption] Failed to manage encryption key:', error);
        throw new Error('Failed to initialize encryption key');
    }
    return encryptionKey;
}
/**
 * Get the path where the encrypted key is stored
 */
function getKeyStoragePath() {
    const { app } = require('electron');
    const path = require('path');
    return path.join(app.getPath('userData'), '.screenshot-key');
}
/**
 * Check if a file is encrypted by examining its header
 */
export function isFileEncrypted(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return false;
        }
        const fd = fs.openSync(filePath, 'r');
        const headerBuffer = Buffer.alloc(HEADER_SIZE);
        fs.readSync(fd, headerBuffer, 0, HEADER_SIZE, 0);
        fs.closeSync(fd);
        // Check for encryption header
        const fileHeader = headerBuffer.subarray(0, ENCRYPTION_HEADER.length);
        return fileHeader.equals(ENCRYPTION_HEADER);
    }
    catch (error) {
        console.error('[Encryption] Failed to check if file is encrypted:', error);
        return false;
    }
}
/**
 * Encrypt a buffer using AES-256-GCM
 */
export function encryptBuffer(data) {
    try {
        const key = getEncryptionKey();
        const iv = crypto.randomBytes(IV_SIZE);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(data),
            cipher.final()
        ]);
        const authTag = cipher.getAuthTag();
        // Format: HEADER + VERSION + IV + AUTH_TAG + ENCRYPTED_DATA
        const result = Buffer.concat([
            ENCRYPTION_HEADER,
            Buffer.from([ENCRYPTION_VERSION]),
            iv,
            authTag,
            encrypted
        ]);
        return result;
    }
    catch (error) {
        console.error('[Encryption] Failed to encrypt buffer:', error);
        throw error;
    }
}
/**
 * Decrypt a buffer that was encrypted with encryptBuffer
 */
export function decryptBuffer(encryptedData) {
    try {
        // Verify header
        const header = encryptedData.subarray(0, ENCRYPTION_HEADER.length);
        if (!header.equals(ENCRYPTION_HEADER)) {
            throw new Error('Invalid encryption header');
        }
        // Check version
        const version = encryptedData[ENCRYPTION_HEADER.length];
        if (version !== ENCRYPTION_VERSION) {
            throw new Error(`Unsupported encryption version: ${version}`);
        }
        // Extract components
        let offset = HEADER_SIZE;
        const iv = encryptedData.subarray(offset, offset + IV_SIZE);
        offset += IV_SIZE;
        const authTag = encryptedData.subarray(offset, offset + AUTH_TAG_SIZE);
        offset += AUTH_TAG_SIZE;
        const encrypted = encryptedData.subarray(offset);
        // Decrypt
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        return decrypted;
    }
    catch (error) {
        console.error('[Encryption] Failed to decrypt buffer:', error);
        throw error;
    }
}
/**
 * Encrypt a file and save it (overwrites the original)
 */
export async function encryptFile(filePath) {
    try {
        // Check if already encrypted
        if (isFileEncrypted(filePath)) {
            console.log('[Encryption] File already encrypted:', filePath);
            return;
        }
        // Read original file
        const originalData = await fs.promises.readFile(filePath);
        // Encrypt
        const encryptedData = encryptBuffer(originalData);
        // Write encrypted data back
        await fs.promises.writeFile(filePath, encryptedData);
        console.log('[Encryption] File encrypted successfully:', filePath);
    }
    catch (error) {
        console.error('[Encryption] Failed to encrypt file:', error);
        throw error;
    }
}
/**
 * Decrypt a file and return the decrypted buffer
 * If the file is not encrypted, returns the original data
 */
export async function decryptFile(filePath) {
    try {
        const fileData = await fs.promises.readFile(filePath);
        // Check if encrypted
        if (isFileEncrypted(filePath)) {
            console.log('[Encryption] Decrypting file:', filePath);
            return decryptBuffer(fileData);
        }
        else {
            // Return as-is for backward compatibility
            console.log('[Encryption] File not encrypted, returning as-is:', filePath);
            return fileData;
        }
    }
    catch (error) {
        console.error('[Encryption] Failed to decrypt file:', error);
        throw error;
    }
}
/**
 * Save encrypted data to a file
 */
export async function saveEncryptedFile(filePath, data) {
    try {
        const encryptedData = encryptBuffer(data);
        await fs.promises.writeFile(filePath, encryptedData);
        console.log('[Encryption] Saved encrypted file:', filePath);
    }
    catch (error) {
        console.error('[Encryption] Failed to save encrypted file:', error);
        throw error;
    }
}
