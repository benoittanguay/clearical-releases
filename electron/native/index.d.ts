// electron/native/index.d.ts
export interface AudioSamplesInfo {
    samples: Float32Array;
    channelCount: number;
    sampleRate: number;
    sampleCount: number;
}

export interface MediaMonitor {
    start(callback: (isActive: boolean, deviceType: 'microphone' | 'camera') => void): void;
    stop(): void;
    isMicrophoneInUse(): boolean;
    isCameraInUse(): boolean;

    // System audio capture (macOS 12.3+)
    isSystemAudioCaptureAvailable(): boolean;
    startSystemAudioCapture(callback: (info: AudioSamplesInfo) => void): Promise<boolean>;
    stopSystemAudioCapture(): void;
    isSystemAudioCapturing(): boolean;
}

declare const mediaMonitor: MediaMonitor;
export default mediaMonitor;
