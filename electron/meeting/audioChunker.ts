/**
 * Audio Chunker
 *
 * Splits large audio files into smaller chunks for transcription services
 * that have file size limits (e.g., Groq's 25MB limit).
 *
 * Requires ffmpeg to be installed on the system (brew install ffmpeg).
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';

// Maximum file size for Groq API (25MB with 1MB safety margin)
export const MAX_CHUNK_SIZE_BYTES = 24 * 1024 * 1024; // 24MB to be safe

// Target chunk duration in seconds (10 minutes = ~9.6MB at 128kbps)
export const TARGET_CHUNK_DURATION_SECONDS = 600; // 10 minutes

/**
 * Result of audio chunking operation
 */
export interface ChunkingResult {
    success: boolean;
    chunks?: AudioChunk[];
    error?: string;
}

/**
 * Information about a single audio chunk
 */
export interface AudioChunk {
    filePath: string;
    startTime: number;  // Start time in seconds
    endTime: number;    // End time in seconds
    sizeBytes: number;
}

/**
 * Check if ffmpeg is available on the system
 */
export async function isFfmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', ['-version']);

        ffmpeg.on('error', () => {
            console.log('[AudioChunker] ffmpeg not available on system');
            resolve(false);
        });

        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            ffmpeg.kill();
            resolve(false);
        }, 5000);
    });
}

/**
 * Get audio duration using ffprobe
 *
 * MediaRecorder-generated WebM files often don't have proper duration metadata,
 * so we fall back to estimating from file size and typical bitrate.
 */
export async function getAudioDuration(filePath: string): Promise<number | null> {
    return new Promise((resolve) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration,bit_rate',
            '-of', 'default=noprint_wrappers=1',
            filePath
        ]);

        let output = '';

        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });

        ffprobe.on('error', () => {
            // Fallback to estimation
            const estimated = estimateDurationFromFileSize(filePath);
            console.log('[AudioChunker] ffprobe error, estimated duration:', estimated, 'seconds');
            resolve(estimated);
        });

        ffprobe.on('close', (code) => {
            if (code === 0) {
                // Parse duration from output
                const durationMatch = output.match(/duration=([0-9.]+)/);
                if (durationMatch) {
                    const duration = parseFloat(durationMatch[1]);
                    if (!isNaN(duration) && duration > 0) {
                        console.log('[AudioChunker] Got duration from ffprobe:', duration, 'seconds');
                        resolve(duration);
                        return;
                    }
                }

                // Duration is N/A (common with MediaRecorder WebM), estimate from file size
                const estimated = estimateDurationFromFileSize(filePath);
                console.log('[AudioChunker] Duration N/A, estimated:', estimated, 'seconds');
                resolve(estimated);
                return;
            }

            // Fallback to estimation
            const estimated = estimateDurationFromFileSize(filePath);
            console.log('[AudioChunker] ffprobe failed, estimated duration:', estimated, 'seconds');
            resolve(estimated);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
            ffprobe.kill();
            const estimated = estimateDurationFromFileSize(filePath);
            resolve(estimated);
        }, 10000);
    });
}

/**
 * Estimate audio duration from file size
 *
 * Assumes 128kbps bitrate (typical for WebM/Opus recordings).
 * 128kbps = 16KB/s, so duration = fileSize / 16000
 */
function estimateDurationFromFileSize(filePath: string): number | null {
    try {
        const stats = fs.statSync(filePath);
        // 128kbps = 16KB/s
        const estimatedDuration = stats.size / 16000;
        return estimatedDuration;
    } catch {
        return null;
    }
}

/**
 * Split audio file into chunks using ffmpeg
 *
 * @param inputPath - Path to the input audio file
 * @param outputDir - Directory to save chunks (uses temp dir if not specified)
 * @returns ChunkingResult with array of chunk file paths
 */
