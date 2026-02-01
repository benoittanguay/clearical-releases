# Calendar Integration Design

## Overview

This feature adds Google Calendar as a context source for smarter AI decisions and enables users to create Focus Time events from completed work.

**Core Capabilities:**

- **Read**: Background sync keeps a local cache of calendar events (±2 hours from now), updated continuously while the app is open
- **Write**: Users can manually add completed time entries to their primary Google calendar as Focus Time events
- **AI Context**: Calendar event titles enrich the `ActivityContext` sent to AI models, improving description generation and bucket assignment suggestions
- **Splitting Assistant**: A new feature that analyzes long recordings using all available signals (calendar, apps, screenshots, window titles) to suggest semantic split points where the user switched between unrelated projects

**Architecture Pattern:**

Following the existing Jira/Tempo pattern:

```
React UI → IPC Bridge → Electron Main → Google Calendar API
                              ↓
                        SQLite Cache
```

A `CalendarService` abstraction layer in the main process handles Google-specific implementation, allowing future providers (Apple, Outlook) to be added without changing the rest of the system.

---

## Google Calendar Integration

### Authentication

OAuth2 flow via in-app browser popup. When the user clicks "Connect Google Calendar" in Settings:

1. Electron opens a `BrowserWindow` pointing to Google's OAuth consent screen
2. User grants calendar read/write permissions
3. App receives auth code, exchanges for access + refresh tokens
4. Tokens stored securely (using existing encryption patterns from Jira credentials)
5. Refresh token used to maintain access without re-prompting

**Required Scopes:**

- `calendar.readonly` - Read events for AI context
- `calendar.events` - Create new Focus Time events

### Background Sync

- Syncs events from 2 hours ago through 2 hours ahead (rolling 4-hour window)
- Polls every 5 minutes while app is running
- Stores events in new SQLite table: `calendar_events`
- Only stores event titles and time ranges (minimal data footprint)
- Cache invalidated on app restart or manual refresh

### Data Schema

```sql
calendar_events (
  id TEXT PRIMARY KEY,        -- Google event ID
  title TEXT,
  start_time INTEGER,         -- Unix timestamp
  end_time INTEGER,
  is_all_day BOOLEAN,
  synced_at INTEGER,
  provider TEXT DEFAULT 'google'
)
```

### Onboarding

New step added before Jira connection:

1. Welcome / Permissions (screen recording, accessibility)
2. **Connect Google Calendar** ← New step (skippable)
3. Connect Jira (optional)
4. Connect Tempo (optional, if Jira connected)
5. Ready to track

---

## AI Pipeline with Calendar Context

### Three-Stage AI Flow

All AI tasks use Gemini as the single provider.

```
Stage 1: Screenshot Analysis (per screenshot)
    Inputs: Screenshot image + app name + window title + user role

    Output: Natural language extraction of project/subject matter

    Examples:

    Figma screenshot:
    "Design of promotional banners for the BEEM Construction spring campaign,
     working on the 728x90 leaderboard variant, incorporating the updated
     orange brand color and new tagline 'Building Tomorrow Today'."

    VS Code screenshot:
    "Development of the calendar integration feature for TimePortal,
     implementing the Google OAuth authentication flow in the CalendarService,
     handling token refresh and error states."

    Jira screenshot:
    "Sprint planning for the Acme Corp mobile app project, reviewing and
     estimating tickets in the authentication epic, prioritizing the
     social login feature for the upcoming sprint."

Stage 2: Summary Description (per activity)
    Inputs: All screenshot analyses + window titles + apps + calendar context + duration
    Output: Cohesive summary of the activity

Stage 3: Bucket Assignment (per activity)
    Inputs: Summary description + available buckets + Jira issues + historical patterns
    Output: Bucket/Jira suggestion with confidence
```

### Where Calendar Context Enters

- **Stage 1**: App name, window title, user role (no calendar)
- **Stage 2**: Calendar context included - shapes the narrative
- **Stage 3**: Via summary description + historical patterns

### Reprocessing Rules

When activities are split, merged, or entries removed:

- **Stage 2 re-runs** → unless user has manually edited the description
- **Stage 3 re-runs** → unless user has manually assigned a bucket/Jira issue

