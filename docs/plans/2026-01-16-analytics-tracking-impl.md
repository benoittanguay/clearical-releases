# Analytics Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement self-hosted product analytics to track feature engagement and workflow patterns.

**Architecture:** Single Supabase `analytics_events` table with JSON properties, client-side batching service, main process IPC handler for Supabase insertion, opt-out toggle in Settings.

**Tech Stack:** Supabase (Postgres), Electron IPC, React, TypeScript

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/011_analytics_events.sql`

**Step 1: Create the migration file**

```sql
-- Migration: Analytics Events
-- Created: 2026-01-16
-- Description: Create analytics_events table for product usage tracking

-- ============================================================================
-- PART 1: Create Analytics Events Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    session_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    app_version TEXT,
    platform TEXT
);

-- Index for user-specific queries (e.g., rate limiting checks)
CREATE INDEX IF NOT EXISTS idx_analytics_user_date
    ON analytics_events(user_id, created_at);

-- Index for event-based queries (e.g., feature adoption)
CREATE INDEX IF NOT EXISTS idx_analytics_event_name
    ON analytics_events(event_name, created_at);

-- Index for session analysis
CREATE INDEX IF NOT EXISTS idx_analytics_session
    ON analytics_events(session_id);

-- Enable RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can insert their own events
CREATE POLICY "Users can insert own analytics events" ON analytics_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can read all events (for admin analysis)
-- Note: Regular users cannot read analytics data
CREATE POLICY "Service role can read analytics" ON analytics_events
    FOR SELECT
    USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 2: Add analytics_enabled to profiles
-- ============================================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN DEFAULT TRUE;

-- Comment on new column
COMMENT ON COLUMN profiles.analytics_enabled IS 'User preference for anonymous usage analytics (opt-out model)';

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE analytics_events IS 'Product usage analytics for feature engagement and workflow patterns';
COMMENT ON COLUMN analytics_events.event_name IS 'Event identifier in category.action format (e.g., settings.opened)';
COMMENT ON COLUMN analytics_events.properties IS 'Event-specific data as JSON';
COMMENT ON COLUMN analytics_events.session_id IS 'Groups events from a single app session';
```

**Step 2: Apply migration locally**

Run: `cd supabase && supabase db push`
Expected: Migration applied successfully

**Step 3: Commit**

```bash
git add supabase/migrations/011_analytics_events.sql
git commit -m "feat(db): add analytics_events table and profiles.analytics_enabled"
```

---

## Task 2: Analytics Service (Renderer)

**Files:**
- Create: `src/services/analytics.ts`

**Step 1: Create the analytics service**

```typescript
/**
 * Analytics Service
 *
 * Tracks product usage events for feature engagement and workflow analysis.
 * Events are batched and sent to Supabase via IPC.
 */

interface AnalyticsEvent {
    event_name: string;
    properties?: Record<string, unknown>;
}

class AnalyticsService {
    private sessionId: string;
    private queue: AnalyticsEvent[] = [];
    private flushIntervalMs = 30000; // 30 seconds
    private maxQueueSize = 10;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private analyticsEnabled: boolean | null = null;

    constructor() {
        this.sessionId = crypto.randomUUID();
    }

    /**
     * Initialize the analytics service
     * Call this after the app is ready and user is authenticated
     */
    initialize(): void {
        // Start periodic flush
        this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);

        // Flush on page unload
        window.addEventListener('beforeunload', () => this.flush());

