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

    // MediaRecorder refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    // Audio analysis refs for waveform visualization
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioLevelIntervalRef = useRef<number | null>(null);

    /**
     * Start audio recording
     */
    const startRecording = useCallback(async (entryId: string) => {
        console.log('[AudioRecordingContext] Starting recording for entry:', entryId);

        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000,
                },
            });

            streamRef.current = stream;
            audioChunksRef.current = [];

            // Set up Web Audio API for audio level analysis
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 64; // Small FFT for 32 frequency bins (we'll use 24)
            analyser.smoothingTimeConstant = 0.4;

            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;

            // Start sending audio levels to the widget
            const NUM_BARS = 24;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            audioLevelIntervalRef.current = window.setInterval(() => {
                if (analyserRef.current) {
                    analyserRef.current.getByteFrequencyData(dataArray);
                    // Convert to normalized levels (0-1)
                    const levels: number[] = [];
                    for (let i = 0; i < NUM_BARS; i++) {
                        // Map frequency bins to bars
                        const binIndex = Math.floor(i * dataArray.length / NUM_BARS);
                        const level = dataArray[binIndex] / 255;
                        levels.push(Math.max(0.05, level)); // Minimum level for visibility
                    }
                    // Send to main process to forward to widget
                    window.electron?.ipcRenderer?.meeting?.sendAudioLevels?.(levels);
                }
            }, 50); // Update at ~20fps

            // Create MediaRecorder with appropriate MIME type
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : 'audio/mp4';

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                audioBitsPerSecond: 128000,
            });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
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

                        // Update the entry with transcription
                        const transcription: EntryTranscription = {
                            transcriptionId: result.transcription.transcriptionId,
                            fullText: result.transcription.fullText,
                            segments: result.transcription.segments,
                            language: result.transcription.language,
                            audioDuration: result.transcription.duration,
                            wordCount: result.transcription.wordCount,
                            createdAt: Date.now(),
                        };

                        await updateEntry(entryId, { transcription });

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

    // Subscribe to recording events from main process
    useEffect(() => {
        if (!isAutoRecordEnabled) return;

        console.log('[AudioRecordingContext] Setting up event listeners');

        const unsubscribeStart = window.electron.ipcRenderer.meeting.onRecordingShouldStart?.(
            (data: { entryId: string; timestamp: number }) => {
                console.log('[AudioRecordingContext] Received start event:', data);
                startRecording(data.entryId);
            }
        );

        const unsubscribeStop = window.electron.ipcRenderer.meeting.onRecordingShouldStop?.(
            (data: { entryId: string; duration: number }) => {
                console.log('[AudioRecordingContext] Received stop event:', data);
                stopRecordingAndTranscribe(data.entryId);
            }
        );

        return () => {
            console.log('[AudioRecordingContext] Cleaning up event listeners');
            unsubscribeStart?.();
            unsubscribeStop?.();

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
        };
    }, [isAutoRecordEnabled, startRecording, stopRecordingAndTranscribe]);

    const value: AudioRecordingContextValue = {
        state,
        transcriptionProgress,
        isAutoRecordEnabled,
        setAutoRecordEnabled: handleSetAutoRecordEnabled,
    };

    return (
        <AudioRecordingContext.Provider value={value}>
            {children}
        </AudioRecordingContext.Provider>
    );
}