Manual edits are preserved and lock that field from automatic updates.

### Extended ActivityContext

```typescript
interface ActivityContext {
  // Existing fields
  description: string;
  appNames: string[];
  windowTitles: string[];
  detectedTechnologies: string[];
  detectedActivities: string[];
  duration: number;
  startTime: number;

  // New calendar fields
  currentCalendarEvent: string | null;
  recentCalendarEvents: string[];      // Past 2 hours
  upcomingCalendarEvents: string[];    // Next 2 hours
}
```

---

## Splitting Assistant

### Purpose

After a long recording session (e.g., 4 hours), users often have context-switched between unrelated projects. The Splitting Assistant analyzes the full recording and suggests where to divide it into separate activities.

### How It Works

1. User clicks "Suggest Splits" on a long activity
2. Gemini analyzes all available signals across the recording:
   - Screenshot analyses (Stage 1 outputs)
   - Calendar events during the time range
   - App and window title changes
   - Timestamps and durations
3. AI identifies **semantic boundaries** - points where the user shifted to a genuinely different project or subject matter
4. Returns suggested split points with:
   - Proposed time ranges
   - Draft summary description for each segment
   - Suggested bucket/Jira for each segment

### What Triggers a Split Suggestion

- Shift from one client/project to another
- Transition from meeting to deep work (or vice versa)
- Context switch to unrelated subject matter

### What Does NOT Trigger a Split

- Switching apps within the same project (VS Code → Chrome for docs)
- Brief interruptions that return to the same work
- Similar tasks on the same project

### After User Accepts Splits

- Original activity divided into separate activities
- Stage 2 (summary) runs for each new segment
- Stage 3 (bucket assignment) runs for each new segment
- User can adjust before finalizing

---

## Splitting Assistant UI

### Timeline Interface

The user sees their recording as a horizontal timeline with:

- Total duration displayed (e.g., "4h 32m")
- Visual segments colored by detected project/subject
- Suggested cut points shown as draggable markers
- Thumbnail previews from screenshots at key moments

### Interaction Flow

1. **Initial View**: Timeline shows suggested segments with cut markers
2. **Hover on segment**: Shows preview card with draft description and suggested bucket
3. **Drag cut marker**: Adjust split point timing
4. **Click "+ Add split"**: Manually add a cut point
5. **Click "× Remove"**: Remove a suggested split
6. **Confirm**: Accept splits, creates separate activities

### Segment Preview Card

```
┌─────────────────────────────────────────┐
│ 9:00 AM - 10:30 AM (1h 30m)            │
│                                         │
│ "Sprint planning for the Acme Corp     │
│  mobile app, reviewing authentication  │
│  epic tickets..."                       │
│                                         │
│ Suggested: [Meetings] [ACME-142]       │
│                                         │
│ [Edit] [Remove Split]                  │
└─────────────────────────────────────────┘
```

### Prototype

HTML prototype available at: `prototypes/splitting-assistant.html`

---

## Writing Focus Time Events

### Trigger

User clicks "Add to Calendar" button on a completed time entry (manual action only).

### Event Structure

```typescript
interface FocusTimeEvent {
  summary: string;        // "Focus Time: [Bucket Name]" or "Focus Time: [Jira Key]"
  description: string;    // AI-generated summary + Jira link if applicable
  start: DateTime;
  end: DateTime;
  colorId?: string;       // Match bucket color if possible
}
```

### Example Event

```
Title: Focus Time: Calendar Integration
Start: 10:30 AM
End: 12:00 PM
Description:
  Development of the calendar integration feature for TimePortal,
  implementing the Google OAuth authentication flow and background
  sync mechanism.

  Duration: 1h 30m
  Linked Issue: https://jira.example.com/browse/TP-89
```

### Constraints

- Only creates new events, never modifies existing
- Always writes to primary calendar
- Includes link back to Jira issue when available
- User can edit title/description before confirming

---

## Settings & Onboarding UI

### Settings Panel

New section in existing Settings:

