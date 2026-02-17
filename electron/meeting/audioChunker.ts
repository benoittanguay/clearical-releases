/**
 * Audio Chunker
 *
 * Splits large audio files into smaller chunks for transcription services
 * that have file size limits (e.g., Groq's 25MB limit).
 *
 * Uses bundled ffmpeg-static binary, with fallback to system ffmpeg.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';

// Maximum file size for Groq API (25MB with 1MB safety margin)
export const MAX_CHUNK_SIZE_BYTES = 24 * 1024 * 1024; // 24MB to be safe

/**
 * Get the path to the ffmpeg binary
 * Priority: 1) Bundled ffmpeg-static (direct path), 2) System ffmpeg
 */
export function getFfmpegPath(): string {
    // In packaged builds, construct the path directly — require('ffmpeg-static')
    // may not work reliably in ESM context within asar
    if (app.isPackaged) {
        const bundledPath = path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'ffmpeg-static',
            'ffmpeg'
        );
        if (fs.existsSync(bundledPath)) {
            try {
                fs.accessSync(bundledPath, fs.constants.X_OK);
                console.log('[AudioChunker] Using bundled ffmpeg:', bundledPath);
                return bundledPath;
            } catch {
                console.warn('[AudioChunker] Bundled ffmpeg not executable at:', bundledPath);
            }
        } else {
            console.warn('[AudioChunker] Bundled ffmpeg not found at:', bundledPath);
        }
    } else {
        // In development, use require to find the binary in node_modules
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const ffmpegStatic = require('ffmpeg-static') as string;
            if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
                console.log('[AudioChunker] Using dev ffmpeg:', ffmpegStatic);
                return ffmpegStatic;
            }
        } catch (error) {
            console.warn('[AudioChunker] Failed to load ffmpeg-static in dev:', error);
        }
    }

    // Fallback to system ffmpeg
    console.warn('[AudioChunker] Falling back to system ffmpeg');
    return 'ffmpeg';
}

/**
 * Get the path to the ffprobe binary
 * ffmpeg-static only provides ffmpeg, not ffprobe
 * For ffprobe, we always use the system binary
 */
function getFfprobePath(): string {
    // ffmpeg-static doesn't include ffprobe, so we use system ffprobe
    // If bundled ffmpeg is available, ffprobe should also be available in the same location
    try {
        const ffmpegPath = getFfmpegPath();
        if (ffmpegPath !== 'ffmpeg') {
            // Try to find ffprobe in the same directory as ffmpeg
            const ffmpegDir = path.dirname(ffmpegPath);
            const ffprobePath = path.join(ffmpegDir, 'ffprobe');

            if (fs.existsSync(ffprobePath)) {
                try {
                    fs.accessSync(ffprobePath, fs.constants.X_OK);
                    console.log('[AudioChunker] Using bundled ffprobe:', ffprobePath);
                    return ffprobePath;
                } catch {
                    // Not executable, fall through to system
                }
            }
        }
    } catch {
        // Error checking for bundled ffprobe, fall through to system
    }

    // Fallback to system ffprobe
    return 'ffprobe';
}

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
 * Check if ffmpeg is available (bundled or system)
 */
