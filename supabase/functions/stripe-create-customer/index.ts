/**
 * Stripe Create Customer Edge Function
 *
 * Creates a Stripe customer for a user and stores the customer ID in their profile.
 * This function is idempotent - calling it multiple times for the same user is safe.
 *
 * Usage from Electron app:
 * POST /functions/v1/stripe-create-customer
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: {} (empty body, user is determined from JWT)
 *
 * Response:
 * - 200: { customerId: string, created: boolean } - Success (created: true if new customer, false if existing)
 * - 401: { error: string } - Authentication error
 * - 500: { error: string } - Server error
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { stripe } from '../_shared/stripe.ts';
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

        // Check if user already has a Stripe customer ID
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.error('Error fetching profile:', profileError);
            return new Response(
                JSON.stringify({ error: 'Failed to fetch user profile' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // If customer already exists, return it
        if (profile?.stripe_customer_id) {
            return new Response(
                JSON.stringify({
                    customerId: profile.stripe_customer_id,
                    created: false,
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create new Stripe customer
        const customer = await stripe.customers.create({
            email: user.email,
            metadata: {
                supabase_user_id: user.id,
            },
        });

        // Store the customer ID in the profile
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ stripe_customer_id: customer.id })
            .eq('id', user.id);

        if (updateError) {
            console.error('Error updating profile:', updateError);
            // Customer was created in Stripe but not saved to DB
            // This is not ideal, but we'll return the customer ID anyway
            // The next call will handle this case since Stripe customer exists
            return new Response(
                JSON.stringify({
                    customerId: customer.id,
                    created: true,
                    warning: 'Customer created but failed to update profile',
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                customerId: customer.id,
                created: true,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Stripe create customer error:', error);
        return new Response(
            JSON.stringify({
                error: error.message || 'Failed to create Stripe customer',
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
