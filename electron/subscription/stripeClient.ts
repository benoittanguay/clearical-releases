/**
 * Stripe API Client
 *
 * Client for interacting with Stripe API for:
 * - Subscription management
 * - Customer creation and retrieval
 * - Checkout session creation
 * - Customer Portal session creation
 * - Subscription status verification
 */

import {
    Subscription,
    SubscriptionStatus,
    SubscriptionPlan,
    SubscriptionError,
    SubscriptionErrorCode,
    SubscriptionConfig,
    CheckoutSession,
    CustomerPortalSession,
    DeviceInfo,
    getFeaturesForPlan,
} from './types.js';

// Stripe types (we'll use minimal types to avoid requiring the full Stripe SDK)
interface StripeCustomer {
    id: string;
    email: string;
    metadata?: Record<string, string>;
}

interface StripeSubscription {
    id: string;
    customer: string;
    status: string;
    current_period_start: number;
    current_period_end: number;
    trial_end?: number | null;
    cancel_at?: number | null;
    canceled_at?: number | null;
    items: {
        data: Array<{
            price: {
                id: string;
                product: string;
            };
        }>;
    };
}

/**
 * Stripe API client for subscription management
 */
export class StripeClient {
    private secretKey: string;
    private apiVersion = '2023-10-16'; // Stripe API version
    private baseUrl = 'https://api.stripe.com/v1';

    constructor(config: SubscriptionConfig) {
        this.secretKey = config.stripeSecretKey;

        if (!this.secretKey) {
            console.warn('[StripeClient] No Stripe secret key provided - API calls will fail');
        }
    }

    /**
     * Create or retrieve Stripe customer by email
     */
    async getOrCreateCustomer(email: string, deviceInfo: DeviceInfo): Promise<StripeCustomer> {
        console.log('[StripeClient] Getting or creating customer for:', email);

        try {
            // First, search for existing customer by email
            const existingCustomers = await this.listCustomers(email);

            if (existingCustomers.length > 0) {
                console.log('[StripeClient] Found existing customer:', existingCustomers[0].id);
                return existingCustomers[0];
            }

            // Create new customer
            console.log('[StripeClient] Creating new customer');
            const customer = await this.createCustomer(email, deviceInfo);
            console.log('[StripeClient] Created customer:', customer.id);
            return customer;
        } catch (error) {
            console.error('[StripeClient] Failed to get or create customer:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                'Failed to get or create Stripe customer',
                error
            );
        }
    }

    /**
     * List customers by email
     */
    private async listCustomers(email: string): Promise<StripeCustomer[]> {
        const params = new URLSearchParams({ email, limit: '1' });
        const response = await this.makeRequest('GET', '/customers', params);
        return response.data || [];
    }

    /**
     * Create a new Stripe customer
     */
    private async createCustomer(email: string, deviceInfo: DeviceInfo): Promise<StripeCustomer> {
        const params = new URLSearchParams({
            email,
            description: `TimePortal user - ${deviceInfo.deviceName}`,
            'metadata[deviceId]': deviceInfo.deviceId,
            'metadata[platform]': deviceInfo.platform,
            'metadata[osVersion]': deviceInfo.osVersion,
        });

        return await this.makeRequest('POST', '/customers', params);
    }

    /**
     * Get customer by ID
     */
    async getCustomer(customerId: string): Promise<StripeCustomer> {
        console.log('[StripeClient] Getting customer:', customerId);

        try {
            return await this.makeRequest('GET', `/customers/${customerId}`);
        } catch (error) {
            console.error('[StripeClient] Failed to get customer:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.INVALID_CUSTOMER,
                'Failed to retrieve customer',
                error
            );
        }
    }

    /**
     * Get active subscription for a customer
     */
    async getCustomerSubscription(customerId: string): Promise<StripeSubscription | null> {
        console.log('[StripeClient] Getting subscription for customer:', customerId);

        try {
            const params = new URLSearchParams({
                customer: customerId,
                status: 'all',
                limit: '1',
            });

            const response = await this.makeRequest('GET', '/subscriptions', params);
            const subscriptions = response.data || [];

            if (subscriptions.length === 0) {
                console.log('[StripeClient] No subscription found for customer');
                return null;
            }

            // Return the first subscription (most recent)
            return subscriptions[0];
        } catch (error) {
            console.error('[StripeClient] Failed to get subscription:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                'Failed to retrieve subscription',
                error
            );
        }
    }

    /**
     * Get subscription by ID
     */
    async getSubscription(subscriptionId: string): Promise<StripeSubscription> {
        console.log('[StripeClient] Getting subscription:', subscriptionId);

        try {
            return await this.makeRequest('GET', `/subscriptions/${subscriptionId}`);
        } catch (error) {
            console.error('[StripeClient] Failed to get subscription:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                'Failed to retrieve subscription',
                error
            );
        }
    }

    /**
     * Create a Checkout Session for new subscription
     */
    async createCheckoutSession(
        email: string,
        priceId: string,
        customerId?: string,
        trialDays?: number
    ): Promise<CheckoutSession> {
        console.log('[StripeClient] Creating checkout session:', { email, priceId, trialDays });

        try {
            const params = new URLSearchParams({
                'line_items[0][price]': priceId,
                'line_items[0][quantity]': '1',
                mode: 'subscription',
                success_url: 'timeportal://subscription/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'timeportal://subscription/cancel',
                customer_email: email,
            });

            if (customerId) {
                params.set('customer', customerId);
            }

            if (trialDays && trialDays > 0) {
                params.set('subscription_data[trial_period_days]', trialDays.toString());
            }

            const session = await this.makeRequest('POST', '/checkout/sessions', params);

            return {
                sessionId: session.id,
                url: session.url,
                expiresAt: session.expires_at * 1000, // Convert to ms
            };
        } catch (error) {
            console.error('[StripeClient] Failed to create checkout session:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                'Failed to create checkout session',
                error
            );
        }
    }

