/**
 * Stripe Webhook Edge Function
 *
 * Handles Stripe webhook events for subscription management.
 * Updates user subscription status in Supabase when:
 * - Subscription is created
 * - Subscription is updated (plan change, renewal)
 * - Subscription is cancelled
 * - Payment fails
 *
 * Setup:
 * 1. Create a webhook in Stripe Dashboard pointing to this function
 * 2. Set STRIPE_WEBHOOK_SECRET in Supabase secrets
 * 3. Subscribe to: checkout.session.completed, customer.subscription.updated,
 *    customer.subscription.deleted, invoice.payment_failed
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Get the raw body for signature verification
        const body = await req.text();
        const signature = req.headers.get('stripe-signature');

        if (!signature) {
            return new Response(
                JSON.stringify({ error: 'Missing stripe-signature header' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Verify webhook signature
        let event;
        try {
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return new Response(
                JSON.stringify({ error: 'Invalid signature' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.metadata?.supabase_user_id;
                const subscriptionId = session.subscription;

                if (userId && subscriptionId) {
                    // Get subscription details
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);

                    // Update user profile with subscription info
                    await supabaseAdmin
                        .from('profiles')
                        .update({
                            subscription_status: 'active',
                            subscription_tier: 'premium',
                            stripe_subscription_id: subscriptionId,
                            subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        })
                        .eq('id', userId);

                    console.log(`Subscription activated for user ${userId}`);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                if (userId) {
                    // Determine subscription status
                    let subscriptionStatus = 'active';
                    let subscriptionTier = 'premium';

                    if (subscription.cancel_at_period_end) {
                        subscriptionStatus = 'canceling';
                    } else if (subscription.status === 'past_due') {
                        subscriptionStatus = 'past_due';
                    } else if (subscription.status === 'unpaid') {
                        subscriptionStatus = 'unpaid';
                        subscriptionTier = 'free';
                    }

                    await supabaseAdmin
                        .from('profiles')
                        .update({
                            subscription_status: subscriptionStatus,
                            subscription_tier: subscriptionTier,
                            subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        })
                        .eq('id', userId);

                    console.log(`Subscription updated for user ${userId}: ${subscriptionStatus}`);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                if (userId) {
                    await supabaseAdmin
                        .from('profiles')
                        .update({
                            subscription_status: 'cancelled',
                            subscription_tier: 'free',
                            stripe_subscription_id: null,
                        })
                        .eq('id', userId);

                    console.log(`Subscription cancelled for user ${userId}`);
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;

                if (subscriptionId) {
                    // Get subscription to find user
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
                    const userId = subscription.metadata?.supabase_user_id;

                    if (userId) {
                        await supabaseAdmin
                            .from('profiles')
                            .update({
                                subscription_status: 'payment_failed',
                            })
                            .eq('id', userId);

                        console.log(`Payment failed for user ${userId}`);
                    }
                }
                break;
            }

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return new Response(
            JSON.stringify({ received: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('Webhook error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
