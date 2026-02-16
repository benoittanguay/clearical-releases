# Apple Review Fixes (v1.7.39) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all Apple App Store review rejections: move OAuth sign-in in-app, disable auto-updater for MAS builds, remove `network.server` entitlement.

**Architecture:** Replace `shell.openExternal()` + localhost HTTP callback server with an in-app `BrowserWindow` that intercepts the OAuth redirect via `will-navigate`/`will-redirect`. This eliminates the need for local HTTP servers and the `network.server` entitlement. The auto-updater is completely disabled for MAS builds using Electron's `process.mas` flag. The webhook server is also gated behind `!process.mas`.

**Tech Stack:** Electron BrowserWindow, Supabase PKCE OAuth, electron-updater, electron-builder

---

## Summary of Changes

| Apple Issue | Fix |
|---|---|
| Guideline 4.0 — OAuth opens system browser | Use in-app BrowserWindow for all OAuth (Apple, Google, Microsoft) |
| Guideline 2.4.5(vii) — Auto-updater outside App Store | Disable auto-updater entirely for MAS builds (`process.mas`) |
| Guideline 2.4.5(i) — `network.server` entitlement unused | Remove entitlement; no more localhost HTTP servers in MAS builds |
| Guideline 2.1 — Accessibility justification | Reply-only (no code change) |
| Guideline 2.1 — Screen recording data | Reply-only (no code change) |

---

### Task 1: Replace OAuth HTTP callback server with in-app BrowserWindow

**Files:**
- Rewrite: `electron/auth/oauthServer.ts` — replace HTTP server with BrowserWindow-based OAuth
- Modify: `electron/auth/supabaseAuth.ts:336-383` — change redirect URL and remove `shell.openExternal()`

**Context:**
Currently, `signInWithOAuth()` in `supabaseAuth.ts`:
1. Generates a Supabase OAuth URL with `redirectTo: 'http://localhost:3848/auth/callback'`
2. Starts an HTTP server on port 3848 via `startOAuthCallbackServer()`
3. Opens the system browser via `shell.openExternal(data.url)`
4. Waits for the browser to redirect back to localhost with the auth code

The new approach:
1. Generate the Supabase OAuth URL with a custom redirect scheme or keep the localhost redirect
2. Open the OAuth URL in an in-app `BrowserWindow`
3. Intercept the redirect using `webContents.on('will-redirect')` or `will-navigate` to capture the auth code
4. Close the window and exchange the code

**Step 1: Rewrite `oauthServer.ts` to use BrowserWindow**

Replace the entire file content with:

```typescript
// electron/auth/oauthServer.ts

import { BrowserWindow } from 'electron';

export type OAuthProvider = 'google' | 'azure' | 'apple';

interface OAuthCallbackResult {
  code: string;
  state?: string;
}

interface OAuthSession {
  waitForCallback: () => Promise<OAuthCallbackResult>;
  close: () => void;
}

const CALLBACK_URL_PREFIX = 'http://localhost:3848/auth/callback';

/**
 * Opens an in-app BrowserWindow for OAuth authentication.
 * Intercepts the redirect to the callback URL to capture the auth code
 * without needing a local HTTP server.
 */
export function startOAuthWindow(
  authUrl: string,
  timeoutMs: number = 60000
): OAuthSession {
  let callbackResolve: (result: OAuthCallbackResult) => void;
  let callbackReject: (error: Error) => void;
  let settled = false;

  const callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });

  const authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    show: true,
    title: 'Sign In',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const settle = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  // Intercept navigation to the callback URL
  const handleRedirect = (_event: Electron.Event, url: string) => {
    if (!url.startsWith(CALLBACK_URL_PREFIX)) return;

    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');
    const errorDescription = parsed.searchParams.get('error_description');
    const state = parsed.searchParams.get('state');

    authWindow.close();

    if (error) {
      settle(() => callbackReject(new Error(errorDescription || error)));
    } else if (code) {
      settle(() => callbackResolve({ code, state: state || undefined }));
    } else {
      settle(() => callbackReject(new Error('No authorization code received')));
    }
  };

  authWindow.webContents.on('will-navigate', handleRedirect);
  authWindow.webContents.on('will-redirect', handleRedirect);

  // User closed the window without completing auth
  authWindow.on('closed', () => {
    settle(() => callbackReject(new Error('Sign in was cancelled.')));
  });

  // Timeout
  const timeout = setTimeout(() => {
    if (!authWindow.isDestroyed()) authWindow.close();
    settle(() => callbackReject(new Error('Sign in timed out. Please try again.')));
  }, timeoutMs);

  // Load the OAuth URL
  authWindow.loadURL(authUrl);

  return {
    waitForCallback: () => callbackPromise,
    close: () => {
      clearTimeout(timeout);
      if (!authWindow.isDestroyed()) authWindow.close();
    },
  };
}

// Keep the old export name for backward compatibility with import in supabaseAuth.ts
// This is now unused but prevents a compile error if anything else imports it
export async function startOAuthCallbackServer(
  _timeoutMs: number = 60000
): Promise<{ waitForCallback: () => Promise<OAuthCallbackResult>; close: () => void }> {
  throw new Error('startOAuthCallbackServer is deprecated. Use startOAuthWindow instead.');
}
```

