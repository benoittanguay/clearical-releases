# Recording System Unification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the recording widget and Chrono page audio controls into a single coherent system — same data, same state, same stop behavior.

**Architecture:** Eliminate renderer-side state duplication by routing all recording actions through canonical start/stop functions. Expose audio levels from AudioRecordingContext directly to RecordingControls (no IPC round-trip). Unify session ID generation into one function.

**Tech Stack:** React context, Electron IPC, TypeScript

---

### Task 1: Verify existing tests pass (baseline)

**Files:**
- None (verification only)

**Step 1: Build and run tests**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

This establishes the green baseline before any refactoring.

---

### Task 2: Add audio level subscription to AudioRecordingContext

**Why:** RecordingControls currently listens on `widget:audio-levels` IPC channel — a channel only sent to the widget window, not the main window. This means the Chrono waveform shows flat bars (no real audio data). By exposing audio levels from context, RecordingControls gets data directly from the source — no IPC round-trip needed.

**Files:**
- Modify: `src/context/AudioRecordingContext.tsx:34-82` (interface), `:210-220` (refs), `:626-631` (setInterval), `:1532-1546` (value)

**Step 1: Add subscription type to AudioRecordingContextValue interface**

In `src/context/AudioRecordingContext.tsx`, add to the interface (after `onTranscriptionComplete` at line 81):

```typescript
    /**
     * Subscribe to real-time audio level updates (called ~20fps during recording).
     * Returns unsubscribe function. Used by RecordingControls to get levels
     * without IPC round-trip (data is already in this renderer process).
     */
    subscribeToAudioLevels: (callback: (levels: number[], elapsedMs: number) => void) => () => void;
```

**Step 2: Add the ref and subscription function inside AudioRecordingProvider**

After the existing refs (around line 220, after `isStoppingRecordingRef`), add:

```typescript
    // Subscribers for audio level data (RecordingControls uses this instead of IPC)
    const audioLevelsSubscribersRef = useRef<Set<(levels: number[], elapsedMs: number) => void>>(new Set());

    const subscribeToAudioLevels = useCallback((callback: (levels: number[], elapsedMs: number) => void) => {
        audioLevelsSubscribersRef.current.add(callback);
        return () => { audioLevelsSubscribersRef.current.delete(callback); };
    }, []);
```

**Step 3: Notify subscribers in the setInterval**

In the setInterval at line 542, after the IPC send (line 631), add:

```typescript
                        // Notify in-process subscribers (RecordingControls waveform)
                        audioLevelsSubscribersRef.current.forEach(cb => cb(levels, elapsedMs));
```

**Step 4: Add to context value object**

In the value object at line 1532, add after `onTranscriptionComplete`:

```typescript
        subscribeToAudioLevels,
```

**Step 5: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS (additive change only)

**Step 6: Commit**

```bash
git add src/context/AudioRecordingContext.tsx
git commit -m "feat(recording): expose audio level subscription from AudioRecordingContext"
```

---

### Task 3: RecordingControls uses context for audio levels

**Why:** Achieves waveform visual parity between widget and Chrono controls. Both now receive the same raw frequency bins — no more accidental coupling to `widget:audio-levels` channel.

**Files:**
- Modify: `src/components/RecordingControls.tsx`

**Step 1: Replace IPC listener with context subscription**

Replace the entire file content of `src/components/RecordingControls.tsx`:

