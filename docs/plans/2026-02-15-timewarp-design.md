# TimeWarp Feature Design

## Overview

TimeWarp lets users retroactively capture work done *before* starting the chrono timer. The app continuously tracks window activity and captures screenshots in the background from launch. A horizontal timeline at the bottom of the chrono screen shows this activity, and a draggable playhead lets the user set a retroactive start time.

## Architecture: Ring Buffer in Main Process

A `BackgroundActivityTracker` singleton runs in the Electron main process from app-ready. It maintains an in-memory ring buffer of activities with a 12-hour TTL. No SQLite persistence — data is ephemeral and lost on restart, which is acceptable for pre-timer activity.

### BackgroundActivity Data Structure

```typescript
interface BackgroundActivity {
  id: string;
  appName: string;
  windowTitle: string;
  bundleId: string;
  browserProfile?: string;
  startTimestamp: number;
  endTimestamp: number;
  isMeeting: boolean;
  screenshotPaths: string[];
}
```

### Tracker Behavior

- Polls active window every 1 second (reuses existing AppleScript `getActiveWindow` logic)
- Groups consecutive same-app activity into single entries (same grouping logic as `useTimer`)
- Captures screenshots on significant window changes — stored in `userData/background-captures/`, no AI analysis yet
- Meeting detection: mic-active + recognized meeting app → `isMeeting: true`
- Respects the app blacklist — no captures or nodes for blacklisted apps
- **Pauses when timer is running** — `useTimer` takes over; resumes when timer stops
- **12-hour TTL cleanup** every 10 minutes: prunes old entries and deletes orphan screenshot files

### IPC API

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `get-background-activities` | invoke | Returns `BackgroundActivity[]` for the last N hours |
| `background-activities-update` | push | Streams activity updates to renderer |
| `claim-background-activities` | invoke | Claims a time range, returns activities, removes from buffer, moves screenshots to main dir |
| `pause-background-tracker` | send | Pauses tracking (called when timer starts) |
| `resume-background-tracker` | send | Resumes tracking (called when timer stops) |

## Timeline UI

### Component: `src/components/TimeWarpTimeline.tsx`

Anchored to the bottom of the chrono page, full-width, rendered directly on the page background (no card/container). Always visible regardless of timer state.

### Visual Layout

```
  9:00      10:00      11:00      12:00   |▶  12:34
  ──●────────●──◆──────●──────●────●──────|──────→ NOW
    VS Code  Chrome Zoom  Slack  VS Code  ↑playhead
```

- **Orientation:** Right-to-left. "Now" pinned to right edge, older activity extends left.
- **Nodes:** Circles (●) for app switches, diamonds (◆) for meetings. Color-coded by app (hue from bundle ID hash).
- **Hour markings:** Tick marks with labels at each hour, smaller ticks at half-hours.
- **Playhead:** Draggable vertical accent-colored line. Defaults to "now".
- **Hover tooltip:** App name, window title, timestamp.
- **Visible window:** Last 2 hours by default, scrollable left for up to 12h of history.
- **Compact height:** ~60px, slight expand on hover for better interaction.

### Interaction States

**Timer stopped:**
- Playhead freely draggable left/right
- Dragging sets a `proposedStartTime` displayed above the timeline
- Pressing START uses `proposedStartTime` as the timer's `startTime`

**Timer running:**
- Playhead locked at the timer's `startTime`
- Can be dragged further left to extend start time (calls `adjustStartTime`)
- Cannot be dragged right past the original start
- New activities from `useTimer` append in real-time to the right

### Props

```typescript
interface TimeWarpTimelineProps {
  backgroundActivities: BackgroundActivity[];
  timerActivities?: WindowActivity[];
  timerStartTime: number | null;
  isRunning: boolean;
  onStartTimeChange: (timestamp: number) => void;
}
```

## Data Flow

### Starting timer with retroactive time

1. Background tracker polls windows + captures screenshots continuously
2. Renderer subscribes via IPC, receives `BackgroundActivity[]` updates
3. User drags playhead left to a past timestamp → `proposedStartTime` set
4. User clicks START → `useTimer.start(overrideStartTime)` called
5. `useTimer` calls `claim-background-activities(proposedStartTime, now)`:
   - Returns background activities in that range
   - Converts them to `WindowActivity[]` format
   - Moves screenshots from `background-captures/` to main screenshots dir
   - Queues screenshots for AI analysis (deferred analysis)
   - Removes claimed activities from ring buffer
6. Background tracker pauses; `useTimer` takes over live polling

### Extending start time while running

1. User drags playhead further left → `adjustStartTime(newTimestamp)` called
2. `claim-background-activities(newStartTime, oldStartTime)` returns gap activities
3. Activities prepended to `WindowActivity[]`
4. `startTime` updated, elapsed recalculates
5. Newly claimed screenshots queued for AI analysis

## Modifications to Existing Code

### `useTimer.ts`
- `start(overrideStartTime?: number)` — optional parameter to set retroactive start
- New `adjustStartTime(newStartTime: number)` method for live adjustment
- Both call claim IPC and merge background activities into `windowActivityRef`
- Send pause/resume IPC to background tracker on start/stop

### `App.tsx`
- Render `<TimeWarpTimeline>` at the bottom of the chrono screen, below controls
- Wire up `BackgroundActivityContext` provider

### `electron/main.ts`
- Initialize `BackgroundActivityTracker` after app ready
- Register IPC handlers for the 5 channels listed above

## New Files

| File | Purpose |
|------|---------|
| `electron/backgroundActivityTracker.ts` | Main process ring buffer + polling service |
| `src/components/TimeWarpTimeline.tsx` | Timeline UI component |
| `src/context/BackgroundActivityContext.tsx` | React context wrapping IPC subscription |

## Cleanup & Error Handling

- **12-hour TTL:** Background tracker prunes entries and deletes screenshot files every 10 minutes
- **App quit:** Delete all unclaimed background screenshots on clean exit
- **Screenshot storage:** Background screenshots in `userData/background-captures/`, moved to main dir when claimed
- **System sleep/wake:** Tracker resumes on wake; gap in timeline is fine
- **Playhead in gap:** Start time still adjusts; activity list simply has no entries for the gap
- **Permission denied:** Activity node still appears without screenshots (graceful degradation)
- **AI analysis timeout on stop:** Same as current — `stop()` waits up to 10s for pending analyses
