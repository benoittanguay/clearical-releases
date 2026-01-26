/**
 * Edge Function Client for Stripe Operations
 *
 * Securely proxies Stripe operations through Supabase Edge Functions.
 * The Stripe secret key is stored in Supabase secrets, never exposed to the client.
 *
 * This module replaces direct Stripe API calls in stripeClient.ts for production use.
 */

import { getConfig } from '../config.js';
import { getAuthService } from '../auth/supabaseAuth.js';
import { CheckoutSession, CustomerPortalSession, SubscriptionError, SubscriptionErrorCode } from './types.js';

// Response types for Edge Functions
interface CheckoutResponse {
    sessionId: string;
    url: string;
    error?: string;
}

interface PortalResponse {
    url: string;
    error?: string;
}

interface CreateCustomerResponse {
    customerId: string;
    error?: string;
}

interface ProfileRow {
    subscription_status?: string;
    subscription_tier?: string;
    subscription_period_end?: string;
    app_version?: string;
}

/**
 * Edge Function client for secure Stripe operations
 */
export class EdgeFunctionClient {
    private config = getConfig();

    /**
     * Create a Stripe Checkout session via Edge Function
     * @param priceId - 'monthly' or 'yearly'
     * @param successUrl - URL to redirect on success
     * @param cancelUrl - URL to redirect on cancel
     */
    async createCheckoutSession(
        priceId: 'monthly' | 'yearly',
        successUrl?: string,
        cancelUrl?: string
    ): Promise<CheckoutSession> {
        console.log('[EdgeFunctionClient] Creating checkout session:', priceId);

        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            throw new SubscriptionError(
                SubscriptionErrorCode.VALIDATION_FAILED,
                'User not authenticated'
            );
        }

        // Debug: Log token expiry info
        const now = Date.now();
        const expiresIn = session.expiresAt ? Math.floor((session.expiresAt - now) / 1000) : 'unknown';
        console.log('[EdgeFunctionClient] Using token expiring in', expiresIn, 'seconds');
        console.log('[EdgeFunctionClient] Token prefix:', session.accessToken?.substring(0, 20) + '...');

