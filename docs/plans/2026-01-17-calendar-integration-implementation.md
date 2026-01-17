# Calendar Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Google Calendar integration to provide AI context for smarter activity descriptions and bucket assignments, plus a Splitting Assistant for long recordings.

**Architecture:** CalendarProvider abstraction with GoogleCalendarProvider implementation. CalendarService in Electron main process handles sync and caching. IPC bridge exposes calendar operations to renderer. AI pipeline extended with calendar context in Stage 2.

**Tech Stack:** TypeScript, Electron IPC, Google Calendar API, OAuth2, SQLite (better-sqlite3), React, Gemini AI

---

## Phase 1: Database Schema

### Task 1.1: Add calendar_events table

**Files:**
- Modify: `electron/databaseService.ts`

**Step 1: Add table creation in initializeSchema**

In `electron/databaseService.ts`, find the `initializeSchema()` method and add after the existing table creations:

```typescript
// Calendar events cache
this.db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'google',
    provider_event_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    is_all_day INTEGER DEFAULT 0,
    synced_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_calendar_events_time
    ON calendar_events(start_time, end_time);
`);
```

**Step 2: Add calendar event CRUD methods**

Add these methods to the DatabaseService class:

```typescript
// Calendar Events
getCalendarEvents(startTime: number, endTime: number): CalendarEvent[] {
  const stmt = this.db.prepare(`
    SELECT * FROM calendar_events
    WHERE start_time <= ? AND end_time >= ?
    ORDER BY start_time ASC
  `);
  return stmt.all(endTime, startTime) as CalendarEvent[];
}

