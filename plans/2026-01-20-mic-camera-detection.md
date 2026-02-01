# Mic/Camera Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically record audio (mic + system) when microphone or camera is in use during an active time entry.

**Architecture:** Native Node.js addon using Core Audio (mic) and AVFoundation (camera) APIs for event-driven detection. RecordingManager orchestrates MediaMonitor events with AudioRecorder, gated by active timer state from renderer.

**Tech Stack:** node-addon-api (N-API), Objective-C++, Core Audio, AVFoundation, Electron IPC

---

## Task 1: Set Up Native Addon Build Infrastructure

**Files:**
- Create: `electron/native/binding.gyp`
- Create: `electron/native/package.json`

**Step 1: Create binding.gyp build configuration**

```gyp
{
  "targets": [
    {
      "target_name": "media_monitor",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "src/media_monitor.mm",
        "src/index.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": ["-fobjc-arc"]
          },
          "link_settings": {
            "libraries": [
              "-framework CoreAudio",
              "-framework AVFoundation",
              "-framework Foundation"
            ]
          }
        }]
      ]
    }
  ]
}
```

**Step 2: Create package.json for native addon**

```json
{
  "name": "media-monitor",
  "version": "1.0.0",
  "description": "Native addon for mic/camera detection",
  "main": "build/Release/media_monitor.node",
  "scripts": {
    "build": "node-gyp rebuild",
    "clean": "node-gyp clean"
  },
  "dependencies": {
    "node-addon-api": "^7.0.0"
  },
  "devDependencies": {
    "node-gyp": "^10.0.0"
  }
}
```

**Step 3: Commit**

```bash
git add electron/native/binding.gyp electron/native/package.json
git commit -m "build: add native addon build infrastructure for media monitor"
```

---

## Task 2: Implement Core Audio Microphone Detection (Objective-C++)

**Files:**
- Create: `electron/native/src/media_monitor.h`
- Create: `electron/native/src/media_monitor.mm`

**Step 1: Create header file**

```cpp
// electron/native/src/media_monitor.h
#ifndef MEDIA_MONITOR_H
#define MEDIA_MONITOR_H

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <AVFoundation/AVFoundation.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*MediaStateCallback)(bool isActive, const char* deviceType);

@interface MediaMonitor : NSObject

@property (nonatomic, assign) MediaStateCallback callback;
@property (nonatomic, assign) BOOL microphoneInUse;
@property (nonatomic, assign) BOOL cameraInUse;

+ (instancetype)sharedInstance;
- (void)startMonitoring;
- (void)stopMonitoring;
- (BOOL)isMicrophoneInUse;
- (BOOL)isCameraInUse;

@end

#ifdef __cplusplus
}
#endif

#endif // MEDIA_MONITOR_H
```

**Step 2: Create Objective-C++ implementation**

