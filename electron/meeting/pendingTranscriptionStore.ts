/**
 * Pending Transcription Store
 *
 * Persists pending transcriptions to disk to survive app crashes/reloads.
 * Pending transcriptions are stored when transcription completes but before
 * the time entry is created (which happens when the timer stops).
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * Stored transcription data structure (simplified from EntryTranscription)
 */
interface StoredTranscription {
    transcriptionId: string;
    fullText: string;
    segments: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
    }>;
    language: string;
    audioDuration: number;
    wordCount: number;
    createdAt: number;
}

/**
 * File structure: Map of sessionId -> array of transcriptions
 */
interface PendingTranscriptionsFile {
    version: number;
    transcriptions: Record<string, StoredTranscription[]>;
}

const FILE_VERSION = 1;
const PENDING_TRANSCRIPTIONS_FILENAME = 'pending-transcriptions.json';

/**
 * Get the path to the pending transcriptions file
 */
function getFilePath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, PENDING_TRANSCRIPTIONS_FILENAME);
}

/**
 * Load all pending transcriptions from disk
 * Returns empty object if file doesn't exist or is corrupted
 */
export function load(): Record<string, StoredTranscription[]> {
    const filePath = getFilePath();

    try {
        if (!fs.existsSync(filePath)) {
            console.log('[PendingTranscriptionStore] No pending transcriptions file found');
            return {};
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data: PendingTranscriptionsFile = JSON.parse(fileContent);

        // Validate version
        if (data.version !== FILE_VERSION) {
            console.warn('[PendingTranscriptionStore] Version mismatch, clearing file');
            return {};
        }

        console.log('[PendingTranscriptionStore] Loaded pending transcriptions for', Object.keys(data.transcriptions).length, 'sessions');
        return data.transcriptions;
    } catch (error) {
        console.error('[PendingTranscriptionStore] Failed to load pending transcriptions:', error);
        // On corruption, start fresh
        return {};
    }
}

/**
 * Save transcription(s) for a session ID
 * Merges with existing transcriptions for the session
 */
export function save(sessionId: string, transcriptions: StoredTranscription[]): void {
    const filePath = getFilePath();

    try {
        // Load existing data
        const existingData = load();

        // Merge new transcriptions with existing ones for this session
        const existing = existingData[sessionId] || [];
        existingData[sessionId] = [...existing, ...transcriptions];

        // Write to disk
        const fileData: PendingTranscriptionsFile = {
            version: FILE_VERSION,
            transcriptions: existingData,
        };

        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
        console.log('[PendingTranscriptionStore] Saved', transcriptions.length, 'transcription(s) for session:', sessionId);
    } catch (error) {
        console.error('[PendingTranscriptionStore] Failed to save pending transcriptions:', error);
        throw error;
    }
}

/**
 * Remove pending transcriptions for a session ID
 */
export function remove(sessionId: string): void {
    const filePath = getFilePath();

    try {
        const existingData = load();

        if (!existingData[sessionId]) {
            console.log('[PendingTranscriptionStore] No pending transcriptions for session:', sessionId);
            return;
        }

        delete existingData[sessionId];

        const fileData: PendingTranscriptionsFile = {
            version: FILE_VERSION,
            transcriptions: existingData,
        };

        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
        console.log('[PendingTranscriptionStore] Removed pending transcriptions for session:', sessionId);
    } catch (error) {
        console.error('[PendingTranscriptionStore] Failed to remove pending transcriptions:', error);
        throw error;
    }
}

/**
 * Clear all pending transcriptions
 */
export function clear(): void {
    const filePath = getFilePath();

    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('[PendingTranscriptionStore] Cleared all pending transcriptions');
        }
    } catch (error) {
        console.error('[PendingTranscriptionStore] Failed to clear pending transcriptions:', error);
        throw error;
    }
}

/**
 * Clean up old pending transcriptions (older than maxAgeMs)
 * Returns number of sessions cleaned
 */
export function cleanupOld(maxAgeMs: number): number {
    const filePath = getFilePath();
    const now = Date.now();
    let cleanedCount = 0;

    try {
        const existingData = load();

        for (const [sessionId, transcriptions] of Object.entries(existingData)) {
            // Check if all transcriptions for this session are old
            const allOld = transcriptions.every(t => now - t.createdAt > maxAgeMs);
            if (allOld) {
                delete existingData[sessionId];
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            const fileData: PendingTranscriptionsFile = {
                version: FILE_VERSION,
                transcriptions: existingData,
            };

            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
            console.log('[PendingTranscriptionStore] Cleaned up', cleanedCount, 'old session(s)');
        }

        return cleanedCount;
    } catch (error) {
        console.error('[PendingTranscriptionStore] Failed to cleanup old transcriptions:', error);
        return 0;
    }
}
