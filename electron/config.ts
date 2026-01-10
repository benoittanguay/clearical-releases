/**
 * Application Configuration
 *
 * Contains configuration values that are safe to bundle with the app.
 *
 * IMPORTANT: Only put PUBLIC values here. Never put secret keys!
 * - Supabase anon key is designed to be public (security via RLS)
 * - API endpoints are public
 * - Stripe publishable key is public
 *
 * Secret keys (Stripe secret, etc.) should be in backend only.
 */

export interface AppConfig {
    // Supabase (Auth & Database)
    supabase: {
        url: string;
        anonKey: string;
    };

    // Stripe (Public key only - for client-side checkout)
    stripe: {
        publishableKey: string;
    };

    // API Endpoints
    api: {
        // Supabase Edge Functions endpoint for Stripe operations
        stripeCheckout: string;
        stripePortal: string;
        stripeWebhook: string;
    };

    // App Info
    app: {
        name: string;
        version: string;
        website: string;
        support: string;
    };
}

/**
 * Production configuration
 * These values are bundled into the app
 */
export const config: AppConfig = {
    supabase: {
        url: 'https://jiuxhwrgmexhhpoaazbj.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppdXhod3JnbWV4aGhwb2FhemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1MTE0MzAsImV4cCI6MjA2NTA4NzQzMH0.SI3jPMLxjHsNFAGQ8gHiGY2fgcRu9cgXZgl527IMfEU',
    },

    stripe: {
        // Publishable key is safe to include - it's meant to be public
        publishableKey: 'pk_test_51Rpg8S2O2zPtqFKnntZfwgWA0rRp1dircceQFDIiiz6X5o16cHrvyLzTEDvqTRFlq1EcxIeMphwYLjjgJHY8aQGB00AFJQOmQM',
    },

    api: {
        // Supabase Edge Functions for Stripe (server-side operations)
        stripeCheckout: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-checkout',
        stripePortal: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-portal',
        stripeWebhook: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-webhook',
    },

    app: {
        name: 'TimePortal',
        version: '0.1.0',
        website: 'https://clearical.io',
        support: 'https://clearical.io/support',
    },
};

/**
 * Get configuration value with optional override from environment
 * In development, environment variables can override bundled config
 */
export function getConfig(): AppConfig {
    // In development, allow environment overrides
    if (process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged) {
        return {
            supabase: {
                url: process.env.SUPABASE_URL || config.supabase.url,
                anonKey: process.env.SUPABASE_ANON_KEY || config.supabase.anonKey,
            },
            stripe: {
                publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || config.stripe.publishableKey,
            },
            api: {
                stripeCheckout: process.env.STRIPE_CHECKOUT_URL || config.api.stripeCheckout,
                stripePortal: process.env.STRIPE_PORTAL_URL || config.api.stripePortal,
                stripeWebhook: process.env.STRIPE_WEBHOOK_URL || config.api.stripeWebhook,
            },
            app: config.app,
        };
    }

    // In production, use bundled config
    return config;
}
