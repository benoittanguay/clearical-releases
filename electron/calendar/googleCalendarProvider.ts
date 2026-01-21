// electron/calendar/googleCalendarProvider.ts

import { BrowserWindow } from 'electron';
import http from 'http';
import { CalendarProvider, CalendarEvent, FocusTimeEventInput, CalendarTokens } from './types.js';
import { getCredential, storeCredential, deleteCredential } from '../credentialStorage.js';

// Google OAuth credentials for desktop apps
// Note: For desktop/native OAuth apps, Google's security model accepts that these
// credentials cannot be kept confidential. Security relies on redirect URI validation
// to localhost, not on secret confidentiality. See: https://developers.google.com/identity/protocols/oauth2/native-app
const GOOGLE_CLIENT_ID = '791311907098-44i72hpg64b965845pbg4hhmrtb5vp11.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

// Allow env override for development/testing
const getClientId = () => process.env.GOOGLE_CALENDAR_CLIENT_ID || GOOGLE_CLIENT_ID;
const getClientSecret = () => process.env.GOOGLE_CALENDAR_CLIENT_SECRET || GOOGLE_CLIENT_SECRET;
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
    // Check if we already have tokens (e.g., from Google SSO sign-in)
    const existingToken = await getCredential('calendar-google-access-token');
    const existingRefresh = await getCredential('calendar-google-refresh-token');

    if (existingToken && existingRefresh) {
      console.log('[GoogleCalendar] Found existing tokens (likely from SSO), verifying...');
      await this.loadTokens();

      try {
        // Verify tokens work by fetching user email
        this.email = await this.fetchUserEmail();
        console.log('[GoogleCalendar] Existing tokens valid, connected as:', this.email);
        return;
      } catch (error) {
        console.log('[GoogleCalendar] Existing tokens invalid, will request new authorization');
        // Clear invalid tokens and fall through to OAuth flow
        await deleteCredential('calendar-google-access-token');
        await deleteCredential('calendar-google-refresh-token');
        await deleteCredential('calendar-google-expires-at');
        this.tokens = null;
      }
    }

    // No valid existing tokens, start OAuth flow
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

    const data = await response.json() as GoogleCalendarListResponse;
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

    const created = await response.json() as GoogleCalendarEventItem;
    return created.id;
  }

  // Private methods

  private buildAuthUrl(): string {
    const clientId = getClientId();
    console.log('[GoogleCalendar] Building auth URL with client_id:', clientId ? `${clientId.substring(0, 20)}...` : 'EMPTY');
    console.log('[GoogleCalendar] Env var raw:', process.env.GOOGLE_CALENDAR_CLIENT_ID ? 'SET' : 'NOT SET');

    if (!clientId) {
      throw new Error('Google Calendar client_id is not configured. Please ensure GOOGLE_CALENDAR_CLIENT_ID is set in .env.local and restart the app.');
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'select_account consent');
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
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url || '', `http://localhost:3847`);
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

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
        reject(new Error('Authentication cancelled'));
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
        client_id: getClientId(),
        client_secret: getClientSecret(),
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to exchange code for tokens: ${response.statusText}`);
    }

    const data = await response.json() as GoogleOAuthTokenResponse;

    if (!data.refresh_token) {
      throw new Error('No refresh token received from Google. Please try again.');
    }

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
        client_id: getClientId(),
        client_secret: getClientSecret(),
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const data = await response.json() as GoogleOAuthTokenResponse;
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

    const data = await response.json() as GoogleUserInfoResponse;
    return data.email;
  }

  private mapGoogleEvents(items: GoogleCalendarEventItem[]): CalendarEvent[] {
    return items.map((item) => ({
      id: `google-${item.id}`,
      provider: 'google',
      providerEventId: item.id,
      title: item.summary || '(No title)',
      startTime: item.start.dateTime
        ? new Date(item.start.dateTime).getTime()
        : new Date(item.start.date!).getTime(),
      endTime: item.end.dateTime
        ? new Date(item.end.dateTime).getTime()
        : new Date(item.end.date!).getTime(),
      isAllDay: !item.start.dateTime,
    }));
  }
}

// Types for Google API responses

interface GoogleCalendarEventItem {
  id: string;
  summary?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEventItem[];
}

interface GoogleOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleUserInfoResponse {
  email: string;
  id: string;
  verified_email?: boolean;
}
