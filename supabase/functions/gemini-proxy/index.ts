/**
 * Gemini AI Proxy Edge Function
 *
 * Proxies AI requests to Google Gemini 1.5 Flash API.
 * Handles authentication, rate limiting, and usage tracking.
 *
 * Operations:
 * - analyze: Analyze a screenshot image
 * - classify: Classify activity to a bucket/issue
 * - summarize: Summarize multiple activity descriptions
 *
 * Usage from Electron app:
 * POST /functions/v1/gemini-proxy
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body: { operation: string, ...operationParams }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient, supabaseAdmin } from '../_shared/supabase.ts';
import { generateText, analyzeImage, extractJsonFromResponse } from '../_shared/gemini.ts';

// Rate limits (requests per day)
const RATE_LIMIT_FREE = 50;
const RATE_LIMIT_PREMIUM = 500;

interface RequestBody {
    operation: 'analyze' | 'classify' | 'summarize';
    // For analyze
    imageBase64?: string;
    appName?: string;
    windowTitle?: string;
    // For classify
    description?: string;
    options?: Array<{ id: string; name: string }>;
    context?: string;
    // For summarize
    descriptions?: string[];
    appNames?: string[];
}

interface AnalyzeResponse {
    success: boolean;
    description?: string;
    confidence?: number;
    error?: string;
}

interface ClassifyResponse {
    success: boolean;
    selectedId?: string;
    selectedName?: string;
    confidence?: number;
    error?: string;
}

interface SummarizeResponse {
    success: boolean;
    summary?: string;
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

        // Create Supabase client with user's token
        const supabase = createSupabaseClient(authHeader);

        // Get the authenticated user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Get user's subscription status
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('subscription_status, subscription_tier')
            .eq('id', user.id)
            .single();

        const isPremium = profile?.subscription_status === 'active' ||
                          profile?.subscription_status === 'trialing';

        // Check rate limiting
        const rateLimitResult = await checkRateLimit(user.id, isPremium);
        if (!rateLimitResult.allowed) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: `Rate limit exceeded. ${isPremium ? 'Premium' : 'Free'} limit: ${rateLimitResult.limit} requests/day. Resets at midnight UTC.`
                }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Parse request body
        const body: RequestBody = await req.json();
        const { operation } = body;

        if (!operation) {
            return new Response(
                JSON.stringify({ success: false, error: 'Missing operation parameter' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        let response: AnalyzeResponse | ClassifyResponse | SummarizeResponse;
        let inputTokens = 0;
        let outputTokens = 0;

        switch (operation) {
            case 'analyze':
                response = await handleAnalyze(body);
                // Estimate tokens for image analysis (rough approximation)
                inputTokens = body.imageBase64 ? Math.ceil(body.imageBase64.length / 4 / 4) : 0; // base64 to bytes to tokens
                inputTokens += (body.appName?.length || 0) + (body.windowTitle?.length || 0);
                break;

            case 'classify':
                response = await handleClassify(body);
                inputTokens = (body.description?.length || 0) / 4;
                inputTokens += JSON.stringify(body.options || []).length / 4;
                break;

            case 'summarize':
                response = await handleSummarize(body);
                inputTokens = (body.descriptions?.join(' ').length || 0) / 4;
                break;

            default:
                return new Response(
                    JSON.stringify({ success: false, error: `Unknown operation: ${operation}` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }

        // Estimate output tokens
        if (response.success) {
            if ('description' in response && response.description) {
                outputTokens = response.description.length / 4;
            } else if ('summary' in response && response.summary) {
                outputTokens = response.summary.length / 4;
            } else {
                outputTokens = 50; // Classification typically short
            }
        }

        // Track usage (non-blocking)
        trackUsage(user.id, operation, Math.round(inputTokens), Math.round(outputTokens)).catch(
            err => console.error('[GeminiProxy] Usage tracking error:', err)
        );

        return new Response(
            JSON.stringify(response),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        console.error('[GeminiProxy] Error:', error);
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
 * Handle screenshot analysis operation
 */
async function handleAnalyze(body: RequestBody): Promise<AnalyzeResponse> {
    const { imageBase64, appName, windowTitle } = body;

    if (!imageBase64) {
        return { success: false, error: 'Missing imageBase64 parameter' };
    }

    // Build the prompt
    let prompt = `Analyze this screenshot and describe what the user is doing in a single, concise sentence (under 100 words). Focus on the specific task or activity visible, not general app descriptions.`;

    if (appName || windowTitle) {
        prompt += `\n\nContext:`;
        if (appName) prompt += `\n- Application: ${appName}`;
        if (windowTitle) prompt += `\n- Window: ${windowTitle}`;
    }

    prompt += `\n\nProvide just the activity description, nothing else.`;

    const result = await analyzeImage(imageBase64, prompt);

    if (!result.success || !result.text) {
        // Return fallback description using context
        const fallback = generateFallbackDescription(appName, windowTitle);
        return {
            success: false,
            description: fallback,
            error: result.error || 'Analysis failed'
        };
    }

    return {
        success: true,
        description: result.text.trim(),
        confidence: 0.9
    };
}

