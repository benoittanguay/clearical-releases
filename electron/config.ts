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
 *
 * ENVIRONMENT SWITCHING:
 * - Development: Uses Clearical Dev environment (wyikhlelmuvcxozwktzr.supabase.co)
 * - Production: Uses Clearical App environment (jiuxhwrgmexhhpoaazbj.supabase.co)
 * - Environment is determined by app.isPackaged or BUILD_ENV environment variable
 */

import { app } from 'electron';

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
        stripeCreateCustomer: string;
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
 * Development Configuration (Clearical Dev)
 * Used when running in development mode or when BUILD_ENV=development
 */
const developmentConfig: AppConfig = {
    supabase: {
        url: 'https://wyikhlelmuvcxozwktzr.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5aWtobGVsbXV2Y3hvendrdHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNTY0NDksImV4cCI6MjA4MzYzMjQ0OX0.f_E7FudrxoXsq40QGqnujt3IZHai116TrzHlcFh-rQI',
    },

    stripe: {
        // Stripe test publishable key for development
        publishableKey: 'pk_test_51Rpg8S2O2zPtqFKnntZfwgWA0rRp1dircceQFDIiiz6X5o16cHrvyLzTEDvqTRFlq1EcxIeMphwYLjjgJHY8aQGB00AFJQOmQM',
    },

    api: {
        // Development Supabase Edge Functions
        stripeCheckout: 'https://wyikhlelmuvcxozwktzr.supabase.co/functions/v1/stripe-checkout',
        stripePortal: 'https://wyikhlelmuvcxozwktzr.supabase.co/functions/v1/stripe-portal',
        stripeWebhook: 'https://wyikhlelmuvcxozwktzr.supabase.co/functions/v1/stripe-webhook',
        stripeCreateCustomer: 'https://wyikhlelmuvcxozwktzr.supabase.co/functions/v1/stripe-create-customer',
    },

    app: {
        name: 'Clearical',
        version: '0.1.0',
        website: 'https://clearical.io',
        support: 'https://clearical.io/support',
    },
};

/**
 * Production Configuration (Clearical App)
 * Used when app is packaged or when BUILD_ENV=production
 */
const productionConfig: AppConfig = {
    supabase: {
        url: 'https://jiuxhwrgmexhhpoaazbj.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppdXhod3JnbWV4aGhwb2FhemJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1MTE0MzAsImV4cCI6MjA2NTA4NzQzMH0.SI3jPMLxjHsNFAGQ8gHiGY2fgcRu9cgXZgl527IMfEU',
    },

    stripe: {
        // Stripe live publishable key for production
        publishableKey: 'pk_live_51Rpg8S2O2zPtqFKnX2v6X4DnFkXOVuflVQV3VzndswExtMIjXTc7yOYyo04GVo2pBQxr3eAWSn2Uukm9PBm5DRYl0087tuBY6o',
    },

    api: {
        // Production Supabase Edge Functions
        stripeCheckout: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-checkout',
        stripePortal: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-portal',
        stripeWebhook: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-webhook',
        stripeCreateCustomer: 'https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-create-customer',
    },

    app: {
        name: 'Clearical',
        version: '0.1.0',
        website: 'https://clearical.io',
        support: 'https://clearical.io/support',
    },
};

/**
 * Determine if the app is running in production mode
 *
 * Environment detection priority:
 * 1. BUILD_ENV environment variable (for CI/CD and explicit control)
 * 2. app.isPackaged (true when running from packaged app, false in development)
 *
 * @returns true if running in production mode, false for development
 */
function isProduction(): boolean {
    // Allow BUILD_ENV to explicitly override environment
    if (process.env.BUILD_ENV) {
        return process.env.BUILD_ENV === 'production';
    }

    // Default to checking if the app is packaged
    try {
        return app.isPackaged;
    } catch (error) {
        // If electron is not available (e.g., in tests), default to development
        console.warn('Electron app not available, defaulting to development config');
        return false;
    }
}

/**
 * Get the appropriate configuration based on the current environment
 *
 * Returns development config when:
 * - Running in development mode (npm run dev)
 * - BUILD_ENV=development is set
 * - app.isPackaged is false
 *
 * Returns production config when:
 * - Running from packaged app
 * - BUILD_ENV=production is set
 *
 * @returns AppConfig object with environment-specific values
 */
export function getConfig(): AppConfig {
    const config = isProduction() ? productionConfig : developmentConfig;

    // Log the active environment for debugging (only in development)
    if (!isProduction()) {
        console.log('[Config] Using DEVELOPMENT configuration (Clearical Dev)');
    }

    return config;
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getConfig() instead to ensure correct environment configuration
 */
export const config = getConfig();
