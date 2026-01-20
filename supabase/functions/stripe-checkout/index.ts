/**
 * Stripe Checkout Edge Function
 *
 * Creates a Stripe Checkout session for subscription purchases.
 * The Stripe secret key is stored securely in Supabase secrets,
 * never exposed to the client app.
 *
 * Usage from Electron app:
 * POST /functions/v1/stripe-checkout
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: { priceId: 'monthly' | 'yearly', successUrl: string, cancelUrl: string }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { stripe, PRICE_IDS } from '../_shared/stripe.ts';
import { createSupabaseClient, supabaseAdmin, extractToken } from '../_shared/supabase.ts';

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Get the authorization header
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create Supabase client and extract token for validation
        const supabase = createSupabaseClient(authHeader);
        const token = extractToken(authHeader);

        // Get the authenticated user by passing the token directly
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const { priceId, successUrl, cancelUrl } = await req.json();

        // Determine the Stripe price ID
        const stripePriceId = priceId === 'yearly' ? PRICE_IDS.YEARLY : PRICE_IDS.MONTHLY;

        // Check if user already has a Stripe customer ID
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        let customerId = profile?.stripe_customer_id;

        // Create Stripe customer if doesn't exist
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    supabase_user_id: user.id,
                },
            });
            customerId = customer.id;

            // Store the customer ID in the profile
            await supabaseAdmin
                .from('profiles')
                .update({ stripe_customer_id: customerId })
                .eq('id', user.id);
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: stripePriceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: successUrl || 'https://clearical.io/success',
            cancel_url: cancelUrl || 'https://clearical.io/pricing',
            metadata: {
                supabase_user_id: user.id,
            },
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    supabase_user_id: user.id,
                },
            },
        });

        return new Response(
            JSON.stringify({ sessionId: session.id, url: session.url }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Stripe checkout error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