export async function splitAudioFile(
    inputPath: string,
    outputDir?: string
): Promise<ChunkingResult> {
    console.log('[AudioChunker] Splitting audio file:', inputPath);

    // Check if file exists
    if (!fs.existsSync(inputPath)) {
        return {
            success: false,
            error: 'Input file not found'
        };
    }

    // Check file size
    const stats = fs.statSync(inputPath);
    const fileSizeBytes = stats.size;
    console.log('[AudioChunker] File size:', Math.round(fileSizeBytes / 1024 / 1024), 'MB');

    // If file is small enough, no chunking needed
    if (fileSizeBytes <= MAX_CHUNK_SIZE_BYTES) {
        console.log('[AudioChunker] File is within size limit, no chunking needed');
        return {
            success: true,
            chunks: [{
                filePath: inputPath,
                startTime: 0,
                endTime: -1, // Unknown
                sizeBytes: fileSizeBytes
            }]
        };
    }

    // Check if ffmpeg is available
    const ffmpegAvailable = await isFfmpegAvailable();
    if (!ffmpegAvailable) {
        return {
            success: false,
            error: 'ffmpeg not available for audio chunking'
        };
    }

    // Get audio duration
    const duration = await getAudioDuration(inputPath);
    if (duration === null) {
        return {
            success: false,
            error: 'Could not determine audio duration'
        };
    }

    console.log('[AudioChunker] Audio duration:', duration, 'seconds');

    // Calculate number of chunks needed
    // Use bitrate-based estimation: 128kbps = 16KB/s = 960KB/min
    // 24MB / 960KB = ~25 minutes max per chunk
    // But we'll use 10 minute chunks for safety
    const numChunks = Math.ceil(duration / TARGET_CHUNK_DURATION_SECONDS);
    console.log('[AudioChunker] Will create', numChunks, 'chunks');

    // Create output directory
    const chunksDir = outputDir || path.join(app.getPath('temp'), `audio-chunks-${Date.now()}`);
    if (!fs.existsSync(chunksDir)) {
        fs.mkdirSync(chunksDir, { recursive: true });
    }

    // Split into chunks
    const chunks: AudioChunk[] = [];
    const inputExt = path.extname(inputPath);

    for (let i = 0; i < numChunks; i++) {
        const startTime = i * TARGET_CHUNK_DURATION_SECONDS;
        const endTime = Math.min((i + 1) * TARGET_CHUNK_DURATION_SECONDS, duration);
        const chunkDuration = endTime - startTime;

        const chunkPath = path.join(chunksDir, `chunk-${i.toString().padStart(3, '0')}${inputExt}`);

        console.log(`[AudioChunker] Creating chunk ${i + 1}/${numChunks}: ${startTime}s - ${endTime}s`);

        const success = await extractAudioSegment(inputPath, chunkPath, startTime, chunkDuration);

        if (!success) {
            // Clean up any chunks we created
            cleanupChunks(chunks);
            return {
                success: false,
                error: `Failed to create chunk ${i + 1}`
            };
        }

        const chunkStats = fs.statSync(chunkPath);
        chunks.push({
            filePath: chunkPath,
            startTime,
            endTime,
            sizeBytes: chunkStats.size
        });

        // Verify chunk size
        if (chunkStats.size > MAX_CHUNK_SIZE_BYTES) {
            console.warn(`[AudioChunker] Chunk ${i + 1} is too large:`, Math.round(chunkStats.size / 1024 / 1024), 'MB');
            // Continue anyway - the transcription service will handle the error
        }
    }

    console.log('[AudioChunker] Successfully created', chunks.length, 'chunks');

    return {
        success: true,
        chunks
    };
}

/**
 * Extract a segment of audio using ffmpeg
 */
async function extractAudioSegment(
    inputPath: string,
    outputPath: string,
    startSeconds: number,
    durationSeconds: number
): Promise<boolean> {
    return new Promise((resolve) => {
        const ffmpeg = spawn('ffmpeg', [
            '-y',                           // Overwrite output
            '-i', inputPath,                // Input file
            '-ss', startSeconds.toString(), // Start time
            '-t', durationSeconds.toString(), // Duration
            '-c', 'copy',                   // Copy codec (no re-encoding for speed)
            '-avoid_negative_ts', 'make_zero',
            outputPath
        ]);

        ffmpeg.on('error', (err) => {
            console.error('[AudioChunker] ffmpeg error:', err);
            resolve(false);
        });

        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });

        // Timeout after 60 seconds per chunk
        setTimeout(() => {
            console.error('[AudioChunker] ffmpeg timeout');
            ffmpeg.kill();
            resolve(false);
        }, 60000);
    });
}

/**
 * Clean up chunk files
 */
export function cleanupChunks(chunks: AudioChunk[]): void {
    for (const chunk of chunks) {
        try {
            if (fs.existsSync(chunk.filePath)) {
                fs.unlinkSync(chunk.filePath);
            }
        } catch (error) {
            console.warn('[AudioChunker] Failed to delete chunk:', chunk.filePath, error);
        }
    }

    // Try to remove the chunks directory if empty
    if (chunks.length > 0) {
        const chunksDir = path.dirname(chunks[0].filePath);
        try {
            const remaining = fs.readdirSync(chunksDir);
            if (remaining.length === 0) {
                fs.rmdirSync(chunksDir);
            }
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Check if a file needs to be chunked for transcription
 */
export function needsChunking(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    const stats = fs.statSync(filePath);
    return stats.size > MAX_CHUNK_SIZE_BYTES;
}

/**
 * Get file size in bytes
 */
export function getFileSizeBytes(filePath: string): number {
    if (!fs.existsSync(filePath)) {
        return 0;
    }

    const stats = fs.statSync(filePath);
    return stats.size;
}
