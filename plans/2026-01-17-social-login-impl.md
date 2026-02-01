# Social Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Google, Microsoft, and Apple OAuth login as alternatives to email OTP.

**Architecture:** Reuse the OAuth callback server pattern from Google Calendar integration. Social providers are configured in Supabase Dashboard (no client secrets in app). The flow opens system browser, captures auth code via localhost callback, exchanges for Supabase session.

**Tech Stack:** Supabase Auth OAuth, Electron shell.openExternal, Node.js http server

---

## Task 1: Create OAuth Callback Server

**Files:**
- Create: `electron/auth/oauthServer.ts`

**Step 1: Create the OAuth server module**

```typescript
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
```

**Step 2: Verify the file compiles**

Run: `cd .worktrees/social-login && npx tsc electron/auth/oauthServer.ts --noEmit --esModuleInterop --moduleResolution node`
Expected: No errors

**Step 3: Commit**

```bash
git add electron/auth/oauthServer.ts
git commit -m "feat(auth): add OAuth callback server for social login"
```

---

## Task 2: Add OAuth Sign-In Method to SupabaseAuthService

**Files:**
- Modify: `electron/auth/supabaseAuth.ts`

**Step 1: Add the signInWithOAuth method**

Add imports at top of file:

```typescript
import { shell } from 'electron';
import { createOAuthCallbackServer, OAuthProvider } from './oauthServer.js';
```

Add new method to `SupabaseAuthService` class (after `verifyOtp` method, around line 225):

```typescript
    /**
     * Sign in with OAuth provider (Google, Microsoft, Apple)
     */
    async signInWithOAuth(provider: OAuthProvider): Promise<AuthResult> {
        if (!this.supabase) {
            return { success: false, error: 'Auth service not initialized' };
        }

        try {
            console.log(`[SupabaseAuth] Starting OAuth flow for: ${provider}`);

            // Map our provider names to Supabase provider names
            const supabaseProvider = provider === 'azure' ? 'azure' : provider;

            // Generate OAuth URL with PKCE
            const { data, error } = await this.supabase.auth.signInWithOAuth({
                provider: supabaseProvider,
                options: {
                    redirectTo: 'http://localhost:3848/auth/callback',
                    skipBrowserRedirect: true,
                },
            });

            if (error || !data.url) {
                console.error('[SupabaseAuth] Failed to generate OAuth URL:', error);
                return { success: false, error: error?.message || 'Failed to start sign in' };
            }

            // Start callback server before opening browser
            const callbackPromise = createOAuthCallbackServer(60000);

            // Open system browser for authentication
            await shell.openExternal(data.url);

            // Wait for callback
            const { code } = await callbackPromise;

            // Exchange code for session
            const { data: sessionData, error: sessionError } =
                await this.supabase.auth.exchangeCodeForSession(code);

            if (sessionError || !sessionData.user || !sessionData.session) {
                console.error('[SupabaseAuth] Failed to exchange code:', sessionError);
                return { success: false, error: sessionError?.message || 'Failed to complete sign in' };
            }

            // Create our auth session
            const authUser: AuthUser = {
                id: sessionData.user.id,
                email: sessionData.user.email || '',
                createdAt: sessionData.user.created_at,
                lastSignIn: new Date().toISOString(),
            };

            const authSession: AuthSession = {
                user: authUser,
                accessToken: sessionData.session.access_token,
                refreshToken: sessionData.session.refresh_token,
                expiresAt: sessionData.session.expires_at
                    ? sessionData.session.expires_at * 1000
                    : Date.now() + 3600000,
            };

            // Save session
            await this.saveSession(authSession);

            console.log('[SupabaseAuth] OAuth sign-in successful:', authUser.email);
            return { success: true, user: authUser, session: authSession };
        } catch (error) {
            console.error('[SupabaseAuth] OAuth sign-in error:', error);

            // Handle user cancellation gracefully
            if (error instanceof Error && error.message.includes('timed out')) {
                return { success: false, error: 'Sign in timed out. Please try again.' };
            }

            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to sign in'
            };
        }
    }
```

**Step 2: Export the OAuthProvider type**

Add to exports at top of file after AuthResult interface:

```typescript
export type { OAuthProvider } from './oauthServer.js';
```

**Step 3: Build to verify**