```objc
// electron/native/src/media_monitor.mm
#import "media_monitor.h"

@implementation MediaMonitor {
    AudioObjectPropertyAddress _micPropertyAddress;
    BOOL _isMonitoring;
}

+ (instancetype)sharedInstance {
    static MediaMonitor *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[MediaMonitor alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _microphoneInUse = NO;
        _cameraInUse = NO;
        _isMonitoring = NO;
        _callback = NULL;

        // Set up property address for microphone "in use" detection
        _micPropertyAddress.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere;
        _micPropertyAddress.mScope = kAudioObjectPropertyScopeGlobal;
        _micPropertyAddress.mElement = kAudioObjectPropertyElementMain;
    }
    return self;
}

static OSStatus microphoneCallback(
    AudioObjectID inObjectID,
    UInt32 inNumberAddresses,
    const AudioObjectPropertyAddress *inAddresses,
    void *inClientData
) {
    MediaMonitor *monitor = (__bridge MediaMonitor *)inClientData;
    [monitor checkMicrophoneState];
    return noErr;
}

- (void)startMonitoring {
    if (_isMonitoring) return;
    _isMonitoring = YES;

    // Get default input device
    AudioObjectPropertyAddress defaultDeviceAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    AudioDeviceID inputDevice;
    UInt32 size = sizeof(inputDevice);
    OSStatus status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &defaultDeviceAddress,
        0,
        NULL,
        &size,
        &inputDevice
    );

    if (status == noErr && inputDevice != kAudioDeviceUnknown) {
        // Add listener for microphone state changes
        AudioObjectAddPropertyListener(
            inputDevice,
            &_micPropertyAddress,
            microphoneCallback,
            (__bridge void *)self
        );

        // Check initial state
        [self checkMicrophoneState];
    }

    // Start camera monitoring
    [self startCameraMonitoring];
}

- (void)checkMicrophoneState {
    AudioObjectPropertyAddress defaultDeviceAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    AudioDeviceID inputDevice;
    UInt32 size = sizeof(inputDevice);
    OSStatus status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &defaultDeviceAddress,
        0,
        NULL,
        &size,
        &inputDevice
    );

    if (status != noErr || inputDevice == kAudioDeviceUnknown) {
        return;
    }

    UInt32 isRunning = 0;
    size = sizeof(isRunning);
    status = AudioObjectGetPropertyData(
        inputDevice,
        &_micPropertyAddress,
        0,
        NULL,
        &size,
        &isRunning
    );

    if (status == noErr) {
        BOOL wasInUse = _microphoneInUse;
        _microphoneInUse = (isRunning != 0);

        if (wasInUse != _microphoneInUse && _callback) {
            _callback(_microphoneInUse, "microphone");
        }
    }
}

- (void)startCameraMonitoring {
    // Observe all video devices
    NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *device in devices) {
        [device addObserver:self
                 forKeyPath:@"inUseByAnotherClient"
                    options:NSKeyValueObservingOptionNew
                    context:NULL];
    }

    // Also monitor device connections for new cameras
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(deviceConnected:)
                                                 name:AVCaptureDeviceWasConnectedNotification
                                               object:nil];

    // Check initial state
    [self checkCameraState];
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary *)change
                       context:(void *)context {
    if ([keyPath isEqualToString:@"inUseByAnotherClient"]) {
        [self checkCameraState];
    }
}

- (void)deviceConnected:(NSNotification *)notification {
    AVCaptureDevice *device = notification.object;
    if ([device hasMediaType:AVMediaTypeVideo]) {
        [device addObserver:self
                 forKeyPath:@"inUseByAnotherClient"
                    options:NSKeyValueObservingOptionNew
                    context:NULL];
    }
}

- (void)checkCameraState {
    BOOL anyInUse = NO;
    NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *device in devices) {
        if (device.isInUseByAnotherClient) {
            anyInUse = YES;
            break;
        }
    }

    BOOL wasInUse = _cameraInUse;
    _cameraInUse = anyInUse;

    if (wasInUse != _cameraInUse && _callback) {
        _callback(_cameraInUse, "camera");
    }
}

- (void)stopMonitoring {
    if (!_isMonitoring) return;
    _isMonitoring = NO;

    // Remove microphone listener
    AudioObjectPropertyAddress defaultDeviceAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };

    AudioDeviceID inputDevice;
    UInt32 size = sizeof(inputDevice);
    OSStatus status = AudioObjectGetPropertyData(
        kAudioObjectSystemObject,
        &defaultDeviceAddress,
        0,
        NULL,
        &size,
        &inputDevice
    );

    if (status == noErr && inputDevice != kAudioDeviceUnknown) {
        AudioObjectRemovePropertyListener(
            inputDevice,
            &_micPropertyAddress,
            microphoneCallback,
            (__bridge void *)self
        );
    }

    // Remove camera observers
    NSArray *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *device in devices) {
        @try {
            [device removeObserver:self forKeyPath:@"inUseByAnotherClient"];
        } @catch (NSException *exception) {
            // Observer wasn't registered
        }
    }

    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (BOOL)isMicrophoneInUse {
    return _microphoneInUse;
}

- (BOOL)isCameraInUse {
    return _cameraInUse;
}

@end
```

**Step 3: Commit**

```bash
git add electron/native/src/media_monitor.h electron/native/src/media_monitor.mm
git commit -m "feat: implement Core Audio mic and AVFoundation camera detection"
```

---

## Task 3: Create N-API Bindings

**Files:**
- Create: `electron/native/src/index.cpp`

**Step 1: Create N-API bindings**

