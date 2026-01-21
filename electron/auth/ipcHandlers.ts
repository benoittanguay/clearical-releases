/**
 * Auth IPC Handlers
 *
 * Electron IPC handlers for authentication operations.
 */

import { ipcMain, shell, app } from 'electron';
import { getAuthService, SupabaseAuthService, AuthUser, AuthSession, OAuthProvider } from './supabaseAuth.js';
import { getConfig } from '../config.js';
import { getEdgeFunctionClient } from '../subscription/edgeFunctionClient.js';
import { getSubscriptionValidator } from '../subscription/ipcHandlers.js';
import { getCalendarService } from '../calendar/calendarService.js';
import { getTranscriptionService } from '../meeting/transcriptionService.js';

/**
 * Get the current app version
 */
function getAppVersion(): string {
    return app.getVersion();
}

/**
 * Update TranscriptionService with current auth session
 * Converts AuthSession format to Supabase Session format
 */
function updateTranscriptionSession(authSession: AuthSession | null): void {
    const transcriptionService = getTranscriptionService();

    if (!authSession) {
        transcriptionService.setSession(null);
        console.log('[Auth] Cleared transcription service session');
        return;
    }

    // Convert AuthSession (camelCase) to Supabase Session format (snake_case)
    const supabaseSession = {
        access_token: authSession.accessToken,
        refresh_token: authSession.refreshToken,
        expires_at: Math.floor(authSession.expiresAt / 1000), // Convert ms to seconds
        expires_in: Math.floor((authSession.expiresAt - Date.now()) / 1000),
        token_type: 'bearer',
        user: {
            id: authSession.user.id,
            email: authSession.user.email,
            aud: 'authenticated',
            role: 'authenticated',
            created_at: authSession.user.createdAt,
        },
    };

    transcriptionService.setSession(supabaseSession as any);
    console.log('[Auth] Updated transcription service session for user:', authSession.user.email);
}

/**
 * Initialize auth system
 */
export function initializeAuth(): void {
    console.log('[Auth] Initializing auth system...');

    const config = getConfig();

    if (!config.supabase.url || !config.supabase.anonKey) {
        console.error('[Auth] Missing Supabase credentials in config');
        return;
    }

    const authService = getAuthService();
    authService.initialize(config.supabase.url, config.supabase.anonKey);

    // Register IPC handlers
    registerIpcHandlers();

    // Validate existing session on startup (async, don't block)
    validateSessionOnStartup(authService);

    console.log('[Auth] Auth system initialized');
}

/**
 * Validate session on startup and log diagnostic info
 */
async function validateSessionOnStartup(authService: SupabaseAuthService): Promise<void> {
    try {
        console.log('[Auth] Validating existing session on startup...');
        const session = await authService.getSession();

        if (session) {
            const now = Date.now();
            const expiresIn = session.expiresAt - now;
            const expiresInMinutes = Math.round(expiresIn / 60000);

            console.log('[Auth] ✓ Valid session found');
            console.log('[Auth]   User:', session.user.email);
            console.log('[Auth]   Token expires:', new Date(session.expiresAt).toISOString());
            console.log('[Auth]   Expires in:', expiresInMinutes, 'minutes');
            console.log('[Auth]   Has refresh token:', !!session.refreshToken);

            if (!session.refreshToken) {
                console.warn('[Auth] ⚠️ WARNING: No refresh token - user will need to re-authenticate when token expires');
            }

            if (expiresInMinutes < 30) {
                console.warn('[Auth] ⚠️ Token expires soon - refresh will be attempted');
            }

            // Wire up transcription service with the session
            updateTranscriptionSession(session);
        } else {
            console.log('[Auth] No active session - user needs to sign in for AI features');
        }
    } catch (error) {
        console.error('[Auth] Error validating session on startup:', error);
    }
}

/**
 * Register all auth-related IPC handlers
 */
function registerIpcHandlers(): void {
    // Check if authenticated
    ipcMain.handle('auth:is-authenticated', handleIsAuthenticated);

    // Get current user
    ipcMain.handle('auth:get-user', handleGetUser);

    // Get current session
    ipcMain.handle('auth:get-session', handleGetSession);

    // Send OTP
    ipcMain.handle('auth:send-otp', handleSendOtp);

    // Verify OTP
    ipcMain.handle('auth:verify-otp', handleVerifyOtp);

    // Sign out
    ipcMain.handle('auth:sign-out', handleSignOut);

    // Sign in with OAuth
    ipcMain.handle('auth:sign-in-oauth', handleSignInWithOAuth);

    // Open Stripe Customer Portal
    ipcMain.handle('auth:open-customer-portal', handleOpenCustomerPortal);

    console.log('[Auth] IPC handlers registered');
}

/**
 * Check if user is authenticated
 */
async function handleIsAuthenticated(): Promise<boolean> {
    const authService = getAuthService();
    return await authService.isAuthenticated();
}

/**
 * Get current user
 */