```typescript
/**
 * Recording Controls Component
 *
 * Displays audio recording controls with waveform visualization.
 * Placed below the split flap timer in the chrono page.
 *
 * Audio levels come directly from AudioRecordingContext (same renderer process)
 * rather than IPC — identical data to what the widget receives.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Waveform } from './Waveform';
import { useAudioRecording } from '../context/AudioRecordingContext';
import './RecordingControls.css';

interface RecordingControlsProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    disabled?: boolean;
    elapsedMs?: number;
}

export function RecordingControls({
    isRecording,
    onToggleRecording,
    disabled = false,
    elapsedMs = 0
}: RecordingControlsProps): React.ReactElement {
    const [audioLevels, setAudioLevels] = useState<number[]>([]);
    const [isVisible, setIsVisible] = useState(false);
    const [waveformWidth, setWaveformWidth] = useState(320);
    const waveformContainerRef = useRef<HTMLDivElement>(null);
    const { subscribeToAudioLevels } = useAudioRecording();

    // Animate in on mount
    useEffect(() => {
        const timer = setTimeout(() => setIsVisible(true), 100);
        return () => clearTimeout(timer);
    }, []);

    // Measure waveform container width for responsive sizing
    useEffect(() => {
        const container = waveformContainerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                if (width > 0) {
                    setWaveformWidth(Math.floor(width));
                }
            }
        });

        resizeObserver.observe(container);
        setWaveformWidth(Math.floor(container.offsetWidth) || 320);

        return () => resizeObserver.disconnect();
    }, []);

    // Subscribe to audio levels from context (same data widget receives)
    useEffect(() => {
        if (!isRecording) {
            setAudioLevels([]);
            return;
        }

        const unsubscribe = subscribeToAudioLevels((levels) => {
            setAudioLevels(levels);
        });

        return () => {
            unsubscribe();
            setAudioLevels([]);
        };
    }, [isRecording, subscribeToAudioLevels]);

    return (
        <div className={`recording-controls ${isVisible ? 'recording-controls--visible' : ''}`}>
            <button
                className={`recording-controls__button ${isRecording ? 'recording-controls__button--recording' : ''}`}
                onClick={onToggleRecording}
                disabled={disabled}
                title={isRecording ? 'Stop Recording' : 'Start Recording'}
            >
                {isRecording ? (
                    <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="recording-controls__icon"
                    >
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                ) : (
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="recording-controls__icon"
                    >
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                    </svg>
                )}
                {isRecording && <span className="recording-controls__pulse" />}
            </button>

            <div
                ref={waveformContainerRef}
                className={`recording-controls__waveform ${isRecording ? 'recording-controls__waveform--active' : ''}`}
            >
                <Waveform
                    isRecording={isRecording}
                    audioLevels={audioLevels}
                    elapsedMs={elapsedMs}
                    width={waveformWidth}
                    height={40}
                    variant="light"
                />
            </div>
        </div>
    );
}

export default RecordingControls;
```

**Key changes from original:**
- Removed: `AudioLevelData` interface, `audioLevel` state, `recentAudioLevelsRef`, weighted RMS calculation, IPC listener on `widget:audio-levels`
- Added: `useAudioRecording()` import, `subscribeToAudioLevels` from context, `audioLevels` state (array)
- Changed: Waveform now receives `audioLevels={audioLevels}` (raw bins) instead of `audioLevel={audioLevel}` (single scalar)
- Result: Waveform shows per-frequency-bin bars (same as widget) instead of uniform-height bars

**Step 2: Verify TypeScript compiles**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 3: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

**Step 4: Commit**

```bash
git add src/components/RecordingControls.tsx
git commit -m "feat(recording): RecordingControls uses context for audio levels (waveform parity with widget)"
```

---

### Task 4: Unify session ID generation

**Why:** Manual recording generates `session-${Date.now()}-${random}` while auto-detection uses `entryId` from RecordingManager. Having one generator ensures consistent format everywhere, preventing transcription lookup mismatches.

**Files:**
- Modify: `src/App.tsx:647,742` (3 generation sites)

**Step 1: Add generator function at module level**

At the top of `src/App.tsx` (after imports, before the component), add:

```typescript
/** Generate a unique recording session ID. Used as the key for transcription lookup. */
function generateRecordingSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
```

**Step 2: Replace all inline session ID generation**

Find and replace these 2 occurrences in `src/App.tsx`:

1. `handleToggleRecording` (line 647):
   ```
   // Before:
   const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
   // After:
   const sessionId = generateRecordingSessionId();
   ```

2. Tray toggle handler (line 742):
   ```
   // Before:
   const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
   // After:
   const sessionId = generateRecordingSessionId();
   ```

