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

      // Send response to browser
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (error) {
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Sign in failed</h1>
              <p>${errorDescription || error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
      } else {
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>Sign in successful!</h1>
              <p>You can close this window and return to the app.</p>
              <script>window.close()</script>
            </body>
          </html>
        `);
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