```
┌─────────────────────────────────────────────────────────────┐
│ Calendar Integration                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Google Calendar                          [Connected ✓]     │
│ user@gmail.com                           [Disconnect]      │
│                                                             │
│ ─────────────────────────────────────────────────────────  │
│                                                             │
│ Context Window                                              │
│ How far back and ahead to consider calendar events          │
│ [± 2 hours ▼]                                              │
│                                                             │
│ ─────────────────────────────────────────────────────────  │
│                                                             │
│ Last synced: 2 minutes ago              [Sync Now]         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Onboarding Step

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│            📅 Connect Your Calendar                         │
│                                                             │
│   Help the AI understand your work context by              │
│   connecting your calendar. Meeting titles inform          │
│   smarter activity descriptions and bucket suggestions.    │
│                                                             │
│          [Connect Google Calendar]                          │
│                                                             │
│                  Skip for now                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Connection States

- **Not connected** - Shows "Connect" button
- **Connecting** - OAuth popup open, shows spinner
- **Connected** - Shows email, sync status, disconnect option
- **Error** - Shows error message with retry option

---

## Error Handling & Edge Cases

### Authentication Errors

| Scenario | Behavior |
|----------|----------|
| OAuth denied/cancelled | Return to settings, show "Connection cancelled" |
| Token refresh fails | Show "Session expired" toast, prompt to reconnect |
| Account disconnected externally | Detect on next sync, prompt to reconnect |

### Sync Errors

| Scenario | Behavior |
|----------|----------|
| Network offline | Use cached events, show "Offline" indicator |
| API rate limited | Back off exponentially, continue with cache |
| Partial sync failure | Log error, continue with available data |

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No calendar events in window | AI proceeds without calendar context (graceful degradation) |
| All-day events | Include in context as "All day: [title]" |
| Recurring events | Treat each occurrence as separate event |
| Multiple overlapping events | Include all in context, let AI reason about which is relevant |
| User deletes Focus Time event externally | No action needed (we only create, never track) |
| Calendar disconnected mid-recording | Continue recording, AI uses cached events until they expire |

### Splitting Assistant Edge Cases

| Scenario | Behavior |
|----------|----------|
| Recording too short (<15 min) | Hide "Suggest Splits" button |
| No clear split points detected | Navigate directly to Activity Details (silent, no message) |
| AI limit reached (free tier) | Show upgrade prompt or allow manual splitting only |

---

## Provider Abstraction

### CalendarProvider Interface

To support Google now and Apple/Outlook later:

```typescript
interface CalendarProvider {
  id: string;                    // 'google', 'apple', 'outlook'
  name: string;                  // 'Google Calendar'

  // Auth
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Read
  getEvents(start: Date, end: Date): Promise<CalendarEvent[]>;

  // Write
  createFocusTimeEvent(entry: TimeEntry): Promise<string>;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  provider: string;
}
```

### CalendarService

Main process service that:

- Manages active provider
- Handles background sync scheduling
- Caches events to SQLite
- Exposes IPC methods to renderer

### Implementation Order

1. `GoogleCalendarProvider` - full implementation
2. `CalendarService` - provider-agnostic orchestration
3. Future: `AppleCalendarProvider`, `OutlookCalendarProvider` slot in with no changes to rest of app

---

## Summary

| Aspect | Decision |
|--------|----------|
| Provider | Google Calendar first, abstraction for future providers |
| Auth | In-app OAuth popup |
| Read | Background sync, ±2 hour window, titles only |
| Write | Manual "Add to Calendar", Focus Time events only, primary calendar |
| AI | Gemini for all tasks, 3-stage pipeline (screenshot → summary → assignment) |
| Context | Calendar enriches Stage 2 (summary) and indirectly Stage 3 |
| Splitting | All signals (calendar, screenshots, apps, window titles), semantic boundaries |
| UI | Timeline with draggable cut markers, segment preview cards |
| Onboarding | New step before Jira, skippable |
| Free tier | Feature available to all, AI operations count against limits |
| Errors | Graceful degradation, silent navigation when no splits found |

### New Components

- `GoogleCalendarProvider` - OAuth + API integration
- `CalendarService` - sync orchestration + caching
- `CalendarContext` extension to `ActivityContext`
- Splitting Assistant UI (modal with timeline)
- Settings panel for calendar
- Onboarding step for calendar
