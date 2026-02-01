/**
 * Stripe client initialization for Edge Functions
 *
 * IMPORTANT: The STRIPE_SECRET_KEY must be set in Supabase Edge Function secrets:
 * supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
 *
 * Optional: Set STRIPE_PRODUCT_ID to specify which product to fetch prices for.
 * If not set, it will use the first active product with active prices.
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

// Product ID for the subscription (optional - if not set, uses first active product)
export const STRIPE_PRODUCT_ID = Deno.env.get('STRIPE_PRODUCT_ID');

// Cache for price IDs to avoid fetching on every request
let priceCache: { monthly?: string; yearly?: string; fetchedAt?: number } = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch active prices from Stripe dynamically
 * This allows price management directly in the Stripe dashboard
 */
export async function getActivePrices(): Promise<{ monthly?: string; yearly?: string }> {
    const now = Date.now();

    // Return cached prices if still valid
    if (priceCache.fetchedAt && (now - priceCache.fetchedAt) < CACHE_TTL) {
        return { monthly: priceCache.monthly, yearly: priceCache.yearly };
    }

    try {
        // Fetch active prices, optionally filtered by product
        const params: Stripe.PriceListParams = {
            active: true,
            type: 'recurring',
            limit: 10,
        };

        if (STRIPE_PRODUCT_ID) {
            params.product = STRIPE_PRODUCT_ID;
        }

        const prices = await stripe.prices.list(params);

        let monthly: string | undefined;
        let yearly: string | undefined;

        for (const price of prices.data) {
            if (price.recurring?.interval === 'month' && price.recurring?.interval_count === 1) {
                monthly = price.id;
            } else if (price.recurring?.interval === 'year' && price.recurring?.interval_count === 1) {
                yearly = price.id;
            }
        }

        // Update cache
        priceCache = { monthly, yearly, fetchedAt: now };

        console.log('[Stripe] Fetched prices:', { monthly, yearly });
        return { monthly, yearly };
    } catch (error) {
        console.error('[Stripe] Failed to fetch prices:', error);
        // Return cached values if available, even if expired
        return { monthly: priceCache.monthly, yearly: priceCache.yearly };
    }
}
