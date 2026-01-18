// electron/auth/oauthServer.ts

import http from 'http';

export type OAuthProvider = 'google' | 'azure' | 'apple';

interface OAuthCallbackResult {
  code: string;
  state?: string;
}

/**
 * Creates a temporary HTTP server to capture OAuth callback
 * Uses port 3848 (3847 is used by calendar OAuth)
 */
export function createOAuthCallbackServer(
  timeoutMs: number = 60000
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '', 'http://localhost:3848');
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      const errorDescription = reqUrl.searchParams.get('error_description');
      const state = reqUrl.searchParams.get('state');

      // Send response to browser - redirect to clearical.io success/error page
      if (error) {
        const errorUrl = `https://www.clearical.io/auth/error?message=${encodeURIComponent(errorDescription || error)}`;
        res.writeHead(302, { 'Location': errorUrl });
        res.end();
      } else {
        res.writeHead(302, { 'Location': 'https://www.clearical.io/auth/success' });
        res.end();
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
      reject(new Error('Sign in timed out. Please try again.'));
    }, timeoutMs);

    // Start server
    server.listen(3848, '127.0.0.1', () => {
      console.log('[OAuthServer] Listening on http://localhost:3848');
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start OAuth server: ${err.message}`));
    });
  });
}