**Step 2: Update `supabaseAuth.ts` to use the in-app window**

In `supabaseAuth.ts`, change the import and the `signInWithOAuth` method:

- Change import from `startOAuthCallbackServer` to `startOAuthWindow`
- Remove the `shell` import (only used for `shell.openExternal` in OAuth — check if used elsewhere first)
- In `signInWithOAuth()`:
  - Keep the same `redirectTo: 'http://localhost:3848/auth/callback'` (the window intercepts this before it hits the network)
  - Replace the HTTP server start + `shell.openExternal()` with `startOAuthWindow(data.url)`
  - The rest (waiting for callback, exchanging code) stays the same

The key change in `signInWithOAuth()` (around lines 361-388):
```typescript
// OLD:
oauthServer = await startOAuthCallbackServer(60000);
await shell.openExternal(data.url);

// NEW:
oauthServer = startOAuthWindow(data.url, 60000);
```

Note: `startOAuthWindow` is synchronous (returns immediately with the session object), unlike `startOAuthCallbackServer` which was async. The `await` on `waitForCallback()` is where we actually wait.

**Step 3: Run `npm run build` to verify compilation**

Run: `npm run build`
Expected: Clean compilation with no errors

**Step 4: Commit**

```bash
git add electron/auth/oauthServer.ts electron/auth/supabaseAuth.ts
git commit -m "feat(auth): move OAuth sign-in to in-app BrowserWindow

Replace shell.openExternal() + localhost HTTP callback server with
an in-app BrowserWindow that intercepts the OAuth redirect URL.
This keeps the authentication flow within the app as required by
Apple App Store guidelines (Guideline 4.0)."
```

---

### Task 2: Update Google Calendar OAuth to not use localhost server in MAS builds

**Files:**
- Modify: `electron/calendar/googleCalendarProvider.ts:169-211` — already uses BrowserWindow but still starts an HTTP server on port 3847

**Context:**
The Google Calendar provider already opens a `BrowserWindow` for OAuth, but also starts an HTTP server on port 3847 to catch the redirect. We need to intercept the redirect in the same way as Task 1.

**Step 1: Replace HTTP server with `will-navigate`/`will-redirect` interception**

In `googleCalendarProvider.ts`, rewrite the `openAuthWindow` method:

```typescript
private openAuthWindow(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      title: 'Connect Google Calendar',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    const handleRedirect = (_event: Electron.Event, url: string) => {
      if (!url.startsWith('http://localhost:3847/oauth/callback')) return;
      if (settled) return;
      settled = true;

      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      authWindow.close();

      if (error) {
        reject(new Error(`OAuth error: ${error}`));
      } else if (code) {
        resolve(code);
      } else {
        reject(new Error('No authorization code received'));
      }
    };

    authWindow.webContents.on('will-navigate', handleRedirect);
    authWindow.webContents.on('will-redirect', handleRedirect);

    authWindow.on('closed', () => {
      if (!settled) {
        settled = true;
        reject(new Error('Authentication cancelled'));
      }
    });

    authWindow.loadURL(authUrl);
  });
}
```

