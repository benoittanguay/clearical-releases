/**
 * Audio Recording Context
 *
 * Manages automatic audio recording when mic/camera is detected in use.
 * Listens for events from the main process and handles the recording lifecycle.
 *
 * Flow:
 * 1. Main process detects mic/camera in use
 * 2. Main sends EVENT_RECORDING_SHOULD_START to renderer
 * 3. This context starts MediaRecorder capture
 * 4. Main detects mic/camera stopped
 * 5. Main sends EVENT_RECORDING_SHOULD_STOP to renderer
 * 6. This context stops recording and sends audio for transcription
 * 7. Transcription result is stored in the time entry
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useStorage } from './StorageContext';
import type { EntryTranscription, PendingTranscription } from '../types/shared';

interface AudioRecordingState {
    isRecording: boolean;
    currentEntryId: string | null;
    recordingStartTime: number | null;
    error: string | null;
}

interface TranscriptionProgress {
    entryId: string;
    status: 'recording' | 'transcribing' | 'complete' | 'error';
    error?: string;
}

interface AudioRecordingContextValue {
    state: AudioRecordingState;
    transcriptionProgress: TranscriptionProgress | null;
    isAutoRecordEnabled: boolean;
    setAutoRecordEnabled: (enabled: boolean) => void;
    /**
     * Get pending transcription for a session ID (merged if multiple)
     * Used to retrieve transcription when entry is created
     * @deprecated Use getPendingTranscriptions for separate recordings
     */
    getPendingTranscription: (sessionId: string) => EntryTranscription | null;
    /**
     * Get all pending transcriptions for a session ID (as separate entries)
     * Each recording session is returned as a separate transcription
     */
    getPendingTranscriptions: (sessionId: string) => EntryTranscription[];
    /**
     * Clear pending transcription after it's been applied
     */
    clearPendingTranscription: (sessionId: string) => void;
    /**
     * Wait for transcription to complete for a session ID
     * Returns the transcription if completed successfully within timeout, null otherwise
     * @deprecated Use waitForTranscriptions for separate recordings
     */
    waitForTranscription: (sessionId: string, timeoutMs?: number) => Promise<EntryTranscription | null>;
    /**
     * Wait for transcriptions to complete for a session ID
     * Returns array of transcriptions (one per recording) if completed successfully within timeout
     */
    waitForTranscriptions: (sessionId: string, timeoutMs?: number) => Promise<EntryTranscription[]>;
    /**
     * Get pending audio info for a session/entry ID (when transcription failed but audio was saved)
     */
    getPendingAudio: (sessionId: string) => PendingTranscription | null;
    /**
     * Retry transcription for saved audio file
     */
    retryTranscription: (entryId: string, audioPath: string, mimeType: string) => Promise<EntryTranscription | null>;
    /**
     * Clear pending audio after it's been handled
     */
    clearPendingAudio: (sessionId: string) => void;
}

const AudioRecordingContext = createContext<AudioRecordingContextValue | null>(null);

export function useAudioRecording(): AudioRecordingContextValue {
    const context = useContext(AudioRecordingContext);
    if (!context) {
        throw new Error('useAudioRecording must be used within AudioRecordingProvider');
    }
    return context;
}

interface AudioRecordingProviderProps {
    children: React.ReactNode;
}

