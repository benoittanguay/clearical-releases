/**
 * Delete Account Edge Function
 *
 * Permanently deletes a user's account and all associated data.
 * - Cancels Stripe subscription if active
 * - Deletes user data from database
 * - Deletes the auth user
 *
 * Usage from Electron app:
 * POST /functions/v1/delete-account
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: {} (empty body, user is determined from JWT)
 *
 * Response:
 * - 200: { success: true } - Account deleted
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

        // Get the authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[delete-account] Starting account deletion for user ${user.id}`);

        // 1. Fetch user's profile to get Stripe customer ID
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('stripe_customer_id, subscription_status')
            .eq('id', user.id)
            .single();

        // 2. Cancel Stripe subscription if active
        if (profile?.stripe_customer_id) {
            try {
                const subscriptions = await stripe.subscriptions.list({
                    customer: profile.stripe_customer_id,
                    status: 'active',
                });

                for (const sub of subscriptions.data) {
                    console.log(`[delete-account] Canceling subscription ${sub.id}`);
                    await stripe.subscriptions.cancel(sub.id);
                }

                // Also cancel any trialing subscriptions
                const trialingSubs = await stripe.subscriptions.list({
                    customer: profile.stripe_customer_id,
                    status: 'trialing',
                });

                for (const sub of trialingSubs.data) {
                    console.log(`[delete-account] Canceling trialing subscription ${sub.id}`);
                    await stripe.subscriptions.cancel(sub.id);
                }
            } catch (stripeError) {
                console.error('[delete-account] Stripe cancellation error (continuing):', stripeError.message);
                // Continue with deletion even if Stripe cancellation fails
            }
        }

        // 3. Delete user data from database tables
        // The profiles table likely has a cascade delete on auth.users, but be explicit
        const { error: deleteProfileError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', user.id);

        if (deleteProfileError) {
            console.error('[delete-account] Failed to delete profile:', deleteProfileError);
            // Continue - auth user deletion may cascade
        }

        // 4. Delete the auth user using admin API
        const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

        if (deleteUserError) {
            console.error('[delete-account] Failed to delete auth user:', deleteUserError);
            return new Response(
                JSON.stringify({ error: 'Failed to delete account' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[delete-account] Successfully deleted user ${user.id}`);

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[delete-account] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Failed to delete account' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
