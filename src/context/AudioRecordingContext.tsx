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
import type { EntryTranscription } from '../types/shared';

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
     * Get pending transcription for a session ID
     * Used to retrieve transcription when entry is created
     */
    getPendingTranscription: (sessionId: string) => EntryTranscription | null;
    /**
     * Clear pending transcription after it's been applied
     */
    clearPendingTranscription: (sessionId: string) => void;
    /**
     * Wait for transcription to complete for a session ID
     * Returns the transcription if completed successfully within timeout, null otherwise
     */
    waitForTranscription: (sessionId: string, timeoutMs?: number) => Promise<EntryTranscription | null>;
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
    const pendingTranscriptionsRef = useRef<Map<string, EntryTranscription>>(new Map());

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

    // Silence detection for meeting end
    const silenceStartTimeRef = useRef<number | null>(null);
    const silenceConfirmationShownRef = useRef<boolean>(false);
    // Note: Using time domain deviation (< 3) instead of frequency threshold for more reliable silence detection
    const SILENCE_DURATION_FOR_PROMPT = 10000; // 10 seconds of silence = ask user if meeting ended

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

            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.4;

            // Create a destination for the mixed audio
            const destination = audioContext.createMediaStreamDestination();

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

                    // Subscribe to native mic audio samples
                    let nativeMicReceivedCount = 0;
                    const unsubscribeMic = window.electron?.ipcRenderer?.meeting?.onMicAudioSamples?.(
                        (data: { samples: Float32Array; channelCount: number; sampleRate: number; sampleCount: number }) => {
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
                                console.log(`[AudioRecordingContext] NATIVE MIC #${nativeMicReceivedCount}: sampleCount=${data.sampleCount}, rms=${micRms.toFixed(6)}, peak=${micPeak.toFixed(6)}, samples[0-3]=[${samples?.[0]?.toFixed(6)}, ${samples?.[1]?.toFixed(6)}, ${samples?.[2]?.toFixed(6)}, ${samples?.[3]?.toFixed(6)}]`);
                            }
                            // Buffer the incoming samples
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
                        // Create a ScriptProcessorNode to inject native mic audio into the mix
                        const micBufferSize = 4096;
                        const micScriptProcessor = audioContext.createScriptProcessor(micBufferSize, 1, 1);

                        let micScriptProcessorCallCount = 0;
                        let micSamplesProcessedCount = 0;
                        // Accumulator buffer to collect multiple small chunks into one 4096-sample output
                        let micAccumulator: number[] = [];

                        micScriptProcessor.onaudioprocess = (e) => {
                            micScriptProcessorCallCount++;
                            const output = e.outputBuffer.getChannelData(0);

                            // Collect samples from buffer until we have enough for the output
                            while (micAccumulator.length < micBufferSize && nativeMicBufferRef.current.length > 0) {
                                const chunk = nativeMicBufferRef.current.shift();
                                if (chunk) {
                                    // Add all samples from chunk to accumulator
                                    for (let i = 0; i < chunk.length; i++) {
                                        micAccumulator.push(chunk[i]);
                                    }
                                }
                            }

                            if (micAccumulator.length > 0) {
                                micSamplesProcessedCount++;
                                // Log every 100th time we have samples
                                if (micSamplesProcessedCount % 100 === 1) {
                                    console.log(`[AudioRecordingContext] MicScriptProcessor processing #${micSamplesProcessedCount}: accumulated=${micAccumulator.length}, bufferSize=${micBufferSize}, bufferQueue=${nativeMicBufferRef.current.length}`);
                                }

                                // Copy accumulated samples to output
                                const samplesToUse = Math.min(micAccumulator.length, micBufferSize);
                                for (let i = 0; i < micBufferSize; i++) {
                                    output[i] = i < samplesToUse ? micAccumulator[i] : 0;
                                }
                                // Remove used samples from accumulator
                                micAccumulator = micAccumulator.slice(samplesToUse);
                            } else {
                                // No mic audio available, output silence
                                if (micScriptProcessorCallCount % 500 === 1) {
                                    console.log(`[AudioRecordingContext] MicScriptProcessor: no native mic in buffer (call #${micScriptProcessorCallCount}, processed ${micSamplesProcessedCount} samples so far)`);
                                }
                                for (let i = 0; i < micBufferSize; i++) {
                                    output[i] = 0;
                                }
                            }
                        };

                        // Connect mic processor to analyser (for visualization) and destination
                        micScriptProcessor.connect(analyser);
                        micScriptProcessor.connect(destination);
                        console.log('[AudioRecordingContext] Native mic ScriptProcessor connected to destination');
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
                        // Create a ScriptProcessorNode to inject system audio into the mix
                        const bufferSize = 4096;
                        const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 2, 2);

                        let scriptProcessorCallCount = 0;
                        let samplesProcessedCount = 0;
                        // Accumulator buffers for left and right channels
                        let sysAccumulatorL: number[] = [];
                        let sysAccumulatorR: number[] = [];

                        scriptProcessor.onaudioprocess = (e) => {
                            scriptProcessorCallCount++;
                            const outputL = e.outputBuffer.getChannelData(0);
                            const outputR = e.outputBuffer.getChannelData(1);

                            // Collect samples from buffer until we have enough for the output
                            while (sysAccumulatorL.length < bufferSize && systemAudioBufferRef.current.length > 0) {
                                const chunk = systemAudioBufferRef.current.shift();
                                if (chunk && chunk.length > 0) {
                                    // System audio is stereo interleaved (L, R, L, R, ...)
                                    for (let i = 0; i < chunk.length; i += 2) {
                                        sysAccumulatorL.push(chunk[i] || 0);
                                        sysAccumulatorR.push(chunk[i + 1] || 0);
                                    }
                                }
                            }

                            if (sysAccumulatorL.length > 0) {
                                samplesProcessedCount++;
                                // Log every 100th time we have samples
                                if (samplesProcessedCount % 100 === 1) {
                                    console.log(`[AudioRecordingContext] SysAudioProcessor processing #${samplesProcessedCount}: accumulated=${sysAccumulatorL.length}, bufferSize=${bufferSize}, bufferQueue=${systemAudioBufferRef.current.length}`);
                                }

                                // Copy accumulated samples to output
                                const samplesToUse = Math.min(sysAccumulatorL.length, bufferSize);
                                for (let i = 0; i < bufferSize; i++) {
                                    outputL[i] = i < samplesToUse ? sysAccumulatorL[i] : 0;
                                    outputR[i] = i < samplesToUse ? sysAccumulatorR[i] : 0;
                                }
                                // Remove used samples from accumulators
                                sysAccumulatorL = sysAccumulatorL.slice(samplesToUse);
                                sysAccumulatorR = sysAccumulatorR.slice(samplesToUse);
                            } else {
                                // No system audio available, output silence
                                if (scriptProcessorCallCount % 500 === 1) {
                                    console.log(`[AudioRecordingContext] SysAudioProcessor: no system audio in buffer (call #${scriptProcessorCallCount}, processed ${samplesProcessedCount} samples so far)`);
                                }
                                for (let i = 0; i < bufferSize; i++) {
                                    outputL[i] = 0;
                                    outputR[i] = 0;
                                }
                            }
                        };

                        // Connect script processor to destination (adds system audio to mix)
                        scriptProcessor.connect(destination);
                        console.log('[AudioRecordingContext] System audio ScriptProcessor connected to destination');
                    }
                }
            } catch (sysAudioError) {
                console.warn('[AudioRecordingContext] System audio capture not available:', sysAudioError);
            }

            // Check if we have at least one audio source
            if (!nativeMicStarted && !systemAudioStarted) {
                throw new Error('No audio capture available - neither native mic nor system audio could be started');
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
                    const isSilentByTimeDomain = timeDomainDeviation < 3; // Very little deviation from center

                    // Silence detection for meeting end
                    if (isSilentByTimeDomain) {
                        if (silenceStartTimeRef.current === null) {
                            silenceStartTimeRef.current = Date.now();
                            silenceConfirmationShownRef.current = false;
                            console.log('[AudioRecordingContext] Silence detected, starting timer...');
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
                        // Reset silence timer when audio is detected
                        if (silenceStartTimeRef.current !== null) {
                            console.log('[AudioRecordingContext] Audio detected, resetting silence timer');
                            silenceConfirmationShownRef.current = false;
                        }
                        silenceStartTimeRef.current = null;
                    }

                    // Send to main process to forward to widget
                    const sendFn = window.electron?.ipcRenderer?.meeting?.sendAudioLevels;
                    if (sendFn) {
                        sendFn(levels);
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
                                'isSilence:', isSilentByTimeDomain);
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

            console.log('[AudioRecordingContext] Recording started');
        } catch (error) {
            console.error('[AudioRecordingContext] Failed to start recording:', error);
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to access microphone',
            }));
        }
    }, []);

    /**
     * Stop recording and transcribe
     */
    const stopRecordingAndTranscribe = useCallback(async (entryId: string) => {
        console.log('[AudioRecordingContext] Stopping recording for entry:', entryId);

        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
            console.log('[AudioRecordingContext] No active recording to stop');
            return;
        }

        return new Promise<void>((resolve) => {
            mediaRecorderRef.current!.onstop = async () => {
                // Stop audio level analysis
                if (audioLevelIntervalRef.current) {
                    clearInterval(audioLevelIntervalRef.current);
                    audioLevelIntervalRef.current = null;
                }
                if (audioContextRef.current) {
                    audioContextRef.current.close();
                    audioContextRef.current = null;
                }
                analyserRef.current = null;

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

                // Create blob from chunks
                const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

                console.log('[AudioRecordingContext] Recording stopped, blob size:', audioBlob.size);

                setState({
                    isRecording: false,
                    currentEntryId: null,
                    recordingStartTime: null,
                    error: null,
                });

                // Check minimum duration (5 seconds)
                const duration = audioBlob.size > 0 ? (audioChunksRef.current.length * 1000) : 0;
                if (duration < 5000 || audioBlob.size < 1000) {
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
                    // Convert blob to base64
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);
                    let binary = '';
                    for (let i = 0; i < uint8Array.length; i++) {
                        binary += String.fromCharCode(uint8Array[i]);
                    }
                    const audioBase64 = btoa(binary);

                    // Send to main process for transcription
                    const result = await window.electron.ipcRenderer.meeting.saveAudioAndTranscribe(
                        entryId,
                        audioBase64,
                        mimeType
                    );

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
                        console.log('[AudioRecordingContext] Storing pending transcription for session:', entryId);
                        pendingTranscriptionsRef.current.set(entryId, transcription);

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
                        console.error('[AudioRecordingContext] Transcription failed:', result.error);
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

    /**
     * Get pending transcription for a session ID
     */
    const getPendingTranscription = useCallback((sessionId: string): EntryTranscription | null => {
        return pendingTranscriptionsRef.current.get(sessionId) || null;
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
     */
    const waitForTranscription = useCallback(async (sessionId: string, timeoutMs: number = 30000): Promise<EntryTranscription | null> => {
        console.log('[AudioRecordingContext] waitForTranscription called, sessionId:', sessionId, 'timeout:', timeoutMs);

        const startTime = Date.now();
        const pollInterval = 100; // Check every 100ms
        const minWaitTime = 2000; // Wait at least 2 seconds to allow STOP event to propagate

        while (Date.now() - startTime < timeoutMs) {
            // Check if transcription is available
            const transcription = pendingTranscriptionsRef.current.get(sessionId);
            if (transcription) {
                console.log('[AudioRecordingContext] Transcription found after', Date.now() - startTime, 'ms');
                return transcription;
            }

            // Only apply early exit logic after minimum wait time
            // This gives time for the STOP event to propagate and transcription to start
            const elapsedMs = Date.now() - startTime;
            if (elapsedMs > minWaitTime) {
                // Check if transcription failed (no recording was active or it errored)
                // If there's no recording and no pending transcription, don't wait
                if (!state.isRecording && !transcriptionProgress) {
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

        console.log('[AudioRecordingContext] waitForTranscription timed out after', timeoutMs, 'ms');
        return null;
    }, [state.isRecording, transcriptionProgress]);

    // Subscribe to recording events from main process
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
                startRecording(data.entryId);
            }
        );

        const unsubscribeStop = onStopFn(
            (data: { entryId: string; duration: number }) => {
                console.log('[AudioRecordingContext] ========================================');
                console.log('[AudioRecordingContext] *** RECEIVED STOP EVENT ***');
                console.log('[AudioRecordingContext] entryId:', data.entryId);
                console.log('[AudioRecordingContext] duration:', data.duration);
                console.log('[AudioRecordingContext] ========================================');
                stopRecordingAndTranscribe(data.entryId);
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
            console.log('[AudioRecordingContext] Cleaning up event listeners');
            unsubscribeStart?.();
            unsubscribeStop?.();
            unsubscribeResetSilence?.();

            // Stop audio level analysis
            if (audioLevelIntervalRef.current) {
                clearInterval(audioLevelIntervalRef.current);
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }

            // Stop any active recording
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            // Stop native mic capture
            if (isNativeMicActiveRef.current) {
                isNativeMicActiveRef.current = false;
                nativeMicBufferRef.current = [];
                if (nativeMicUnsubscribeRef.current) {
                    nativeMicUnsubscribeRef.current();
                    nativeMicUnsubscribeRef.current = null;
                }
                window.electron?.ipcRenderer?.meeting?.stopMicCapture?.();
            }

            // Stop system audio capture
            if (isSystemAudioActiveRef.current) {
                isSystemAudioActiveRef.current = false;
                systemAudioBufferRef.current = [];
                if (systemAudioUnsubscribeRef.current) {
                    systemAudioUnsubscribeRef.current();
                    systemAudioUnsubscribeRef.current = null;
                }
                window.electron?.ipcRenderer?.meeting?.stopSystemAudioCapture?.();
            }
        };
    }, [isAutoRecordEnabled, startRecording, stopRecordingAndTranscribe]);

    const value: AudioRecordingContextValue = {
        state,
        transcriptionProgress,
        isAutoRecordEnabled,
        setAutoRecordEnabled: handleSetAutoRecordEnabled,
        getPendingTranscription,
        clearPendingTranscription,
        waitForTranscription,
    };

    return (
        <AudioRecordingContext.Provider value={value}>
            {children}
        </AudioRecordingContext.Provider>
    );
}