upsertCalendarEvents(events: CalendarEvent[]): void {
  const stmt = this.db.prepare(`
    INSERT OR REPLACE INTO calendar_events
    (id, provider, provider_event_id, title, start_time, end_time, is_all_day, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  const upsertMany = this.db.transaction((events: CalendarEvent[]) => {
    for (const event of events) {
      stmt.run(
        event.id,
        event.provider,
        event.providerEventId,
        event.title,
        event.startTime,
        event.endTime,
        event.isAllDay ? 1 : 0,
        now
      );
    }
  });
  upsertMany(events);
}

deleteStaleCalendarEvents(olderThan: number): void {
  const stmt = this.db.prepare(`
    DELETE FROM calendar_events WHERE synced_at < ?
  `);
  stmt.run(olderThan);
}

clearCalendarEvents(): void {
  this.db.exec('DELETE FROM calendar_events');
}
```

**Step 3: Add CalendarEvent type**

Add to `electron/databaseService.ts` or a shared types file:

```typescript
export interface CalendarEvent {
  id: string;
  provider: string;
  providerEventId: string;
  title: string;
  startTime: number;
  endTime: number;
  isAllDay: boolean;
  syncedAt?: number;
}
```

**Step 4: Run app to verify table is created**

Run: `npm run dev`
Expected: App starts without database errors

**Step 5: Commit**

```bash
git add electron/databaseService.ts
git commit -m "feat(calendar): add calendar_events table and CRUD methods"
```

---

## Phase 2: Calendar Provider Abstraction

### Task 2.1: Create CalendarProvider interface

**Files:**
- Create: `electron/calendar/types.ts`

**Step 1: Create types file**

```typescript
// electron/calendar/types.ts

export interface CalendarEvent {
  id: string;
  provider: string;
  providerEventId: string;
  title: string;
  startTime: number;
  endTime: number;
  isAllDay: boolean;
}

export interface FocusTimeEventInput {
  title: string;
  description: string;
  startTime: number;
  endTime: number;
}

export interface CalendarProvider {
  readonly id: string;
  readonly name: string;

  // Auth
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  getAccountEmail(): Promise<string | null>;

  // Read
  getEvents(startTime: number, endTime: number): Promise<CalendarEvent[]>;

  // Write
  createFocusTimeEvent(input: FocusTimeEventInput): Promise<string>;
}

export interface CalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
```

**Step 2: Commit**

```bash
git add electron/calendar/types.ts
git commit -m "feat(calendar): add CalendarProvider interface and types"
```

---

### Task 2.2: Create GoogleCalendarProvider

**Files:**
- Create: `electron/calendar/googleCalendarProvider.ts`

**Step 1: Create Google provider implementation**

```typescript
// electron/calendar/googleCalendarProvider.ts

import { BrowserWindow } from 'electron';
import { CalendarProvider, CalendarEvent, FocusTimeEventInput, CalendarTokens } from './types';
import { getCredential, storeCredential, deleteCredential } from '../credentialStorage';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3847/oauth/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google';
  readonly name = 'Google Calendar';

  private tokens: CalendarTokens | null = null;
  private email: string | null = null;

  async connect(): Promise<void> {
    const authUrl = this.buildAuthUrl();
    const code = await this.openAuthWindow(authUrl);
    const tokens = await this.exchangeCodeForTokens(code);

    await storeCredential('calendar-google-access-token', tokens.accessToken);
    await storeCredential('calendar-google-refresh-token', tokens.refreshToken);
    await storeCredential('calendar-google-expires-at', String(tokens.expiresAt));

    this.tokens = tokens;
    this.email = await this.fetchUserEmail();
  }

  async disconnect(): Promise<void> {
    await deleteCredential('calendar-google-access-token');
    await deleteCredential('calendar-google-refresh-token');
    await deleteCredential('calendar-google-expires-at');
    this.tokens = null;
    this.email = null;
  }

  async isConnected(): Promise<boolean> {
    const accessToken = await getCredential('calendar-google-access-token');
    return !!accessToken;
  }

  async getAccountEmail(): Promise<string | null> {
    if (this.email) return this.email;
    if (await this.isConnected()) {
      await this.loadTokens();
      this.email = await this.fetchUserEmail();
    }
    return this.email;
  }

  async getEvents(startTime: number, endTime: number): Promise<CalendarEvent[]> {
    await this.ensureValidToken();

    const timeMin = new Date(startTime).toISOString();
    const timeMax = new Date(endTime).toISOString();

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', timeMin);
    url.searchParams.set('timeMax', timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '100');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar events: ${response.statusText}`);
    }

    const data = await response.json();
    return this.mapGoogleEvents(data.items || []);
  }

  async createFocusTimeEvent(input: FocusTimeEventInput): Promise<string> {
    await this.ensureValidToken();

    const event = {
      summary: input.title,
      description: input.description,
      start: {
        dateTime: new Date(input.startTime).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: new Date(input.endTime).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tokens!.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to create calendar event: ${response.statusText}`);
    }

    const created = await response.json();
    return created.id;
  }

  // Private methods

  private buildAuthUrl(): string {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  }

  private openAuthWindow(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // Create a simple HTTP server to catch the redirect
      const http = require('http');
      const server = http.createServer((req: any, res: any) => {
        const url = new URL(req.url, `http://localhost:3847`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>You can close this window</h1><script>window.close()</script></body></html>');

        server.close();
        authWindow.close();

        if (error) {
          reject(new Error(`OAuth error: ${error}`));
        } else if (code) {
          resolve(code);
        } else {
          reject(new Error('No authorization code received'));
        }
      });

      server.listen(3847, () => {
        authWindow.loadURL(authUrl);
      });

      authWindow.on('closed', () => {
        server.close();
      });
    });
  }

  private async exchangeCodeForTokens(code: string): Promise<CalendarTokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to exchange code for tokens: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private async refreshAccessToken(): Promise<void> {
    const refreshToken = await getCredential('calendar-google-refresh-token');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    await storeCredential('calendar-google-access-token', this.tokens.accessToken);
    await storeCredential('calendar-google-expires-at', String(this.tokens.expiresAt));
  }

  private async loadTokens(): Promise<void> {
    const accessToken = await getCredential('calendar-google-access-token');
    const refreshToken = await getCredential('calendar-google-refresh-token');
    const expiresAt = await getCredential('calendar-google-expires-at');

    if (accessToken && refreshToken && expiresAt) {
      this.tokens = {
        accessToken,
        refreshToken,
        expiresAt: parseInt(expiresAt, 10),
      };
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.tokens) {
      await this.loadTokens();
    }

    if (!this.tokens) {
      throw new Error('Not connected to Google Calendar');
    }

    // Refresh if token expires in less than 5 minutes
    if (this.tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      await this.refreshAccessToken();
    }
  }

  private async fetchUserEmail(): Promise<string> {
    await this.ensureValidToken();

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${this.tokens!.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user email');
    }

    const data = await response.json();
    return data.email;
  }

  private mapGoogleEvents(items: any[]): CalendarEvent[] {
    return items.map((item) => ({
      id: `google-${item.id}`,
      provider: 'google',
      providerEventId: item.id,
      title: item.summary || '(No title)',
      startTime: item.start.dateTime
        ? new Date(item.start.dateTime).getTime()
        : new Date(item.start.date).getTime(),
      endTime: item.end.dateTime
        ? new Date(item.end.dateTime).getTime()
        : new Date(item.end.date).getTime(),
      isAllDay: !item.start.dateTime,
    }));
  }
}
```

**Step 2: Commit**

```bash
git add electron/calendar/googleCalendarProvider.ts
git commit -m "feat(calendar): implement GoogleCalendarProvider with OAuth"
```

---

### Task 2.3: Create CalendarService

**Files:**
- Create: `electron/calendar/calendarService.ts`

**Step 1: Create calendar service**

```typescript
// electron/calendar/calendarService.ts

