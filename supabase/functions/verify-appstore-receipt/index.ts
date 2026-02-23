/**
 * Verify App Store Receipt Edge Function
 *
 * Validates App Store receipts and updates the user's subscription in Supabase.
 *
 * Usage:
 * POST /functions/v1/verify-appstore-receipt
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: { receipt: string }
 *
 * Response:
 * - 200: { success: true, subscription: { status, plan, expiresAt } }
 * - 401: { error: string } - Authentication error
 * - 400: { error: string } - Invalid receipt
 * - 500: { error: string } - Server error
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient, supabaseAdmin, extractToken } from '../_shared/supabase.ts';

// App Store receipt verification endpoints
const APPLE_PRODUCTION_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_VERIFY_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

// Product ID to subscription tier mapping
// Must match the DB constraint: ('free', 'premium', 'pro', 'enterprise')
// and the planMap in subscriptionValidator.ts: 'premium' → WORKPLACE_MONTHLY
const PRODUCT_TIER_MAP: Record<string, string> = {
    'com.clearical.workplace.monthly': 'premium',
    'com.clearical.workplace.yearly': 'premium',
};

interface ReceiptVerificationResponse {
    status: number;
    receipt?: {
        in_app?: Array<{
            product_id: string;
            expires_date_ms?: string;
            purchase_date_ms?: string;
            original_transaction_id?: string;
        }>;
        latest_receipt_info?: Array<{
            product_id: string;
            expires_date_ms?: string;
            purchase_date_ms?: string;
            original_transaction_id?: string;
        }>;
    };
    latest_receipt?: string;
}

/**
 * Verify receipt with Apple servers
 * Tries production first, falls back to sandbox if status 21007
 */
async function verifyWithApple(receipt: string): Promise<ReceiptVerificationResponse> {
    const appSharedSecret = Deno.env.get('APPLE_SHARED_SECRET') || '';

    const body = JSON.stringify({
        'receipt-data': receipt,
        'password': appSharedSecret,
        'exclude-old-transactions': true,
    });

    // Try production first
    let response = await fetch(APPLE_PRODUCTION_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });

    let result: ReceiptVerificationResponse = await response.json();

    // Status 21007 means this is a sandbox receipt
    if (result.status === 21007) {
        console.log('[verify-receipt] Sandbox receipt detected, retrying with sandbox URL');
        response = await fetch(APPLE_SANDBOX_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        result = await response.json();
    }

    return result;
}

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

        // Validate user
        const supabase = createSupabaseClient(authHeader);
        const token = extractToken(authHeader);
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const { receipt } = await req.json();
        if (!receipt) {
            return new Response(
                JSON.stringify({ error: 'Missing receipt data' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[verify-receipt] Verifying receipt for user ${user.id}`);

        // Verify with Apple
        const verificationResult = await verifyWithApple(receipt);

        if (verificationResult.status !== 0) {
            console.error('[verify-receipt] Apple verification failed, status:', verificationResult.status);
            return new Response(
                JSON.stringify({ error: `Receipt verification failed (status ${verificationResult.status})` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Find the latest subscription from receipt
        const receiptInfo = verificationResult.receipt?.latest_receipt_info
            || verificationResult.receipt?.in_app
            || [];

        // Find the most recent subscription transaction
        let latestSubscription: { productId: string; expiresAt: number } | null = null;

        for (const item of receiptInfo) {
            const productId = item.product_id;
            if (!PRODUCT_TIER_MAP[productId]) continue;

            const expiresMs = parseInt(item.expires_date_ms || '0', 10);
            if (!latestSubscription || expiresMs > latestSubscription.expiresAt) {
                latestSubscription = {
                    productId,
                    expiresAt: expiresMs,
                };
            }
        }

        if (!latestSubscription) {
            return new Response(
                JSON.stringify({ error: 'No valid subscription found in receipt' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const tier = PRODUCT_TIER_MAP[latestSubscription.productId];
        const isExpired = latestSubscription.expiresAt < Date.now();
        // Use 'inactive' for expired (matches DB constraint), 'active' for valid
        const subscriptionStatus = isExpired ? 'inactive' : 'active';

        console.log('[verify-receipt] Subscription found:', {
            tier,
            status: subscriptionStatus,
            expiresAt: new Date(latestSubscription.expiresAt).toISOString(),
        });

        // Update user's subscription in Supabase
        // Fields must match DB constraints:
        // - subscription_status: ('active', 'canceled', 'canceling', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'inactive', 'payment_failed')
        // - subscription_tier: ('free', 'premium', 'pro', 'enterprise')
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({
                subscription_status: subscriptionStatus,
                subscription_tier: tier,
                subscription_period_end: new Date(latestSubscription.expiresAt).toISOString(),
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('[verify-receipt] Failed to update profile:', updateError);
            return new Response(
                JSON.stringify({ error: 'Failed to update subscription status' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({
                success: true,
                subscription: {
                    status: subscriptionStatus,
                    tier,
                    expiresAt: latestSubscription.expiresAt,
                },
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[verify-receipt] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Receipt verification failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