async function handleGetUser(): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    try {
        const authService = getAuthService();
        const user = await authService.getCurrentUser();

        if (user) {
            return { success: true, user };
        } else {
            return { success: false, error: 'Not authenticated' };
        }
    } catch (error) {
        console.error('[Auth] Get user error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get current session
 */
async function handleGetSession(): Promise<{ success: boolean; session?: AuthSession; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (session) {
            return { success: true, session };
        } else {
            return { success: false, error: 'No session' };
        }
    } catch (error) {
        console.error('[Auth] Get session error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Send OTP to email
 */
async function handleSendOtp(
    _event: Electron.IpcMainInvokeEvent,
    email: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const result = await authService.sendOtp(email);
        return result;
    } catch (error) {
        console.error('[Auth] Send OTP error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Verify OTP code
 * After successful verification, ensures a Stripe customer is created for the user.
 */
async function handleVerifyOtp(
    _event: Electron.IpcMainInvokeEvent,
    email: string,
    token: string
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
    try {
        const authService = getAuthService();
        const result = await authService.verifyOtp(email, token);

        // If OTP verification succeeded, ensure Stripe customer exists and refresh subscription
        if (result.success && result.user && result.session) {
            console.log('[Auth] OTP verified, ensuring Stripe customer and refreshing subscription...');

            // Wire up transcription service with the new session
            updateTranscriptionSession(result.session);

            const edgeClient = getEdgeFunctionClient();

            // Call customer creation asynchronously - don't block login if it fails
            edgeClient.ensureStripeCustomer().catch((error) => {
                console.error('[Auth] Failed to ensure Stripe customer (non-blocking):', error);
            });

            // Update app version in user's profile
            const version = getAppVersion();
            edgeClient.updateAppVersion(version).catch((error) => {
                console.error('[Auth] Failed to update app version (non-blocking):', error);
            });

            // Force refresh subscription from Supabase to ensure local cache is up-to-date
            // This overwrites any stale local subscription.dat with fresh Supabase data
            const subscriptionValidator = getSubscriptionValidator();
            if (subscriptionValidator) {
                subscriptionValidator.validate().then((validationResult) => {
                    console.log('[Auth] Subscription refreshed on login:', {
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
        console.error('[Auth] Verify OTP error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

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
        if (result.success && result.user && result.session) {
            console.log('[Auth] OAuth verified, ensuring Stripe customer and refreshing subscription...');

            // Wire up transcription service with the new session
            updateTranscriptionSession(result.session);

            const edgeClient = getEdgeFunctionClient();

            // Call customer creation asynchronously - don't block login if it fails
            edgeClient.ensureStripeCustomer().catch((error) => {
                console.error('[Auth] Failed to ensure Stripe customer (non-blocking):', error);
            });

            // Update app version in user's profile
            const version = getAppVersion();
            edgeClient.updateAppVersion(version).catch((error) => {
                console.error('[Auth] Failed to update app version (non-blocking):', error);
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

            // Auto-connect calendar for Google SSO (tokens were stored during OAuth)
            if (provider === 'google') {
                const calendarService = getCalendarService();
                calendarService.connectGoogle().then(() => {
                    console.log('[Auth] Calendar auto-connected after Google SSO');
                }).catch((error) => {
                    console.error('[Auth] Failed to auto-connect calendar (non-blocking):', error);
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

/**
 * Sign out user
 */
async function handleSignOut(): Promise<{ success: boolean }> {
    try {
        const authService = getAuthService();
        await authService.signOut();

        // Clear transcription service session
        updateTranscriptionSession(null);

        return { success: true };
    } catch (error) {
        console.error('[Auth] Sign out error:', error);
        return { success: false };
    }
}

/**
 * Open Stripe Customer Portal via Edge Function
 */
async function handleOpenCustomerPortal(): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const user = await authService.getCurrentUser();

        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Use Edge Function to create portal session (no secret key needed)
        const edgeClient = getEdgeFunctionClient();
        const session = await edgeClient.createCustomerPortalSession('timeportal://settings');

        if (session.url) {
            await shell.openExternal(session.url);
            return { success: true };
        } else {
            return { success: false, error: 'Failed to create portal session' };
        }
    } catch (error) {
        console.error('[Auth] Open customer portal error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Note: Stripe operations are now handled via Edge Functions (edgeFunctionClient.ts)
// Stripe customers are created on-demand when users initiate checkout
// Subscription status is updated via webhooks to the Supabase profiles table

/**
 * Sync app version to user profile on startup.
 * Called after auth initialization to update version for users with existing sessions.
 * This ensures version is tracked even if user doesn't log in/out.
 */
export async function syncAppVersionOnStartup(): Promise<void> {
    try {
        const authService = getAuthService();
        const isAuthenticated = await authService.isAuthenticated();

        if (!isAuthenticated) {
            console.log('[Auth] User not authenticated, skipping version sync on startup');
            return;
        }

        const edgeClient = getEdgeFunctionClient();
        const version = getAppVersion();

        console.log('[Auth] Syncing app version on startup:', version);
        await edgeClient.updateAppVersion(version);
    } catch (error) {
        console.error('[Auth] Failed to sync app version on startup (non-blocking):', error);
    }
}