Run: `cd .worktrees/social-login && npm run build:electron-main`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add electron/auth/supabaseAuth.ts
git commit -m "feat(auth): add signInWithOAuth method for social login"
```

---

## Task 3: Add OAuth IPC Handler

**Files:**
- Modify: `electron/auth/ipcHandlers.ts`

**Step 1: Import OAuthProvider type**

Update the import at line 8:

```typescript
import { getAuthService, AuthUser, AuthSession, OAuthProvider } from './supabaseAuth.js';
```

**Step 2: Register new IPC handler**

Add to `registerIpcHandlers()` function (after line 55, `auth:sign-out` handler):

```typescript
    // Sign in with OAuth
    ipcMain.handle('auth:sign-in-oauth', handleSignInWithOAuth);
```

**Step 3: Add handler function**

Add after `handleVerifyOtp` function (around line 182):

```typescript
/**
 * Sign in with OAuth provider
 * After successful sign-in, ensures a Stripe customer is created for the user.
 */
async function handleSignInWithOAuth(
    _event: Electron.IpcMainInvokeEvent,
    provider: OAuthProvider
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    try {
        const authService = getAuthService();
        const result = await authService.signInWithOAuth(provider);

        // If OAuth sign-in succeeded, ensure Stripe customer exists and refresh subscription
        if (result.success && result.user) {
            console.log('[Auth] OAuth verified, ensuring Stripe customer and refreshing subscription...');
            const edgeClient = getEdgeFunctionClient();

            // Call customer creation asynchronously - don't block login if it fails
            edgeClient.ensureStripeCustomer().catch((error) => {
                console.error('[Auth] Failed to ensure Stripe customer (non-blocking):', error);
            });

            // Force refresh subscription from Supabase
            const subscriptionValidator = getSubscriptionValidator();
            if (subscriptionValidator) {
                subscriptionValidator.validate().then((validationResult) => {
                    console.log('[Auth] Subscription refreshed on OAuth login:', {
                        status: validationResult.subscription?.status,
                        plan: validationResult.subscription?.plan,
                        mode: validationResult.mode,
                    });
                }).catch((error) => {
                    console.error('[Auth] Failed to refresh subscription (non-blocking):', error);
                });
            }
        }

        return result;
    } catch (error) {
        console.error('[Auth] OAuth sign-in error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
```

**Step 4: Build to verify**

Run: `cd .worktrees/social-login && npm run build:electron-main`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add electron/auth/ipcHandlers.ts
git commit -m "feat(auth): add IPC handler for OAuth sign-in"
```

---

## Task 4: Expose OAuth Method in Preload

**Files:**
- Modify: `electron/preload.cts`

**Step 1: Add auth OAuth method**

Add after line 21 (after the `invoke` method), within the `ipcRenderer` object:

```typescript
        // Auth OAuth
        signInWithOAuth: (provider: 'google' | 'azure' | 'apple') =>
            ipcRenderer.invoke('auth:sign-in-oauth', provider),
```

**Step 2: Build to verify**

Run: `cd .worktrees/social-login && npm run build:electron-main`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add electron/preload.cts
git commit -m "feat(auth): expose OAuth sign-in method to renderer"
```

---

## Task 5: Add TypeScript Types for Window.electron

**Files:**
- Modify: `src/types/electron.d.ts` (create if doesn't exist)

**Step 1: Check if types file exists**

Run: `ls -la .worktrees/social-login/src/types/`

**Step 2: Add or update electron types**

If file exists, add to the ipcRenderer interface. If not, create with full interface. Add this method to the ipcRenderer type:

```typescript
signInWithOAuth: (provider: 'google' | 'azure' | 'apple') => Promise<{
    success: boolean;
    user?: {
        id: string;
        email: string;
        stripeCustomerId?: string;
        createdAt: string;
        lastSignIn?: string;
    };
    error?: string;
}>;
```

**Step 3: Build to verify types**

Run: `cd .worktrees/social-login && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/types/
git commit -m "feat(auth): add TypeScript types for OAuth sign-in"
```

---

## Task 6: Update AuthContext with OAuth Method

**Files:**
- Modify: `src/context/AuthContext.tsx`

**Step 1: Add signInWithOAuth to context type**

Update `AuthContextType` interface (around line 11):

```typescript
interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    sendOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
    verifyOtp: (email: string, token: string) => Promise<{ success: boolean; error?: string }>;
    signInWithOAuth: (provider: 'google' | 'azure' | 'apple') => Promise<{ success: boolean; error?: string }>;
    signOut: () => Promise<void>;
    openCustomerPortal: () => Promise<{ success: boolean; error?: string }>;
}
```

**Step 2: Implement signInWithOAuth callback**

Add after `verifyOtp` callback (around line 79):

```typescript
    const signInWithOAuth = useCallback(async (
        provider: 'google' | 'azure' | 'apple'
    ): Promise<{ success: boolean; error?: string }> => {
        try {
            const result = await window.electron.ipcRenderer.signInWithOAuth(provider);

            if (result.success && result.user) {
                setUser(result.user);
            }

            return result;
        } catch (error) {
            console.error('[AuthContext] OAuth sign-in error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to sign in'
            };
        }
    }, []);
```

**Step 3: Add to provider value**

Update the provider value object (around line 106) to include `signInWithOAuth`:

```typescript
    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading,
                sendOtp,
                verifyOtp,
                signInWithOAuth,
                signOut,
                openCustomerPortal,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
```

**Step 4: Build to verify**

Run: `cd .worktrees/social-login && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/context/AuthContext.tsx
git commit -m "feat(auth): add OAuth sign-in to AuthContext"
```

---

## Task 7: Create Social Login Buttons Component

**Files:**
- Create: `src/components/SocialLoginButtons.tsx`

**Step 1: Create the component**

```typescript
// src/components/SocialLoginButtons.tsx

import { useState } from 'react';

type OAuthProvider = 'google' | 'azure' | 'apple';

interface SocialLoginButtonsProps {
    onSignIn: (provider: OAuthProvider) => Promise<{ success: boolean; error?: string }>;
    disabled?: boolean;
}

const providerConfig = {
    google: {
        name: 'Google',
        icon: (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
            </svg>
        ),
    },
    azure: {
        name: 'Microsoft',
        icon: (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#F25022" d="M1 1h10v10H1z" />
                <path fill="#00A4EF" d="M1 13h10v10H1z" />
                <path fill="#7FBA00" d="M13 1h10v10H13z" />
                <path fill="#FFB900" d="M13 13h10v10H13z" />
            </svg>
        ),
    },
    apple: {
        name: 'Apple',
        icon: (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
        ),
    },
};

export function SocialLoginButtons({ onSignIn, disabled }: SocialLoginButtonsProps) {
    const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSignIn = async (provider: OAuthProvider) => {
        setLoadingProvider(provider);
        setError(null);

        const result = await onSignIn(provider);

        setLoadingProvider(null);

        if (!result.success) {
            setError(result.error || 'Sign in failed');
        }
    };

    const providers: OAuthProvider[] = ['google', 'azure', 'apple'];

    return (
        <div className="space-y-3">
            {providers.map((provider) => {
                const config = providerConfig[provider];
                const isLoading = loadingProvider === provider;
                const isDisabled = disabled || loadingProvider !== null;

                return (
                    <button
                        key={provider}
                        type="button"
                        onClick={() => handleSignIn(provider)}
                        disabled={isDisabled}
                        className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            backgroundColor: 'var(--color-bg-tertiary)',
                            borderColor: 'var(--color-border-primary)',
                            color: 'var(--color-text-primary)',
                            fontFamily: 'var(--font-display)',
                            borderRadius: 'var(--radius-xl)',
                        }}
                        onMouseEnter={(e) => {
                            if (!isDisabled) {
                                e.currentTarget.style.borderColor = 'var(--color-border-secondary)';
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--color-border-primary)';
                            e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
                        }}
                    >
                        {isLoading ? (
                            <svg className="animate-spin h-5 w-5\" viewBox="0 0 24 24">
                                <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                    fill="none"
                                />
                                <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                            </svg>
                        ) : (
                            config.icon
                        )}
                        <span className="font-medium">
                            {isLoading ? 'Signing in...' : `Continue with ${config.name}`}
                        </span>
                    </button>
                );
            })}

            {error && (
                <div
                    className="p-3 rounded-xl border animate-slide-down"
                    style={{
                        backgroundColor: 'var(--color-error-muted)',
                        borderColor: 'var(--color-error)',
                        borderRadius: 'var(--radius-xl)',
                    }}
                >
                    <p
                        className="text-sm font-medium text-center"
                        style={{ color: 'var(--color-error)' }}
                    >
                        {error}
                    </p>
                </div>
            )}
        </div>
    );
}
```

**Step 2: Build to verify**

Run: `cd .worktrees/social-login && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/SocialLoginButtons.tsx
git commit -m "feat(auth): add SocialLoginButtons component"
```

---

## Task 8: Update LoginScreen with Social Login

**Files:**
- Modify: `src/components/LoginScreen.tsx`

**Step 1: Import SocialLoginButtons and update useAuth**

Update imports at top:

```typescript
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { SocialLoginButtons } from './SocialLoginButtons';
```

**Step 2: Get signInWithOAuth from useAuth**

Update the destructuring (line 7):

```typescript
    const { sendOtp, verifyOtp, signInWithOAuth } = useAuth();
