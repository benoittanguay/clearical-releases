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
import { decode as decodeBase64 } from 'https://deno.land/std@0.177.0/encoding/base64.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient, supabaseAdmin, extractToken } from '../_shared/supabase.ts';

// Usage limits (seconds per month)
// Free users: 8 hours/month (Groq fallback when Apple unavailable)
// Premium/Trial: 20 hours/month Groq, then unlimited Apple on-device
const MONTHLY_LIMIT_FREE_SECONDS = 8 * 60 * 60; // 8 hours = 28800 seconds
const MONTHLY_LIMIT_PREMIUM_SECONDS = 20 * 60 * 60; // 20 hours = 72000 seconds

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
            const limitHours = Math.round(usageCheck.limitSeconds / 3600);
            const errorMessage = isPremium
                ? `Monthly Groq transcription limit (${limitHours} hours) exceeded. Transcription will continue using on-device Apple Speech.`
                : `Monthly transcription limit (${limitHours} hours) exceeded. Upgrade to premium for more transcription hours.`;

            return new Response(
                JSON.stringify({
                    success: false,
                    error: errorMessage,
                    quotaExceeded: true, // Signal to client to use Apple fallback
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

        // Convert base64 to blob (using efficient Deno decoder to stay within CPU limits)
        const audioBytes = decodeBase64(audioBase64);
        console.log('[groq-transcribe] Audio data size:', audioBytes.length, 'bytes, mimeType:', mimeType);

        // Validate audio size (minimum ~1KB for any meaningful audio, max 25MB for Whisper)
        if (audioBytes.length < 1000) {
            console.error('[groq-transcribe] Audio too small:', audioBytes.length, 'bytes');
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Audio file too small (${audioBytes.length} bytes). Minimum meaningful audio is ~1KB.`
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (audioBytes.length > 25 * 1024 * 1024) {
            console.error('[groq-transcribe] Audio too large:', audioBytes.length, 'bytes');
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Audio file too large (${Math.round(audioBytes.length / 1024 / 1024)}MB). Maximum is 25MB.`
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Clean MIME type by removing codec info (e.g., 'audio/webm;codecs=opus' -> 'audio/webm')
        const cleanMimeType = mimeType.split(';')[0].trim();
        const audioBlob = new Blob([audioBytes], { type: cleanMimeType });
        const fileExtension = getExtension(mimeType);
        console.log('[groq-transcribe] Using cleanMimeType:', cleanMimeType, 'extension:', fileExtension);

        // Prepare form data for Groq API
        const formData = new FormData();
        formData.append('file', audioBlob, `audio.${fileExtension}`);
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

            // Try to parse Groq error message for better feedback
            let errorMessage = `Transcription failed: ${groqResponse.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    errorMessage = `Groq error: ${errorJson.error.message}`;
                } else if (errorJson.message) {
                    errorMessage = `Groq error: ${errorJson.message}`;
                }
            } catch {
                // If not JSON, use raw text if it's short enough
                if (errorText && errorText.length < 200) {
                    errorMessage = `Groq error: ${errorText}`;
                }
            }

            return new Response(
                JSON.stringify({
                    success: false,
                    error: errorMessage
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
 * Handles MIME types with codec info like 'audio/webm;codecs=opus'
 */
function getExtension(mimeType: string): string {
    // Strip codec info if present (e.g., 'audio/webm;codecs=opus' -> 'audio/webm')
    const baseMimeType = mimeType.split(';')[0].trim();

    const mimeToExt: Record<string, string> = {
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
    };
    return mimeToExt[baseMimeType] || 'webm';
}

/**
 * Check if user is within monthly Groq usage limits
 *
 * Limits:
 * - Free users: 8 hours/month (Groq fallback when Apple unavailable)
 * - Premium/Trial: 20 hours/month Groq, then switch to Apple on-device
 */
async function checkMonthlyUsage(userId: string, isPremium: boolean): Promise<{
    allowed: boolean;
    usedSeconds: number;
    limitSeconds: number;
}> {
    const limitSeconds = isPremium ? MONTHLY_LIMIT_PREMIUM_SECONDS : MONTHLY_LIMIT_FREE_SECONDS;

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
