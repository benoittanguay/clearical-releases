/**
 * New User Notification Edge Function
 *
 * Sends an email notification when a new user creates an account.
 * Triggered by a Supabase Database Webhook on auth.users INSERT.
 *
 * Setup:
 * 1. Sign up at resend.com and get an API key
 * 2. Set secrets in Supabase:
 *    supabase secrets set RESEND_API_KEY=re_xxxxx
 *    supabase secrets set NOTIFICATION_EMAIL=your@email.com
 * 3. Create a Database Webhook in Supabase Dashboard:
 *    - Go to Database > Webhooks
 *    - Create webhook on auth.users table, INSERT event
 *    - Set URL to: https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/new-user-notification
 *    - Add header: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
const notificationEmail = Deno.env.get('NOTIFICATION_EMAIL') || '';

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const payload = await req.json();

        // Database webhook sends: { type, table, schema, record, old_record }
        const record = payload.record;
        if (!record) {
            return new Response(
                JSON.stringify({ error: 'No record in payload' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const userEmail = record.email || 'unknown';
        const createdAt = record.created_at || new Date().toISOString();
        const provider = record.raw_app_meta_data?.provider || 'email';

        console.log(`[New User] ${userEmail} signed up via ${provider} at ${createdAt}`);

        if (!resendApiKey || !notificationEmail) {
            console.warn('[New User] RESEND_API_KEY or NOTIFICATION_EMAIL not configured');
            return new Response(
                JSON.stringify({ error: 'Email not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Send notification email via Resend
        const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'Clearical <notifications@clearical.io>',
                to: [notificationEmail],
                subject: `New Clearical user: ${userEmail}`,
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                        <h2 style="margin: 0 0 16px; color: #1a1a1a;">New User Signup</h2>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #666; width: 100px;">Email</td>
                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 500;">${userEmail}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666;">Provider</td>
                                <td style="padding: 8px 0; color: #1a1a1a;">${provider}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666;">Signed up</td>
                                <td style="padding: 8px 0; color: #1a1a1a;">${new Date(createdAt).toLocaleString('en-US', { timeZone: 'America/Montreal' })}</td>
                            </tr>
                        </table>
                    </div>
                `,
            }),
        });

        if (!emailResponse.ok) {
            const error = await emailResponse.text();
            console.error('[New User] Resend error:', error);
            return new Response(
                JSON.stringify({ error: 'Failed to send email' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const result = await emailResponse.json();
        console.log(`[New User] Notification sent: ${result.id}`);

        return new Response(
            JSON.stringify({ success: true, email_id: result.id }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[New User] Error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