        console.log('[Analytics] Initialized with session:', this.sessionId);
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.flush();
    }

    /**
     * Track an event
     * @param eventName - Event name in category.action format (e.g., 'settings.opened')
     * @param properties - Optional event-specific data
     */
    track(eventName: string, properties?: Record<string, unknown>): void {
        // Check opt-out (cached for performance)
        if (!this.isEnabled()) {
            return;
        }

        this.queue.push({
            event_name: eventName,
            properties,
        });

        // Flush if queue is full
        if (this.queue.length >= this.maxQueueSize) {
            this.flush();
        }
    }

    /**
     * Send queued events to backend
     */
    private async flush(): Promise<void> {
        if (this.queue.length === 0) {
            return;
        }

        const events = [...this.queue];
        this.queue = [];

        try {
            await window.electron.ipcRenderer.invoke('analytics:send-events', events, this.sessionId);
        } catch (error) {
            // Analytics should never break the app - log and continue
            console.error('[Analytics] Failed to send events:', error);
        }
    }

    /**
     * Check if analytics is enabled
     * Caches the result to avoid repeated IPC calls
     */
    private isEnabled(): boolean {
        // Use cached value if available
        if (this.analyticsEnabled !== null) {
            return this.analyticsEnabled;
        }

        // Default to true (opt-out model) until we get the actual value
        return true;
    }

    /**
     * Update the enabled state (called when user changes preference)
     */
    setEnabled(enabled: boolean): void {
        this.analyticsEnabled = enabled;
    }

    /**
     * Refresh enabled state from profile
     */
    async refreshEnabledState(): Promise<void> {
        try {
            const result = await window.electron.ipcRenderer.invoke('analytics:get-enabled');
            if (result.success) {
                this.analyticsEnabled = result.enabled;
            }
        } catch (error) {
            console.error('[Analytics] Failed to get enabled state:', error);
        }
    }
}

// Singleton instance
export const analytics = new AnalyticsService();
```

**Step 2: Commit**

```bash
git add src/services/analytics.ts
git commit -m "feat(analytics): add client-side analytics service with batching"
```

---

## Task 3: IPC Handlers (Main Process)

**Files:**
- Create: `electron/analytics/ipcHandlers.ts`

**Step 1: Create the analytics IPC handlers**

```typescript
/**
 * Analytics IPC Handlers
 *
 * Handles analytics events from renderer and inserts into Supabase.
 */

import { ipcMain, app } from 'electron';
import os from 'os';
import { getAuthService } from '../auth/supabaseAuth.js';

interface AnalyticsEvent {
    event_name: string;
    properties?: Record<string, unknown>;
}

/**
 * Initialize analytics IPC handlers
 */
export function initializeAnalytics(): void {
    console.log('[Analytics] Initializing analytics handlers...');
    registerIpcHandlers();
    console.log('[Analytics] Analytics handlers initialized');
}

/**
 * Register IPC handlers for analytics
 */
function registerIpcHandlers(): void {
    // Send batched events
    ipcMain.handle('analytics:send-events', handleSendEvents);

    // Get analytics enabled state
    ipcMain.handle('analytics:get-enabled', handleGetEnabled);

    // Set analytics enabled state
    ipcMain.handle('analytics:set-enabled', handleSetEnabled);
}

/**
 * Handle sending batched analytics events
 */