```cpp
// electron/native/src/index.cpp
#include <napi.h>
#include "media_monitor.h"

// Store reference to JS callback function
static Napi::ThreadSafeFunction tsfn;
static bool tsfnInitialized = false;

// Callback from Objective-C
void mediaStateChanged(bool isActive, const char* deviceType) {
    if (!tsfnInitialized) return;

    // Create data to pass to JS
    struct CallbackData {
        bool isActive;
        std::string deviceType;
    };

    auto* data = new CallbackData{isActive, std::string(deviceType)};

    tsfn.BlockingCall(data, [](Napi::Env env, Napi::Function jsCallback, CallbackData* data) {
        jsCallback.Call({
            Napi::Boolean::New(env, data->isActive),
            Napi::String::New(env, data->deviceType)
        });
        delete data;
    });
}

Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Create thread-safe function for callbacks
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "MediaMonitorCallback",
        0,
        1
    );
    tsfnInitialized = true;

    // Set callback and start monitoring
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    monitor.callback = mediaStateChanged;
    [monitor startMonitoring];

    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    [monitor stopMonitoring];
    monitor.callback = NULL;

    if (tsfnInitialized) {
        tsfn.Release();
        tsfnInitialized = false;
    }

    return env.Undefined();
}

Napi::Value IsMicrophoneInUse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    return Napi::Boolean::New(env, [monitor isMicrophoneInUse]);
}

Napi::Value IsCameraInUse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    MediaMonitor *monitor = [MediaMonitor sharedInstance];
    return Napi::Boolean::New(env, [monitor isCameraInUse]);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start", Napi::Function::New(env, Start));
    exports.Set("stop", Napi::Function::New(env, Stop));
    exports.Set("isMicrophoneInUse", Napi::Function::New(env, IsMicrophoneInUse));
    exports.Set("isCameraInUse", Napi::Function::New(env, IsCameraInUse));
    return exports;
}

NODE_API_MODULE(media_monitor, Init)
```

**Step 2: Commit**

```bash
git add electron/native/src/index.cpp
git commit -m "feat: add N-API bindings for media monitor"
```

---

## Task 4: Create TypeScript Wrapper

**Files:**
- Create: `electron/native/index.ts`
- Create: `electron/native/index.d.ts`

**Step 1: Create TypeScript type definitions**

```typescript
// electron/native/index.d.ts
export interface MediaMonitor {
    start(callback: (isActive: boolean, deviceType: 'microphone' | 'camera') => void): void;
    stop(): void;
    isMicrophoneInUse(): boolean;
    isCameraInUse(): boolean;
}

declare const mediaMonitor: MediaMonitor;
export default mediaMonitor;
```

**Step 2: Create TypeScript wrapper with EventEmitter**

```typescript
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
```

**Step 3: Commit**

```bash
git add electron/native/index.ts electron/native/index.d.ts
git commit -m "feat: add TypeScript wrapper for media monitor with EventEmitter"
```

---

## Task 5: Update Types for System Audio Recording

**Files:**
- Modify: `electron/meeting/types.ts`

**Step 1: Add 'System Audio' to MeetingPlatform type**

In `electron/meeting/types.ts`, update the `MeetingPlatform` type:

```typescript
export type MeetingPlatform =
    | 'Zoom'
    | 'Microsoft Teams'
    | 'Google Meet'
    | 'Discord'
    | 'Slack'
    | 'FaceTime'
    | 'Webex'
    | 'Skype'
    | 'Zoom Web'
    | 'Teams Web'
    | 'System Audio';  // NEW: for hardware-triggered recordings
```

**Step 2: Add new IPC channels**

Add to `MEETING_IPC_CHANNELS`:

```typescript
export const MEETING_IPC_CHANNELS = {
    // ... existing channels ...
    SET_ACTIVE_ENTRY: 'meeting:set-active-entry',
    GET_MEDIA_STATUS: 'meeting:get-media-status',
} as const;
```

**Step 3: Add new events**

Add to `MEETING_EVENTS`:

```typescript
export const MEETING_EVENTS = {
    // ... existing events ...
    MEDIA_STARTED: 'media-started',
    MEDIA_STOPPED: 'media-stopped',
} as const;
```

**Step 4: Commit**

```bash
git add electron/meeting/types.ts
git commit -m "feat: add System Audio platform and new IPC channels for media detection"
```

