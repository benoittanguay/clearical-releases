# Analytics Tracking Design

**Created:** 2026-01-16
**Status:** Approved
**Purpose:** Track feature engagement and workflow patterns for product improvement

## Overview

Self-hosted analytics using Supabase with a single flexible events table. Users can opt-out via Settings (opt-out by default model).

## Database Schema

### New Table: `analytics_events`

```sql
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,           -- e.g., 'settings.changed', 'export.completed'
    properties JSONB DEFAULT '{}',      -- event-specific data
    session_id UUID,                    -- groups events in a single app session
    created_at TIMESTAMPTZ DEFAULT NOW(),
    app_version TEXT,                   -- track behavior across versions
    platform TEXT                       -- 'darwin', 'win32', 'linux'
);

-- Indexes for common queries
CREATE INDEX idx_analytics_user_date ON analytics_events(user_id, created_at);
CREATE INDEX idx_analytics_event_name ON analytics_events(event_name, created_at);
CREATE INDEX idx_analytics_session ON analytics_events(session_id);

-- RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events
CREATE POLICY "Users can insert own events" ON analytics_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Only service role can read all events (for analysis)
CREATE POLICY "Service role can read all events" ON analytics_events
    FOR SELECT USING (auth.role() = 'service_role');
```

### Profile Addition

```sql
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN DEFAULT TRUE;
```

## Event Naming Convention

Format: `category.action`

Examples:
- `onboarding.step_completed`
- `export.format_selected`
- `settings.theme_changed`

## Events to Track

### Onboarding & Auth
| Event | Properties |
|-------|------------|
| `onboarding.started` | — |
| `onboarding.step_completed` | `{ step: string }` |
| `onboarding.completed` | — |
| `onboarding.skipped` | `{ at_step: string }` |
| `auth.login` | `{ method: 'email' \| 'google' }` |
| `auth.logout` | — |

### Core Features
| Event | Properties |
|-------|------------|
| `timer.started` | `{ source: 'manual' \| 'auto' }` |
| `timer.stopped` | `{ duration_seconds: number }` |
| `assignment.selected` | `{ source: 'picker' \| 'ai_suggestion' }` |
| `assignment.ai_used` | — |
| `screenshot.viewed` | `{ from: 'gallery' \| 'history' }` |

### Settings & Configuration
| Event | Properties |
|-------|------------|
| `settings.opened` | — |
| `settings.changed` | `{ setting: string, value: any }` |
| `blacklist.app_added` | `{ app_name: string }` |
| `integration.configured` | `{ type: 'jira' \| 'other' }` |

### Export & Data
| Event | Properties |
|-------|------------|
| `export.opened` | — |
| `export.completed` | `{ format: 'csv' \| 'json', row_count: number }` |

## Client-Side Implementation

### Analytics Service (`src/services/analytics.ts`)

```typescript
interface AnalyticsEvent {
  event_name: string;
  properties?: Record<string, unknown>;
}

class AnalyticsService {
  private sessionId: string;
  private queue: AnalyticsEvent[] = [];
  private flushInterval: number = 30000; // 30 seconds

  constructor() {
    this.sessionId = crypto.randomUUID();
    setInterval(() => this.flush(), this.flushInterval);
    window.addEventListener('beforeunload', () => this.flush());
  }

  track(eventName: string, properties?: Record<string, unknown>) {
    if (!this.isEnabled()) return;

    this.queue.push({ event_name: eventName, properties });

    if (this.queue.length >= 10) this.flush();
  }

  private async flush() {
    if (this.queue.length === 0) return;
    const events = [...this.queue];
    this.queue = [];

    await window.electronAPI.sendAnalyticsEvents(events, this.sessionId);
  }

  private isEnabled(): boolean {
    return window.electronAPI.getAnalyticsEnabled();
  }
}

export const analytics = new AnalyticsService();
```

### Usage in Components

```typescript
import { analytics } from '../services/analytics';

// Track a simple event
analytics.track('settings.opened');

// Track with properties
analytics.track('export.completed', { format: 'csv', row_count: 150 });
```

## Main Process Handler (`electron/analyticsService.ts`)

```typescript
import { ipcMain, app } from 'electron';
import { supabase } from './supabaseClient';
import os from 'os';

export function setupAnalyticsHandlers() {
  ipcMain.handle('analytics:send-events', async (_, events, sessionId) => {
    const user = await getCurrentUser();
    if (!user) return { success: false };

    const rows = events.map((event: { event_name: string; properties?: Record<string, unknown> }) => ({
      user_id: user.id,
      event_name: event.event_name,
      properties: event.properties || {},
      session_id: sessionId,
      app_version: app.getVersion(),
      platform: os.platform(),
    }));

    const { error } = await supabase
      .from('analytics_events')
      .insert(rows);

    if (error) {
      console.error('Analytics insert failed:', error);
      return { success: false };
    }

    return { success: true };
  });
}
```

## Settings UI

Add toggle to Settings.tsx:

```tsx
<div className="setting-row">
  <div className="setting-label">
    <span>Help improve Clearical</span>
    <span className="setting-description">
      Send anonymous usage data to help us improve the app
    </span>
  </div>
  <label className="toggle">
    <input
      type="checkbox"
      checked={profile?.analytics_enabled ?? true}
      onChange={(e) => updateProfile({ analytics_enabled: e.target.checked })}
    />
    <span className="toggle-slider" />
  </label>
</div>
```

## Example Queries

### Daily Active Users
```sql
SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as dau
FROM analytics_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY day ORDER BY day;
```

### Feature Adoption
```sql
SELECT event_name, COUNT(*) as count, COUNT(DISTINCT user_id) as unique_users
FROM analytics_events
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY event_name
ORDER BY count DESC;
```

### Onboarding Funnel
```sql
SELECT
  properties->>'step' as step,
  COUNT(DISTINCT user_id) as users_completed
FROM analytics_events
WHERE event_name = 'onboarding.step_completed'
GROUP BY step;
```

### Average Session Duration
```sql
SELECT AVG(duration) as avg_session_minutes FROM (
  SELECT session_id,
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 60 as duration
  FROM analytics_events
  GROUP BY session_id
) sessions WHERE duration > 0;
```

## Implementation Checklist

- [ ] Create migration for `analytics_events` table
- [ ] Add `analytics_enabled` column to profiles
- [ ] Create `src/services/analytics.ts`
- [ ] Create `electron/analyticsService.ts`
- [ ] Add IPC handlers to preload and main
- [ ] Add opt-out toggle to Settings
- [ ] Instrument key components with tracking calls
- [ ] Test event flow end-to-end
