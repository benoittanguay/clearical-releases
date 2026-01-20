/**
 * Supabase Authentication Service
 *
 * Handles user authentication using Supabase OTP (one-time password) flow.
 * Manages session persistence and syncs users with Stripe customers.
 */

import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { app, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createOAuthCallbackServer, OAuthProvider } from './oauthServer.js';

export interface AuthUser {
    id: string;
    email: string;
    stripeCustomerId?: string;
    createdAt: string;
    lastSignIn?: string;
}

export interface AuthSession {
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

export interface AuthResult {
    success: boolean;
    error?: string;
    user?: AuthUser;
    session?: AuthSession;
    needsOtp?: boolean;
}

export type { OAuthProvider } from './oauthServer.js';

/**
 * Supabase Auth Service for Electron
 */
export class SupabaseAuthService {
    private supabase: SupabaseClient | null = null;
    private currentSession: AuthSession | null = null;
    private sessionFilePath: string;
    private encryptionKey: Buffer;

    constructor() {
        // Session file stored in app data directory
        const userDataPath = app.getPath('userData');
        this.sessionFilePath = path.join(userDataPath, '.auth-session');

        // Generate or load encryption key for session storage
        this.encryptionKey = this.getOrCreateEncryptionKey();
    }

    /**
     * Initialize Supabase client with credentials
     */
    initialize(supabaseUrl: string, supabaseAnonKey: string): void {
        if (!supabaseUrl || !supabaseAnonKey) {
            console.error('[SupabaseAuth] Missing Supabase credentials');
            return;
        }

        this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                autoRefreshToken: true,
                persistSession: false, // We handle persistence ourselves
                detectSessionInUrl: false,
                flowType: 'pkce', // Use PKCE flow for OAuth (returns code instead of tokens)
            },
        });

        console.log('[SupabaseAuth] Supabase client initialized');
    }

    /**
     * Check if user is authenticated (has valid session)
     */
    async isAuthenticated(): Promise<boolean> {
        const session = await this.getSession();
        if (!session) return false;

        // Check if session is expired
        if (Date.now() >= session.expiresAt) {
            // Try to refresh
            const refreshed = await this.refreshSession();
            return refreshed;
        }

        return true;
    }

    /**
     * Get current session from storage
     * Automatically refreshes the token if expired
     */
    async getSession(): Promise<AuthSession | null> {
        // Load from file if not in memory
        if (!this.currentSession) {
            try {
                if (fs.existsSync(this.sessionFilePath)) {
                    const encryptedData = fs.readFileSync(this.sessionFilePath);
                    const decrypted = this.decrypt(encryptedData);
                    this.currentSession = JSON.parse(decrypted);
                }
            } catch (error) {
                console.error('[SupabaseAuth] Failed to load session:', error);
                this.clearSession();
                return null;
            }
        }

        if (!this.currentSession) {
            return null;
        }

        // Check if session is expired or about to expire (within 5 minutes)
        const expiryBuffer = 5 * 60 * 1000; // 5 minutes
        if (Date.now() >= this.currentSession.expiresAt - expiryBuffer) {
            console.log('[SupabaseAuth] Token expired or expiring soon, refreshing...');
            const refreshed = await this.refreshSession();
            if (!refreshed) {
                console.error('[SupabaseAuth] Failed to refresh expired token');
                return null;
            }
        }

        return this.currentSession;
    }

    /**
     * Get current user
     */
    async getCurrentUser(): Promise<AuthUser | null> {
        const session = await this.getSession();
        return session?.user || null;
    }

    /**
     * Send OTP to email for login/signup
     */
    async sendOtp(email: string): Promise<AuthResult> {
        if (!this.supabase) {
            return { success: false, error: 'Auth service not initialized' };
        }

        try {
            console.log('[SupabaseAuth] Sending OTP to:', email);

            const { error } = await this.supabase.auth.signInWithOtp({
                email,
                options: {
                    shouldCreateUser: true, // Create user if doesn't exist
                },
            });

            if (error) {
                console.error('[SupabaseAuth] OTP send failed:', error);
                return { success: false, error: error.message };
            }

            console.log('[SupabaseAuth] OTP sent successfully');
            return { success: true, needsOtp: true };
        } catch (error) {
            console.error('[SupabaseAuth] OTP send error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to send OTP'
            };
        }
    }

    /**
     * Verify OTP code
     */
    async verifyOtp(email: string, token: string): Promise<AuthResult> {
        if (!this.supabase) {
            return { success: false, error: 'Auth service not initialized' };
        }

        try {
            console.log('[SupabaseAuth] Verifying OTP for:', email);

            const { data, error } = await this.supabase.auth.verifyOtp({
                email,
                token,
                type: 'email',
            });

            if (error) {
                console.error('[SupabaseAuth] OTP verification failed:', error);
                return { success: false, error: error.message };
            }

            if (!data.user || !data.session) {
                return { success: false, error: 'No user or session returned' };
            }

            // Create our auth session
            const authUser: AuthUser = {
                id: data.user.id,
                email: data.user.email || email,
                createdAt: data.user.created_at,
                lastSignIn: new Date().toISOString(),
            };

            const authSession: AuthSession = {
                user: authUser,
                accessToken: data.session.access_token,
                refreshToken: data.session.refresh_token,
                expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : Date.now() + 3600000,
            };

            // Save session
            await this.saveSession(authSession);

            console.log('[SupabaseAuth] OTP verified successfully, user:', authUser.email);
            return { success: true, user: authUser, session: authSession };
        } catch (error) {
            console.error('[SupabaseAuth] OTP verification error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to verify OTP'
            };
        }
    }

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

            // Provider-specific scopes to ensure email is returned
            const scopesByProvider: Record<string, string> = {
                azure: 'openid profile email',
                google: 'openid profile email',
                apple: 'name email',
            };

            // Generate OAuth URL with PKCE
            const { data, error } = await this.supabase.auth.signInWithOAuth({
                provider: supabaseProvider,
                options: {
                    redirectTo: 'http://localhost:3848/auth/callback',
                    skipBrowserRedirect: true,
                    scopes: scopesByProvider[supabaseProvider],
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

            // Check if email exists after OAuth callback
            if (!sessionData.user.email) {
                console.warn('[SupabaseAuth] OAuth sign-in: no email from provider');
                return { success: false, error: 'Email required for sign-in' };
            }

            // Validate refresh token exists (required for session refresh)
            if (!sessionData.session.refresh_token) {
                console.error('[SupabaseAuth] OAuth sign-in: no refresh token from Supabase');
                console.error('[SupabaseAuth] Session data:', {
                    hasAccessToken: !!sessionData.session.access_token,
                    hasRefreshToken: !!sessionData.session.refresh_token,
                    expiresAt: sessionData.session.expires_at,
                    provider
                });
                // Continue anyway but warn - user will need to re-auth when token expires
            }

            // Create our auth session
            const authUser: AuthUser = {
                id: sessionData.user.id,
                email: sessionData.user.email,  // Now guaranteed non-empty
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

            // Log session creation for debugging
            console.log('[SupabaseAuth] OAuth session created:', {
                user: authUser.email,
                hasRefreshToken: !!authSession.refreshToken,
                expiresAt: new Date(authSession.expiresAt).toISOString()
            });

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

    /**
     * Refresh session using refresh token
     */
    async refreshSession(): Promise<boolean> {
        if (!this.supabase) {
            console.error('[SupabaseAuth] Cannot refresh: Supabase client not initialized');
            return false;
        }

        if (!this.currentSession?.refreshToken) {
            console.error('[SupabaseAuth] Cannot refresh: No refresh token in session');
            console.error('[SupabaseAuth] Session state:', {
                hasSession: !!this.currentSession,
                hasRefreshToken: !!this.currentSession?.refreshToken,
                expiresAt: this.currentSession?.expiresAt,
                user: this.currentSession?.user?.email
            });
            return false;
        }

        try {
            console.log('[SupabaseAuth] Refreshing session...');

            const { data, error } = await this.supabase.auth.refreshSession({
                refresh_token: this.currentSession.refreshToken,
            });

            if (error || !data.session) {
                console.error('[SupabaseAuth] Session refresh failed:', {
                    errorMessage: error?.message,
                    errorCode: error?.code,
                    errorStatus: error?.status,
                    hasData: !!data,
                    hasSession: !!data?.session
                });
                this.clearSession();
                return false;
            }

            // Update session
            this.currentSession.accessToken = data.session.access_token;
            this.currentSession.refreshToken = data.session.refresh_token;
            this.currentSession.expiresAt = data.session.expires_at
                ? data.session.expires_at * 1000
                : Date.now() + 3600000;

            await this.saveSession(this.currentSession);
            console.log('[SupabaseAuth] Session refreshed successfully');
            return true;
        } catch (error) {
            console.error('[SupabaseAuth] Session refresh error:', error);
            this.clearSession();
            return false;
        }
    }

    /**
     * Sign out and clear session
     */
    async signOut(): Promise<void> {
        if (this.supabase) {
            await this.supabase.auth.signOut();
        }
        this.clearSession();
        console.log('[SupabaseAuth] User signed out');
    }

    /**
     * Save session to encrypted file
     */
    private async saveSession(session: AuthSession): Promise<void> {
        try {
            this.currentSession = session;
            const encrypted = this.encrypt(JSON.stringify(session));
            fs.writeFileSync(this.sessionFilePath, encrypted);
            console.log('[SupabaseAuth] Session saved');
        } catch (error) {
            console.error('[SupabaseAuth] Failed to save session:', error);
        }
    }

    /**
     * Clear session from memory and storage
     */
    private clearSession(): void {
        this.currentSession = null;
        try {
            if (fs.existsSync(this.sessionFilePath)) {
                fs.unlinkSync(this.sessionFilePath);
            }
        } catch (error) {
            console.error('[SupabaseAuth] Failed to clear session file:', error);
        }
    }

    /**
     * Get or create encryption key for session storage
     */
    private getOrCreateEncryptionKey(): Buffer {
        const keyPath = path.join(app.getPath('userData'), '.auth-key');

        try {
            if (fs.existsSync(keyPath)) {
                return fs.readFileSync(keyPath);
            }
        } catch (error) {
            // Key doesn't exist or is corrupted, create new one
        }

        // Generate new key
        const key = crypto.randomBytes(32);
        try {
            fs.writeFileSync(keyPath, key, { mode: 0o600 });
        } catch (error) {
            console.error('[SupabaseAuth] Failed to save encryption key:', error);
        }
        return key;
    }

    /**
     * Encrypt data using AES-256-GCM
     */
    private encrypt(data: string): Buffer {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

        const encrypted = Buffer.concat([
            cipher.update(data, 'utf8'),
            cipher.final(),
        ]);

        const authTag = cipher.getAuthTag();

        // Format: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Data
        return Buffer.concat([iv, authTag, encrypted]);
    }

    /**
     * Decrypt data using AES-256-GCM
     */
    private decrypt(data: Buffer): string {
        const iv = data.subarray(0, 16);
        const authTag = data.subarray(16, 32);
        const encrypted = data.subarray(32);

        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
        decipher.setAuthTag(authTag);

        return decipher.update(encrypted) + decipher.final('utf8');
    }

    /**
     * Update user's Stripe customer ID
     */
    async updateStripeCustomerId(stripeCustomerId: string): Promise<void> {
        if (this.currentSession) {
            this.currentSession.user.stripeCustomerId = stripeCustomerId;
            await this.saveSession(this.currentSession);
        }
    }

    /**
     * Get the Supabase client for direct database operations
     */
    getSupabaseClient(): SupabaseClient | null {
        return this.supabase;
    }
}

// Singleton instance
let authServiceInstance: SupabaseAuthService | null = null;

export function getAuthService(): SupabaseAuthService {
    if (!authServiceInstance) {
        authServiceInstance = new SupabaseAuthService();
    }
    return authServiceInstance;
}
