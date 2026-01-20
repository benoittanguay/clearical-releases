/**
 * Gemini AI Proxy Edge Function
 *
 * Proxies AI requests to Google Gemini 2.5 Flash Lite API.
 * Using Flash Lite for higher free tier limits (15 RPM, 1000 RPD).
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
import { createSupabaseClient, supabaseAdmin, extractToken } from '../_shared/supabase.ts';
import { generateText, analyzeImage, extractJsonFromResponse } from '../_shared/gemini.ts';

// Rate limits (requests per day)
const RATE_LIMIT_FREE = 50;
const RATE_LIMIT_PREMIUM = 500;

/**
 * Signal categories for organizing and filtering signals
 * Each AI task only receives signals from categories it needs
 */
type SignalCategory = 'user' | 'activity' | 'temporal' | 'external';

/**
 * AI Task types that can request signals
 */
type AITaskType = 'summarization' | 'classification' | 'account_selection' | 'split_suggestion';

/**
 * Configuration for which signal categories each AI task needs
 */
const AI_TASK_SIGNAL_REQUIREMENTS: Record<AITaskType, SignalCategory[]> = {
    'summarization': ['activity', 'temporal'],     // Activity + calendar context
    'classification': ['activity'],                 // Only activity context
    'account_selection': ['activity', 'external'], // Activity + Jira context
    'split_suggestion': ['activity', 'temporal']   // Activity + time patterns
};

/**
 * Context signal types for signal-based AI tasks
 * Matches the types defined in electron/ai/contextSignals.ts
 */
interface ContextSignal {
    type: string;
    category: SignalCategory;
    source: string;
    confidence: 'high' | 'medium' | 'low';
    timestamp?: number;
    data: unknown;
}

interface ScreenshotAnalysisData {
    descriptions: string[];
    count: number;
}

interface WindowActivityData {
    appNames: string[];
    windowTitles: string[];
    appDurations?: Record<string, number>;
}

interface CalendarEventsData {
    currentEvent?: string;
    recentEvents: string[];
    upcomingEvents: string[];
}

interface UserProfileData {
    role?: string;
    domain?: string;
    company?: string;
}

interface DetectedTechnologiesData {
    technologies: string[];
    frameworks?: string[];
    languages?: string[];
}

interface JiraContextData {
    issueKey?: string;
    issueSummary?: string;
    issueType?: string;
    projectKey?: string;
}

interface HistoricalPatternsData {
    commonActivities: string[];
    frequentBuckets: Array<{ id: string; name: string; frequency: number }>;
}

interface RequestBody {
    operation: 'analyze' | 'classify' | 'summarize';
    // Task type for signal filtering (new approach)
    taskType?: AITaskType;
    // Whether to include user context even if not required
    includeUserContext?: boolean;
    // For analyze
    imageBase64?: string;
    appName?: string;
    windowTitle?: string;
    // For classify
    description?: string;
    options?: Array<{ id: string; name: string }>;
    context?: string;
    // For summarize/classify - signal-based approach
    signals?: ContextSignal[];
    duration?: number;
    startTime?: number;
    endTime?: number;
    // Legacy support (deprecated - use signals instead)
    descriptions?: string[];
    appNames?: string[];
    windowTitles?: string[];
}

/**
 * Filter signals by categories allowed for a task
 */
