# Mic/Camera Detection for Auto Audio Recording

## Overview

Replace window-title-based meeting detection with hardware-level mic/camera detection to automatically trigger audio recording when the user is in any call or meeting.

## Goals

- Detect when any app uses the microphone or camera
- Auto-start audio recording (mic + system audio) when detected
- Auto-stop recording when mic AND camera are both inactive
- Link recordings to the active time entry as contextual data

## User Flow

```
9:00 AM  ─── Start Timer (Entry: "Client Project") ───
   │
9:30 AM  ─── Mic activates (Zoom call) ────────────────
   │           └─► Audio recording starts
   │               └─► Linked to "Client Project"
   │
10:15 AM ─── Mic stops ────────────────────────────────
   │           └─► Audio recording stops & saved
   │               └─► Attached to entry as context
   │
11:00 AM ─── Mic activates (another call) ─────────────
   │           └─► New recording starts
   │               └─► Same entry, second recording
   │
5:00 PM  ─── Stop Timer ───────────────────────────────
               └─► Entry has 2 audio recordings
```

## Architecture

```
┌──────────────────┐     events      ┌──────────────────┐
│   MediaMonitor   │ ──────────────► │  AudioRecorder   │
│  (native addon)  │                 │   (existing)     │
└──────────────────┘                 └──────────────────┘
        │                                    │
        │ mic-started / camera-started       │ startRecording()
        │ mic-stopped / camera-stopped       │ stopRecording()
        ▼                                    ▼
┌─────────────────────────────────────────────────────────┐
│                   RecordingManager                      │
│  - Listens to MediaMonitor events                       │
│  - Coordinates start/stop with AudioRecorder            │
│  - Requires active time entry to record                 │
│  - Handles edge cases (mic only, camera only, both)     │
└─────────────────────────────────────────────────────────┘
```

## Components

### 1. Native Addon: media-monitor

A Node.js N-API module written in Objective-C++ for macOS.

**File structure:**
```
electron/native/
├── binding.gyp              # Build configuration
├── src/
│   ├── media_monitor.mm     # Objective-C++ implementation
│   ├── media_monitor.h      # Header
│   └── index.cpp            # N-API bindings
└── index.ts                 # TypeScript wrapper
```

**Core Audio detection (microphone):**
- Uses `AudioObjectAddPropertyListener` on `kAudioDevicePropertyDeviceIsRunningSomewhere`
- Event-driven, no polling required
- Fires when ANY app starts/stops using the mic

**AVFoundation detection (camera):**
- Uses KVO on `AVCaptureDevice.isInUseByAnotherApplication`
- Event-driven, no polling required
- Fires when ANY app starts/stops using the camera

**TypeScript API:**
```typescript
interface MediaMonitor {
  start(): void;
  stop(): void;
  isMicrophoneInUse(): boolean;
  isCameraInUse(): boolean;
  on(event: 'mic-started' | 'mic-stopped' | 'camera-started' | 'camera-stopped', callback: () => void): void;
}
```

### 2. RecordingManager

Orchestrates MediaMonitor, AudioRecorder, and active time entry state.

**File:** `electron/meeting/recordingManager.ts`

**Key logic:**
- Recording starts when mic OR camera activates (and time entry is active)
- Recording stops only when BOTH mic AND camera are inactive
- No active time entry = no recording (mic/camera use is ignored)
- Multiple calls in one entry = multiple recordings attached

```typescript
class RecordingManager {
  private mediaMonitor: MediaMonitor;
  private audioRecorder: AudioRecorder;
  private activeEntryId: string | null = null;

  setActiveEntry(entryId: string | null): void;

  // Internal handlers
  private onMicStarted(): void;
  private onMicStopped(): void;
  private onCameraStarted(): void;
  private onCameraStopped(): void;
}
```

### 3. Types Update

**File:** `electron/meeting/types.ts`

Add new platform type:
```typescript
type MeetingPlatform =
  | 'Zoom' | 'Microsoft Teams' | ... // existing
  | 'System Audio';  // new - for hardware-triggered recordings
```

## Implementation Order

1. **Build native addon** (`media-monitor`)
   - Set up binding.gyp and build tooling
   - Implement Core Audio mic detection
   - Implement AVFoundation camera detection
   - Create N-API bindings
   - Create TypeScript wrapper with types

2. **Create RecordingManager**
   - Implement orchestration logic
   - Handle all edge cases (mic only, camera only, both, neither)
   - Integrate with existing AudioRecorder

3. **Integrate with time entry system**
   - Call `setActiveEntry()` when timer starts/stops
   - Wire up IPC handlers in main.ts

4. **Add settings toggle**
   - Enable/disable auto-recording feature
   - Store preference in user settings

## Files to Create

- `electron/native/binding.gyp`
- `electron/native/src/media_monitor.h`
- `electron/native/src/media_monitor.mm`
- `electron/native/src/index.cpp`
- `electron/native/index.ts`
- `electron/meeting/recordingManager.ts`

## Files to Modify

- `electron/main.ts` — IPC handlers for recording manager
- `electron/meeting/types.ts` — Add 'System Audio' platform type
- `package.json` — Add native build dependencies

## Build Dependencies

- `node-addon-api` — N-API C++ wrapper
- `node-gyp` — Native build tool
- `electron-rebuild` — Rebuild native modules for Electron

## Platform Support

- **macOS**: Full support via Core Audio + AVFoundation
- **Windows/Linux**: Future work (different APIs required)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No active time entry | Ignore mic/camera events |
| Mic starts, then camera starts | One recording continues |
| Mic stops, camera still on | Recording continues |
| Both stop | Recording stops |
| Entry stops while recording | Stop recording, save to entry |
| App quits while recording | Stop recording, save to entry |
