// electron/auth/oauthServer.ts

import { BrowserWindow } from 'electron';

export type OAuthProvider = 'google' | 'azure' | 'apple';

interface OAuthCallbackResult {
  code: string;
  state?: string;
}

interface OAuthWindow {
  waitForCallback: () => Promise<OAuthCallbackResult>;
  close: () => void;
}

const CALLBACK_URL_PREFIX = 'http://localhost:3848/auth/callback';

/**
 * Opens an in-app BrowserWindow for OAuth sign-in and intercepts the redirect
 * back to localhost to capture the authorization code.
 *
 * This replaces the previous approach of opening the system browser + HTTP callback server.
 * Required by Apple App Store guidelines (Guideline 4.0) to keep auth in-app.
 */
export function startOAuthWindow(authUrl: string, timeoutMs: number = 60000): OAuthWindow {
  let settled = false;
  let callbackResolve: (result: OAuthCallbackResult) => void;
  let callbackReject: (error: Error) => void;
  let timeout: NodeJS.Timeout;

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });

  const win = new BrowserWindow({
    width: 520,
    height: 720,
    show: true,
    title: 'Sign In',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  function handleRedirect(url: string): boolean {
    if (!url.startsWith(CALLBACK_URL_PREFIX)) {
      return false;
    }

    if (settled) return true;
    settled = true;
    clearTimeout(timeout);

    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');
    const errorDescription = parsed.searchParams.get('error_description');

    // Close the window before resolving/rejecting
    if (!win.isDestroyed()) {
      win.close();
    }

    if (error) {
      callbackReject(new Error(errorDescription || error));
    } else if (code) {
      const state = parsed.searchParams.get('state') || undefined;
      callbackResolve({ code, state });
    } else {
      callbackReject(new Error('No authorization code received'));
    }

    return true;
  }

  // Intercept navigations to the callback URL
  win.webContents.on('will-navigate', (event, url) => {
    if (handleRedirect(url)) {
      event.preventDefault();
    }
  });

  win.webContents.on('will-redirect', (event, url) => {
    if (handleRedirect(url)) {
      event.preventDefault();
    }
  });

  // Handle user closing the window before auth completes
  win.on('closed', () => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      callbackReject(new Error('Sign in was cancelled.'));
    }
  });

  // Timeout — close window and reject
  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      if (!win.isDestroyed()) {
        win.close();
      }
      callbackReject(new Error('Sign in timed out. Please try again.'));
    }
  }, timeoutMs);

  // Load the OAuth URL
  win.loadURL(authUrl);

  return {
    waitForCallback: () => callbackPromise,
    close: () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
      }
      if (!win.isDestroyed()) {
        win.close();
      }
    },
  };
}

/**
 * @deprecated Replaced by startOAuthWindow — OAuth now uses an in-app BrowserWindow.
 */
export async function startOAuthCallbackServer(
  _timeoutMs: number = 60000
): Promise<never> {
  throw new Error(
    'startOAuthCallbackServer is deprecated. Use startOAuthWindow instead.'
  );
}