**Step 3: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(recording): extract generateRecordingSessionId to eliminate duplication"
```

---

### Task 5: Extract canonical start/stop recording functions

**Why:** Recording start logic is duplicated in `handleToggleRecording` and `tray:toggle-recording` handler. Recording stop logic is duplicated in 3 places (`handleToggleRecording`, `tray:toggle-recording`, `handleStartStop`). A single function for each eliminates the risk of divergence.

**Files:**
- Modify: `src/App.tsx:629-658` (handleToggleRecording), `:718-752` (tray handler), `:501-514` (timer stop)

**Step 1: Add canonical startRecording function**

In `src/App.tsx`, add after the `generateRecordingSessionId` function (before `handleToggleRecording`):

```typescript
  // Canonical recording start — all trigger points route through this
  const startRecording = useCallback(async (): Promise<boolean> => {
    const sessionId = generateRecordingSessionId();
    console.log('[App] Starting recording, sessionId:', sessionId);
    const result = await setActiveRecordingEntry(sessionId, true);
    if (result.success) {
      recordingSessionIdRef.current = sessionId;
      lastRecordingSessionIdRef.current = sessionId;
      setIsAudioRecording(true);
      return true;
    } else {
      console.error('[App] Failed to start recording:', result.error);
      return false;
    }
  }, [setActiveRecordingEntry]);

  // Canonical recording stop — all trigger points route through this
  const stopRecording = useCallback(async (): Promise<void> => {
    console.log('[App] Stopping recording');
    await setActiveRecordingEntry(null);
    recordingSessionIdRef.current = null;
    setIsAudioRecording(false);
  }, [setActiveRecordingEntry]);
```

**Step 2: Simplify handleToggleRecording**

Replace `handleToggleRecording` (lines 629-658) with:

```typescript
  const handleToggleRecording = async () => {
    if (recordingSessionIdRef.current) {
      await stopRecording();
    } else if (isRunning) {
      checkPermissions();
      await startRecording();
    }
  };
```

**Step 3: Simplify tray toggle handler**

Replace the tray recording handler (lines 718-752) with:

```typescript
      const unsubscribeRecording = window.electron.ipcRenderer.on('tray:toggle-recording', async () => {
        console.log('[Renderer] Tray toggle recording command received');
        if (recordingSessionIdRef.current) {
          await stopRecording();
        } else {
          if (!isRunning) {
            console.log('[Renderer] Timer not running, starting timer first');
            const permissions = await checkPermissions();
            if (!permissions.requiredGranted || !permissions.hasScreenRecording) {
              console.log('[Renderer] Missing permissions, showing modal');
              setShowPermissionModal(true);
              return;
            }
            startTimer();
          }
          await startRecording();
        }
      });
```

**Step 4: Simplify handleStartStop (timer stop path)**

Replace lines 510-514 (the recording stop section in handleStartStop) with:

```typescript
        // Stop recording — canonical function handles IPC + state cleanup
        await stopRecording();
```

This replaces:
```typescript
        await setActiveRecordingEntry(null);
        recordingSessionIdRef.current = null;
        setIsAudioRecording(false);
```

Note: The `sessionId` capture at line 507 must remain BEFORE `stopRecording()` is called, since `stopRecording()` nulls `recordingSessionIdRef.current`.

**Step 5: Update useEffect dependency arrays**

The tray toggle handler useEffect (line 759) needs `stopRecording` and `startRecording` in its dependencies:

```typescript
  }, [setActiveRecordingEntry, isRunning, checkPermissions, startTimer, stopRecording, startRecording]);
```

**Step 6: Verify TypeScript compiles**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 7: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

**Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(recording): canonical startRecording/stopRecording functions eliminate 3 duplicate stop paths"
```

---

### Task 6: Add recording state safety sync

**Why:** `App.tsx` (`isAudioRecording`) and `AudioRecordingContext` (`state.isRecording`) can desync if one side encounters an error. A safety sync catches and corrects the "ghost recording" state (UI shows recording but nothing is actually recording).

**Files:**
- Modify: `src/App.tsx:89` (useAudioRecording destructuring), add new useEffect

**Step 1: Destructure `state` from context**

In `src/App.tsx` line 89, add `state: recordingState` to the destructuring:

```typescript
  const { state: recordingState, clearPendingTranscription, getPendingTranscriptions, getPendingAudio, clearPendingAudio, onTranscriptionComplete } = useAudioRecording();
```

**Step 2: Add safety sync useEffect**

After the existing recording event listeners (after line 806), add:

```typescript
  // Safety sync: correct "ghost recording" state if context says not recording but App thinks it is
  // This catches edge cases where an error in AudioRecordingContext stops recording
  // but the stop event doesn't reach App.tsx (e.g., MediaRecorder error before onstop fires)
  useEffect(() => {
    if (!recordingState.isRecording && isAudioRecording) {
      console.warn('[App] Recording state desync detected — context says stopped, correcting App state');
      recordingSessionIdRef.current = null;
      setIsAudioRecording(false);
    }
  }, [recordingState.isRecording, isAudioRecording]);
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 4: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

**Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fix(recording): add safety sync to correct ghost recording state on desync"
```

