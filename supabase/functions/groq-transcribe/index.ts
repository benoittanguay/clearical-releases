/**
 * Groq Whisper Transcription Proxy Edge Function
 *
 * Proxies audio transcription requests to Groq's Whisper Large v3 Turbo API.
 * Handles authentication, usage tracking, and monthly limits.
 *
 * Usage limits:
 * - Free tier: 10 hours/month
 * - Premium/Trial: Unlimited
 *
 * Cost: ~$0.04/hour (Groq Whisper Large v3 Turbo)
 *
 * Usage from Electron app:
 * POST /functions/v1/groq-transcribe
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: { audioBase64: string, mimeType: string, entryId: string }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient, supabaseAdmin, extractToken } from '../_shared/supabase.ts';

// Usage limits (seconds per month)
const MONTHLY_LIMIT_FREE_SECONDS = 10 * 60 * 60; // 10 hours = 36000 seconds
const MONTHLY_LIMIT_PREMIUM_SECONDS = -1; // -1 = unlimited

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

interface TranscribeRequest {
    audioBase64: string;
    mimeType?: string;
    entryId: string;
    language?: string;
}

interface TranscriptionSegment {
    id: number;
    start: number;
    end: number;
    text: string;
}

interface GroqResponse {
    text: string;
    segments?: TranscriptionSegment[];
    language?: string;
    duration?: number;
}

interface TranscribeResponse {
    success: boolean;
    transcription?: {
        text: string;
        segments: TranscriptionSegment[];
        language: string;
        duration: number;
    };
    usage?: {
        durationSeconds: number;
        monthlyUsedSeconds: number;
        monthlyLimitSeconds: number;
        remainingSeconds: number;
    };
    error?: string;
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
                JSON.stringify({ success: false, error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create Supabase client and extract token for validation
        const supabase = createSupabaseClient(authHeader);
        const token = extractToken(authHeader);

        // Get the authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            console.error('[groq-transcribe] Auth validation failed:', userError?.message);
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Get user's subscription status
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('subscription_status, subscription_tier')
            .eq('id', user.id)
            .single();

        const isPremium = profile?.subscription_status === 'active' ||
                          profile?.subscription_status === 'trialing';

        // Check monthly usage limit
        const usageCheck = await checkMonthlyUsage(user.id, isPremium);
        if (!usageCheck.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Monthly transcription limit exceeded. Free tier limit: ${Math.round(MONTHLY_LIMIT_FREE_SECONDS / 3600)} hours/month. Upgrade to premium for unlimited transcription.`,
                    usage: {
                        durationSeconds: 0,
                        monthlyUsedSeconds: usageCheck.usedSeconds,
                        monthlyLimitSeconds: usageCheck.limitSeconds,
                        remainingSeconds: 0,
                    }
                }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const body: TranscribeRequest = await req.json();
        const { audioBase64, mimeType = 'audio/webm', entryId, language } = body;

        if (!audioBase64) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing audioBase64 parameter' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (!entryId) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing entryId parameter' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Get Groq API key from environment
        const groqApiKey = Deno.env.get('GROQ_API_KEY');
        if (!groqApiKey) {
            console.error('[groq-transcribe] GROQ_API_KEY not configured');
            return new Response(
                JSON.stringify({ success: false, error: 'Transcription service not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Convert base64 to blob
        const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const audioBlob = new Blob([audioBytes], { type: mimeType });

        // Prepare form data for Groq API
        const formData = new FormData();
        formData.append('file', audioBlob, `audio.${getExtension(mimeType)}`);
        formData.append('model', GROQ_MODEL);
        formData.append('response_format', 'verbose_json');
        if (language) {
            formData.append('language', language);
        }

        // Call Groq API
        console.log('[groq-transcribe] Sending request to Groq API...');
        const groqResponse = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
            },
            body: formData,
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            console.error('[groq-transcribe] Groq API error:', groqResponse.status, errorText);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Transcription failed: ${groqResponse.status}`
                }),
                { status: groqResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const groqResult: GroqResponse = await groqResponse.json();
        console.log('[groq-transcribe] Transcription complete, duration:', groqResult.duration);

        // Track usage (non-blocking)
        const durationSeconds = groqResult.duration || 0;
        trackUsage(user.id, entryId, durationSeconds).catch(
            err => console.error('[groq-transcribe] Usage tracking error:', err)
        );

        // Calculate updated usage
        const newUsedSeconds = usageCheck.usedSeconds + durationSeconds;
        const remainingSeconds = usageCheck.limitSeconds > 0
            ? Math.max(0, usageCheck.limitSeconds - newUsedSeconds)
            : -1; // -1 = unlimited

        const response: TranscribeResponse = {
            success: true,
            transcription: {
                text: groqResult.text || '',
                segments: groqResult.segments || [],
                language: groqResult.language || 'en',
                duration: durationSeconds,
            },
            usage: {
                durationSeconds,
                monthlyUsedSeconds: newUsedSeconds,
                monthlyLimitSeconds: usageCheck.limitSeconds,
                remainingSeconds,
            },
        };

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[groq-transcribe] Error:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Internal server error'
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});

/**
 * Get file extension from mime type
 */
function getExtension(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
    };
    return mimeToExt[mimeType] || 'webm';
}

/**
 * Check if user is within monthly usage limits
 */
async function checkMonthlyUsage(userId: string, isPremium: boolean): Promise<{
    allowed: boolean;
    usedSeconds: number;
    limitSeconds: number;
}> {
    const limitSeconds = isPremium ? MONTHLY_LIMIT_PREMIUM_SECONDS : MONTHLY_LIMIT_FREE_SECONDS;

    // Premium users have unlimited usage
    if (limitSeconds < 0) {
        return { allowed: true, usedSeconds: 0, limitSeconds };
    }

    // Get start of current month (UTC)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Sum this month's usage
    const { data, error } = await supabaseAdmin
        .from('transcription_usage')
        .select('duration_seconds')
        .eq('user_id', userId)
        .gte('created_at', monthStart.toISOString());

    if (error) {
        console.error('[groq-transcribe] Usage check error:', error);
        // Allow on error to avoid blocking users
        return { allowed: true, usedSeconds: 0, limitSeconds };
    }

    const usedSeconds = data?.reduce((sum, row) => sum + (row.duration_seconds || 0), 0) || 0;

    return {
        allowed: usedSeconds < limitSeconds,
        usedSeconds,
        limitSeconds,
    };
}

/**
 * Track transcription usage in database
 */
async function trackUsage(
    userId: string,
    entryId: string,
    durationSeconds: number
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('transcription_usage')
        .insert({
            user_id: userId,
            entry_id: entryId,
            duration_seconds: durationSeconds,
        });

    if (error) {
        console.error('[groq-transcribe] Usage tracking insert error:', error);
    }
}