import { CalendarProvider, CalendarEvent } from './types';
import { GoogleCalendarProvider } from './googleCalendarProvider';
import { getDatabaseService } from '../databaseService';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONTEXT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

export class CalendarService {
  private provider: CalendarProvider | null = null;
  private syncInterval: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    // Check if Google Calendar was previously connected
    const googleProvider = new GoogleCalendarProvider();
    if (await googleProvider.isConnected()) {
      this.provider = googleProvider;
      this.startBackgroundSync();
    }
  }

  async connectGoogle(): Promise<void> {
    const provider = new GoogleCalendarProvider();
    await provider.connect();
    this.provider = provider;
    await this.syncEvents();
    this.startBackgroundSync();
  }

  async disconnect(): Promise<void> {
    if (this.provider) {
      await this.provider.disconnect();
      this.provider = null;
    }
    this.stopBackgroundSync();
    getDatabaseService().clearCalendarEvents();
  }

  async isConnected(): Promise<boolean> {
    return this.provider !== null && await this.provider.isConnected();
  }

  async getAccountEmail(): Promise<string | null> {
    return this.provider?.getAccountEmail() ?? null;
  }

  async getProviderName(): Promise<string | null> {
    return this.provider?.name ?? null;
  }

  async syncEvents(): Promise<void> {
    if (!this.provider) return;

    const now = Date.now();
    const startTime = now - CONTEXT_WINDOW_MS;
    const endTime = now + CONTEXT_WINDOW_MS;

    try {
      const events = await this.provider.getEvents(startTime, endTime);
      const db = getDatabaseService();

      // Clear old events and insert fresh ones
      db.deleteStaleCalendarEvents(now - 24 * 60 * 60 * 1000); // Remove events older than 24h
      db.upsertCalendarEvents(events);
    } catch (error) {
      console.error('Failed to sync calendar events:', error);
    }
  }

  getCalendarContext(timestamp: number): {
    currentEvent: string | null;
    recentEvents: string[];
    upcomingEvents: string[];
  } {
    const db = getDatabaseService();
    const windowStart = timestamp - CONTEXT_WINDOW_MS;
    const windowEnd = timestamp + CONTEXT_WINDOW_MS;

    const events = db.getCalendarEvents(windowStart, windowEnd);

    let currentEvent: string | null = null;
    const recentEvents: string[] = [];
    const upcomingEvents: string[] = [];

    for (const event of events) {
      if (event.startTime <= timestamp && event.endTime >= timestamp) {
        currentEvent = event.title;
      } else if (event.endTime < timestamp) {
        recentEvents.push(event.title);
      } else if (event.startTime > timestamp) {
        upcomingEvents.push(event.title);
      }
    }

    return {
      currentEvent,
      recentEvents: recentEvents.slice(-5), // Last 5 recent
      upcomingEvents: upcomingEvents.slice(0, 5), // Next 5 upcoming
    };
  }

  async createFocusTimeEvent(input: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
  }): Promise<string | null> {
    if (!this.provider) {
      throw new Error('No calendar provider connected');
    }
    return this.provider.createFocusTimeEvent(input);
  }

  private startBackgroundSync(): void {
    if (this.syncInterval) return;

    this.syncInterval = setInterval(() => {
      this.syncEvents();
    }, SYNC_INTERVAL_MS);

    // Initial sync
    this.syncEvents();
  }

  private stopBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

