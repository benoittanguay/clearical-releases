// electron/native/index.ts
import { EventEmitter } from 'events';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type MediaEvent = 'mic-started' | 'mic-stopped' | 'camera-started' | 'camera-stopped';

export interface MediaMonitorEvents {
    'mic-started': () => void;
    'mic-stopped': () => void;
    'camera-started': () => void;
    'camera-stopped': () => void;
}

export interface AudioSamplesInfo {
    samples: Float32Array;
    channelCount: number;
    sampleRate: number;
    sampleCount: number;
}

export interface MicAudioSamplesInfo {
    samples: Float32Array;
    channelCount: number;
    sampleRate: number;
    sampleCount: number;
}

class MediaMonitorWrapper extends EventEmitter {
    private native: any;
    private isRunning: boolean = false;

    constructor() {
        super();

        // Load native addon - handle dev, production, and asar.unpacked paths
        const nativeAddonName = 'media_monitor.node';

        // Debug: Log the current __dirname to help diagnose path issues
        console.log('[MediaMonitor] __dirname:', __dirname);
        console.log('[MediaMonitor] process.resourcesPath:', (process as any).resourcesPath);

        // Build list of possible paths
        const possiblePaths: string[] = [];

        // 1. Use process.resourcesPath for packaged Electron apps (most reliable)
        if ((process as any).resourcesPath) {
            const resourcesPath = (process as any).resourcesPath;
            // Native addon is at: Resources/app.asar.unpacked/electron/native/build/Release/
            possiblePaths.push(
                path.join(resourcesPath, 'app.asar.unpacked', 'electron', 'native', 'build', 'Release', nativeAddonName)
            );
        }

        // 2. Handle __dirname with asar and dist-electron replacements
        const unpackedPath = __dirname
            .replace('app.asar', 'app.asar.unpacked')
            .replace(/dist-electron[\/\\]native/, 'electron/native');
        possiblePaths.push(path.join(unpackedPath, 'build', 'Release', nativeAddonName));

        // 3. Development path (relative to this file in source, for npm run dev)
        // When running from dist-electron/native, map to electron/native
        const devPath = __dirname.replace(/dist-electron[\/\\]native/, 'electron/native');
        possiblePaths.push(path.join(devPath, 'build', 'Release', nativeAddonName));

        // 4. Alternative development path: when __dirname is already electron/native
        possiblePaths.push(path.join(__dirname, 'build', 'Release', nativeAddonName));

        // 5. Fallback: require relative path
        possiblePaths.push('./build/Release/media_monitor.node');

        for (const addonPath of possiblePaths) {
            try {
                console.log('[MediaMonitor] Trying to load native addon from:', addonPath);
                this.native = require(addonPath);
                console.log('[MediaMonitor] ✓ Successfully loaded native addon from:', addonPath);
                break;
            } catch (err) {
                console.log('[MediaMonitor] ✗ Failed to load from:', addonPath, '-', (err as Error).message);
            }
        }

        if (!this.native) {
            console.error('[MediaMonitor] ❌ Failed to load native addon from any path');
            console.error('[MediaMonitor] Possible paths tried:', possiblePaths);
        }
    }

    start(): void {
        if (this.isRunning || !this.native) {
            if (!this.native) {
                console.warn('[MediaMonitor] Native addon not available - running in stub mode');
            }
            return;
        }

        this.isRunning = true;

        this.native.start((isActive: boolean, deviceType: string) => {
            const eventName = `${deviceType === 'microphone' ? 'mic' : 'camera'}-${isActive ? 'started' : 'stopped'}` as MediaEvent;
            console.log(`[MediaMonitor] ========================================`);
            console.log(`[MediaMonitor] *** NATIVE CALLBACK RECEIVED ***`);
            console.log(`[MediaMonitor] isActive=${isActive}, deviceType=${deviceType}`);
            console.log(`[MediaMonitor] Emitting event: ${eventName}`);
            console.log(`[MediaMonitor] Current mic state: ${this.native?.isMicrophoneInUse?.()}, camera state: ${this.native?.isCameraInUse?.()}`);
            console.log(`[MediaMonitor] Event listeners for '${eventName}':`, this.listenerCount(eventName));
            console.log(`[MediaMonitor] ========================================`);
            this.emit(eventName);
        });

        console.log('[MediaMonitor] Started monitoring');
    }

