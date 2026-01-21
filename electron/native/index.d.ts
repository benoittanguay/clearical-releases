// electron/native/index.d.ts
export interface MediaMonitor {
    start(callback: (isActive: boolean, deviceType: 'microphone' | 'camera') => void): void;
    stop(): void;
    isMicrophoneInUse(): boolean;
    isCameraInUse(): boolean;
}

declare const mediaMonitor: MediaMonitor;
export default mediaMonitor;
