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
