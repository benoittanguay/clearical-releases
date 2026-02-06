// electron/auth/oauthServer.ts

import http from 'http';

export type OAuthProvider = 'google' | 'azure' | 'apple';

interface OAuthCallbackResult {
  code: string;
  state?: string;
}

interface OAuthServer {
  waitForCallback: () => Promise<OAuthCallbackResult>;
  close: () => void;
}

/** Escape user-controlled strings before injecting into HTML to prevent XSS. */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Attempts to start the OAuth callback server on the given port.
 * Error handler is attached before listen() to prevent uncaught exceptions.
 */
function tryStartServer(port: number, timeoutMs: number): Promise<OAuthServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let callbackResolve: (result: OAuthCallbackResult) => void;
    let callbackReject: (error: Error) => void;
    let timeout: NodeJS.Timeout;

    const callbackPromise = new Promise<OAuthCallbackResult>((res, rej) => {
      callbackResolve = res;
      callbackReject = rej;
    });

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '', 'http://localhost:3848');
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const errorDescription = reqUrl.searchParams.get('error_description');
      const state = reqUrl.searchParams.get('state');

      // Send response to browser - show inline success/error page
      // (Don't redirect to external site as it may trigger additional auth prompts)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        const safeMessage = escapeHtml(errorDescription || error);
        res.end(`<!DOCTYPE html>
<html><head><title>Sign In Error</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#F7EFE3;}
.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h1{color:#DC2626;margin:0 0 16px;}p{color:#6B6560;margin:0;}</style></head>
<body><div class="card"><h1>Sign In Failed</h1><p>${safeMessage}</p><p style="margin-top:16px;color:#8C877D;">You can close this window.</p></div></body></html>`);
      } else {
        res.end(`<!DOCTYPE html>
<html><head><title>Sign In Successful</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#F7EFE3;}
.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h1{color:#16A34A;margin:0 0 16px;}p{color:#6B6560;margin:0;}
.checkmark{width:64px;height:64px;margin:0 auto 24px;background:#DCFCE7;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.checkmark svg{width:32px;height:32px;color:#16A34A;}</style></head>
<body><div class="card">
<div class="checkmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
<h1>Sign In Successful</h1><p>You can close this window and return to Clearical.</p></div></body></html>`);
      }

      // Cleanup
      server.close();
      clearTimeout(timeout);

      if (error) {
        callbackReject(new Error(errorDescription || error));
      } else if (code) {
        callbackResolve({ code, state: state || undefined });
      } else {
        callbackReject(new Error('No authorization code received'));
      }
    });

    // Attach error handler BEFORE listen to prevent uncaught exceptions
    server.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to start OAuth server: ${err.message}`));
    });

    // Start server and resolve when listening
    server.listen(port, '127.0.0.1', () => {
      if (settled) return;
      settled = true;
      console.log('[OAuthServer] Listening on http://localhost:3848');

      // Start timeout only after server is ready
      timeout = setTimeout(() => {
        server.close();
        callbackReject(new Error('Sign in timed out. Please try again.'));
      }, timeoutMs);

      // Server is ready - resolve with controller
      resolve({
        waitForCallback: () => callbackPromise,
        close: () => {
          clearTimeout(timeout);
          server.close();
        },
      });
    });
  });
}

/**
 * Starts the OAuth callback server and returns when it's ready to receive connections.
 * Returns an object with waitForCallback() to get the auth code.
 * Uses port 3848 (3847 is used by calendar OAuth)
 *
 * Retries up to 3 times with 500ms delay to handle port still held from a previous attempt.
 * Converts technical errors to user-friendly messages.
 */
export async function startOAuthCallbackServer(
  timeoutMs: number = 60000
): Promise<OAuthServer> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await tryStartServer(3848, timeoutMs);
    } catch (err) {
      lastError = err as Error;
      console.warn(`[OAuthServer] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // Convert technical error to user-friendly message
  const msg = lastError?.message || '';
  if (msg.includes('EPERM') || msg.includes('EACCES')) {
    throw new Error('Unable to start sign-in server. A firewall or security setting may be blocking local connections. Please check your firewall settings and try again.');
  } else if (msg.includes('EADDRINUSE')) {
    throw new Error('Sign-in server port is busy. Please close other applications that may be using it and try again.');
  }
  throw lastError || new Error('Failed to start sign-in server');
}

/**
 * @deprecated Use startOAuthCallbackServer instead for proper sequencing
 * Creates a temporary HTTP server to capture OAuth callback
 */
export function createOAuthCallbackServer(
  timeoutMs: number = 60000
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '', 'http://localhost:3848');
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const errorDescription = reqUrl.searchParams.get('error_description');
      const state = reqUrl.searchParams.get('state');

      // Send response to browser - show inline success/error page
      // (Don't redirect to external site as it may trigger additional auth prompts)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (error) {
        const safeMessage = escapeHtml(errorDescription || error);
        res.end(`<!DOCTYPE html>
<html><head><title>Sign In Error</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#F7EFE3;}
.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h1{color:#DC2626;margin:0 0 16px;}p{color:#6B6560;margin:0;}</style></head>
<body><div class="card"><h1>Sign In Failed</h1><p>${safeMessage}</p><p style="margin-top:16px;color:#8C877D;">You can close this window.</p></div></body></html>`);
      } else {
        res.end(`<!DOCTYPE html>
<html><head><title>Sign In Successful</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#F7EFE3;}
.card{background:white;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h1{color:#16A34A;margin:0 0 16px;}p{color:#6B6560;margin:0;}
.checkmark{width:64px;height:64px;margin:0 auto 24px;background:#DCFCE7;border-radius:50%;display:flex;align-items:center;justify-content:center;}
.checkmark svg{width:32px;height:32px;color:#16A34A;}</style></head>
<body><div class="card">
<div class="checkmark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
<h1>Sign In Successful</h1><p>You can close this window and return to Clearical.</p></div></body></html>`);
      }

      // Cleanup
      server.close();
      clearTimeout(timeout);

      if (error) {
        reject(new Error(errorDescription || error));
      } else if (code) {
        resolve({ code, state: state || undefined });
      } else {
        reject(new Error('No authorization code received'));
      }
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      server.close();
      if (!settled) {
        settled = true;
        reject(new Error('Sign in timed out. Please try again.'));
      }
    }, timeoutMs);

    // Attach error handler BEFORE listen to prevent uncaught exceptions
    server.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to start OAuth server: ${err.message}`));
    });

    // Start server
    server.listen(3848, '127.0.0.1', () => {
      console.log('[OAuthServer] Listening on http://localhost:3848');
    });
  });
}