---

## Task 6: Implement RecordingManager

**Files:**
- Create: `electron/meeting/recordingManager.ts`

**Step 1: Create RecordingManager class**

```typescript
// electron/meeting/recordingManager.ts
import { EventEmitter } from 'events';
import { mediaMonitor } from '../native';
import { AudioRecorder, getAudioRecorder } from './audioRecorder';
import { MEETING_EVENTS, MeetingPlatform } from './types';

export class RecordingManager extends EventEmitter {
    private static instance: RecordingManager | null = null;

    private audioRecorder: AudioRecorder;
    private activeEntryId: string | null = null;
    private isEnabled: boolean = true;

    private constructor() {
        super();
        this.audioRecorder = getAudioRecorder();
        this.setupMediaMonitorListeners();
    }

    public static getInstance(): RecordingManager {
        if (!RecordingManager.instance) {
            RecordingManager.instance = new RecordingManager();
        }
        return RecordingManager.instance;
    }

    private setupMediaMonitorListeners(): void {
        mediaMonitor.on('mic-started', () => this.onMediaStarted('microphone'));
        mediaMonitor.on('mic-stopped', () => this.onMediaStopped('microphone'));
        mediaMonitor.on('camera-started', () => this.onMediaStarted('camera'));
        mediaMonitor.on('camera-stopped', () => this.onMediaStopped('camera'));
    }

    /**
     * Start monitoring for media device usage
     */
    public start(): void {
        mediaMonitor.start();
        console.log('[RecordingManager] Started media monitoring');
    }

    /**
     * Stop monitoring
     */
    public stop(): void {
        mediaMonitor.stop();

        // Stop any active recording
        if (this.audioRecorder.isRecording()) {
            this.audioRecorder.stopRecording();
        }

        console.log('[RecordingManager] Stopped media monitoring');
    }

    /**
     * Set the active time entry ID
     * Recording will only happen when an entry is active
     */
    public setActiveEntry(entryId: string | null): void {
        const wasActive = this.activeEntryId !== null;
        this.activeEntryId = entryId;

        console.log('[RecordingManager] Active entry changed:', {
            from: wasActive ? 'active' : 'none',
            to: entryId ? entryId : 'none'
        });

        if (entryId) {
            // Entry became active - check if media is already in use
            if (mediaMonitor.isMediaInUse() && !this.audioRecorder.isRecording()) {
                this.startRecording();
            }
        } else {
            // Entry stopped - stop any recording
            if (this.audioRecorder.isRecording()) {
                this.audioRecorder.stopRecording();
            }
        }
    }

    /**
     * Get the active entry ID
     */
    public getActiveEntry(): string | null {
        return this.activeEntryId;
    }

    /**
     * Enable/disable auto-recording
     */
    public setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;

        if (!enabled && this.audioRecorder.isRecording()) {
            this.audioRecorder.stopRecording();
        }
    }

    /**
     * Check if auto-recording is enabled
     */
    public isAutoRecordingEnabled(): boolean {
        return this.isEnabled;
    }

    /**
     * Get current media status
     */
    public getMediaStatus(): { micInUse: boolean; cameraInUse: boolean; isRecording: boolean } {
        return {
            micInUse: mediaMonitor.isMicrophoneInUse(),
            cameraInUse: mediaMonitor.isCameraInUse(),
            isRecording: this.audioRecorder.isRecording()
        };
    }

    private onMediaStarted(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] ${device} started`);

        this.emit(MEETING_EVENTS.MEDIA_STARTED, { device });

        // Only start recording if:
        // 1. Auto-recording is enabled
        // 2. There's an active entry
        // 3. We're not already recording
        if (!this.isEnabled) {
            console.log('[RecordingManager] Auto-recording disabled, skipping');
            return;
        }

        if (!this.activeEntryId) {
            console.log('[RecordingManager] No active entry, skipping recording');
            return;
        }

        if (this.audioRecorder.isRecording()) {
            console.log('[RecordingManager] Already recording, continuing');
            return;
        }

        this.startRecording();
    }

    private onMediaStopped(device: 'microphone' | 'camera'): void {
        console.log(`[RecordingManager] ${device} stopped`);

        this.emit(MEETING_EVENTS.MEDIA_STOPPED, { device });

        // Only stop recording if BOTH mic and camera are inactive
        if (!mediaMonitor.isMicrophoneInUse() && !mediaMonitor.isCameraInUse()) {
            if (this.audioRecorder.isRecording()) {
                console.log('[RecordingManager] All media stopped, stopping recording');
                this.audioRecorder.stopRecording();
            }
        } else {
            console.log('[RecordingManager] Other media still active, continuing recording');
        }
    }

    private async startRecording(): Promise<void> {
        if (!this.activeEntryId) {
            console.error('[RecordingManager] Cannot start recording without active entry');
            return;
        }

        const platform: MeetingPlatform = 'System Audio';
        const result = await this.audioRecorder.startRecording(this.activeEntryId, platform);

        if (result.success) {
            console.log('[RecordingManager] Recording started:', result.recordingId);
        } else {
            console.error('[RecordingManager] Failed to start recording:', result.error);
        }
    }
}