        const response = await fetch(this.config.api.stripeCheckout, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.accessToken}`,
            },
            body: JSON.stringify({
                priceId,
                successUrl: successUrl || 'timeportal://subscription/success',
                cancelUrl: cancelUrl || 'timeportal://subscription/cancel',
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
            console.error('[EdgeFunctionClient] Checkout session failed:', errorData);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                errorData.error || 'Failed to create checkout session'
            );
        }

        const data = await response.json() as CheckoutResponse;
        console.log('[EdgeFunctionClient] Checkout session created:', data.sessionId);

        return {
            sessionId: data.sessionId,
            url: data.url,
            expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
        };
    }

    /**
     * Create a Stripe Customer Portal session via Edge Function
     * @param returnUrl - URL to return to after portal
     */
    async createCustomerPortalSession(returnUrl?: string): Promise<CustomerPortalSession> {
        console.log('[EdgeFunctionClient] Creating customer portal session');

        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            throw new SubscriptionError(
                SubscriptionErrorCode.VALIDATION_FAILED,
                'User not authenticated'
            );
        }

        const response = await fetch(this.config.api.stripePortal, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.accessToken}`,
            },
            body: JSON.stringify({
                returnUrl: returnUrl || 'timeportal://subscription/portal-return',
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
            console.error('[EdgeFunctionClient] Portal session failed:', errorData);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                errorData.error || 'Failed to create portal session'
            );
        }

        const data = await response.json() as PortalResponse;
        console.log('[EdgeFunctionClient] Portal session created');

        return {
            url: data.url,
            expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
        };
    }

    /**
     * Ensure user has a Stripe customer created
     * Called after successful authentication to create Stripe customer if needed.
     * This is idempotent - safe to call multiple times.
     *
     * @returns true if customer exists or was created, false if failed
     */
    async ensureStripeCustomer(): Promise<boolean> {
        console.log('[EdgeFunctionClient] Ensuring Stripe customer exists...');

        try {
            const authService = getAuthService();
            const session = await authService.getSession();

            if (!session) {
                console.log('[EdgeFunctionClient] No active session, skipping customer creation');
                return false;
            }

            const response = await fetch(this.config.api.stripeCreateCustomer, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.accessToken}`,
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
                console.error('[EdgeFunctionClient] Customer creation failed:', errorData);
                // Don't throw - this shouldn't block login
                return false;
            }

            const data = await response.json() as CreateCustomerResponse;
            console.log('[EdgeFunctionClient] Stripe customer ensured:', data.customerId);

            return true;
        } catch (error) {
            console.error('[EdgeFunctionClient] Error ensuring Stripe customer:', error);
            // Don't throw - this shouldn't block login
            return false;
        }
    }

    /**
     * Get subscription status from Supabase profile (populated by webhooks)
     * This replaces direct Stripe API calls for subscription status checks.
     *
     * Returns null if:
     * - User is not authenticated
     * - Profile doesn't exist
     * - API call fails
     */
    async getSubscriptionStatus(): Promise<{
        status: string;
        tier: string;
        periodEnd?: string;
    } | null> {
        console.log('[EdgeFunctionClient] Getting subscription status from Supabase');

        try {
            const authService = getAuthService();
            const session = await authService.getSession();

            if (!session) {
                console.log('[EdgeFunctionClient] No active session, user not authenticated');
                return null;
            }

            const response = await fetch(`${this.config.supabase.url}/rest/v1/profiles?id=eq.${session.user.id}&select=subscription_status,subscription_tier,subscription_period_end`, {
                headers: {
                    'apikey': this.config.supabase.anonKey,
                    'Authorization': `Bearer ${session.accessToken}`,
                },
            });

            if (!response.ok) {
                console.error('[EdgeFunctionClient] Failed to get profile:', response.status);
                return null;
            }

            const profiles = await response.json() as ProfileRow[];
            if (!profiles || profiles.length === 0) {
                console.log('[EdgeFunctionClient] No profile found for user');
                return null;
            }

            const profile = profiles[0];
            console.log('[EdgeFunctionClient] Profile found:', {
                status: profile.subscription_status,
                tier: profile.subscription_tier,
            });

            return {
                status: profile.subscription_status || 'inactive',
                tier: profile.subscription_tier || 'free',
                periodEnd: profile.subscription_period_end,
            };
        } catch (error) {
            console.error('[EdgeFunctionClient] Error getting subscription status:', error);
            return null;
        }
    }

    /**
     * Get transcription usage for the current month
     * Used to track Groq usage for premium users (20hr limit before Apple fallback)
     *
     * @returns Usage info with monthlyUsedSeconds, or null if unavailable
     */
    async getTranscriptionUsage(): Promise<{
        monthlyUsedSeconds: number;
        monthlyLimitSeconds: number;
        remainingSeconds: number;
    } | null> {
        console.log('[EdgeFunctionClient] Getting transcription usage');

        try {
            const authService = getAuthService();
            const session = await authService.getSession();

            if (!session) {
                console.log('[EdgeFunctionClient] No active session for usage query');
                return null;
            }

            // Get start of current month (UTC)
            const now = new Date();
            const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

            // Query transcription_usage table for this month
            const response = await fetch(
                `${this.config.supabase.url}/rest/v1/transcription_usage?user_id=eq.${session.user.id}&created_at=gte.${monthStart.toISOString()}&select=duration_seconds`,
                {
                    headers: {
                        'apikey': this.config.supabase.anonKey,
                        'Authorization': `Bearer ${session.accessToken}`,
                    },
                }
            );

            if (!response.ok) {
                console.error('[EdgeFunctionClient] Failed to get transcription usage:', response.status);
                return null;
            }

            const usageRecords = await response.json() as Array<{ duration_seconds: number }>;
            const monthlyUsedSeconds = usageRecords.reduce((sum, record) => sum + (record.duration_seconds || 0), 0);

            // Get subscription status to determine limit
            const subscriptionStatus = await this.getSubscriptionStatus();
            const isPremium = subscriptionStatus?.status === 'active' || subscriptionStatus?.status === 'trialing';

            // Limits: Free = 8hrs, Premium = 20hrs (for Groq)
            const monthlyLimitSeconds = isPremium ? 20 * 60 * 60 : 8 * 60 * 60;
            const remainingSeconds = Math.max(0, monthlyLimitSeconds - monthlyUsedSeconds);

            console.log('[EdgeFunctionClient] Transcription usage:', {
                usedHours: Math.round(monthlyUsedSeconds / 3600 * 10) / 10,
                limitHours: monthlyLimitSeconds / 3600,
                remainingHours: Math.round(remainingSeconds / 3600 * 10) / 10,
            });

            return {
                monthlyUsedSeconds,
                monthlyLimitSeconds,
                remainingSeconds,
            };
        } catch (error) {
            console.error('[EdgeFunctionClient] Error getting transcription usage:', error);
            return null;
        }
    }

    /**
     * Update the user's app version in their Supabase profile.
     * Called on login/app start to track which version each user is running.
     *
     * @param version - The app version string (e.g., "1.6.2")
     * @returns true if update succeeded, false otherwise
     */
    async updateAppVersion(version: string): Promise<boolean> {
        console.log('[EdgeFunctionClient] Updating app version in profile:', version);

        try {
            const authService = getAuthService();
            const session = await authService.getSession();

            if (!session) {
                console.log('[EdgeFunctionClient] No active session, skipping app version update');
                return false;
            }

            const response = await fetch(`${this.config.supabase.url}/rest/v1/profiles?id=eq.${session.user.id}`, {
                method: 'PATCH',
                headers: {
                    'apikey': this.config.supabase.anonKey,
                    'Authorization': `Bearer ${session.accessToken}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                    app_version: version,
                }),
            });

            if (!response.ok) {
                console.error('[EdgeFunctionClient] Failed to update app version:', response.status);
                return false;
            }

            console.log('[EdgeFunctionClient] App version updated successfully');
            return true;
        } catch (error) {
            console.error('[EdgeFunctionClient] Error updating app version:', error);
            return false;
        }
    }
}

// Singleton instance
let edgeFunctionClientInstance: EdgeFunctionClient | null = null;

export function getEdgeFunctionClient(): EdgeFunctionClient {
    if (!edgeFunctionClientInstance) {
        edgeFunctionClientInstance = new EdgeFunctionClient();
    }
    return edgeFunctionClientInstance;
}
