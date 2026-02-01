// electron/native/index.d.ts
export interface AudioSamplesInfo {
    samples: Float32Array;
    channelCount: number;
    sampleRate: number;
    sampleCount: number;
}

export interface FileRecordingResult {
    success: boolean;
    filePath?: string;
    sampleRate?: number;
    error?: string;
}

export interface MediaMonitor {
    start(callback: (isActive: boolean, deviceType: 'microphone' | 'camera') => void): void;
    stop(): void;
    isMicrophoneInUse(): boolean;
    isCameraInUse(): boolean;

    // System audio capture (macOS 12.3+)
    isSystemAudioCaptureAvailable(): boolean;
    startSystemAudioCapture(callback: (info: AudioSamplesInfo) => void): { success: boolean; error?: string };
    stopSystemAudioCapture(): void;
    isSystemAudioCapturing(): boolean;

    // Microphone capture
    isMicCaptureAvailable(): boolean;
    startMicCapture(callback: (info: AudioSamplesInfo) => void): { success: boolean; error?: string };
    stopMicCapture(): void;
    isMicCapturing(): boolean;

    // File recording (direct to WAV, no resampling)
    startMicFileRecording(filePath: string): { success: boolean };
    stopMicFileRecording(): FileRecordingResult;
    startSystemAudioFileRecording(filePath: string): { success: boolean; error?: string };
    stopSystemAudioFileRecording(): FileRecordingResult;

    // Meeting app detection
    getRunningMeetingApps(): Array<{
        bundleId: string;
        appName: string;
        localizedName: string;
        pid: number;
        isActive: boolean;
    }>;
    getLikelyMeetingAppUsingMic(): {
        bundleId: string;
        appName: string;
        localizedName: string;
        pid: number;
        isActive: boolean;
    } | null;
    getCurrentMeetingApp(): {
        bundleId: string;
        appName: string;
        localizedName: string;
        pid: number;
        isActive: boolean;
    } | null;

    // Speech transcription
    isSpeechTranscriptionAvailable(): boolean;
    getSupportedTranscriptionLanguages(): string[];
    transcribeAudioFile(filePath: string, language?: string): {
        success: boolean;
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
        }>;
        error?: string;
    };
    transcribeAudioBuffer(buffer: Float32Array | ArrayBuffer, sampleRate: number, language?: string): {
        success: boolean;
        text?: string;
        language?: string;
        duration?: number;
        segments?: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
        }>;
        error?: string;
    };
}

declare const mediaMonitor: MediaMonitor;
export default mediaMonitor;