    /**
     * Create a Customer Portal session for subscription management
     */
    async createCustomerPortalSession(customerId: string): Promise<CustomerPortalSession> {
        console.log('[StripeClient] Creating customer portal session for:', customerId);

        try {
            const params = new URLSearchParams({
                customer: customerId,
                return_url: 'timeportal://subscription/portal-return',
            });

            const session = await this.makeRequest('POST', '/billing_portal/sessions', params);

            return {
                url: session.url,
                expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
            };
        } catch (error) {
            console.error('[StripeClient] Failed to create portal session:', error);
            throw new SubscriptionError(
                SubscriptionErrorCode.STRIPE_API_ERROR,
                'Failed to create customer portal session',
                error
            );
        }
    }

    /**
     * Transform Stripe subscription to our Subscription model
     */
    transformStripeSubscription(
        stripeSubscription: StripeSubscription,
        customer: StripeCustomer,
        deviceId: string,
        devices: DeviceInfo[]
    ): Subscription {
        const now = Date.now();

        // Map Stripe status to our SubscriptionStatus
        const status = this.mapStripeStatus(stripeSubscription.status);

        // Determine plan from price ID
        const priceId = stripeSubscription.items.data[0]?.price.id;
        const plan = this.mapPriceToPlan(priceId);

        // Get features for this plan
        const features = getFeaturesForPlan(plan);

        const subscription: Subscription = {
            stripeCustomerId: customer.id,
            stripeSubscriptionId: stripeSubscription.id,
            stripePriceId: priceId,
            email: customer.email,
            status,
            plan,
            currentPeriodStart: stripeSubscription.current_period_start * 1000, // Convert to ms
            currentPeriodEnd: stripeSubscription.current_period_end * 1000,
            trialEndsAt: stripeSubscription.trial_end ? stripeSubscription.trial_end * 1000 : undefined,
            cancelAt: stripeSubscription.cancel_at ? stripeSubscription.cancel_at * 1000 : undefined,
            canceledAt: stripeSubscription.canceled_at ? stripeSubscription.canceled_at * 1000 : undefined,
            deviceId,
            devices,
            lastValidated: now,
            validatedOffline: false,
            features,
            version: '1.0',
            createdAt: now,
            updatedAt: now,
        };

        return subscription;
    }

    /**
     * Map Stripe subscription status to our SubscriptionStatus
     */
    private mapStripeStatus(stripeStatus: string): SubscriptionStatus {
        const statusMap: Record<string, SubscriptionStatus> = {
            'trialing': SubscriptionStatus.TRIAL,
            'active': SubscriptionStatus.ACTIVE,
            'past_due': SubscriptionStatus.PAST_DUE,
            'canceled': SubscriptionStatus.CANCELED,
            'unpaid': SubscriptionStatus.UNPAID,
            'incomplete': SubscriptionStatus.INCOMPLETE,
            'incomplete_expired': SubscriptionStatus.INCOMPLETE_EXPIRED,
            'paused': SubscriptionStatus.PAUSED,
        };

        return statusMap[stripeStatus] || SubscriptionStatus.NONE;
    }

    /**
     * Map Stripe Price ID to our SubscriptionPlan
     */
    private mapPriceToPlan(priceId: string): SubscriptionPlan {
        // Actual Stripe Price IDs from your Stripe Dashboard
        const priceMap: Record<string, SubscriptionPlan> = {
            // Workplace Plan - Monthly ($2/month)
            'price_1Snpiv2O2zPtqFKn0fGJ9Gvi': SubscriptionPlan.WORKPLACE_MONTHLY,
            // Freelancer plan maps to FREE (will be $0)
            'price_1Snpzr2O2zPtqFKnroWooOqt': SubscriptionPlan.FREE,
        };

        return priceMap[priceId] || SubscriptionPlan.FREE;
    }

    /**
     * Make authenticated request to Stripe API
     */
    private async makeRequest(
        method: 'GET' | 'POST' | 'DELETE',
        endpoint: string,
        params?: URLSearchParams
    ): Promise<any> {
        const url = method === 'GET' && params
            ? `${this.baseUrl}${endpoint}?${params.toString()}`
            : `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.secretKey}`,
            'Stripe-Version': this.apiVersion,
        };

        const options: RequestInit = {
            method,
            headers,
        };

        if (method === 'POST' && params) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.body = params.toString();
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const error: any = await response.json();
            console.error('[StripeClient] API error:', error);
            throw new Error(error?.error?.message || error?.message || 'Stripe API request failed');
        }

        return await response.json();
    }

    /**
     * Test Stripe API connection
     */
    async testConnection(): Promise<boolean> {
        try {
            // Try to retrieve account info
            await this.makeRequest('GET', '/account');
            console.log('[StripeClient] Connection test successful');
            return true;
        } catch (error) {
            console.error('[StripeClient] Connection test failed:', error);
            return false;
        }
    }
}