// Export singleton getter
export function getRecordingManager(): RecordingManager {
    return RecordingManager.getInstance();
}
```

**Step 2: Commit**

```bash
git add electron/meeting/recordingManager.ts
git commit -m "feat: implement RecordingManager to orchestrate media detection and recording"
```

---

## Task 7: Wire Up IPC Handlers in Main Process

**Files:**
- Modify: `electron/main.ts`

**Step 1: Import RecordingManager at top of main.ts**

Add near other imports:

```typescript
import { getRecordingManager } from './meeting/recordingManager';
import { MEETING_IPC_CHANNELS } from './meeting/types';
```

**Step 2: Initialize RecordingManager after app is ready**

In the `app.whenReady()` handler or after window creation, add:

```typescript
// Initialize recording manager for mic/camera detection
const recordingManager = getRecordingManager();
recordingManager.start();
```

**Step 3: Add IPC handler for setting active entry**

Add IPC handler (near other ipcMain handlers):

```typescript
// Recording Manager IPC handlers
ipcMain.handle(MEETING_IPC_CHANNELS.SET_ACTIVE_ENTRY, (event, entryId: string | null) => {
    const recordingManager = getRecordingManager();
    recordingManager.setActiveEntry(entryId);
    return { success: true };
});

ipcMain.handle(MEETING_IPC_CHANNELS.GET_MEDIA_STATUS, () => {
    const recordingManager = getRecordingManager();
    return recordingManager.getMediaStatus();
});

ipcMain.handle(MEETING_IPC_CHANNELS.GET_RECORDING_STATUS, () => {
    const { getAudioRecorder } = require('./meeting/audioRecorder');
    return getAudioRecorder().getStatus();
});
```

**Step 4: Update timer state handler to notify RecordingManager**

Find the `ipcMain.on('update-timer-display', ...)` handler and update it:

```typescript
ipcMain.on('update-timer-display', (event, timerData: { isRunning: boolean; isPaused: boolean; elapsed: number; startTime: number | null; entryId?: string }) => {
    // ... existing code ...

    // Notify RecordingManager of timer state changes
    const recordingManager = getRecordingManager();
    if (isNowRunning && !wasRunning && timerData.entryId) {
        // Timer started with entry
        recordingManager.setActiveEntry(timerData.entryId);
    } else if (!isNowRunning && wasRunning) {
        // Timer stopped
        recordingManager.setActiveEntry(null);
    }
});
```

**Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat: wire up RecordingManager IPC handlers in main process"
```

---

## Task 8: Update Renderer Timer Hook to Send Entry ID

**Files:**
- Modify: `src/hooks/useTimer.ts`

**Step 1: Update the IPC call to include entry context**

Find the `useEffect` that sends timer state to main process and update it to include entry tracking:

```typescript
// In useTimer.ts, find the effect that calls update-timer-display
useEffect(() => {
    // @ts-ignore
    if (window.electron && window.electron.ipcRenderer) {
        // @ts-ignore
        window.electron.ipcRenderer.send('update-timer-display', {
            isRunning,
            isPaused,
            elapsed,
            startTime,
            // Note: entryId will be set by the component that uses useTimer
            // when an entry is created/assigned
        });
    }
}, [isRunning, isPaused, elapsed, startTime]);
```