export async function isFfmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const ffmpegPath = getFfmpegPath();
        const ffmpeg = spawn(ffmpegPath, ['-version']);

        ffmpeg.on('error', () => {
            console.log('[AudioChunker] ffmpeg not available:', ffmpegPath);
            resolve(false);
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('[AudioChunker] ffmpeg available:', ffmpegPath);
            }
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
        const ffprobePath = getFfprobePath();
        const ffprobe = spawn(ffprobePath, [
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
        const ffmpegPath = getFfmpegPath();
        const ffmpeg = spawn(ffmpegPath, [
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

/**
 * Result of audio merge operation
 */
export interface MergeResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

/**
 * Merge two audio files (mic and system audio) into a single file
 *
 * Uses FFmpeg to:
 * 1. Resample both inputs to 48kHz
 * 2. Mix them into a single stereo output
 * 3. Output as WebM/Opus for transcription compatibility
 *
 * @param micPath - Path to microphone audio (WAV, any sample rate)
 * @param systemPath - Path to system audio (WAV, any sample rate)
 * @param outputPath - Path for the merged output file
 * @returns MergeResult with success status and output path
 */
export async function mergeAudioFiles(
    micPath: string | null,
    systemPath: string | null,
    outputPath: string
): Promise<MergeResult> {
    console.log('[AudioChunker] Merging audio files');
    console.log('[AudioChunker]   Mic:', micPath);
    console.log('[AudioChunker]   System:', systemPath);
    console.log('[AudioChunker]   Output:', outputPath);

    // Check if ffmpeg is available
    const ffmpegAvailable = await isFfmpegAvailable();
    if (!ffmpegAvailable) {
        return {
            success: false,
            error: 'ffmpeg not available'
        };
    }

    // Validate inputs - need at least one file
    const hasMic = micPath && fs.existsSync(micPath);
    const hasSystem = systemPath && fs.existsSync(systemPath);

    if (!hasMic && !hasSystem) {
        return {
            success: false,
            error: 'No audio files to merge'
        };
    }

    // Probe input files to log their actual properties
    const probeFile = async (filePath: string, label: string) => {
        return new Promise<void>((resolve) => {
            const ffprobePath = getFfprobePath();
            const ffprobe = spawn(ffprobePath, [
                '-v', 'error',
                '-select_streams', 'a:0',
                '-show_entries', 'stream=sample_rate,channels,duration',
                '-of', 'default=noprint_wrappers=1',
                filePath
            ]);
            let output = '';
            ffprobe.stdout.on('data', (data) => { output += data.toString(); });
            ffprobe.stderr.on('data', (data) => { output += data.toString(); });
            ffprobe.on('close', () => {
                console.log(`[AudioChunker] ${label} properties:`, output.trim().replace(/\n/g, ', '));
                resolve();
            });
            ffprobe.on('error', () => {
                console.log(`[AudioChunker] Failed to probe ${label}`);
                resolve();
            });
            setTimeout(() => { ffprobe.kill(); resolve(); }, 5000);
        });
    };

    // Probe both files
    if (hasMic) await probeFile(micPath!, 'Mic file');
    if (hasSystem) await probeFile(systemPath!, 'System file');

    // Create output directory if needed
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve) => {
        let ffmpegArgs: string[];

        if (hasMic && hasSystem) {
            // Merge both files
            // Use amix filter to combine, with duration=longest to keep all audio
            ffmpegArgs = [
                '-y',                           // Overwrite output
                '-i', micPath!,                 // Input 1: mic
                '-i', systemPath!,              // Input 2: system audio
                '-filter_complex',
                // Resample both to 48kHz, convert to stereo, then mix
                '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[mic];' +
                '[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[sys];' +
                '[mic][sys]amix=inputs=2:duration=longest:dropout_transition=0[out]',
                '-map', '[out]',
                '-c:a', 'libopus',              // Encode as Opus
                '-b:a', '128k',                 // 128kbps bitrate
                '-ar', '48000',                 // 48kHz sample rate
                outputPath
            ];
        } else if (hasMic) {
            // Only mic audio
            ffmpegArgs = [
                '-y',
                '-i', micPath!,
                '-af', 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-ar', '48000',
                outputPath
            ];
        } else {
            // Only system audio
            ffmpegArgs = [
                '-y',
                '-i', systemPath!,
                '-af', 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo',
                '-c:a', 'libopus',
                '-b:a', '128k',
                '-ar', '48000',
                outputPath
            ];
        }

        console.log('[AudioChunker] Running ffmpeg with args:', ffmpegArgs.join(' '));

        const ffmpegPath = getFfmpegPath();
        const ffmpeg = spawn(ffmpegPath, ffmpegArgs);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('error', (err) => {
            console.error('[AudioChunker] ffmpeg error:', err);
            resolve({
                success: false,
                error: `ffmpeg error: ${err.message}`
            });
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('[AudioChunker] Merge successful:', outputPath);
                resolve({
                    success: true,
                    outputPath
                });
            } else {
                console.error('[AudioChunker] ffmpeg failed with code:', code);
                console.error('[AudioChunker] stderr:', stderr);
                resolve({
                    success: false,
                    error: `ffmpeg exited with code ${code}: ${stderr.slice(-500)}`
                });
            }
        });

        // Timeout after 5 minutes for long recordings
        setTimeout(() => {
            console.error('[AudioChunker] ffmpeg merge timeout');
            ffmpeg.kill();
            resolve({
                success: false,
                error: 'ffmpeg merge timeout'
            });
        }, 300000);
    });
}

/**
 * Convert a single audio file to WebM/Opus format for transcription
 *
 * @param inputPath - Path to input audio file (any format FFmpeg supports)
 * @param outputPath - Path for the output WebM file
 * @returns MergeResult with success status and output path
 */
export async function convertToWebm(
    inputPath: string,
    outputPath: string
): Promise<MergeResult> {
    console.log('[AudioChunker] Converting to WebM:', inputPath, '->', outputPath);

    if (!fs.existsSync(inputPath)) {
        return {
            success: false,
            error: 'Input file not found'
        };
    }

    const ffmpegAvailable = await isFfmpegAvailable();
    if (!ffmpegAvailable) {
        return {
            success: false,
            error: 'ffmpeg not available'
        };
    }

    // Create output directory if needed
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve) => {
        const ffmpegPath = getFfmpegPath();
        const ffmpeg = spawn(ffmpegPath, [
            '-y',
            '-i', inputPath,
            '-af', 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo',
            '-c:a', 'libopus',
            '-b:a', '128k',
            '-ar', '48000',
            outputPath
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('error', (err) => {
            console.error('[AudioChunker] ffmpeg error:', err);
            resolve({
                success: false,
                error: `ffmpeg error: ${err.message}`
            });
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log('[AudioChunker] Conversion successful');
                resolve({
                    success: true,
                    outputPath
                });
            } else {
                console.error('[AudioChunker] ffmpeg conversion failed:', code, stderr.slice(-500));
                resolve({
                    success: false,
                    error: `ffmpeg exited with code ${code}`
                });
            }
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            ffmpeg.kill();
            resolve({
                success: false,
                error: 'ffmpeg conversion timeout'
            });
        }, 300000);
    });
}
