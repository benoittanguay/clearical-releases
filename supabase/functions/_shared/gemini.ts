/**
 * Gemini API Client for Edge Functions
 *
 * Shared module for calling Google Gemini 2.5 Flash Lite API.
 * Using Flash Lite for higher free tier limits (15 RPM, 1000 RPD vs 10 RPM, 250 RPD).
 * API key is stored in Supabase secrets.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

// Retry configuration for rate limit handling
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface GeminiResponse {
    success: boolean;
    text?: string;
    error?: string;
}

export interface GeminiImagePart {
    inlineData: {
        mimeType: string;
        data: string; // base64 encoded
    };
}

export interface GeminiTextPart {
    text: string;
}

type GeminiPart = GeminiImagePart | GeminiTextPart;

interface GeminiRequestContent {
    parts: GeminiPart[];
}

interface GeminiCandidate {
    content: {
        parts: { text: string }[];
    };
    finishReason: string;
}

interface GeminiAPIResponse {
    candidates?: GeminiCandidate[];
    error?: {
        message: string;
        code: number;
    };
}

/**
 * Call Gemini API with text-only prompt
 * Includes retry logic with exponential backoff for rate limit errors
 */
export async function generateText(prompt: string): Promise<GeminiResponse> {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
        return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

    let lastError = 'Unknown error';

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 1024,
                    },
                }),
            });

            if (response.ok) {
                const data: GeminiAPIResponse = await response.json();

                if (data.error) {
                    return { success: false, error: data.error.message };
                }

                if (!data.candidates || data.candidates.length === 0) {
                    return { success: false, error: 'No response from Gemini' };
                }

                const text = data.candidates[0].content.parts
                    .map(part => part.text)
                    .join('');

                return { success: true, text };
            }

            // Handle non-OK response
            const errorText = await response.text();
            lastError = `Gemini API error: ${response.status}`;
            console.error(`[Gemini] API error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, response.status, errorText);

            // Check if retryable
            if (!RETRY_CONFIG.retryableStatusCodes.includes(response.status) || attempt >= RETRY_CONFIG.maxRetries) {
                return { success: false, error: lastError };
            }

            // Calculate delay with exponential backoff
            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );

            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            const actualDelay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, delayMs) : delayMs;

            console.log(`[Gemini] Retrying in ${actualDelay}ms...`);
            await sleep(actualDelay);

        } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Gemini] Request error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, error);

            if (attempt >= RETRY_CONFIG.maxRetries) {
                return { success: false, error: lastError };
            }

            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );
            console.log(`[Gemini] Retrying in ${delayMs}ms...`);
            await sleep(delayMs);
        }
    }

    return { success: false, error: lastError };
}

/**
 * Analyze an image with Gemini Vision
 * Includes retry logic with exponential backoff for rate limit errors
 *
 * @param imageBase64 - Base64 encoded image data (without data URL prefix)
 * @param prompt - Text prompt to accompany the image
 * @param mimeType - Image MIME type (default: 'image/png')
 */
export async function analyzeImage(
    imageBase64: string,
    prompt: string,
    mimeType: string = 'image/png'
): Promise<GeminiResponse> {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
        return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

    const content: GeminiRequestContent = {
        parts: [
            {
                inlineData: {
                    mimeType,
                    data: imageBase64,
                }
            },
            { text: prompt }
        ]
    };

    const requestBody = JSON.stringify({
        contents: [content],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
        },
    });

    let lastError = 'Unknown error';

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
            const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: requestBody,
            });

            if (response.ok) {
                const data: GeminiAPIResponse = await response.json();

                if (data.error) {
                    return { success: false, error: data.error.message };
                }

                if (!data.candidates || data.candidates.length === 0) {
                    return { success: false, error: 'No response from Gemini' };
                }

                const text = data.candidates[0].content.parts
                    .map(part => part.text)
                    .join('');

                return { success: true, text };
            }

            // Handle non-OK response
            const errorText = await response.text();
            lastError = `Gemini API error: ${response.status}`;
            console.error(`[Gemini] Vision API error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, response.status, errorText);

            // Check if retryable
            if (!RETRY_CONFIG.retryableStatusCodes.includes(response.status) || attempt >= RETRY_CONFIG.maxRetries) {
                return { success: false, error: lastError };
            }

            // Calculate delay with exponential backoff
            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );

            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            const actualDelay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, delayMs) : delayMs;

            console.log(`[Gemini] Retrying vision request in ${actualDelay}ms...`);
            await sleep(actualDelay);

        } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Gemini] Vision request error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, error);

            if (attempt >= RETRY_CONFIG.maxRetries) {
                return { success: false, error: lastError };
            }

            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );
            console.log(`[Gemini] Retrying in ${delayMs}ms...`);
            await sleep(delayMs);
        }
    }

    return { success: false, error: lastError };
}

/**
 * Extract a JSON response from Gemini's text output
 * Handles cases where the response might have markdown code blocks
 */
export function extractJsonFromResponse<T>(text: string): T | null {
    try {
        // Try direct JSON parse first
        return JSON.parse(text);
    } catch {
        // Try to extract from markdown code block
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch {
                return null;
            }
        }
        return null;
    }
}