    stop(): void {
        if (!this.isRunning || !this.native) return;

        this.native.stop();
        this.isRunning = false;
        console.log('[MediaMonitor] Stopped monitoring');
    }

    isMicrophoneInUse(): boolean {
        if (!this.native) return false;
        return this.native.isMicrophoneInUse();
    }

    isCameraInUse(): boolean {
        if (!this.native) return false;
        return this.native.isCameraInUse();
    }

    isMediaInUse(): boolean {
        return this.isMicrophoneInUse() || this.isCameraInUse();
    }

    // System audio capture methods (macOS 12.3+ via ScreenCaptureKit)

    isSystemAudioCaptureAvailable(): boolean {
        if (!this.native) return false;
        try {
            return this.native.isSystemAudioCaptureAvailable();
        } catch (err) {
            console.warn('[MediaMonitor] isSystemAudioCaptureAvailable error:', err);
            return false;
        }
    }

    startSystemAudioCapture(callback: (info: AudioSamplesInfo) => void): { success: boolean; error?: string } {
        if (!this.native) {
            console.warn('[MediaMonitor] Native addon not available for system audio capture');
            return { success: false, error: 'Native addon not available' };
        }

        try {
            console.log('[MediaMonitor] Starting system audio capture...');
            const result = this.native.startSystemAudioCapture(callback);
            console.log('[MediaMonitor] System audio capture result:', result);
            return result;
        } catch (err) {
            console.error('[MediaMonitor] Failed to start system audio capture:', err);
            return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
    }

    stopSystemAudioCapture(): void {
        if (!this.native) return;
        try {
            this.native.stopSystemAudioCapture();
            console.log('[MediaMonitor] System audio capture stopped');
        } catch (err) {
            console.error('[MediaMonitor] Failed to stop system audio capture:', err);
        }
    }

    isSystemAudioCapturing(): boolean {
        if (!this.native) return false;
        try {
            return this.native.isSystemAudioCapturing();
        } catch (err) {
            console.warn('[MediaMonitor] isSystemAudioCapturing error:', err);
            return false;
        }
    }

    // Native microphone capture methods (bypasses getUserMedia limitations)

    isMicCaptureAvailable(): boolean {
        if (!this.native) return false;
        try {
            return this.native.isMicCaptureAvailable();
        } catch (err) {
            console.warn('[MediaMonitor] isMicCaptureAvailable error:', err);
            return false;
        }
    }

    startMicCapture(callback: (info: MicAudioSamplesInfo) => void): { success: boolean; error?: string } {
        if (!this.native) {
            console.warn('[MediaMonitor] Native addon not available for mic capture');
            return { success: false, error: 'Native addon not available' };
        }

        try {
            console.log('[MediaMonitor] Starting native mic capture...');
            const result = this.native.startMicCapture(callback);
            console.log('[MediaMonitor] Native mic capture result:', result);
            return result;
        } catch (err) {
            console.error('[MediaMonitor] Failed to start native mic capture:', err);
            return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
    }

    stopMicCapture(): void {
        if (!this.native) return;
        try {
            this.native.stopMicCapture();
            console.log('[MediaMonitor] Native mic capture stopped');
        } catch (err) {
            console.error('[MediaMonitor] Failed to stop native mic capture:', err);
        }
    }

    isMicCapturing(): boolean {
        if (!this.native) return false;
        try {
            return this.native.isMicCapturing();
        } catch (err) {
            console.warn('[MediaMonitor] isMicCapturing error:', err);
            return false;
        }
    }
}

// Export singleton instance
export const mediaMonitor = new MediaMonitorWrapper();
export default mediaMonitor;