```

**Step 3: Remove handleOpenSignup function**

Delete the `handleOpenSignup` function (lines 63-65).

**Step 4: Add social login buttons to email step**

In the `step === 'email'` form section, add the social buttons and divider before the email input. Replace the form content (inside `{step === 'email' ? (` block) with:

```tsx
                        <form onSubmit={handleSendOtp}>
                            <h2
                                className="text-xl font-semibold mb-6"
                                style={{
                                    fontFamily: 'var(--font-display)',
                                    color: 'var(--color-text-primary)'
                                }}
                            >
                                Sign in to your account
                            </h2>

                            {/* Social Login Buttons */}
                            <SocialLoginButtons
                                onSignIn={signInWithOAuth}
                                disabled={isLoading}
                            />

                            {/* Divider */}
                            <div className="flex items-center gap-4 my-6">
                                <div
                                    className="flex-1 h-px"
                                    style={{ backgroundColor: 'var(--color-border-primary)' }}
                                />
                                <span
                                    className="text-xs font-medium uppercase"
                                    style={{
                                        color: 'var(--color-text-secondary)',
                                        letterSpacing: 'var(--tracking-wider)',
                                    }}
                                >
                                    or
                                </span>
                                <div
                                    className="flex-1 h-px"
                                    style={{ backgroundColor: 'var(--color-border-primary)' }}
                                />
                            </div>

                            {/* Email input - existing code continues here */}
                            <div className="mb-5">
                                <label
                                    htmlFor="email"
                                    className="block text-xs font-semibold mb-2 uppercase"
                                    style={{
                                        fontFamily: 'var(--font-display)',
                                        color: 'var(--color-text-secondary)',
                                        letterSpacing: 'var(--tracking-wider)'
                                    }}
                                >
                                    Email Address
                                </label>
                                {/* ... rest of email input unchanged ... */}
```

**Step 5: Remove the "Don't have an account?" section**

Delete the sign-up link section (lines 370-396 in original) since social login handles account creation.

**Step 6: Build to verify**

Run: `cd .worktrees/social-login && npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add src/components/LoginScreen.tsx
git commit -m "feat(auth): integrate social login buttons into LoginScreen"
```

---

## Task 9: Final Integration Test

**Step 1: Run full build**

Run: `cd .worktrees/social-login && npm run build`
Expected: Build succeeds with no errors

**Step 2: Run TypeScript check**

Run: `cd .worktrees/social-login && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit any fixes**

If any fixes needed, commit them:

```bash
git add -A
git commit -m "fix(auth): resolve integration issues"
```

---

## External Setup (Manual - Not Automated)

After implementation, configure in Supabase Dashboard:

1. **Google OAuth**
   - Go to Supabase Dashboard → Authentication → Providers → Google
   - Enable Google provider
   - Add Client ID and Client Secret from Google Cloud Console
   - Authorized redirect URI: Add your Supabase project's callback URL

2. **Microsoft OAuth**
   - Go to Supabase Dashboard → Authentication → Providers → Azure
   - Enable Azure provider
   - Add Application ID and Client Secret from Azure Portal
   - Configure redirect URI in Azure

3. **Apple OAuth**
   - Go to Supabase Dashboard → Authentication → Providers → Apple
   - Enable Apple provider
   - Add Services ID, Key ID, and Private Key from Apple Developer Portal

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | OAuth callback server | `electron/auth/oauthServer.ts` |
| 2 | signInWithOAuth method | `electron/auth/supabaseAuth.ts` |
| 3 | IPC handler | `electron/auth/ipcHandlers.ts` |
| 4 | Preload exposure | `electron/preload.cts` |
| 5 | TypeScript types | `src/types/electron.d.ts` |
| 6 | AuthContext update | `src/context/AuthContext.tsx` |
| 7 | Social buttons component | `src/components/SocialLoginButtons.tsx` |
| 8 | LoginScreen integration | `src/components/LoginScreen.tsx` |
| 9 | Final integration test | - |
