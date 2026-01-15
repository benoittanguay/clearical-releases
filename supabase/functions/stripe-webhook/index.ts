/**
 * Stripe Webhook Edge Function
 *
 * Handles Stripe webhook events for subscription management.
 * Updates user subscription status in Supabase when:
 * - Subscription is created (including trials)
 * - Subscription is updated (plan change, renewal, trial→paid)
 * - Subscription is cancelled
 * - Payment fails
 * - Trial is about to end
 *
 * Setup:
 * 1. Create a webhook in Stripe Dashboard pointing to this function
 * 2. Set STRIPE_WEBHOOK_SECRET in Supabase secrets
 * 3. Subscribe to: checkout.session.completed, customer.subscription.created,
 *    customer.subscription.updated, customer.subscription.deleted,
 *    customer.subscription.trial_will_end, invoice.payment_failed,
 *    invoice.payment_succeeded
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabase.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

/**
 * Log webhook event for debugging and idempotency checking
 */
async function logWebhookEvent(
    eventId: string,
    eventType: string,
    userId: string | null,
    data: any,
    error?: string
): Promise<boolean> {
    try {
        // Check if event was already processed (idempotency)
        const { data: existing } = await supabaseAdmin
            .from('webhook_events')
            .select('id')
            .eq('event_id', eventId)
            .single();

        if (existing) {
            console.log(`[Webhook] Event ${eventId} already processed, skipping`);
            return false; // Already processed
        }

        // Log the event
        await supabaseAdmin
            .from('webhook_events')
            .insert({
                event_id: eventId,
                event_type: eventType,
                user_id: userId,
                data: data,
                error: error,
            });

        return true; // New event, should process
    } catch (err) {
        // If table doesn't exist yet, continue processing
        console.warn('[Webhook] Could not log event (table may not exist):', err.message);
        return true;
    }
}

/**
 * Update user profile with error handling
 * Returns true on success, throws on failure
 */