// Singleton instance
let calendarService: CalendarService | null = null;

export function getCalendarService(): CalendarService {
  if (!calendarService) {
    calendarService = new CalendarService();
  }
  return calendarService;
}

export function initializeCalendarService(): Promise<void> {
  return getCalendarService().initialize();
}
```

**Step 2: Commit**

```bash
git add electron/calendar/calendarService.ts
git commit -m "feat(calendar): add CalendarService with background sync"
```

---

## Phase 3: IPC Integration

### Task 3.1: Add IPC handlers in main process

**Files:**
- Modify: `electron/main.ts`

**Step 1: Import calendar service**

At the top of `electron/main.ts`, add:

```typescript
import { getCalendarService, initializeCalendarService } from './calendar/calendarService';
```

**Step 2: Initialize calendar service on app ready**

Find the `app.whenReady()` block and add after database initialization:

```typescript
// Initialize calendar service
await initializeCalendarService();
```

**Step 3: Add IPC handlers**

Add these handlers with the other `ipcMain.handle` calls:

```typescript
// Calendar Integration
ipcMain.handle('calendar:connect', async () => {
  const service = getCalendarService();
  await service.connectGoogle();
  return { success: true };
});

ipcMain.handle('calendar:disconnect', async () => {
  const service = getCalendarService();
  await service.disconnect();
  return { success: true };
});

ipcMain.handle('calendar:is-connected', async () => {
  const service = getCalendarService();
  return service.isConnected();
});

ipcMain.handle('calendar:get-account', async () => {
  const service = getCalendarService();
  const email = await service.getAccountEmail();
  const provider = await service.getProviderName();
  return { email, provider };
});

ipcMain.handle('calendar:sync', async () => {
  const service = getCalendarService();
  await service.syncEvents();
  return { success: true };
});

ipcMain.handle('calendar:get-context', async (_, timestamp: number) => {
  const service = getCalendarService();
  return service.getCalendarContext(timestamp);
});

ipcMain.handle('calendar:create-focus-time', async (_, input: {
  title: string;
  description: string;
  startTime: number;
  endTime: number;
}) => {
  const service = getCalendarService();
  const eventId = await service.createFocusTimeEvent(input);
  return { eventId };
});
```

**Step 4: Commit**

```bash
git add electron/main.ts
git commit -m "feat(calendar): add IPC handlers for calendar operations"
```

---

### Task 3.2: Expose calendar API in preload

**Files:**
- Modify: `electron/preload.cts`

**Step 1: Add calendar methods to exposed API**

Find the `contextBridge.exposeInMainWorld` call and add the calendar methods:

```typescript
calendar: {
  connect: () => ipcRenderer.invoke('calendar:connect'),
  disconnect: () => ipcRenderer.invoke('calendar:disconnect'),
  isConnected: () => ipcRenderer.invoke('calendar:is-connected'),
  getAccount: () => ipcRenderer.invoke('calendar:get-account'),
  sync: () => ipcRenderer.invoke('calendar:sync'),
  getContext: (timestamp: number) => ipcRenderer.invoke('calendar:get-context', timestamp),
  createFocusTime: (input: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
  }) => ipcRenderer.invoke('calendar:create-focus-time', input),
},
```

**Step 2: Update TypeScript types**

If there's a types file for the electron API (e.g., `src/types/electron.d.ts`), add:

```typescript
calendar: {
  connect: () => Promise<{ success: boolean }>;
  disconnect: () => Promise<{ success: boolean }>;
  isConnected: () => Promise<boolean>;
  getAccount: () => Promise<{ email: string | null; provider: string | null }>;
  sync: () => Promise<{ success: boolean }>;
  getContext: (timestamp: number) => Promise<{
    currentEvent: string | null;
    recentEvents: string[];
    upcomingEvents: string[];
  }>;
  createFocusTime: (input: {
    title: string;
    description: string;
    startTime: number;
    endTime: number;
  }) => Promise<{ eventId: string | null }>;
};
```

**Step 3: Commit**

```bash
git add electron/preload.cts src/types/electron.d.ts
git commit -m "feat(calendar): expose calendar API to renderer via preload"
```

---

## Phase 4: Settings UI

### Task 4.1: Create CalendarSettings component

**Files:**
- Create: `src/components/CalendarSettings.tsx`

**Step 1: Create the component**

```typescript
// src/components/CalendarSettings.tsx

