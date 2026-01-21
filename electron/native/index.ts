// electron/native/index.ts
import { EventEmitter } from 'events';
import * as path from 'path';

export type MediaEvent = 'mic-started' | 'mic-stopped' | 'camera-started' | 'camera-stopped';

export interface MediaMonitorEvents {
    'mic-started': () => void;
    'mic-stopped': () => void;
    'camera-started': () => void;
    'camera-stopped': () => void;
}

class MediaMonitorWrapper extends EventEmitter {
    private native: any;
    private isRunning: boolean = false;

    constructor() {
        super();

        // Load native addon - handle both dev and production paths
        try {
            // Try production path first (in asar)
            this.native = require('./build/Release/media_monitor.node');
        } catch {
            try {
                // Try development path
                this.native = require(path.join(__dirname, 'build', 'Release', 'media_monitor.node'));
            } catch (err) {
                console.error('[MediaMonitor] Failed to load native addon:', err);
                this.native = null;
            }
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
            console.log(`[MediaMonitor] ${eventName}`);
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
}

// Export singleton instance
export const mediaMonitor = new MediaMonitorWrapper();
export default mediaMonitor;