export function AudioRecordingProvider({ children }: AudioRecordingProviderProps): React.ReactElement {
    const { updateEntry } = useStorage();

    const [state, setState] = useState<AudioRecordingState>({
        isRecording: false,
        currentEntryId: null,
        recordingStartTime: null,
        error: null,
    });

    const [transcriptionProgress, setTranscriptionProgress] = useState<TranscriptionProgress | null>(null);
    const [isAutoRecordEnabled, setIsAutoRecordEnabled] = useState(true);
    // Store pending transcriptions by session ID for later association with entries
    // Uses array to support multiple recordings per session (e.g., multiple meetings during one timer session)
    const pendingTranscriptionsRef = useRef<Map<string, EntryTranscription[]>>(new Map());
    // Store pending audio files (when transcription failed) for later retry
    const pendingAudioRef = useRef<Map<string, PendingTranscription>>(new Map());

    // Cleanup old pending transcriptions to prevent memory leaks
    // Transcriptions older than 5 minutes are likely orphaned (entry was never created)
    const PENDING_TRANSCRIPTION_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
    useEffect(() => {
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;

            // Clean up old transcriptions
            for (const [sessionId, transcriptions] of pendingTranscriptionsRef.current.entries()) {
                // Check if all transcriptions for this session are old
                const allOld = transcriptions.every(t => now - t.createdAt > PENDING_TRANSCRIPTION_MAX_AGE_MS);
                if (allOld) {
                    pendingTranscriptionsRef.current.delete(sessionId);
                    cleanedCount++;
                }
            }

            // Clean up old pending audio
            for (const [sessionId, pending] of pendingAudioRef.current.entries()) {
                const attemptedAt = pending.attemptedAt ?? 0;
                if (now - attemptedAt > PENDING_TRANSCRIPTION_MAX_AGE_MS) {
                    pendingAudioRef.current.delete(sessionId);
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                console.log(`[AudioRecordingContext] Cleaned up ${cleanedCount} old pending transcriptions/audio`);
            }
        }, 60000); // Check every minute

        return () => clearInterval(cleanupInterval);
    }, []);

    // MediaRecorder refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    // Audio analysis refs for waveform visualization
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioLevelIntervalRef = useRef<number | null>(null);

    // System audio capture refs
    const systemAudioBufferRef = useRef<Float32Array[]>([]);
    const systemAudioUnsubscribeRef = useRef<(() => void) | null>(null);
    const isSystemAudioActiveRef = useRef<boolean>(false);

    // Native mic capture refs (bypasses getUserMedia limitations)
    const nativeMicBufferRef = useRef<Float32Array[]>([]);
    const nativeMicUnsubscribeRef = useRef<(() => void) | null>(null);
    const isNativeMicActiveRef = useRef<boolean>(false);

    // AudioWorklet node ref for mixing audio on dedicated thread
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);

    // File-based recording paths (direct WAV recording, no resampling)
    const micFilePathRef = useRef<string | null>(null);
    const systemFilePathRef = useRef<string | null>(null);
    const isFileRecordingActiveRef = useRef<boolean>(false);

    // Silence detection for meeting end
    const silenceStartTimeRef = useRef<number | null>(null);
    const silenceConfirmationShownRef = useRef<boolean>(false);
    // Note: Using time domain deviation (< 3) instead of frequency threshold for more reliable silence detection
    const SILENCE_DURATION_FOR_PROMPT = 10000; // 10 seconds of silence = ask user if meeting ended

    // CRITICAL: Synchronous lock to prevent race conditions when multiple START events arrive
    // This is set immediately (synchronously) before any async operations
    const isStartingRecordingRef = useRef<boolean>(false);

    // CRITICAL: Synchronous lock to prevent race conditions when multiple STOP events arrive
    // Prevents duplicate transcriptions if stop is called twice before onstop fires
    const isStoppingRecordingRef = useRef<boolean>(false);

    // CRITICAL: Refs to hold current callbacks to avoid useEffect re-registration race condition
    // When stopRecordingAndTranscribe changes (due to updateEntry dependency), we don't want
    // to re-register event listeners as this creates a window where START events are missed
    const startRecordingRef = useRef<((entryId: string) => Promise<void>) | null>(null);
    const stopRecordingAndTranscribeRef = useRef<((entryId: string) => Promise<void>) | null>(null);

    /**
     * Start audio recording
     * Uses native mic capture (AVFoundation) to bypass getUserMedia limitations
     * when Chrome/other apps have exclusive microphone access
     */
    const startRecording = useCallback(async (entryId: string) => {
        console.log('[AudioRecordingContext] ========================================');
        console.log('[AudioRecordingContext] startRecording CALLED');
        console.log('[AudioRecordingContext] entryId:', entryId);
        console.log('[AudioRecordingContext] Current state:', state);
        console.log('[AudioRecordingContext] ========================================');

        // CRITICAL: Synchronous lock check BEFORE any async operations
        // This prevents race conditions when two START events arrive nearly simultaneously
        if (isStartingRecordingRef.current) {
            console.log('[AudioRecordingContext] *** GUARD: Already starting recording, ignoring duplicate start ***');
            return;
        }

        // CRITICAL: Guard against multiple parallel recordings
        // This prevents corrupted audio when duplicate START events are received
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            console.log('[AudioRecordingContext] *** GUARD: Already recording, ignoring duplicate start ***');
            return;
        }

        // Set lock immediately (synchronously) before any async work
        isStartingRecordingRef.current = true;
        console.log('[AudioRecordingContext] Lock acquired, starting recording setup...');

        try {
            console.log('[AudioRecordingContext] Setting up native audio capture...');

            // Reset buffers
            audioChunksRef.current = [];
            nativeMicBufferRef.current = [];
            systemAudioBufferRef.current = [];

            // Set up Web Audio API for mixing mic + system audio
            const audioContext = new AudioContext({ sampleRate: 48000 });
            console.log('[AudioRecordingContext] AudioContext state:', audioContext.state);
            console.log('[AudioRecordingContext] AudioContext sampleRate:', audioContext.sampleRate);

            // Resume AudioContext if suspended (required for some browsers/Electron versions)
            if (audioContext.state === 'suspended') {
                console.log('[AudioRecordingContext] AudioContext is suspended, attempting to resume...');
                await audioContext.resume();
                console.log('[AudioRecordingContext] AudioContext state after resume:', audioContext.state);
            }

            // Load AudioWorklet module for glitch-free audio mixing
            // The worklet runs on a dedicated audio thread, avoiding main thread timing issues
            // Use relative path './' for compatibility with Electron production builds (file:// protocol)
            try {
                await audioContext.audioWorklet.addModule('./audio-mixer-worklet.js');
                console.log('[AudioRecordingContext] AudioWorklet module loaded successfully');
            } catch (workletError) {
                console.error('[AudioRecordingContext] Failed to load AudioWorklet module:', workletError);
                throw new Error('Failed to load audio mixer worklet');
            }

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.4;

            // Create a destination for the mixed audio
            const destination = audioContext.createMediaStreamDestination();

            // Create AudioWorkletNode for mixing mic + system audio
            const mixerNode = new AudioWorkletNode(audioContext, 'audio-mixer-processor', {
                numberOfInputs: 0,  // We'll push samples via port.postMessage
                numberOfOutputs: 1,
                outputChannelCount: [2],  // Stereo output
            });

            // Listen for stats from the worklet
            mixerNode.port.onmessage = (event) => {
                if (event.data.type === 'stats') {
                    console.log('[AudioRecordingContext] Worklet stats:', event.data);
                }
            };

            // Connect worklet to analyser and destination
            mixerNode.connect(analyser);
            mixerNode.connect(destination);
            audioWorkletNodeRef.current = mixerNode;
            console.log('[AudioRecordingContext] AudioWorkletNode created and connected');

            // ============================================================
            // NATIVE MICROPHONE CAPTURE (via AVFoundation)
            // This bypasses getUserMedia limitations when Chrome has exclusive mic access
            // ============================================================
            let nativeMicStarted = false;
            try {
                const isMicAvailable = await window.electron?.ipcRenderer?.meeting?.isMicCaptureAvailable?.();
                console.log('[AudioRecordingContext] Native mic capture available:', isMicAvailable);

                if (isMicAvailable) {
                    // Reset native mic buffer
                    nativeMicBufferRef.current = [];
                    isNativeMicActiveRef.current = true;

                    // Subscribe to native mic audio samples and forward to AudioWorklet
                    let nativeMicReceivedCount = 0;
                    const unsubscribeMic = window.electron?.ipcRenderer?.meeting?.onMicAudioSamples?.(
                        (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number; detectedRate?: number; rateDetected?: boolean; resampling?: boolean }) => {
                            nativeMicReceivedCount++;
                            // Log every 100th callback with sample analysis
                            if (nativeMicReceivedCount % 100 === 1) {
                                let micRms = 0;
                                let micPeak = 0;
                                const samples = data.samples;
                                if (samples && samples.length > 0) {
                                    for (let i = 0; i < samples.length; i++) {
                                        micRms += samples[i] * samples[i];
                                        const absVal = Math.abs(samples[i]);
                                        if (absVal > micPeak) micPeak = absVal;
                                    }
                                    micRms = Math.sqrt(micRms / samples.length);
                                }
                                console.log(`[AudioRecordingContext] NATIVE MIC #${nativeMicReceivedCount}: sampleRate=${data.sampleRate}, sampleCount=${data.sampleCount}, channels=${data.channelCount}, rms=${micRms.toFixed(6)}, peak=${micPeak.toFixed(6)}, detectedRate=${data.detectedRate ?? 'N/A'}, rateDetected=${data.rateDetected ?? false}, resampling=${data.resampling ?? false}`);
                            }
                            // Forward samples to AudioWorklet for mixing
                            if (isNativeMicActiveRef.current && audioWorkletNodeRef.current) {
                                audioWorkletNodeRef.current.port.postMessage({
                                    type: 'mic',
                                    samples: data.samples
                                });
                            }
                            // Also keep buffer ref updated for silence detection RMS check
                            if (isNativeMicActiveRef.current) {
                                nativeMicBufferRef.current.push(data.samples);
                                // Keep buffer limited to ~1 second of audio
                                while (nativeMicBufferRef.current.length > 50) {
                                    nativeMicBufferRef.current.shift();
                                }
                            }
                        }
                    );
                    nativeMicUnsubscribeRef.current = unsubscribeMic || null;

                    // Start the native mic capture
                    const micResult = await window.electron?.ipcRenderer?.meeting?.startMicCapture?.();
                    nativeMicStarted = micResult?.success ?? false;
                    console.log('[AudioRecordingContext] Native mic capture started:', nativeMicStarted, micResult?.error || '');

                    if (nativeMicStarted) {
                        console.log('[AudioRecordingContext] Native mic audio will be forwarded to AudioWorklet');
                    }
                } else {
                    console.warn('[AudioRecordingContext] Native mic capture not available - recording may not capture user voice');
                }
            } catch (micError) {
                console.warn('[AudioRecordingContext] Native mic capture error:', micError);
            }

            // ============================================================
            // SYSTEM AUDIO CAPTURE (via ScreenCaptureKit)
            // Captures what others say in video calls
            // ============================================================
            let systemAudioStarted = false;
            try {
                const isAvailable = await window.electron?.ipcRenderer?.meeting?.isSystemAudioAvailable?.();
                console.log('[AudioRecordingContext] System audio available:', isAvailable);

                if (isAvailable) {
                    // Reset system audio buffer
                    systemAudioBufferRef.current = [];
                    isSystemAudioActiveRef.current = true;

                    // Subscribe to system audio samples
                    let systemAudioReceivedCount = 0;
                    const unsubscribe = window.electron?.ipcRenderer?.meeting?.onSystemAudioSamples?.(
                        (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number }) => {
                            systemAudioReceivedCount++;
                            // Log every 100th callback with sample analysis
                            if (systemAudioReceivedCount % 100 === 1) {
                                let sysRms = 0;
                                let sysPeak = 0;
                                const samples = data.samples;
                                if (samples && samples.length > 0) {
                                    for (let i = 0; i < samples.length; i++) {
                                        sysRms += samples[i] * samples[i];
                                        const absVal = Math.abs(samples[i]);
                                        if (absVal > sysPeak) sysPeak = absVal;
                                    }
                                    sysRms = Math.sqrt(sysRms / samples.length);
                                }
                                console.log(`[AudioRecordingContext] SYSTEM AUDIO #${systemAudioReceivedCount}: sampleCount=${data.sampleCount}, rms=${sysRms.toFixed(6)}, peak=${sysPeak.toFixed(6)}, samples[0-3]=[${samples?.[0]?.toFixed(6)}, ${samples?.[1]?.toFixed(6)}, ${samples?.[2]?.toFixed(6)}, ${samples?.[3]?.toFixed(6)}]`);
                            }
                            // Buffer the incoming samples
                            if (isSystemAudioActiveRef.current) {
                                systemAudioBufferRef.current.push(data.samples);
                                // Keep buffer limited to ~1 second of audio
                                while (systemAudioBufferRef.current.length > 50) {
                                    systemAudioBufferRef.current.shift();
                                }
                            }
                        }
                    );
                    systemAudioUnsubscribeRef.current = unsubscribe || null;

                    // Start the capture
                    const result = await window.electron?.ipcRenderer?.meeting?.startSystemAudioCapture?.();
                    systemAudioStarted = result?.success ?? false;
                    console.log('[AudioRecordingContext] System audio capture started:', systemAudioStarted);

                    if (systemAudioStarted) {
                        // Update the system audio callback to forward samples to AudioWorklet
                        // The worklet handles mixing on a dedicated audio thread for glitch-free playback
                        let sysAudioForwardedCount = 0;

                        // Replace the existing callback with one that forwards to the worklet
                        systemAudioUnsubscribeRef.current?.();
                        const unsubscribeSystem = window.electron?.ipcRenderer?.meeting?.onSystemAudioSamples?.(
                            (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number; detectedRate?: number; rateDetected?: boolean; resampling?: boolean }) => {
                                sysAudioForwardedCount++;
                                // Log every 100th callback
                                if (sysAudioForwardedCount % 100 === 1) {
                                    let sysRms = 0;
                                    let sysPeak = 0;
                                    const samples = data.samples;
                                    if (samples && samples.length > 0) {
                                        for (let i = 0; i < samples.length; i++) {
                                            sysRms += samples[i] * samples[i];
                                            const absVal = Math.abs(samples[i]);
                                            if (absVal > sysPeak) sysPeak = absVal;
                                        }
                                        sysRms = Math.sqrt(sysRms / samples.length);
                                    }
                                    console.log(`[AudioRecordingContext] SYSTEM AUDIO FORWARDED #${sysAudioForwardedCount}: sampleRate=${data.sampleRate}, sampleCount=${data.sampleCount}, channels=${data.channelCount}, rms=${sysRms.toFixed(6)}, peak=${sysPeak.toFixed(6)}, detectedRate=${data.detectedRate ?? 'N/A'}, rateDetected=${data.rateDetected ?? false}, resampling=${data.resampling ?? false}`);
                                }

                                // Forward samples to AudioWorklet for mixing
                                if (isSystemAudioActiveRef.current && audioWorkletNodeRef.current) {
                                    audioWorkletNodeRef.current.port.postMessage({
                                        type: 'system',
                                        samples: data.samples,
                                        channelCount: data.channelCount
                                    });
                                }

                                // Also keep buffer ref updated for silence detection RMS check
                                if (isSystemAudioActiveRef.current) {
                                    systemAudioBufferRef.current.push(data.samples);
                                    // Keep buffer limited to ~1 second of audio
                                    while (systemAudioBufferRef.current.length > 50) {
                                        systemAudioBufferRef.current.shift();
                                    }
                                }
                            }
                        );
                        systemAudioUnsubscribeRef.current = unsubscribeSystem || null;
                        console.log('[AudioRecordingContext] System audio forwarding to AudioWorklet configured');
                    }
                }
            } catch (sysAudioError) {
                console.warn('[AudioRecordingContext] System audio capture not available:', sysAudioError);
            }

            // Check if we have at least one audio source
            if (!nativeMicStarted && !systemAudioStarted) {
                throw new Error('No audio capture available - neither native mic nor system audio could be started');
            }

            // ============================================================
            // FILE-BASED RECORDING (direct WAV, no resampling)
            // This records to separate files for post-processing with FFmpeg
            // ============================================================
            try {
                // Generate unique file paths for this recording session
                const timestamp = Date.now();
                const tempDir = await window.electron?.ipcRenderer?.invoke?.('get-temp-path') || '/tmp';
                const micFilePath = `${tempDir}/clearical-mic-${timestamp}.wav`;
                const systemFilePath = `${tempDir}/clearical-system-${timestamp}.wav`;

                console.log('[AudioRecordingContext] Starting file-based recording...');
                console.log('[AudioRecordingContext]   Mic file:', micFilePath);
                console.log('[AudioRecordingContext]   System file:', systemFilePath);

                const fileResult = await window.electron?.ipcRenderer?.meeting?.startFileRecording?.(
                    nativeMicStarted ? micFilePath : '',
                    systemAudioStarted ? systemFilePath : ''
                );

                if (fileResult?.success) {
                    micFilePathRef.current = nativeMicStarted ? micFilePath : null;
                    systemFilePathRef.current = systemAudioStarted ? systemFilePath : null;
                    isFileRecordingActiveRef.current = true;
                    console.log('[AudioRecordingContext] File recording started successfully');
                } else {
                    console.warn('[AudioRecordingContext] File recording failed to start:', fileResult);
                    // Continue anyway - MediaRecorder is the fallback
                }
            } catch (fileError) {
                console.warn('[AudioRecordingContext] File recording error:', fileError);
                // Continue anyway - MediaRecorder is the fallback
            }

            // Use the mixed destination stream for recording
            const recordingStream = destination.stream;

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;

            // Start sending audio levels to the widget
            const NUM_BARS = 24;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let audioLevelsSentCount = 0;
            silenceStartTimeRef.current = null; // Reset silence detection
            const recordingStartTimestamp = Date.now(); // For waveform sync

            // Also get time domain data for raw waveform analysis
            const timeDomainArray = new Uint8Array(analyser.frequencyBinCount);

            audioLevelIntervalRef.current = window.setInterval(() => {
                if (analyserRef.current) {
                    analyserRef.current.getByteFrequencyData(dataArray);
                    analyserRef.current.getByteTimeDomainData(timeDomainArray);

                    // Convert to normalized levels (0-1)
                    const levels: number[] = [];
                    let averageLevel = 0;
                    for (let i = 0; i < NUM_BARS; i++) {
                        // Map frequency bins to bars
                        const binIndex = Math.floor(i * dataArray.length / NUM_BARS);
                        const level = dataArray[binIndex] / 255;
                        levels.push(Math.max(0.05, level)); // Minimum level for visibility
                        averageLevel += level;
                    }
                    averageLevel /= NUM_BARS;

                    // Calculate time domain deviation from center (128 = silence)
                    let timeDomainMax = 0;
                    let timeDomainMin = 255;
                    for (let i = 0; i < timeDomainArray.length; i++) {
                        if (timeDomainArray[i] > timeDomainMax) timeDomainMax = timeDomainArray[i];
                        if (timeDomainArray[i] < timeDomainMin) timeDomainMin = timeDomainArray[i];
                    }
                    const timeDomainDeviation = Math.max(timeDomainMax - 128, 128 - timeDomainMin);

                    // Use time domain for silence detection (more reliable than frequency)
                    const isSystemAudioSilent = timeDomainDeviation < 3; // Very little deviation from center

                    // Also check if native mic has recent audio activity
                    // This prevents false silence detection when Chrome has exclusive system audio
                    let isMicActive = false;
                    if (nativeMicBufferRef.current.length > 0) {
                        // Check the most recent mic buffer chunk for audio activity
                        const recentMicChunk = nativeMicBufferRef.current[nativeMicBufferRef.current.length - 1];
                        if (recentMicChunk && recentMicChunk.length > 0) {
                            // Calculate RMS (root mean square) to detect audio activity
                            let sumSquares = 0;
                            for (let i = 0; i < Math.min(recentMicChunk.length, 1000); i++) {
                                sumSquares += recentMicChunk[i] * recentMicChunk[i];
                            }
                            const rms = Math.sqrt(sumSquares / Math.min(recentMicChunk.length, 1000));
                            // If RMS is above threshold, mic has audio (threshold ~0.01 for speech)
                            isMicActive = rms > 0.005;
                        }
                    }

                    // Only consider truly silent if BOTH system audio AND mic are silent
                    const isTrulySilent = isSystemAudioSilent && !isMicActive;

                    // Silence detection for meeting end
                    if (isTrulySilent) {
                        if (silenceStartTimeRef.current === null) {
                            silenceStartTimeRef.current = Date.now();
                            silenceConfirmationShownRef.current = false;
                            console.log('[AudioRecordingContext] Silence detected (sysAudio silent + mic inactive), starting timer...');
                        } else {
                            const silenceDuration = Date.now() - silenceStartTimeRef.current;
                            // Log every 5 seconds of silence
                            if (silenceDuration > 0 && silenceDuration % 5000 < 50) {
                                console.log('[AudioRecordingContext] Silence duration:', Math.floor(silenceDuration / 1000), 'seconds');
                            }
                            // Check if we've reached the silence threshold - show confirmation
                            if (silenceDuration >= SILENCE_DURATION_FOR_PROMPT && !silenceConfirmationShownRef.current) {
                                console.log('[AudioRecordingContext] *** SILENCE THRESHOLD REACHED - Asking user if meeting ended ***');
                                silenceConfirmationShownRef.current = true;
                                // Signal to main process to show confirmation dialog
                                window.electron?.ipcRenderer?.send?.('meeting:silence-detected', {
                                    entryId,
                                    silenceDuration,
                                    askConfirmation: true,
                                });
                            }
                        }
                    } else {
                        // Reset silence timer when audio is detected (either system audio or mic)
                        if (silenceStartTimeRef.current !== null) {
                            const reason = isMicActive ? 'mic active' : 'system audio detected';
                            console.log('[AudioRecordingContext] Audio detected (' + reason + '), resetting silence timer');
                            silenceConfirmationShownRef.current = false;
                        }
                        silenceStartTimeRef.current = null;
                    }

                    // Send to main process to forward to widget
                    const sendFn = window.electron?.ipcRenderer?.meeting?.sendAudioLevels;
                    if (sendFn) {
                        const elapsedMs = Date.now() - recordingStartTimestamp;
                        sendFn(levels, elapsedMs);
                        audioLevelsSentCount++;
                        // Log every 100 sends (~5 seconds)
                        if (audioLevelsSentCount % 100 === 1) {
                            // Log raw frequency data for debugging
                            const maxVal = Math.max(...Array.from(dataArray));
                            const minVal = Math.min(...Array.from(dataArray));
                            console.log('[AudioRecordingContext] ANALYSER DATA #' + audioLevelsSentCount + ':',
                                'freqMax:', maxVal, 'freqMin:', minVal,
                                'timeMax:', timeDomainMax, 'timeMin:', timeDomainMin, 'timeDev:', timeDomainDeviation,
                                'avg:', averageLevel.toFixed(3),
                                'sysAudioSilent:', isSystemAudioSilent, 'micActive:', isMicActive, 'trulySilent:', isTrulySilent);
                        }
                    } else if (audioLevelsSentCount === 0) {
                        console.error('[AudioRecordingContext] sendAudioLevels function not available!');
                        audioLevelsSentCount = -1; // Only log once
                    }
                }
            }, 50); // Update at ~20fps

            // Create MediaRecorder with appropriate MIME type
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4';

            console.log('[AudioRecordingContext] MediaRecorder mimeType:', mimeType);
            console.log('[AudioRecordingContext] Recording stream tracks:', recordingStream.getAudioTracks().length);
            const recTrack = recordingStream.getAudioTracks()[0];
            if (recTrack) {
                console.log('[AudioRecordingContext] Recording track enabled:', recTrack.enabled);
                console.log('[AudioRecordingContext] Recording track muted:', recTrack.muted);
                console.log('[AudioRecordingContext] Recording track readyState:', recTrack.readyState);
            }

            const mediaRecorder = new MediaRecorder(recordingStream, {
                mimeType,
                audioBitsPerSecond: 128000,
            });

            let dataChunkCount = 0;
            mediaRecorder.ondataavailable = (event) => {
                dataChunkCount++;
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                    // Log every 10 chunks (~10 seconds)
                    if (dataChunkCount % 10 === 1) {
                        console.log('[AudioRecordingContext] MediaRecorder data chunk #' + dataChunkCount + ', size:', event.data.size, 'bytes, total chunks:', audioChunksRef.current.length);
                    }
                } else {
                    console.warn('[AudioRecordingContext] MediaRecorder got empty chunk #' + dataChunkCount);
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('[AudioRecordingContext] MediaRecorder error:', event);
                setState(prev => ({
                    ...prev,
                    error: 'Recording error occurred',
                }));
            };

            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.start(1000); // Collect data every second

            setState({
                isRecording: true,
                currentEntryId: entryId,
                recordingStartTime: Date.now(),
                error: null,
            });

            setTranscriptionProgress({
                entryId,
                status: 'recording',
            });

            console.log('[AudioRecordingContext] Recording started successfully');

            // Release lock after recording has successfully started
            isStartingRecordingRef.current = false;
        } catch (error) {
            console.error('[AudioRecordingContext] Failed to start recording:', error);

            // CRITICAL: Release lock on error so future attempts can proceed
            isStartingRecordingRef.current = false;

            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to access microphone',
            }));

            // Notify main process that recording failed to start
            try {
                window.electron?.ipcRenderer?.send?.('meeting:recording-failed', {
                    entryId,
                    error: error instanceof Error ? error.message : 'Failed to start recording',
                    timestamp: Date.now(),
                });
            } catch (ipcError) {
                console.error('[AudioRecordingContext] Failed to notify main process of recording failure:', ipcError);
            }
        }
    }, []);

    /**
     * Stop recording and transcribe
     */
    const stopRecordingAndTranscribe = useCallback(async (entryId: string) => {
        console.log('[AudioRecordingContext] Stopping recording for entry:', entryId);

        // CRITICAL: Synchronous lock check BEFORE any async operations
        // This prevents race conditions when two STOP events arrive nearly simultaneously
        // Without this guard, both calls would capture the same chunks and create duplicate transcriptions
        if (isStoppingRecordingRef.current) {
            console.log('[AudioRecordingContext] *** GUARD: Already stopping recording, ignoring duplicate stop ***');
            return;
        }

        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
            console.log('[AudioRecordingContext] No active recording to stop');
            return;
        }

        // Set lock immediately (synchronously) before any async work
        isStoppingRecordingRef.current = true;
        console.log('[AudioRecordingContext] Stop lock acquired, stopping recording...');

        // CRITICAL: Capture chunks and mimeType BEFORE calling stop() to prevent race condition
        // If a new recording starts before onstop fires, audioChunksRef would be reset
        const capturedChunks = [...audioChunksRef.current];
        const capturedMimeType = mediaRecorderRef.current.mimeType || 'audio/webm';
        console.log('[AudioRecordingContext] Captured', capturedChunks.length, 'chunks before stop, mimeType:', capturedMimeType);

        return new Promise<void>((resolve) => {
            mediaRecorderRef.current!.onstop = async () => {
                // Stop audio level analysis
                if (audioLevelIntervalRef.current) {
                    clearInterval(audioLevelIntervalRef.current);
                    audioLevelIntervalRef.current = null;
                }
                // Fully close AudioContext to release audio resources
                // This is critical for Bluetooth headsets to switch back to A2DP codec
                if (audioContextRef.current) {
                    try {
                        await audioContextRef.current.close();
                        console.log('[AudioRecordingContext] AudioContext closed successfully');
                    } catch (e) {
                        console.warn('[AudioRecordingContext] Error closing AudioContext:', e);
                    }
                    audioContextRef.current = null;
                }
                analyserRef.current = null;

                // Clean up AudioWorkletNode
                if (audioWorkletNodeRef.current) {
                    try {
                        // Tell worklet to clear its buffers
                        audioWorkletNodeRef.current.port.postMessage({ type: 'clear' });
                        audioWorkletNodeRef.current.disconnect();
                        console.log('[AudioRecordingContext] AudioWorkletNode disconnected');
                    } catch (e) {
                        console.warn('[AudioRecordingContext] Error disconnecting AudioWorkletNode:', e);
                    }
                    audioWorkletNodeRef.current = null;
                }

                // Stop all tracks
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }

                // Stop native mic capture
                if (isNativeMicActiveRef.current) {
                    isNativeMicActiveRef.current = false;
                    nativeMicBufferRef.current = [];
                    if (nativeMicUnsubscribeRef.current) {
                        nativeMicUnsubscribeRef.current();
                        nativeMicUnsubscribeRef.current = null;
                    }
                    try {
                        await window.electron?.ipcRenderer?.meeting?.stopMicCapture?.();
                        console.log('[AudioRecordingContext] Native mic capture stopped');
                    } catch (e) {
                        console.warn('[AudioRecordingContext] Error stopping native mic capture:', e);
                    }
                }

                // Stop system audio capture
                if (isSystemAudioActiveRef.current) {
                    isSystemAudioActiveRef.current = false;
                    systemAudioBufferRef.current = [];
                    if (systemAudioUnsubscribeRef.current) {
                        systemAudioUnsubscribeRef.current();
                        systemAudioUnsubscribeRef.current = null;
                    }
                    try {
                        await window.electron?.ipcRenderer?.meeting?.stopSystemAudioCapture?.();
                        console.log('[AudioRecordingContext] System audio capture stopped');
                    } catch (e) {
                        console.warn('[AudioRecordingContext] Error stopping system audio capture:', e);
                    }
                }

                // Reset silence detection
                silenceStartTimeRef.current = null;
                silenceConfirmationShownRef.current = false;

                // ============================================================
                // STOP FILE-BASED RECORDING AND MERGE
                // ============================================================
                let mergedFilePath: string | null = null;
                if (isFileRecordingActiveRef.current) {
                    try {
                        console.log('[AudioRecordingContext] Stopping file-based recording...');
                        const fileResult = await window.electron?.ipcRenderer?.meeting?.stopFileRecording?.();
                        console.log('[AudioRecordingContext] File recording stopped:', fileResult);

                        isFileRecordingActiveRef.current = false;

                        // Merge the files with FFmpeg
                        if (fileResult?.success && (fileResult.mic?.filePath || fileResult.system?.filePath)) {
                            const tempDir = await window.electron?.ipcRenderer?.invoke?.('get-temp-path') || '/tmp';
                            const outputPath = `${tempDir}/clearical-merged-${Date.now()}.webm`;

                            console.log('[AudioRecordingContext] Merging audio files with FFmpeg...');
                            console.log('[AudioRecordingContext]   Mic:', fileResult.mic?.filePath);
                            console.log('[AudioRecordingContext]   System:', fileResult.system?.filePath);
                            console.log('[AudioRecordingContext]   Output:', outputPath);

                            const mergeResult = await window.electron?.ipcRenderer?.meeting?.mergeAudioFiles?.(
                                fileResult.mic?.filePath || null,
                                fileResult.system?.filePath || null,
                                outputPath
                            );

                            if (mergeResult?.success && mergeResult.outputPath) {
                                mergedFilePath = mergeResult.outputPath;
                                console.log('[AudioRecordingContext] Audio merge successful:', mergedFilePath);
                            } else {
                                console.warn('[AudioRecordingContext] Audio merge failed:', mergeResult?.error);
                            }
                        }
                    } catch (fileError) {
                        console.error('[AudioRecordingContext] Error stopping file recording:', fileError);
                    }

                    // Clean up file path refs
                    micFilePathRef.current = null;
                    systemFilePathRef.current = null;
                }

                // Create blob from captured chunks (fallback if file-based recording failed)
                const audioBlob = new Blob(capturedChunks, { type: capturedMimeType });

                console.log('[AudioRecordingContext] Recording stopped');
                console.log('[AudioRecordingContext]   Merged file:', mergedFilePath);
                console.log('[AudioRecordingContext]   Fallback blob size:', audioBlob.size);

                setState({
                    isRecording: false,
                    currentEntryId: null,
                    recordingStartTime: null,
                    error: null,
                });

                // Check minimum duration (5 seconds)
                const duration = audioBlob.size > 0 ? (capturedChunks.length * 1000) : 0;
                if (!mergedFilePath && (duration < 5000 || audioBlob.size < 1000)) {
                    console.log('[AudioRecordingContext] Recording too short, skipping transcription');
                    setTranscriptionProgress(null);
                    resolve();
                    return;
                }

                // Start transcription
                setTranscriptionProgress({
                    entryId,
                    status: 'transcribing',
                });

                try {
                    let result;

                    // Prefer file-based recording if available
                    if (mergedFilePath) {
                        console.log('[AudioRecordingContext] Transcribing merged file:', mergedFilePath);
                        // Use file path directly for transcription
                        result = await window.electron.ipcRenderer.meeting.saveAudioAndTranscribe(
                            entryId,
                            mergedFilePath, // Pass file path instead of base64
                            'audio/webm', // FFmpeg outputs WebM
                            true // Flag to indicate this is a file path
                        );
                    } else {
                        // Fallback to MediaRecorder blob
                        console.log('[AudioRecordingContext] Transcribing fallback blob...');
                        const arrayBuffer = await audioBlob.arrayBuffer();
                        const uint8Array = new Uint8Array(arrayBuffer);
                        let binary = '';
                        for (let i = 0; i < uint8Array.length; i++) {
                            binary += String.fromCharCode(uint8Array[i]);
                        }
                        const audioBase64 = btoa(binary);

                        // Send to main process for transcription
                        result = await window.electron.ipcRenderer.meeting.saveAudioAndTranscribe(
                            entryId,
                            audioBase64,
                            capturedMimeType
                        );
                    }

                    if (result.success && result.transcription) {
                        console.log('[AudioRecordingContext] Transcription complete:', result.transcription.wordCount, 'words');

                        // Create transcription data
                        const transcription: EntryTranscription = {
                            transcriptionId: result.transcription.transcriptionId,
                            fullText: result.transcription.fullText,
                            segments: result.transcription.segments,
                            language: result.transcription.language,
                            audioDuration: result.transcription.duration,
                            wordCount: result.transcription.wordCount,
                            createdAt: Date.now(),
                        };

                        // Store pending transcription - it will be associated with the entry later
                        // This is necessary because the entry may not exist yet (it's created when timer stops)
                        // Uses array to support multiple recordings per session
                        console.log('[AudioRecordingContext] Storing pending transcription for session:', entryId);
                        const existingTranscriptions = pendingTranscriptionsRef.current.get(entryId) || [];
                        existingTranscriptions.push(transcription);
                        pendingTranscriptionsRef.current.set(entryId, existingTranscriptions);
                        console.log('[AudioRecordingContext] Total transcriptions for session:', existingTranscriptions.length);

                        // Note: The entry may not exist yet as it's created when the timer stops.
                        // The transcription is stored as pending and will be attached to the entry
                        // when it's created via waitForTranscription() in App.tsx.
                        // The updateEntry call below is a fallback that only works if the entry
                        // happens to already exist with the same ID (unlikely).
                        try {
                            await updateEntry(entryId, { transcription });
                            console.log('[AudioRecordingContext] Attempted fallback entry update (may not have matched any entry)');
                        } catch (error) {
                            // Expected - entry likely doesn't exist with this sessionId
                            console.log('[AudioRecordingContext] Fallback update did not match any entry (expected)');
                        }

                        setTranscriptionProgress({
                            entryId,
                            status: 'complete',
                        });

                        // Clear progress after a short delay
                        setTimeout(() => {
                            setTranscriptionProgress(null);
                        }, 3000);
                    } else {
                        // Transcription failed but audio should be saved
                        console.error('[AudioRecordingContext] Transcription failed:', result.error);

                        // Store pending audio info if audio was saved
                        if (result.audioPath) {
                            const pendingAudio: PendingTranscription = {
                                audioPath: result.audioPath,
                                mimeType: result.mimeType || capturedMimeType,
                                status: 'failed',
                                error: result.error,
                                attemptedAt: Date.now(),
                            };
                            console.log('[AudioRecordingContext] Storing pending audio for retry:', pendingAudio);
                            pendingAudioRef.current.set(entryId, pendingAudio);
                        }

                        setTranscriptionProgress({
                            entryId,
                            status: 'error',
                            error: result.error,
                        });
                    }
                } catch (error) {
                    console.error('[AudioRecordingContext] Transcription error:', error);
                    setTranscriptionProgress({
                        entryId,
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Transcription failed',
                    });
                }

                // CRITICAL: Release stop lock after all processing is complete
                isStoppingRecordingRef.current = false;
                console.log('[AudioRecordingContext] Stop lock released');

                resolve();
            };

            mediaRecorderRef.current!.stop();
        });
    }, [updateEntry]);

    /**
     * Handle auto-record toggle
     */
    const handleSetAutoRecordEnabled = useCallback((enabled: boolean) => {
        setIsAutoRecordEnabled(enabled);
        window.electron.ipcRenderer.meeting.setAutoRecordEnabled(enabled);
    }, []);

    // Keep callback refs updated without triggering useEffect re-registration
    // This prevents the race condition where START events are missed during cleanup/re-registration
    useEffect(() => {
        startRecordingRef.current = startRecording;
    }, [startRecording]);

    useEffect(() => {
        stopRecordingAndTranscribeRef.current = stopRecordingAndTranscribe;
    }, [stopRecordingAndTranscribe]);

    /**
     * Get pending transcription for a session ID
     * Merges multiple transcriptions if multiple recordings occurred during the session
     */
    const getPendingTranscription = useCallback((sessionId: string): EntryTranscription | null => {
        const transcriptions = pendingTranscriptionsRef.current.get(sessionId);
        if (!transcriptions || transcriptions.length === 0) {
            return null;
        }

        // If only one transcription, return it directly
        if (transcriptions.length === 1) {
            return transcriptions[0];
        }

        // Merge multiple transcriptions into one
        console.log('[AudioRecordingContext] Merging', transcriptions.length, 'transcriptions for session:', sessionId);

        // Combine all transcriptions with separator
        const mergedFullText = transcriptions
            .map((t, i) => `[Recording ${i + 1}]\n${t.fullText}`)
            .join('\n\n---\n\n');

        // Merge segments with offset adjustment
        let segmentOffset = 0;
        const mergedSegments = transcriptions.flatMap((t) => {
            const adjustedSegments = (t.segments || []).map(seg => ({
                ...seg,
                start: seg.start + segmentOffset,
                end: seg.end + segmentOffset,
            }));
            segmentOffset += t.audioDuration || 0;
            return adjustedSegments;
        });

        // Sum up durations and word counts
        const totalDuration = transcriptions.reduce((sum, t) => sum + (t.audioDuration || 0), 0);
        const totalWordCount = transcriptions.reduce((sum, t) => sum + (t.wordCount || 0), 0);

        const merged: EntryTranscription = {
            transcriptionId: transcriptions[0].transcriptionId, // Use first transcription's ID
            fullText: mergedFullText,
            segments: mergedSegments,
            language: transcriptions[0].language,
            audioDuration: totalDuration,
            wordCount: totalWordCount,
            createdAt: transcriptions[0].createdAt,
        };

        console.log('[AudioRecordingContext] Merged transcription:', totalWordCount, 'words,', totalDuration, 'seconds');
        return merged;
    }, []);

    /**
     * Get all pending transcriptions for a session ID (as separate entries)
     * Each recording session is returned as a separate transcription
     */
    const getPendingTranscriptions = useCallback((sessionId: string): EntryTranscription[] => {
        const transcriptions = pendingTranscriptionsRef.current.get(sessionId);
        return transcriptions || [];
    }, []);

    /**
     * Clear pending transcription after it's been applied
     */
    const clearPendingTranscription = useCallback((sessionId: string): void => {
        pendingTranscriptionsRef.current.delete(sessionId);
    }, []);

    /**
     * Wait for transcription to complete for a session ID
     * Polls the pending transcriptions until one is available or timeout
     * Returns merged transcription if multiple recordings occurred during the session
     */
    const waitForTranscription = useCallback(async (sessionId: string, timeoutMs: number = 30000): Promise<EntryTranscription | null> => {
        console.log('[AudioRecordingContext] waitForTranscription called, sessionId:', sessionId, 'timeout:', timeoutMs);

        const startTime = Date.now();
        const pollInterval = 100; // Check every 100ms
        const minWaitTime = 2000; // Wait at least 2 seconds to allow STOP event to propagate

        while (Date.now() - startTime < timeoutMs) {
            // Check if transcription is available (uses array, checks length > 0)
            const transcriptions = pendingTranscriptionsRef.current.get(sessionId);
            if (transcriptions && transcriptions.length > 0) {
                // Wait a bit more to see if more recordings are coming
                // (give time for any in-progress transcription to finish)
                if (!state.isRecording && !transcriptionProgress) {
                    console.log('[AudioRecordingContext] Transcription(s) found after', Date.now() - startTime, 'ms, count:', transcriptions.length);
                    return getPendingTranscription(sessionId); // Returns merged transcription
                }
            }

            // Only apply early exit logic after minimum wait time
            // This gives time for the STOP event to propagate and transcription to start
            const elapsedMs = Date.now() - startTime;
            if (elapsedMs > minWaitTime) {
                // If we have transcriptions and no recording is active, return them
                const existingTranscriptions = pendingTranscriptionsRef.current.get(sessionId);
                if (existingTranscriptions && existingTranscriptions.length > 0 && !state.isRecording && !transcriptionProgress) {
                    console.log('[AudioRecordingContext] Returning', existingTranscriptions.length, 'transcription(s) after', elapsedMs, 'ms');
                    return getPendingTranscription(sessionId); // Returns merged transcription
                }

                // Check if transcription failed (no recording was active or it errored)
                // If there's no recording and no pending transcription, don't wait
                if (!state.isRecording && !transcriptionProgress && (!existingTranscriptions || existingTranscriptions.length === 0)) {
                    console.log('[AudioRecordingContext] No active recording and no transcription in progress after', elapsedMs, 'ms, returning null');
                    return null;
                }

                // If transcription errored, return null
                if (transcriptionProgress?.status === 'error') {
                    console.log('[AudioRecordingContext] Transcription errored, returning null');
                    return null;
                }
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // On timeout, return whatever transcriptions we have (merged)
        const finalTranscriptions = pendingTranscriptionsRef.current.get(sessionId);
        if (finalTranscriptions && finalTranscriptions.length > 0) {
            console.log('[AudioRecordingContext] Timeout reached, returning', finalTranscriptions.length, 'transcription(s)');
            return getPendingTranscription(sessionId);
        }

        console.log('[AudioRecordingContext] waitForTranscription timed out after', timeoutMs, 'ms');
        return null;
    }, [state.isRecording, transcriptionProgress, getPendingTranscription]);

    /**
     * Wait for transcriptions to complete for a session ID
     * Returns array of transcriptions (one per recording) if completed successfully within timeout
     */
    const waitForTranscriptions = useCallback(async (sessionId: string, timeoutMs: number = 30000): Promise<EntryTranscription[]> => {
        console.log('[AudioRecordingContext] waitForTranscriptions called, sessionId:', sessionId, 'timeout:', timeoutMs);

        const startTime = Date.now();
        const pollInterval = 100;
        const minWaitTime = 2000;

        while (Date.now() - startTime < timeoutMs) {
            const transcriptions = pendingTranscriptionsRef.current.get(sessionId);
            if (transcriptions && transcriptions.length > 0) {
                if (!state.isRecording && !transcriptionProgress) {
                    console.log('[AudioRecordingContext] Transcriptions found:', transcriptions.length);
                    return transcriptions;
                }
            }

            const elapsedMs = Date.now() - startTime;
            if (elapsedMs > minWaitTime) {
                const existingTranscriptions = pendingTranscriptionsRef.current.get(sessionId);
                if (existingTranscriptions && existingTranscriptions.length > 0 && !state.isRecording && !transcriptionProgress) {
                    console.log('[AudioRecordingContext] Returning', existingTranscriptions.length, 'transcription(s) after', elapsedMs, 'ms');
                    return existingTranscriptions;
                }

                if (!state.isRecording && !transcriptionProgress && (!existingTranscriptions || existingTranscriptions.length === 0)) {
                    console.log('[AudioRecordingContext] No transcriptions available after', elapsedMs, 'ms');
                    return [];
                }

                if (transcriptionProgress?.status === 'error') {
                    console.log('[AudioRecordingContext] Transcription errored');
                    return [];
                }
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        const finalTranscriptions = pendingTranscriptionsRef.current.get(sessionId);
        if (finalTranscriptions && finalTranscriptions.length > 0) {
            console.log('[AudioRecordingContext] Timeout reached, returning', finalTranscriptions.length, 'transcription(s)');
            return finalTranscriptions;
        }

        console.log('[AudioRecordingContext] waitForTranscriptions timed out after', timeoutMs, 'ms');
        return [];
    }, [state.isRecording, transcriptionProgress]);

    /**
     * Get pending audio info for a session/entry ID (when transcription failed but audio was saved)
     */
    const getPendingAudio = useCallback((sessionId: string): PendingTranscription | null => {
        return pendingAudioRef.current.get(sessionId) || null;
    }, []);

    /**
     * Clear pending audio after it's been handled
     */
    const clearPendingAudio = useCallback((sessionId: string): void => {
        pendingAudioRef.current.delete(sessionId);
    }, []);

    /**
     * Retry transcription for saved audio file
     */
    const retryTranscription = useCallback(async (entryId: string, audioPath: string, mimeType: string): Promise<EntryTranscription | null> => {
        console.log('[AudioRecordingContext] Retrying transcription for entry:', entryId, 'audioPath:', audioPath);

        setTranscriptionProgress({
            entryId,
            status: 'transcribing',
        });

        try {
            const result = await window.electron.ipcRenderer.meeting.retryTranscription(entryId, audioPath, mimeType);

            if (result.success && result.transcription) {
                console.log('[AudioRecordingContext] Retry transcription complete:', result.transcription.wordCount, 'words');

                const transcription: EntryTranscription = {
                    transcriptionId: result.transcription.transcriptionId,
                    fullText: result.transcription.fullText,
                    segments: result.transcription.segments,
                    language: result.transcription.language,
                    audioDuration: result.transcription.duration,
                    wordCount: result.transcription.wordCount,
                    createdAt: Date.now(),
                };

                // Update pending transcriptions (add to array for this session)
                const existingTranscriptions = pendingTranscriptionsRef.current.get(entryId) || [];
                existingTranscriptions.push(transcription);
                pendingTranscriptionsRef.current.set(entryId, existingTranscriptions);

                // Clear pending audio since transcription succeeded
                pendingAudioRef.current.delete(entryId);

                setTranscriptionProgress({
                    entryId,
                    status: 'complete',
                });

                setTimeout(() => setTranscriptionProgress(null), 3000);

                return transcription;
            } else {
                console.error('[AudioRecordingContext] Retry transcription failed:', result.error);

                // Update pending audio with new error
                const existingPending = pendingAudioRef.current.get(entryId);
                if (existingPending) {
                    pendingAudioRef.current.set(entryId, {
                        ...existingPending,
                        error: result.error,
                        attemptedAt: Date.now(),
                    });
                }

                setTranscriptionProgress({
                    entryId,
                    status: 'error',
                    error: result.error,
                });

                return null;
            }
        } catch (error) {
            console.error('[AudioRecordingContext] Retry transcription error:', error);
            setTranscriptionProgress({
                entryId,
                status: 'error',
                error: error instanceof Error ? error.message : 'Retry failed',
            });
            return null;
        }
    }, []);

    // Subscribe to recording events from main process
    // CRITICAL: This effect only depends on isAutoRecordEnabled to prevent race conditions
    // The callback refs are used to access current callbacks without re-registering listeners
    useEffect(() => {
        console.log('[AudioRecordingContext] ========================================');
        console.log('[AudioRecordingContext] EFFECT RUNNING - Setting up event listeners');
        console.log('[AudioRecordingContext] isAutoRecordEnabled:', isAutoRecordEnabled);
        console.log('[AudioRecordingContext] ========================================');

        if (!isAutoRecordEnabled) {
            console.log('[AudioRecordingContext] Auto-record disabled, skipping event listener setup');
            return;
        }

        console.log('[AudioRecordingContext] Setting up event listeners');
        console.log('[AudioRecordingContext] window.electron available:', !!window.electron);
        console.log('[AudioRecordingContext] meeting API available:', !!window.electron?.ipcRenderer?.meeting);

        const onStartFn = window.electron?.ipcRenderer?.meeting?.onRecordingShouldStart;
        const onStopFn = window.electron?.ipcRenderer?.meeting?.onRecordingShouldStop;

        console.log('[AudioRecordingContext] onRecordingShouldStart available:', !!onStartFn);
        console.log('[AudioRecordingContext] onRecordingShouldStop available:', !!onStopFn);

        if (!onStartFn || !onStopFn) {
            console.error('[AudioRecordingContext] *** CRITICAL: Event listener functions not available! ***');
            console.error('[AudioRecordingContext] This means the preload script did not expose the meeting API correctly');
            return;
        }

        const unsubscribeStart = onStartFn(
            (data: { entryId: string; timestamp: number }) => {
                console.log('[AudioRecordingContext] ========================================');
                console.log('[AudioRecordingContext] *** RECEIVED START EVENT ***');
                console.log('[AudioRecordingContext] entryId:', data.entryId);
                console.log('[AudioRecordingContext] timestamp:', data.timestamp);
                console.log('[AudioRecordingContext] ========================================');
                // Use ref to access current callback without causing effect re-registration
                startRecordingRef.current?.(data.entryId);
            }
        );

        const unsubscribeStop = onStopFn(
            (data: { entryId: string; duration: number }) => {
                console.log('[AudioRecordingContext] ========================================');
                console.log('[AudioRecordingContext] *** RECEIVED STOP EVENT ***');
                console.log('[AudioRecordingContext] entryId:', data.entryId);
                console.log('[AudioRecordingContext] duration:', data.duration);
                console.log('[AudioRecordingContext] ========================================');
                // Use ref to access current callback without causing effect re-registration
                stopRecordingAndTranscribeRef.current?.(data.entryId);
            }
        );

        // Listen for reset-silence-timer event (when user clicks "No, continue recording")
        const unsubscribeResetSilence = window.electron?.ipcRenderer?.on?.(
            'meeting:reset-silence-timer',
            () => {
                console.log('[AudioRecordingContext] *** RECEIVED RESET SILENCE TIMER EVENT ***');
                silenceStartTimeRef.current = null;
                silenceConfirmationShownRef.current = false;
            }
        );

        console.log('[AudioRecordingContext] *** Event listeners REGISTERED successfully ***');

        return () => {
            console.log('[AudioRecordingContext] Cleaning up event listeners and audio resources');
            unsubscribeStart?.();
            unsubscribeStop?.();
            unsubscribeResetSilence?.();

            // Stop audio level analysis
            if (audioLevelIntervalRef.current) {
                clearInterval(audioLevelIntervalRef.current);
                audioLevelIntervalRef.current = null;
            }

            // Close AudioContext to release audio resources
            // Critical for Bluetooth headsets to switch back to A2DP codec
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(e => {
                    console.warn('[AudioRecordingContext] Error closing AudioContext during cleanup:', e);
                });
                audioContextRef.current = null;
            }
            analyserRef.current = null;

            // Clean up AudioWorkletNode
            if (audioWorkletNodeRef.current) {
                try {
                    audioWorkletNodeRef.current.port.postMessage({ type: 'clear' });
                    audioWorkletNodeRef.current.disconnect();
                } catch (e) {
                    console.warn('[AudioRecordingContext] Error disconnecting AudioWorkletNode during cleanup:', e);
                }
                audioWorkletNodeRef.current = null;
            }

            // Stop any active recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }

            // Always stop native mic capture to ensure device is released
            // This is critical for Bluetooth headsets to switch back to A2DP codec
            isNativeMicActiveRef.current = false;
            nativeMicBufferRef.current = [];
            if (nativeMicUnsubscribeRef.current) {
                nativeMicUnsubscribeRef.current();
                nativeMicUnsubscribeRef.current = null;
            }
            // Always call stopMicCapture to ensure the native capture session is fully released
            window.electron?.ipcRenderer?.meeting?.stopMicCapture?.().catch(e => {
                console.warn('[AudioRecordingContext] Error stopping mic capture during cleanup:', e);
            });

            // Always stop system audio capture
            isSystemAudioActiveRef.current = false;
            systemAudioBufferRef.current = [];
            if (systemAudioUnsubscribeRef.current) {
                systemAudioUnsubscribeRef.current();
                systemAudioUnsubscribeRef.current = null;
            }
            window.electron?.ipcRenderer?.meeting?.stopSystemAudioCapture?.().catch(e => {
                console.warn('[AudioRecordingContext] Error stopping system audio capture during cleanup:', e);
            });

            console.log('[AudioRecordingContext] Cleanup complete - all audio resources released');
        };
    // CRITICAL: Only depend on isAutoRecordEnabled to prevent race condition
    // Callbacks are accessed via refs (startRecordingRef, stopRecordingAndTranscribeRef)
    // which are kept updated by separate effects without triggering listener re-registration
    }, [isAutoRecordEnabled]);

    const value: AudioRecordingContextValue = {
        state,
        transcriptionProgress,
        isAutoRecordEnabled,
        setAutoRecordEnabled: handleSetAutoRecordEnabled,
        getPendingTranscription,
        getPendingTranscriptions,
        clearPendingTranscription,
        waitForTranscription,
        waitForTranscriptions,
        getPendingAudio,
        retryTranscription,
        clearPendingAudio,
    };

    return (
        <AudioRecordingContext.Provider value={value}>
            {children}
        </AudioRecordingContext.Provider>
    );
}