/**
 * Handle activity classification operation
 */
async function handleClassify(body: RequestBody): Promise<ClassifyResponse> {
    const { description, options, context } = body;

    if (!description) {
        return { success: false, error: 'Missing description parameter' };
    }

    if (!options || options.length === 0) {
        return { success: false, error: 'Missing or empty options parameter' };
    }

    // Build the prompt for classification
    let prompt = `Given the following work activity description, select the most appropriate category from the options below.

Activity: "${description}"

${context ? `Additional context: ${context}\n` : ''}
Available options:
${options.map((opt, i) => `${i + 1}. [ID: ${opt.id}] ${opt.name}`).join('\n')}

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"selectedId": "the_id_value", "selectedName": "the name", "confidence": 0.85}

Select the option that best matches the work activity. If unsure, pick the closest match with lower confidence.`;

    const result = await generateText(prompt);

    if (!result.success || !result.text) {
        return { success: false, error: result.error || 'Classification failed' };
    }

    // Parse the JSON response
    const parsed = extractJsonFromResponse<{
        selectedId: string;
        selectedName: string;
        confidence: number;
    }>(result.text);

    if (!parsed || !parsed.selectedId) {
        // Try to find a match in the text
        for (const opt of options) {
            if (result.text.includes(opt.id) || result.text.toLowerCase().includes(opt.name.toLowerCase())) {
                return {
                    success: true,
                    selectedId: opt.id,
                    selectedName: opt.name,
                    confidence: 0.7
                };
            }
        }
        return { success: false, error: 'Could not parse classification response' };
    }

    return {
        success: true,
        selectedId: parsed.selectedId,
        selectedName: parsed.selectedName,
        confidence: parsed.confidence || 0.8
    };
}

/**
 * Handle activity summarization operation
 */
async function handleSummarize(body: RequestBody): Promise<SummarizeResponse> {
    const { descriptions, appNames } = body;

    if (!descriptions || descriptions.length === 0) {
        return { success: false, error: 'Missing descriptions parameter' };
    }

    // Build the prompt for summarization
    let prompt = `Summarize the following sequence of work activities into a cohesive, narrative paragraph (2-4 sentences). Focus on what was accomplished and the flow of work.

Activities (in chronological order):
${descriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}`;

    if (appNames && appNames.length > 0) {
        const uniqueApps = [...new Set(appNames)];
        prompt += `\n\nApplications used: ${uniqueApps.join(', ')}`;
    }

    prompt += `\n\nProvide just the summary paragraph, nothing else.`;

    const result = await generateText(prompt);

    if (!result.success || !result.text) {
        // Generate a simple fallback summary
        const fallback = generateFallbackSummary(descriptions, appNames);
        return {
            success: false,
            summary: fallback,
            error: result.error || 'Summarization failed'
        };
    }

    return {
        success: true,
        summary: result.text.trim()
    };
}

/**
 * Generate a fallback description when AI fails
 */
function generateFallbackDescription(appName?: string, windowTitle?: string): string {
    if (appName && windowTitle) {
        return `Working in ${appName}: ${windowTitle}`;
    }
    if (appName) {
        return `Working in ${appName}`;
    }
    if (windowTitle) {
        return `Working on: ${windowTitle}`;
    }
    return 'Working on computer';
}

/**
 * Generate a fallback summary when AI fails
 */
function generateFallbackSummary(descriptions: string[], appNames?: string[]): string {
    const uniqueApps = appNames ? [...new Set(appNames)] : [];
    const appText = uniqueApps.length > 0 ? ` using ${uniqueApps.join(', ')}` : '';
    return `Completed ${descriptions.length} activities${appText}.`;
}

/**
 * Check if user is within rate limits
 */
async function checkRateLimit(userId: string, isPremium: boolean): Promise<{
    allowed: boolean;
    remaining: number;
    limit: number;
}> {
    const limit = isPremium ? RATE_LIMIT_PREMIUM : RATE_LIMIT_FREE;

    // Count today's usage
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { count, error } = await supabaseAdmin
        .from('ai_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', today.toISOString());

    if (error) {
        console.error('[GeminiProxy] Rate limit check error:', error);
        // Allow on error to avoid blocking users
        return { allowed: true, remaining: limit, limit };
    }

    const used = count || 0;
    const remaining = Math.max(0, limit - used);

    return {
        allowed: used < limit,
        remaining,
        limit
    };
}

/**
 * Track AI usage in database
 */
async function trackUsage(
    userId: string,
    operation: string,
    inputTokens: number,
    outputTokens: number
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('ai_usage')
        .insert({
            user_id: userId,
            operation,
            input_tokens: inputTokens,
            output_tokens: outputTokens
        });

    if (error) {
        console.error('[GeminiProxy] Usage tracking insert error:', error);
    }
}
