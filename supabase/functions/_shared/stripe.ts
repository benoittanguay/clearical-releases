/**
 * Stripe client initialization for Edge Functions
 *
 * IMPORTANT: The STRIPE_SECRET_KEY must be set in Supabase Edge Function secrets:
 * supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
 */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

if (!stripeSecretKey) {
    console.error('STRIPE_SECRET_KEY not found in environment');
}

export const stripe = new Stripe(stripeSecretKey || '', {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
});

// Stripe Price IDs - update these with your actual Stripe price IDs
export const PRICE_IDS = {
    MONTHLY: Deno.env.get('STRIPE_PRICE_MONTHLY') || 'price_xxx_monthly',
    YEARLY: Deno.env.get('STRIPE_PRICE_YEARLY') || 'price_xxx_yearly',
};
