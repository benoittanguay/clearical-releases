/**
 * Auth IPC Handlers
 *
 * Electron IPC handlers for authentication operations.
 */

import { ipcMain, shell } from 'electron';
import { getAuthService, AuthUser, AuthSession, OAuthProvider } from './supabaseAuth.js';
import { getConfig } from '../config.js';
import { getEdgeFunctionClient } from '../subscription/edgeFunctionClient.js';
import { getSubscriptionValidator } from '../subscription/ipcHandlers.js';

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

    console.log('[Auth] Auth system initialized');
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
        if (result.success && result.user) {
            console.log('[Auth] OTP verified, ensuring Stripe customer and refreshing subscription...');
            const edgeClient = getEdgeFunctionClient();

            // Call customer creation asynchronously - don't block login if it fails
            edgeClient.ensureStripeCustomer().catch((error) => {
                console.error('[Auth] Failed to ensure Stripe customer (non-blocking):', error);
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

/**
 * Sign out user
 */
async function handleSignOut(): Promise<{ success: boolean }> {
    try {
        const authService = getAuthService();
        await authService.signOut();
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