function filterSignalsForTask(
    signals: ContextSignal[],
    taskType: AITaskType,
    includeUserContext: boolean = false
): ContextSignal[] {
    const allowedCategories = [...AI_TASK_SIGNAL_REQUIREMENTS[taskType]];

    // Optionally include user context for terminology/personalization
    if (includeUserContext && !allowedCategories.includes('user')) {
        allowedCategories.push('user');
    }

    return signals.filter(signal => allowedCategories.includes(signal.category));
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

        // Create Supabase client and extract token for validation
        const supabase = createSupabaseClient(authHeader);
        const token = extractToken(authHeader);

        // Get the authenticated user by passing the token directly
        // This is the correct way to validate JWT tokens in edge functions
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            console.error('[gemini-proxy] Auth validation failed:', {
                hasUserError: !!userError,
                errorMessage: userError?.message,
                errorCode: userError?.code,
                hasUser: !!user,
                tokenPrefix: authHeader?.substring(0, 30) + '...',
            });
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
 * Now supports context signals for richer analysis
 */
async function handleAnalyze(body: RequestBody): Promise<AnalyzeResponse> {
    const { imageBase64, appName, windowTitle, signals } = body;

    if (!imageBase64) {
        return { success: false, error: 'Missing imageBase64 parameter' };
    }

    // Build the prompt with context from signals
    let prompt = `Analyze this screenshot and describe what the user is doing in a single, concise sentence (under 100 words). Focus on the specific task or activity visible, not general app descriptions.`;

    // Add basic context
    if (appName || windowTitle) {
        prompt += `\n\nContext:`;
        if (appName) prompt += `\n- Application: ${appName}`;
        if (windowTitle) prompt += `\n- Window: ${windowTitle}`;
    }

    // Add context from signals if provided
    if (signals && signals.length > 0) {
        const signalContext = buildSignalContextForAnalysis(signals);
        if (signalContext) {
            prompt += `\n\nAdditional Context:${signalContext}`;
        }
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
 * Build context string from signals for screenshot analysis
 * Only uses relevant signal types (calendar, user profile, time context)
 * Note: Jira context is intentionally excluded to avoid biasing the description
 */
function buildSignalContextForAnalysis(signals: ContextSignal[]): string {
    const contextParts: string[] = [];

    for (const signal of signals) {
        switch (signal.type) {
            case 'calendar_events': {
                const data = signal.data as CalendarEventsData;
                if (data.currentEvent) {
                    contextParts.push(`- Currently in meeting: "${data.currentEvent}"`);
                }
                if (data.recentEvents && data.recentEvents.length > 0) {
                    contextParts.push(`- Recent meetings: ${data.recentEvents.slice(0, 2).join(', ')}`);
                }
                break;
            }
            case 'user_profile': {
                const data = signal.data as UserProfileData;
                if (data.role) {
                    contextParts.push(`- User role: ${data.role}`);
                }
                if (data.domain) {
                    contextParts.push(`- Work domain: ${data.domain}`);
                }
                break;
            }
            case 'time_context': {
                const data = signal.data as { timeOfDay: string; dayOfWeek: string; isWorkHours: boolean };
                contextParts.push(`- Time: ${data.timeOfDay} on ${data.dayOfWeek}`);
                break;
            }
            // Note: jira_context intentionally excluded - could bias description toward
            // a specific issue even when user is doing unrelated work
        }
    }

    return contextParts.length > 0 ? '\n' + contextParts.join('\n') : '';
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
 * Handle activity summarization operation using signal-based architecture
 *
 * Aggregates context from multiple signal sources to generate a cohesive description:
 * - screenshot_analysis: AI-analyzed screenshot descriptions
 * - window_activity: App names and window titles
 * - calendar_events: Current/recent/upcoming calendar context
 * - user_profile: User's role for domain-specific terminology
 * - detected_technologies: Technologies to include in description
 *
 * Supports legacy parameters for backwards compatibility.
 */
async function handleSummarize(body: RequestBody): Promise<SummarizeResponse> {
    const {
        signals,
        taskType = 'summarization',
        includeUserContext = false,
        duration,
        descriptions,
        appNames,
        windowTitles
    } = body;

    // Filter signals by task type to prevent cross-contamination
    const filteredSignals = signals
        ? filterSignalsForTask(signals, taskType, includeUserContext)
        : undefined;

    console.log(`[GeminiProxy] Summarizing with taskType=${taskType}, includeUserContext=${includeUserContext}`);
    if (signals) {
        console.log(`[GeminiProxy] Received ${signals.length} signals, filtered to ${filteredSignals?.length || 0}`);
    }

    // Extract context from filtered signals (or use legacy parameters)
    const context = filteredSignals
        ? extractContextFromSignals(filteredSignals)
        : extractLegacyContext(descriptions, appNames, windowTitles);

    // Check if we have any context to work with
    if (!context.hasData) {
        return { success: false, error: 'No context signals available for summarization' };
    }

    // Build the prompt from available signals
    const prompt = buildSummarizationPrompt(context, duration);

    const result = await generateText(prompt);

    if (!result.success || !result.text) {
        // Generate fallback from available context
        const fallback = generateFallbackFromSignals(context);
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
 * Aggregated context extracted from signals
 */
interface AggregatedContext {
    hasData: boolean;
    // Screenshot analysis
    screenshotDescriptions: string[];
    // Window activity
    appNames: string[];
    windowTitles: string[];
    appDurations?: Record<string, number>;
    // Calendar
    currentCalendarEvent?: string;
    recentCalendarEvents: string[];
    // User profile
    userRole?: string;
    userDomain?: string;
    // Technologies
    technologies: string[];
    // Confidence levels for weighting
    confidenceLevels: Record<string, 'high' | 'medium' | 'low'>;
}

/**
 * Extract and aggregate context from signals array
 */
function extractContextFromSignals(signals: ContextSignal[]): AggregatedContext {
    const context: AggregatedContext = {
        hasData: false,
        screenshotDescriptions: [],
        appNames: [],
        windowTitles: [],
        recentCalendarEvents: [],
        technologies: [],
        confidenceLevels: {}
    };

    for (const signal of signals) {
        context.confidenceLevels[signal.type] = signal.confidence;

        switch (signal.type) {
            case 'screenshot_analysis': {
                const data = signal.data as ScreenshotAnalysisData;
                if (data.descriptions && data.descriptions.length > 0) {
                    context.screenshotDescriptions.push(...data.descriptions);
                    context.hasData = true;
                }
                break;
            }
            case 'window_activity': {
                const data = signal.data as WindowActivityData;
                if (data.appNames && data.appNames.length > 0) {
                    context.appNames.push(...data.appNames);
                    context.hasData = true;
                }
                if (data.windowTitles && data.windowTitles.length > 0) {
                    const filtered = data.windowTitles.filter(t => t && t !== '(No window title available)');
                    context.windowTitles.push(...filtered);
                    context.hasData = true;
                }
                if (data.appDurations) {
                    context.appDurations = { ...context.appDurations, ...data.appDurations };
                }
                break;
            }
            case 'calendar_events': {
                const data = signal.data as CalendarEventsData;
                if (data.currentEvent) {
                    context.currentCalendarEvent = data.currentEvent;
                    context.hasData = true;
                }
                if (data.recentEvents && data.recentEvents.length > 0) {
                    context.recentCalendarEvents.push(...data.recentEvents);
                    context.hasData = true;
                }
                break;
            }
            case 'user_profile': {
                const data = signal.data as UserProfileData;
                if (data.role) {
                    context.userRole = data.role;
                    context.hasData = true;
                }
                if (data.domain) {
                    context.userDomain = data.domain;
                }
                break;
            }
            case 'detected_technologies': {
                const data = signal.data as DetectedTechnologiesData;
                if (data.technologies && data.technologies.length > 0) {
                    context.technologies.push(...data.technologies);
                    context.hasData = true;
                }
                if (data.frameworks) {
                    context.technologies.push(...data.frameworks);
                }
                if (data.languages) {
                    context.technologies.push(...data.languages);
                }
                break;
            }
        }
    }

    // Deduplicate arrays
    context.appNames = [...new Set(context.appNames)];
    context.windowTitles = [...new Set(context.windowTitles)];
    context.technologies = [...new Set(context.technologies)];
    context.recentCalendarEvents = [...new Set(context.recentCalendarEvents)];

    return context;
}

/**
 * Extract context from legacy parameters (backwards compatibility)
 */
function extractLegacyContext(
    descriptions?: string[],
    appNames?: string[],
    windowTitles?: string[]
): AggregatedContext {
    const context: AggregatedContext = {
        hasData: false,
        screenshotDescriptions: descriptions || [],
        appNames: appNames ? [...new Set(appNames)] : [],
        windowTitles: windowTitles
            ? [...new Set(windowTitles)].filter(t => t && t !== '(No window title available)')
            : [],
        recentCalendarEvents: [],
        technologies: [],
        confidenceLevels: {}
    };

    context.hasData = context.screenshotDescriptions.length > 0 ||
                      context.appNames.length > 0 ||
                      context.windowTitles.length > 0;

    return context;
}

/**
 * Build the AI prompt from aggregated context
 *
 * Uses app durations to identify the PRIMARY task and filter out peripheral activities.
 * Activities like checking emails, notifications, or quick app switches are deprioritized
 * in favor of where the user spent the most focused time.
 */
function buildSummarizationPrompt(context: AggregatedContext, duration?: number): string {
    const sections: string[] = [];

    // Analyze app durations to identify primary focus
    let primaryApp: string | undefined;
    let primaryAppDuration = 0;
    let totalTrackedDuration = 0;

    if (context.appDurations) {
        const sortedApps = Object.entries(context.appDurations)
            .sort((a, b) => b[1] - a[1]); // Sort by duration descending

        if (sortedApps.length > 0) {
            primaryApp = sortedApps[0][0];
            primaryAppDuration = sortedApps[0][1];
            totalTrackedDuration = sortedApps.reduce((sum, [_, dur]) => sum + dur, 0);
        }
    }

    // Calculate focus percentage for primary app
    const focusPercentage = totalTrackedDuration > 0
        ? Math.round((primaryAppDuration / totalTrackedDuration) * 100)
        : 0;

    // Introduction - emphasize PRIMARY task focus
    sections.push(`Write a timesheet entry (1-2 sentences) describing the PRIMARY work task.

CRITICAL RULES:
- Focus ONLY on the main productive task where most time was spent
- IGNORE peripheral activities: checking emails, notifications, security alerts, app switching
- IGNORE brief interruptions or context switches
- Start with an action verb (Developed, Fixed, Reviewed, Implemented, Debugged, etc.)
- Be specific about WHAT was accomplished, not what apps were open

Example good: "Debugged Apple Developer notarization issue for Clearical application."
Example bad: "Managed notifications while reviewing code changes and checking emails."`);

    // Primary app focus signal (this is the key context)
    if (primaryApp && focusPercentage > 0) {
        const durationMins = Math.round(primaryAppDuration / 60000);
        sections.push(`\n**PRIMARY FOCUS**: ${primaryApp} (${focusPercentage}% of session, ${durationMins}+ min)`);
        sections.push(`→ The timesheet entry should describe what was done in ${primaryApp}.`);
    }

    // User role context
    if (context.userRole) {
        sections.push(`\nUser's role: ${context.userRole}${context.userDomain ? ` (${context.userDomain})` : ''}`);
    }

    // Calendar context (helps identify meetings vs focused work)
    if (context.currentCalendarEvent) {
        sections.push(`\nScheduled meeting during this time: "${context.currentCalendarEvent}"`);
    }

    // Screenshot descriptions - filtered and weighted by relevance to primary app
    if (context.screenshotDescriptions.length > 0) {
        // Filter to prioritize descriptions mentioning the primary app
        const relevantDescriptions = primaryApp
            ? context.screenshotDescriptions.filter(desc =>
                desc.toLowerCase().includes(primaryApp!.toLowerCase()) ||
                !isPeripheralActivity(desc)
              )
            : context.screenshotDescriptions.filter(desc => !isPeripheralActivity(desc));

        if (relevantDescriptions.length > 0) {
            sections.push(`\nKey activities observed:`);
            relevantDescriptions.slice(0, 5).forEach((desc, i) => {
                sections.push(`${i + 1}. ${desc}`);
            });
        }
    }

    // App breakdown with time weighting (shows where time was actually spent)
    if (context.appDurations && Object.keys(context.appDurations).length > 0) {
        const sortedApps = Object.entries(context.appDurations)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5); // Top 5 apps by time

        sections.push(`\nTime breakdown by application:`);
        sortedApps.forEach(([app, dur]) => {
            const mins = Math.round(dur / 60000);
            const pct = totalTrackedDuration > 0 ? Math.round((dur / totalTrackedDuration) * 100) : 0;
            if (mins > 0) {
                sections.push(`- ${app}: ${mins} min (${pct}%)`);
            }
        });
    } else if (context.appNames.length > 0) {
        // Fallback if no durations available
        sections.push(`\nApplications used: ${context.appNames.slice(0, 5).join(', ')}`);
    }

    // Window titles - only if relevant to primary task
    if (context.windowTitles.length > 0) {
        const relevantTitles = context.windowTitles
            .filter(title => !isPeripheralWindowTitle(title))
            .slice(0, 5);

        if (relevantTitles.length > 0) {
            sections.push(`\nRelevant window titles: ${relevantTitles.join(', ')}`);
        }
    }

    // Technologies detected
    if (context.technologies.length > 0) {
        sections.push(`\nTechnologies detected: ${context.technologies.join(', ')}`);
    }

    // Session duration
    if (duration && duration > 0) {
        const minutes = Math.round(duration / 60000);
        if (minutes >= 1) {
            sections.push(`\nTotal session: ${minutes} minute${minutes > 1 ? 's' : ''}`);
        }
    }

    // Final instruction
    sections.push(`\nOutput ONLY the timesheet entry (1-2 sentences). Describe the PRIMARY task, not a list of everything that happened.`);

    return sections.join('\n');
}

/**
 * Check if an activity description is peripheral (should be deprioritized)
 *
 * NOTE: We're careful not to filter out legitimate work like email composition.
 * Only filter activities that are clearly interruptions or administrative overhead.
 */
function isPeripheralActivity(description: string): boolean {
    const peripheralPatterns = [
        // System notifications and alerts
        /\bnotification\b/i,
        /security.*alert/i,
        /system.*alert/i,

        // Authentication interruptions (not the main task)
        /one-time.*password/i,
        /\bOTP\b/,
        /verification.*code/i,
        /two-factor/i,
        /2FA/i,

        // Quick app switches / file management
        /managing.*finder/i,
        /system.*preference/i,

        // Social media browsing (unless it's the primary app)
        /browsing.*youtube/i,
        /scrolling.*feed/i,
    ];

    return peripheralPatterns.some(pattern => pattern.test(description));
}

/**
 * Check if a window title is peripheral (notifications, alerts, etc.)
 *
 * NOTE: Don't filter email apps - they can be legitimate primary work
 */
function isPeripheralWindowTitle(title: string): boolean {
    const peripheralPatterns = [
        /notification/i,
        /\balert\b/i,
        /system.*preferences/i,
    ];

    return peripheralPatterns.some(pattern => pattern.test(title));
}

/**
 * Generate fallback description from aggregated context when AI fails
 */
function generateFallbackFromSignals(context: AggregatedContext): string {
    const parts: string[] = [];

    // If we have screenshot descriptions, summarize count
    if (context.screenshotDescriptions.length > 0) {
        parts.push(`Completed ${context.screenshotDescriptions.length} activities`);
    }

    // Add calendar context if available
    if (context.currentCalendarEvent) {
        parts.push(`during "${context.currentCalendarEvent}"`);
    }

    // Add app context
    if (context.appNames.length > 0) {
        const apps = context.appNames.slice(0, 3).join(', ');
        const more = context.appNames.length > 3 ? ' and more' : '';
        if (parts.length > 0) {
            parts.push(`using ${apps}${more}`);
        } else {
            parts.push(`Worked in ${apps}${more}`);
        }
    }

    // Add window title context if no other context
    if (parts.length === 0 && context.windowTitles.length > 0) {
        parts.push(`Worked on ${context.windowTitles[0]}`);
        if (context.windowTitles.length > 1) {
            parts.push(`and ${context.windowTitles.length - 1} other items`);
        }
    }

    // Default fallback
    if (parts.length === 0) {
        return 'Completed work session.';
    }

    return parts.join(' ') + '.';
}

/**
 * Generate a fallback description when AI fails (for screenshot analysis)
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