async function handleSendEvents(
    _event: Electron.IpcMainInvokeEvent,
    events: AnalyticsEvent[],
    sessionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, error: 'Supabase client not initialized' };
        }

        // Build rows with metadata
        const rows = events.map(event => ({
            user_id: session.user.id,
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
            console.error('[Analytics] Insert failed:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error('[Analytics] Error sending events:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get analytics enabled state from profile
 */
async function handleGetEnabled(): Promise<{ success: boolean; enabled: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, enabled: true, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, enabled: true, error: 'Supabase client not initialized' };
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('analytics_enabled')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error('[Analytics] Failed to get enabled state:', error);
            return { success: false, enabled: true, error: error.message };
        }

        // Default to true if not set
        const enabled = data?.analytics_enabled ?? true;
        return { success: true, enabled };
    } catch (error) {
        console.error('[Analytics] Error getting enabled state:', error);
        return {
            success: false,
            enabled: true,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Set analytics enabled state in profile
 */
async function handleSetEnabled(
    _event: Electron.IpcMainInvokeEvent,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, error: 'Supabase client not initialized' };
        }

        const { error } = await supabase
            .from('profiles')
            .update({ analytics_enabled: enabled })
            .eq('id', session.user.id);

        if (error) {
            console.error('[Analytics] Failed to set enabled state:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error('[Analytics] Error setting enabled state:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
```

**Step 2: Commit**

```bash
git add electron/analytics/ipcHandlers.ts
git commit -m "feat(analytics): add main process IPC handlers for Supabase"
```

---

## Task 4: Expose getSupabaseClient in Auth Service

**Files:**
- Modify: `electron/auth/supabaseAuth.ts`

**Step 1: Add getSupabaseClient method**

Find this section (around line 40):
```typescript
export class SupabaseAuthService {
    private supabase: SupabaseClient | null = null;
```

Add this method to the class (after the constructor):

```typescript
    /**
     * Get the Supabase client for direct database operations
     */
    getSupabaseClient(): SupabaseClient | null {
        return this.supabase;
    }
```

**Step 2: Commit**

```bash
git add electron/auth/supabaseAuth.ts
git commit -m "feat(auth): expose getSupabaseClient for analytics"
```

---

## Task 5: Wire Up Analytics in Main Process

**Files:**
- Modify: `electron/main.ts`

**Step 1: Import and initialize analytics**

Find the imports section (around line 30) and add:
```typescript
import { initializeAnalytics } from './analytics/ipcHandlers.js';
```

Find where `initializeAuth()` is called (search for it) and add after it:
```typescript
initializeAnalytics();
```

**Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat(analytics): wire up analytics handlers in main process"
```

---

## Task 6: Add Preload Bridge

**Files:**
- Modify: `electron/preload.cts`

**Step 1: Add analytics methods to preload**

Find the end of the `contextBridge.exposeInMainWorld('electron', {` object (before the closing `});`) and add:

```typescript
        // Analytics
        analytics: {
            sendEvents: (events: any[], sessionId: string) =>
                ipcRenderer.invoke('analytics:send-events', events, sessionId),
            getEnabled: () => ipcRenderer.invoke('analytics:get-enabled'),
            setEnabled: (enabled: boolean) => ipcRenderer.invoke('analytics:set-enabled', enabled),
        },
```

**Step 2: Commit**

```bash
git add electron/preload.cts
git commit -m "feat(analytics): add preload bridge for analytics IPC"
```

---

## Task 7: Update Analytics Service to Use Preload

**Files:**
- Modify: `src/services/analytics.ts`

**Step 1: Update IPC calls to use the analytics namespace**

Replace the flush method's IPC call:
```typescript
// Old:
await window.electron.ipcRenderer.invoke('analytics:send-events', events, this.sessionId);

// New:
await window.electron.analytics.sendEvents(events, this.sessionId);
```

Replace refreshEnabledState's IPC call:
```typescript
// Old:
const result = await window.electron.ipcRenderer.invoke('analytics:get-enabled');

// New:
const result = await window.electron.analytics.getEnabled();
```

**Step 2: Commit**

```bash
git add src/services/analytics.ts
git commit -m "refactor(analytics): use preload analytics namespace"
```

---

## Task 8: Add TypeScript Types for Window.electron

**Files:**
- Modify: `src/types/electron.d.ts` (or create if doesn't exist)

**Step 1: Find or create the electron types file**

Search for existing `electron.d.ts` or window type declarations. Add analytics types:

```typescript
interface ElectronAnalytics {
    sendEvents: (events: { event_name: string; properties?: Record<string, unknown> }[], sessionId: string) => Promise<{ success: boolean; error?: string }>;
    getEnabled: () => Promise<{ success: boolean; enabled: boolean; error?: string }>;
    setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
}
```

Add to the Window interface:
```typescript
analytics: ElectronAnalytics;
```

**Step 2: Commit**

```bash
git add src/types/electron.d.ts
git commit -m "feat(types): add analytics types for window.electron"
```

---

## Task 9: Add Settings Toggle UI

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Add state for analytics toggle**

Find the state declarations (around line 23-31) and add:
```typescript
const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
```

**Step 2: Add useEffect to load initial value**

Add after other useEffects:
```typescript
// Load analytics preference
useEffect(() => {
    const loadAnalyticsPreference = async () => {
        try {
            const result = await window.electron.analytics.getEnabled();
            if (result.success) {
                setAnalyticsEnabled(result.enabled);
            }
        } catch (error) {
            console.error('[Settings] Failed to load analytics preference:', error);
        }
    };
    loadAnalyticsPreference();
}, []);
```

**Step 3: Add handler function**

Add with other handlers:
```typescript
const handleAnalyticsToggle = async (enabled: boolean) => {
    setAnalyticsEnabled(enabled);
    try {
        await window.electron.analytics.setEnabled(enabled);
        // Update the analytics service
        const { analytics } = await import('../services/analytics');
        analytics.setEnabled(enabled);
    } catch (error) {
        console.error('[Settings] Failed to save analytics preference:', error);
        // Revert on error
        setAnalyticsEnabled(!enabled);
    }
};
```

**Step 4: Add UI toggle**

Find an appropriate section in Settings (e.g., after account settings, before "About" section) and add:

```tsx
{/* Analytics Section */}
<div className="settings-section">
    <h3 className="settings-section-title">Privacy</h3>
    <div className="setting-row">
        <div className="setting-info">
            <span className="setting-label">Help improve Clearical</span>
            <span className="setting-description">
                Send anonymous usage data to help us improve the app. No personal data is collected.
            </span>
        </div>
        <label className="toggle-switch">
            <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => handleAnalyticsToggle(e.target.checked)}
            />
            <span className="toggle-slider"></span>
        </label>
    </div>
</div>
```

**Step 5: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(settings): add analytics opt-out toggle"
```

---

## Task 10: Initialize Analytics on App Start

**Files:**
- Modify: `src/App.tsx`

**Step 1: Import and initialize analytics**

Add import:
```typescript
import { analytics } from './services/analytics';
```

Find where app initialization happens (after auth check) and add:
```typescript
// Initialize analytics after auth is ready
useEffect(() => {
    if (isAuthenticated) {
        analytics.initialize();
        analytics.refreshEnabledState();
        analytics.track('app.started');
    }

    return () => {
        analytics.destroy();
    };
}, [isAuthenticated]);
```

**Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(analytics): initialize analytics on app start"
```

---

## Task 11: Add Key Tracking Events

**Files:**
- Modify: Various components

**Step 1: Add tracking to Settings.tsx**

Import analytics:
```typescript
import { analytics } from '../services/analytics';
```

Track settings.opened when component mounts:
```typescript
useEffect(() => {
    analytics.track('settings.opened');
}, []);
```

Track setting changes in the save handler:
```typescript
analytics.track('settings.changed', { setting: 'timeRoundingIncrement', value: newValue });
```

**Step 2: Add tracking to OnboardingModal.tsx**

Track onboarding events:
```typescript
analytics.track('onboarding.started');
analytics.track('onboarding.step_completed', { step: currentStep });
analytics.track('onboarding.completed');
```

**Step 3: Add tracking to ExportDialog.tsx**

Track export events:
```typescript
analytics.track('export.opened');
analytics.track('export.completed', { format: selectedFormat, row_count: entries.length });
```

**Step 4: Add tracking to AssignmentPicker.tsx**

Track assignment events:
```typescript
analytics.track('assignment.selected', { source: 'picker' });
analytics.track('assignment.ai_used');
```

**Step 5: Commit**

```bash
git add src/components/Settings.tsx src/components/OnboardingModal.tsx src/components/ExportDialog.tsx src/components/AssignmentPicker.tsx
git commit -m "feat(analytics): add tracking to key components"
```

---

## Task 12: Test End-to-End

**Step 1: Build and run the app**

Run: `npm run dev:electron`

**Step 2: Verify in Supabase**

1. Open app, let it initialize
2. Navigate through features (open settings, etc.)
3. Wait 30 seconds or close app
4. Check Supabase dashboard → analytics_events table
5. Verify events are being inserted with correct user_id, event_name, properties

**Step 3: Test opt-out**

1. Go to Settings → Privacy
2. Toggle off "Help improve Clearical"
3. Perform actions
4. Verify no new events in analytics_events table

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(analytics): complete product analytics implementation"
```

---

## Summary

Files created:
- `supabase/migrations/011_analytics_events.sql`
- `src/services/analytics.ts`
- `electron/analytics/ipcHandlers.ts`

Files modified:
- `electron/auth/supabaseAuth.ts` (add getSupabaseClient)
- `electron/main.ts` (wire up analytics)
- `electron/preload.cts` (add analytics bridge)
- `src/types/electron.d.ts` (add types)
- `src/components/Settings.tsx` (add toggle)
- `src/App.tsx` (initialize)
- Various components (add tracking calls)