**Step 2: Add method to notify main process of entry**

Add a new function to the hook:

```typescript
const setActiveRecordingEntry = (entryId: string | null) => {
    // @ts-ignore
    if (window.electron?.ipcRenderer) {
        // @ts-ignore
        window.electron.ipcRenderer.invoke('meeting:set-active-entry', entryId);
    }
};

// Add to return object
return {
    isRunning, isPaused, elapsed, windowActivity,
    start, stop, pause, resume, reset, formatTime, checkPermissions,
    setActiveRecordingEntry  // NEW
};
```

**Step 3: Commit**

```bash
git add src/hooks/useTimer.ts
git commit -m "feat: add entry ID notification for recording manager"
```

---

## Task 9: Update Preload Script for New IPC Channels

**Files:**
- Modify: `electron/preload.cts`

**Step 1: Add new IPC methods to preload**

Find the `ipcRenderer` object in preload and add:

```typescript
// In the ipcRenderer object, add:
meeting: {
    setActiveEntry: (entryId: string | null) => ipcRenderer.invoke('meeting:set-active-entry', entryId),
    getMediaStatus: () => ipcRenderer.invoke('meeting:get-media-status'),
    getRecordingStatus: () => ipcRenderer.invoke('meeting:get-recording-status'),
}
```

**Step 2: Commit**

```bash
git add electron/preload.cts
git commit -m "feat: expose meeting/recording IPC methods in preload"
```

---

## Task 10: Update Package.json for Native Build

**Files:**
- Modify: `package.json`

**Step 1: Add native build scripts and dependencies**

Add to `scripts`:

```json
"build:native": "cd electron/native && npm install && npm run build",
"rebuild:native": "electron-rebuild -f -w media-monitor",
"postinstall": "npm run build:native || echo 'Native build skipped'"
```

Add to `dependencies`:

```json
"node-addon-api": "^7.0.0"
```

Add to `devDependencies`:

```json
"node-gyp": "^10.0.0",
"electron-rebuild": "^3.6.0"
```

**Step 2: Update electron-builder config to include native addon**

In the `build.files` array, ensure native addon is included:

```json
"files": [
    // ... existing entries ...
    "electron/native/build/**/*"
]
```

**Step 3: Commit**

```bash
git add package.json
git commit -m "build: add native addon build scripts and dependencies"
```

---

## Task 11: Test Native Addon Build

**Step 1: Install dependencies and build native addon**

```bash
cd electron/native
npm install
npm run build
```

**Step 2: Verify build succeeded**

Check that `electron/native/build/Release/media_monitor.node` exists.

**Step 3: Rebuild for Electron**

```bash
cd ../..  # back to project root
npx electron-rebuild -f -w media-monitor
```

**Step 4: Run the app in dev mode**

```bash
npm run dev:electron
```

**Step 5: Test mic/camera detection**

- Start a timer
- Open a video call or voice app
- Verify recording starts
- End the call
- Verify recording stops

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address any issues found during native addon testing"
```

---

## Task 12: Add Settings Toggle for Auto-Recording

**Files:**
- Modify: `src/context/SettingsContext.tsx` (add setting)
- Modify settings UI component (add toggle)

**Step 1: Add autoRecordMeetings setting**

In SettingsContext, add to the settings interface:

```typescript
autoRecordMeetings: boolean;
```

With default value `true`.

**Step 2: Add IPC to sync setting to main process**

When setting changes, notify main:

```typescript
// @ts-ignore
window.electron?.ipcRenderer?.invoke('meeting:set-enabled', autoRecordMeetings);
```

**Step 3: Add UI toggle**

In settings panel, add toggle for "Auto-record when mic/camera in use".

**Step 4: Commit**

```bash
git add src/context/SettingsContext.tsx src/components/Settings*.tsx
git commit -m "feat: add settings toggle for auto-recording"
```

---

## Summary

After completing all tasks:

1. **Native addon** detects mic/camera usage via Core Audio and AVFoundation
2. **RecordingManager** orchestrates detection with AudioRecorder
3. **Timer integration** notifies main process of active entry
4. **IPC handlers** bridge renderer and main process
5. **Settings toggle** allows user control

Total commits: 12
Estimated files changed: 15+