async function updateUserProfile(
    userId: string,
    updates: Record<string, any>,
    eventType: string
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', userId);

    if (error) {
        console.error(`[Webhook] Failed to update profile for ${eventType}:`, error);
        throw new Error(`Database update failed: ${error.message}`);
    }

    console.log(`[Webhook] Profile updated for user ${userId}:`, Object.keys(updates));
}

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

        console.log(`[Webhook] Received event: ${event.type} (${event.id})`);

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const userId = session.metadata?.supabase_user_id;
                const subscriptionId = session.subscription;

                // Check idempotency
                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    userId,
                    { session_id: session.id, subscription_id: subscriptionId }
                );
                if (!shouldProcess) break;

                if (userId && subscriptionId) {
                    // Get subscription details
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);

                    // Determine if this is a trial or paid subscription
                    const isTrialing = subscription.status === 'trialing';
                    const subscriptionStatus = isTrialing ? 'trialing' : 'active';

                    // Update user profile with subscription info
                    await updateUserProfile(userId, {
                        subscription_status: subscriptionStatus,
                        subscription_tier: 'premium',
                        stripe_subscription_id: subscriptionId,
                        subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        // Mark trial as used and record start time
                        trial_used: true,
                        trial_started_at: isTrialing ? new Date().toISOString() : null,
                        subscription_created_at: new Date().toISOString(),
                    }, event.type);

                    console.log(`[Webhook] Subscription ${isTrialing ? 'trial ' : ''}activated for user ${userId}`);
                }
                break;
            }

            case 'customer.subscription.created': {
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    userId,
                    { subscription_id: subscription.id, status: subscription.status }
                );
                if (!shouldProcess) break;

                if (userId) {
                    const isTrialing = subscription.status === 'trialing';
                    const subscriptionStatus = isTrialing ? 'trialing' : 'active';

                    await updateUserProfile(userId, {
                        subscription_status: subscriptionStatus,
                        subscription_tier: 'premium',
                        stripe_subscription_id: subscription.id,
                        subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        trial_used: true,
                        trial_started_at: isTrialing ? new Date().toISOString() : null,
                    }, event.type);

                    console.log(`[Webhook] Subscription created for user ${userId}: ${subscriptionStatus}`);
                }
                break;
            }

            case 'customer.subscription.updated': {
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    userId,
                    { subscription_id: subscription.id, status: subscription.status }
                );
                if (!shouldProcess) break;

                if (userId) {
                    // Determine subscription status based on Stripe status
                    let subscriptionStatus = 'active';
                    let subscriptionTier = 'premium';

                    // Check for trial status FIRST
                    if (subscription.status === 'trialing') {
                        subscriptionStatus = 'trialing';
                    } else if (subscription.cancel_at_period_end) {
                        subscriptionStatus = 'canceling';
                    } else if (subscription.status === 'past_due') {
                        subscriptionStatus = 'past_due';
                    } else if (subscription.status === 'unpaid') {
                        subscriptionStatus = 'unpaid';
                        subscriptionTier = 'free';
                    } else if (subscription.status === 'canceled') {
                        subscriptionStatus = 'canceled';
                        subscriptionTier = 'free';
                    } else if (subscription.status === 'active') {
                        subscriptionStatus = 'active';
                    }

                    await updateUserProfile(userId, {
                        subscription_status: subscriptionStatus,
                        subscription_tier: subscriptionTier,
                        subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    }, event.type);

                    console.log(`[Webhook] Subscription updated for user ${userId}: ${subscriptionStatus}`);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    userId,
                    { subscription_id: subscription.id }
                );
                if (!shouldProcess) break;

                if (userId) {
                    await updateUserProfile(userId, {
                        subscription_status: 'canceled',
                        subscription_tier: 'free',
                        stripe_subscription_id: null,
                    }, event.type);

                    console.log(`[Webhook] Subscription cancelled for user ${userId}`);
                }
                break;
            }

            case 'customer.subscription.trial_will_end': {
                // Trial ending in 3 days - we can use this to send notifications
                const subscription = event.data.object;
                const userId = subscription.metadata?.supabase_user_id;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    userId,
                    { subscription_id: subscription.id, trial_end: subscription.trial_end }
                );
                if (!shouldProcess) break;

                if (userId) {
                    console.log(`[Webhook] Trial ending soon for user ${userId}`);
                    // TODO: Send email notification or in-app notification
                    // For now, just log it - the app handles trial warnings locally
                }
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    null,
                    { invoice_id: invoice.id, subscription_id: subscriptionId }
                );
                if (!shouldProcess) break;

                if (subscriptionId) {
                    // Get subscription to find user
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
                    const userId = subscription.metadata?.supabase_user_id;

                    if (userId) {
                        // Payment succeeded - ensure subscription is active
                        await updateUserProfile(userId, {
                            subscription_status: 'active',
                            subscription_tier: 'premium',
                            subscription_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                        }, event.type);

                        console.log(`[Webhook] Payment succeeded for user ${userId}`);
                    }
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;

                const shouldProcess = await logWebhookEvent(
                    event.id,
                    event.type,
                    null,
                    { invoice_id: invoice.id, subscription_id: subscriptionId }
                );
                if (!shouldProcess) break;

                if (subscriptionId) {
                    // Get subscription to find user
                    const subscription = await stripe.subscriptions.retrieve(subscriptionId as string);
                    const userId = subscription.metadata?.supabase_user_id;

                    if (userId) {
                        await updateUserProfile(userId, {
                            subscription_status: 'payment_failed',
                        }, event.type);

                        console.log(`[Webhook] Payment failed for user ${userId}`);
                    }
                }
                break;
            }

            default:
                console.log(`[Webhook] Unhandled event type: ${event.type}`);
        }

        return new Response(
            JSON.stringify({ received: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[Webhook] Error:', error);

        // Return 500 to trigger Stripe retry for recoverable errors
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
