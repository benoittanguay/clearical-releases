/**
 * Audio Capture Hook
 *
 * Provides audio recording capabilities using MediaRecorder API.
 * Records microphone audio and sends it to the main process for transcription.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioCaptureState {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
    error: string | null;
}

export interface TranscriptionResult {
    success: boolean;
    transcriptionId?: string;
    fullText?: string;
    segments?: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
    }>;
    language?: string;
    duration?: number;
    wordCount?: number;
    error?: string;
}

export interface UseAudioCaptureResult {
    state: AudioCaptureState;
    startRecording: () => Promise<boolean>;
    stopRecording: () => Promise<{ audioBlob: Blob | null; duration: number }>;
    pauseRecording: () => void;
    resumeRecording: () => void;
    transcribeAndSave: (entryId: string) => Promise<TranscriptionResult>;
}

/**
 * Hook for capturing audio from microphone
 *
 * @returns Audio capture controls and state
 */
export function useAudioCapture(): UseAudioCaptureResult {
    const [state, setState] = useState<AudioCaptureState>({
        isRecording: false,
        isPaused: false,
        duration: 0,
        error: null,
    });

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const pausedDurationRef = useRef<number>(0);
    const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    /**
     * Start recording audio from microphone
     */
    const startRecording = useCallback(async (): Promise<boolean> => {
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
                console.error('[useAudioCapture] MediaRecorder error:', event);
                setState(prev => ({
                    ...prev,
                    error: 'Recording error occurred',
                }));
            };

            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.start(1000); // Collect data every second

            startTimeRef.current = Date.now();
            pausedDurationRef.current = 0;

            // Start duration tracking
            durationIntervalRef.current = setInterval(() => {
                if (startTimeRef.current && !state.isPaused) {
                    const elapsed = Date.now() - startTimeRef.current - pausedDurationRef.current;
                    setState(prev => ({
                        ...prev,
                        duration: elapsed,
                    }));
                }
            }, 100);

            setState({
                isRecording: true,
                isPaused: false,
                duration: 0,
                error: null,
            });

            console.log('[useAudioCapture] Recording started');
            return true;
        } catch (error) {
            console.error('[useAudioCapture] Failed to start recording:', error);
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to access microphone',
            }));
            return false;
        }
    }, [state.isPaused]);

    /**
     * Stop recording and return the audio blob
     */
    const stopRecording = useCallback(async (): Promise<{ audioBlob: Blob | null; duration: number }> => {
        return new Promise((resolve) => {
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
                resolve({ audioBlob: null, duration: 0 });
                return;
            }

            const duration = state.duration;

            mediaRecorderRef.current.onstop = () => {
                // Stop all tracks
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }

                // Clear duration interval
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                    durationIntervalRef.current = null;
                }

                // Create blob from chunks
                const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

                console.log('[useAudioCapture] Recording stopped, blob size:', audioBlob.size);

                setState({
                    isRecording: false,
                    isPaused: false,
                    duration: 0,
                    error: null,
                });

                resolve({ audioBlob, duration });
            };

            mediaRecorderRef.current.stop();
        });
    }, [state.duration]);

    /**
     * Pause recording
     */
    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.pause();
            setState(prev => ({
                ...prev,
                isPaused: true,
            }));
            console.log('[useAudioCapture] Recording paused');
        }
    }, []);

    /**
     * Resume recording
     */
    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
            mediaRecorderRef.current.resume();
            setState(prev => ({
                ...prev,
                isPaused: false,
            }));
            console.log('[useAudioCapture] Recording resumed');
        }
    }, []);

    /**
     * Stop recording, transcribe the audio, and save it
     */
    const transcribeAndSave = useCallback(async (entryId: string): Promise<TranscriptionResult> => {
        const { audioBlob, duration } = await stopRecording();

        if (!audioBlob || audioBlob.size === 0) {
            return {
                success: false,
                error: 'No audio recorded',
            };
        }

        // Minimum duration check (5 seconds)
        if (duration < 5000) {
            return {
                success: false,
                error: 'Recording too short (minimum 5 seconds)',
            };
        }

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
                audioBlob.type
            );

            return result;
        } catch (error) {
            console.error('[useAudioCapture] Transcription error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Transcription failed',
            };
        }
    }, [stopRecording]);

    return {
        state,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        transcribeAndSave,
    };
}