This removes the `http` import entirely from `googleCalendarProvider.ts`.

**Step 2: Remove `http` import**

Remove `import http from 'http';` from the top of `googleCalendarProvider.ts` (line 4).

**Step 3: Run `npm run build` to verify compilation**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add electron/calendar/googleCalendarProvider.ts
git commit -m "feat(calendar): replace HTTP server with BrowserWindow redirect interception

Remove localhost HTTP server from Google Calendar OAuth flow.
The BrowserWindow now intercepts the redirect URL directly,
eliminating the need for a local server."
```

---

### Task 3: Disable auto-updater for MAS builds

**Files:**
- Modify: `electron/autoUpdater.ts:240-259` — skip initialization for MAS
- Modify: `electron/main.ts:33` — conditionally import/use updater
- Modify: `electron/main.ts:4304-4309` — skip updater initialization for MAS
- Modify: `electron/main.ts:2952-3035` — guard IPC handlers
- Modify: `electron/main.ts:3735-3736` — guard cleanup

**Context:**
Electron sets `process.mas = true` when running as a Mac App Store build. We use this to completely disable the auto-updater.

**Step 1: Guard the auto-updater `start()` method**

In `electron/autoUpdater.ts`, add a MAS check at the top of `start()`:

```typescript
public start(): void {
    // Skip update checks in MAS builds - App Store handles updates
    if ((process as any).mas) {
        log.info('[AutoUpdater] Skipping update checks in Mac App Store build');
        return;
    }

    // Skip update checks in development
    if (!app.isPackaged) {
        log.info('[AutoUpdater] Skipping update checks in development mode');
        return;
    }
    // ... rest unchanged
```

**Step 2: Guard the updater IPC handlers in `main.ts`**

Wrap all `updater:*` IPC handlers (lines ~2952-3035) in a `if (!(process as any).mas)` check, or have them return no-op responses when MAS.

Simpler approach: in each handler, the updater methods already handle gracefully (they just return status). But to be safe, wrap the initialization block in main.ts:

```typescript
// Initialize auto-updater (skip for Mac App Store builds)
if (!(process as any).mas) {
    updater.setMainWindow(win);
    updater.start();
    console.log('[Main] Auto-updater initialized');
} else {
    console.log('[Main] Skipping auto-updater (Mac App Store build)');
}
```

**Step 3: Guard updater cleanup in `main.ts`**

At line ~3735, wrap: `if (!(process as any).mas) { updater.cleanup(); }`

**Step 4: Run `npm run build` to verify compilation**

Run: `npm run build`
Expected: Clean compilation

**Step 5: Commit**

```bash
git add electron/autoUpdater.ts electron/main.ts
git commit -m "fix(updater): disable auto-updater for Mac App Store builds

Mac App Store handles all updates. The auto-updater via GitHub Releases
must be disabled for MAS builds per Apple Guideline 2.4.5(vii).
Uses process.mas flag to detect MAS runtime environment."
```

---

### Task 4: Gate webhook server behind non-MAS check

**Files:**
- Modify: `electron/subscription/ipcHandlers.ts:70-77` — skip webhook server for MAS builds

**Context:**
The webhook server on port 3001 is another local HTTP server that requires `network.server`. In MAS builds, subscription updates come via Supabase polling, not local webhooks. Gate it.

**Step 1: Add MAS guard to webhook server initialization**

In `electron/subscription/ipcHandlers.ts`, around line 70:

```typescript
// Start webhook server if webhooks are enabled and we have a secret
// Skip in MAS builds - no local servers allowed
if (config.enableWebhooks && config.stripeWebhookSecret && !(process as any).mas) {
```

**Step 2: Run `npm run build` to verify compilation**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add electron/subscription/ipcHandlers.ts
git commit -m "fix(subscription): skip webhook server in Mac App Store builds

Local HTTP servers are not appropriate for MAS builds.
Subscription updates in MAS use Supabase polling instead."
```

---

### Task 5: Remove `network.server` entitlement from MAS build

**Files:**
- Modify: `build/entitlements.mas.plist` — remove `com.apple.security.network.server`

**Context:**
After Tasks 1-4, no MAS code path starts a local HTTP server. The entitlement is no longer needed.

**Step 1: Remove the entitlement**

Remove these lines from `build/entitlements.mas.plist`:

```xml
    <!-- Network server for OAuth callback (localhost only) -->
    <!-- Required for Sign in with Apple, Google, and Microsoft OAuth flows -->
    <key>com.apple.security.network.server</key>
    <true/>
```

The file should look like:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- App Sandbox (required for Mac App Store) -->
    <key>com.apple.security.app-sandbox</key>
    <true/>

    <!-- Network access for API calls (Jira, Tempo, Supabase) -->
    <key>com.apple.security.network.client</key>
    <true/>

    <!-- Microphone access for meeting recording -->
    <key>com.apple.security.device.audio-input</key>
    <true/>

    <!-- File access for exports -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

**Step 2: Commit**

```bash
git add build/entitlements.mas.plist
git commit -m "fix(entitlements): remove network.server from MAS entitlements

No local HTTP servers are used in MAS builds after OAuth and webhook
changes. Resolves Apple Guideline 2.4.5(i) feedback."
```

---

### Task 6: Hide UpdateNotification component in MAS builds

**Files:**
- Modify: `src/App.tsx:2187` — conditionally render UpdateNotification
- Modify: `electron/preload.cts:158-175` — expose `isMas` flag to renderer

**Context:**
The `<UpdateNotification />` component in App.tsx shows update UI to users. In MAS builds this should be hidden since updates come through the App Store.

**Step 1: Expose `isMas` flag via preload**

In `electron/preload.cts`, add to the exposed API:

```typescript
isMas: (process as any).mas === true,
```

**Step 2: Add `isMas` to the electron.d.ts type**

In `src/types/electron.d.ts`, add `isMas: boolean` to the `ElectronAPI` interface.

**Step 3: Conditionally render in App.tsx**

Change line 2187 from:
```tsx
<UpdateNotification showManualCheck={false} />
```
to:
```tsx
{!window.electron?.isMas && <UpdateNotification showManualCheck={false} />}
```

**Step 4: Run `npm run build` to verify compilation**

Run: `npm run build`
Expected: Clean compilation

**Step 5: Commit**

```bash
git add src/App.tsx electron/preload.cts src/types/electron.d.ts
git commit -m "fix(ui): hide update notification in Mac App Store builds

MAS builds receive updates through the App Store, so the in-app
update notification component should not be shown."
```

---

### Task 7: Build MAS package and verify

**Step 1: Build MAS target**

Run: `npm run build:mas`
Expected: Successful build producing a MAS `.pkg` file

**Step 2: Verify entitlements in the built app**

Run: `codesign -d --entitlements :- "dist/mas-arm64/Clearical.app"` (adjust path)
Expected: Should NOT contain `com.apple.security.network.server`

**Step 3: Final commit with version bump if needed**

---

## Reply-Only Items (No Code Changes)

### Accessibility Justification (Guideline 2.1)
Reply to Apple in App Store Connect:
> "Clearical uses Accessibility access to detect the currently active application name and window title via macOS System Events AppleScript API. This is used to automatically label time-tracking entries with the application and window title the user is working in, and to skip screenshot captures when certain apps are active (user-configurable blacklist). No user interactions are simulated — only read-only observation of frontmost window metadata (app name, bundle identifier, window title)."

### Screen Recording Data (Guideline 2.1)
Reply to Apple with detailed answers — see the separate reply template (not a code change).
