// electron/calendar/calendarService.ts

import { CalendarProvider, CalendarEvent } from './types.js';
import { GoogleCalendarProvider } from './googleCalendarProvider.js';
import { DatabaseService } from '../databaseService.js';

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
    DatabaseService.getInstance().clearCalendarEvents();
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
      const db = DatabaseService.getInstance();

      // Clear old events and insert fresh ones
      db.deleteStaleCalendarEvents(now - 24 * 60 * 60 * 1000); // Remove events older than 24h
      db.upsertCalendarEvents(events);
    } catch (error) {
      console.error('[CalendarService] Failed to sync calendar events:', error);
    }
  }

  getCalendarContext(timestamp: number): {
    currentEvent: string | null;
    recentEvents: string[];
    upcomingEvents: string[];
  } {
    const db = DatabaseService.getInstance();
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