import { useState, useEffect } from 'react';

interface CalendarAccount {
  email: string | null;
  provider: string | null;
}

export function CalendarSettings() {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<CalendarAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkConnectionStatus();
  }, []);

  async function checkConnectionStatus() {
    try {
      const connected = await window.electron.calendar.isConnected();
      setIsConnected(connected);

      if (connected) {
        const accountInfo = await window.electron.calendar.getAccount();
        setAccount(accountInfo);
      }
    } catch (err) {
      console.error('Failed to check calendar status:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConnect() {
    setIsConnecting(true);
    setError(null);

    try {
      await window.electron.calendar.connect();
      await checkConnectionStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await window.electron.calendar.disconnect();
      setIsConnected(false);
      setAccount(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }

  async function handleSync() {
    try {
      await window.electron.calendar.sync();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync');
    }
  }

  if (isLoading) {
    return (
      <div className="p-4">
        <div className="animate-pulse">Loading calendar settings...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold font-display">Calendar Integration</h3>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {isConnected ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/>
                </svg>
              </div>
              <div>
                <div className="font-medium">Google Calendar</div>
                <div className="text-sm text-gray-500">{account?.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                Connected
              </span>
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
            <div className="text-sm text-gray-600">
              Calendar events sync automatically every 5 minutes
            </div>
            <button
              onClick={handleSync}
              className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
            >
              Sync Now
            </button>
          </div>
        </div>
      ) : (
        <div className="p-6 bg-white border border-gray-200 rounded-xl text-center">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/>
            </svg>
          </div>
          <h4 className="font-medium mb-2">Connect Your Calendar</h4>
          <p className="text-sm text-gray-500 mb-4">
            Help the AI understand your work context by connecting your calendar.
          </p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/CalendarSettings.tsx
git commit -m "feat(calendar): add CalendarSettings component"
```

---

### Task 4.2: Integrate CalendarSettings into Settings page

**Files:**
- Modify: `src/components/Settings.tsx` (or wherever settings are rendered)

**Step 1: Import and add CalendarSettings**

Find the Settings component and add the CalendarSettings section after Jira/Tempo settings:

```typescript
import { CalendarSettings } from './CalendarSettings';

// In the render, add:
<CalendarSettings />
```

**Step 2: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(calendar): integrate CalendarSettings into Settings page"
```

---

## Phase 5: Onboarding Integration

### Task 5.1: Add calendar step to onboarding

**Files:**
- Modify: `src/components/OnboardingModal.tsx`

**Step 1: Add calendar onboarding step**

Find the onboarding steps array/logic and add a calendar step before Jira:

```typescript
// Calendar onboarding step content
function CalendarOnboardingStep({ onComplete, onSkip }: {
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [isConnecting, setIsConnecting] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      await window.electron.calendar.connect();
      onComplete();
    } catch (err) {
      console.error('Failed to connect calendar:', err);
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="text-center p-6">
      <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/>
        </svg>
      </div>

      <h2 className="text-xl font-bold font-display mb-2">Connect Your Calendar</h2>

      <p className="text-gray-600 mb-6">
        Help the AI understand your work context by connecting your calendar.
        Meeting titles inform smarter activity descriptions and bucket suggestions.
      </p>

      <div className="space-y-3">
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-medium transition-colors disabled:opacity-50"
        >
          {isConnecting ? 'Connecting...' : 'Connect Google Calendar'}
        </button>

        <button
          onClick={onSkip}
          className="w-full px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Update step order**

Ensure the step order is:
1. Permissions
2. **Calendar** (new)
3. Jira
4. Tempo

**Step 3: Commit**

```bash
git add src/components/OnboardingModal.tsx
git commit -m "feat(calendar): add calendar step to onboarding flow"
```

---

## Phase 6: AI Context Integration

### Task 6.1: Extend ActivityContext with calendar data

**Files:**
- Modify: `src/types/activity.ts` (or wherever ActivityContext is defined)

**Step 1: Add calendar fields to ActivityContext**

```typescript
export interface ActivityContext {
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
  recentCalendarEvents: string[];
  upcomingCalendarEvents: string[];
}
```

**Step 2: Commit**

```bash
git add src/types/activity.ts
git commit -m "feat(calendar): extend ActivityContext with calendar fields"
```

---

### Task 6.2: Inject calendar context into AI prompts

**Files:**
- Modify: `electron/ai/aiService.ts` (or wherever AI calls are made)

**Step 1: Fetch and include calendar context**

When building the context for Stage 2 (Summary Description), include calendar data:

```typescript
import { getCalendarService } from '../calendar/calendarService';

// In the method that builds ActivityContext:
async function buildActivityContext(activity: Activity): Promise<ActivityContext> {
  // ... existing context building ...

  // Add calendar context
  const calendarService = getCalendarService();
  const calendarContext = calendarService.getCalendarContext(activity.startTime);

  return {
    // ... existing fields ...
    currentCalendarEvent: calendarContext.currentEvent,
    recentCalendarEvents: calendarContext.recentEvents,
    upcomingCalendarEvents: calendarContext.upcomingEvents,
  };
}
```

**Step 2: Update prompt template for Stage 2**

Modify the summary generation prompt to include calendar context:

```typescript
function buildSummaryPrompt(context: ActivityContext): string {
  let prompt = `Generate a summary description for this work activity.\n\n`;

  prompt += `Apps used: ${context.appNames.join(', ')}\n`;
  prompt += `Window titles: ${context.windowTitles.join(', ')}\n`;
  prompt += `Duration: ${Math.round(context.duration / 60000)} minutes\n`;

  // Add calendar context
  if (context.currentCalendarEvent) {
    prompt += `\nCurrent calendar event: ${context.currentCalendarEvent}\n`;
  }
  if (context.recentCalendarEvents.length > 0) {
    prompt += `Recent events: ${context.recentCalendarEvents.join(', ')}\n`;
  }
  if (context.upcomingCalendarEvents.length > 0) {
    prompt += `Upcoming events: ${context.upcomingCalendarEvents.join(', ')}\n`;
  }

  prompt += `\nScreenshot analysis:\n${context.description}\n`;

  return prompt;
}
```

**Step 3: Commit**

```bash
git add electron/ai/aiService.ts
git commit -m "feat(calendar): inject calendar context into AI summary prompts"
```

---

## Phase 7: Focus Time Event Creation

### Task 7.1: Add "Add to Calendar" button to time entry

**Files:**
- Modify: `src/components/ActivityDetails.tsx` (or equivalent)

**Step 1: Add the button and handler**

```typescript
import { useState } from 'react';

function AddToCalendarButton({ entry }: { entry: TimeEntry }) {
  const [isAdding, setIsAdding] = useState(false);
  const [added, setAdded] = useState(false);

  async function handleAddToCalendar() {
    const isConnected = await window.electron.calendar.isConnected();
    if (!isConnected) {
      // Show connect prompt or redirect to settings
      return;
    }

    setIsAdding(true);
    try {
      const title = entry.bucketName
        ? `Focus Time: ${entry.bucketName}`
        : entry.jiraKey
          ? `Focus Time: ${entry.jiraKey}`
          : 'Focus Time';

      let description = entry.description || '';
      if (entry.jiraKey && entry.jiraUrl) {
        description += `\n\nLinked Issue: ${entry.jiraUrl}`;
      }
      description += `\n\nDuration: ${formatDuration(entry.duration)}`;

      await window.electron.calendar.createFocusTime({
        title,
        description,
        startTime: entry.startTime,
        endTime: entry.endTime,
      });

      setAdded(true);
    } catch (err) {
      console.error('Failed to add to calendar:', err);
    } finally {
      setIsAdding(false);
    }
  }

  if (added) {
    return (
      <span className="text-green-600 text-sm flex items-center gap-1">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Added to Calendar
      </span>
    );
  }

  return (
    <button
      onClick={handleAddToCalendar}
      disabled={isAdding}
      className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
        <line x1="12" y1="14" x2="12" y2="18"/>
        <line x1="10" y1="16" x2="14" y2="16"/>
      </svg>
      {isAdding ? 'Adding...' : 'Add to Calendar'}
    </button>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/ActivityDetails.tsx
git commit -m "feat(calendar): add 'Add to Calendar' button for Focus Time events"
```

---

## Phase 8: Splitting Assistant

### Task 8.1: Create SplittingAssistant component

**Files:**
- Create: `src/components/SplittingAssistant.tsx`

**Step 1: Create the component**

This is a larger component. Create it based on the HTML prototype at `prototypes/splitting-assistant.html`, converting to React with proper state management.

Key elements:
- Timeline with segments
- Draggable cut markers
- Segment preview cards
- Accept/cancel actions

**Step 2: Commit**

```bash
git add src/components/SplittingAssistant.tsx
git commit -m "feat(calendar): add SplittingAssistant component"
```

---

### Task 8.2: Add AI splitting analysis endpoint

**Files:**
- Modify: `electron/ai/aiService.ts`
- Modify: `electron/main.ts`

**Step 1: Add splitting analysis function**

```typescript
interface SplitSuggestion {
  startTime: number;
  endTime: number;
  description: string;
  suggestedBucket: string | null;
  suggestedJiraKey: string | null;
  confidence: number;
}

async function analyzeSplits(
  screenshots: ScreenshotAnalysis[],
  calendarEvents: CalendarEvent[],
  entries: TimeEntry[]
): Promise<SplitSuggestion[]> {
  // Build prompt with all signals
  const prompt = buildSplitAnalysisPrompt(screenshots, calendarEvents, entries);

  // Call Gemini
  const response = await makeGeminiRequest({
    operation: 'analyze_splits',
    prompt,
  });

  return parseSplitSuggestions(response);
}
```

**Step 2: Add IPC handler**

```typescript
ipcMain.handle('ai:analyze-splits', async (_, activityId: string) => {
  // Gather all data for the activity
  // Call AI analysis
  // Return split suggestions
});
```

**Step 3: Commit**

```bash
git add electron/ai/aiService.ts electron/main.ts
git commit -m "feat(calendar): add AI splitting analysis endpoint"
```

---

### Task 8.3: Integrate SplittingAssistant into activity flow

**Files:**
- Modify: `src/components/ActivityDetails.tsx`

**Step 1: Add "Suggest Splits" button**

Show button only for activities longer than 15 minutes:

```typescript
{activity.duration > 15 * 60 * 1000 && (
  <button
    onClick={() => setShowSplittingAssistant(true)}
    className="px-3 py-1.5 text-sm bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors"
  >
    Suggest Splits
  </button>
)}

{showSplittingAssistant && (
  <SplittingAssistant
    activity={activity}
    onClose={() => setShowSplittingAssistant(false)}
    onApply={handleApplySplits}
  />
)}
```

**Step 2: Handle split results**

When no splits are found, navigate directly to activity details (silent, no message).

**Step 3: Commit**

```bash
git add src/components/ActivityDetails.tsx
git commit -m "feat(calendar): integrate SplittingAssistant into activity flow"
```

---

## Phase 9: Environment Configuration

### Task 9.1: Add Google OAuth credentials

**Files:**
- Modify: `.env.example`
- Create or modify: `.env` (local only, not committed)

**Step 1: Add environment variables**

```bash
# .env.example
GOOGLE_CALENDAR_CLIENT_ID=your-client-id-here
GOOGLE_CALENDAR_CLIENT_SECRET=your-client-secret-here
```

**Step 2: Document setup**

Add to README or developer docs:
1. Go to Google Cloud Console
2. Create OAuth 2.0 credentials
3. Add `http://localhost:3847/oauth/callback` as authorized redirect URI
4. Copy client ID and secret to `.env`

**Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(calendar): add Google OAuth environment variables"
```

---

## Summary

| Phase | Tasks | Key Files |
|-------|-------|-----------|
| 1. Database | 1.1 | `electron/databaseService.ts` |
| 2. Provider | 2.1-2.3 | `electron/calendar/*.ts` |
| 3. IPC | 3.1-3.2 | `electron/main.ts`, `electron/preload.cts` |
| 4. Settings | 4.1-4.2 | `src/components/CalendarSettings.tsx` |
| 5. Onboarding | 5.1 | `src/components/OnboardingModal.tsx` |
| 6. AI Context | 6.1-6.2 | `electron/ai/aiService.ts` |
| 7. Focus Time | 7.1 | `src/components/ActivityDetails.tsx` |
| 8. Splitting | 8.1-8.3 | `src/components/SplittingAssistant.tsx` |
| 9. Config | 9.1 | `.env.example` |

---

Plan complete and saved to `docs/plans/2026-01-17-calendar-integration-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