---

### Task 7: Rename audio level IPC channel (semantic correctness)

**Why:** The IPC channel `widget:audio-levels` is semantically wrong — it carries recording audio data, not widget-specific data. Renaming to `recording:audio-levels` makes the architecture self-documenting and prevents future confusion.

**Files:**
- Modify: `electron/meeting/recordingWidgetManager.ts:351` (send channel)
- Modify: `src/components/RecordingWidget.tsx:160` (listener registration)

**Step 1: Update widget manager send channel**

In `electron/meeting/recordingWidgetManager.ts`, change the `webContents.send` call (around line 351):

```typescript
// Before:
this.widgetWindow.webContents.send('widget:audio-levels', {
// After:
this.widgetWindow.webContents.send('recording:audio-levels', {
```

**Step 2: Update widget listener registration**

In `src/components/RecordingWidget.tsx`, change the listener (around line 160):

```typescript
// Before:
const unsubscribeAudioLevels = onFn('widget:audio-levels', handleAudioLevels);
// After:
const unsubscribeAudioLevels = onFn('recording:audio-levels', handleAudioLevels);
```

**Step 3: Verify no other listeners on old channel name**

Search the codebase for `widget:audio-levels` to confirm no remaining references. RecordingControls no longer uses this channel (changed in Task 3).

Run: `grep -r "widget:audio-levels" src/ electron/ --include="*.ts" --include="*.tsx" --include="*.cts"`
Expected: No matches

**Step 4: Verify TypeScript compiles**

Run: `npx tsc -b --noEmit`
Expected: No errors

**Step 5: Verify tests still pass**

Run: `npm run build:electron-main && npx playwright test tests/e2e/audio-recording.spec.ts`
Expected: All 13 tests PASS

**Step 6: Commit**

```bash
git add electron/meeting/recordingWidgetManager.ts src/components/RecordingWidget.tsx
git commit -m "refactor(recording): rename widget:audio-levels → recording:audio-levels (semantic clarity)"
```

---

### Task 8: Final verification

**Step 1: Run full E2E test suite**

Run: `npm run build:electron-main && npx playwright test`
Expected: All tests PASS

**Step 2: Manual smoke test (dev mode)**

Run: `npm run dev:electron`

Verify:
1. Start timer → recording button appears, not disabled
2. Click mic button → waveform animates with frequency bars (same visual style as widget)
3. Widget appears with matching waveform data
4. Stop from Chrono button → widget closes immediately, recording stops
5. Start recording again → stop from widget → "exit" animation plays, then closes
6. Stop timer → entry created with transcription (if long enough)
7. Tray menu → "Start Recording" / "Stop Recording" works

---

## Summary of Changes

| Weakness | Fix | Files |
|----------|-----|-------|
| Audio levels: RecordingControls listened on widget IPC channel (no data arrived) | Subscribe to audio levels directly from AudioRecordingContext | `AudioRecordingContext.tsx`, `RecordingControls.tsx` |
| Waveform visual disparity: uniform bars vs frequency bins | Pass raw `audioLevels` array to Waveform (same as widget) | `RecordingControls.tsx` |
| Session ID inconsistency: random vs entryId format | `generateRecordingSessionId()` function used everywhere | `App.tsx` |
| 3 duplicate stop paths in renderer | Canonical `stopRecording()` function | `App.tsx` |
| 2 duplicate start paths in renderer | Canonical `startRecording()` function | `App.tsx` |
| State desync between App.tsx and AudioRecordingContext | Safety sync useEffect catches ghost recording | `App.tsx` |
| `widget:audio-levels` channel name misleading | Renamed to `recording:audio-levels` | `recordingWidgetManager.ts`, `RecordingWidget.tsx` |

## What's NOT Changed (Intentional)

- **Main process state** (`RecordingManager.isRendererRecording`): Must track its own state — inherent to Electron's multi-process model
- **Widget content modes**: Widget still manages its own animation lifecycle — this is correct for a floating window
- **Tray menu label**: Still reads from `RecordingManager.getMediaStatus()` on each right-click — inherent
- **Stop path asymmetry for widget animations**: Widget stop shows animation before close, Chrono stop is instant — this is correct UX (the widget's animation provides feedback when it's the control surface)
- **AudioRecordingContext's `state.isRecording`**: Remains the authoritative recording state for actual MediaRecorder/WebAudio lifecycle
