/**
 * Gemini API Client for Edge Functions
 *
 * Shared module for calling Google Gemini 2.0 Flash API.
 * Using Gemini 2.0 Flash for best performance and reasonable rate limits.
 * API key is stored in Supabase secrets as GEMINI_API_KEY.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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
 * Image input for batch analysis
 */
export interface BatchImageInput {
    base64: string;
    mimeType: string;
    appName?: string;
    windowTitle?: string;
    ocrText?: string[];  // OCR text detected on screen
}

/**
 * Result for a single image in batch analysis
 */
export interface BatchImageResult {
    index: number;
    success: boolean;
    description?: string;
    confidence?: number;
    error?: string;
}

/**
 * Response from batch image analysis
 */
export interface GeminiBatchResponse {
    success: boolean;
    results: BatchImageResult[];
    error?: string;
}

/**
 * Analyze multiple images in a single API call
 * Includes retry logic with exponential backoff for rate limit errors
 *
 * @param images - Array of images with base64 data, mimeType, and optional context
 */
export async function analyzeImageBatch(
    images: BatchImageInput[]
): Promise<GeminiBatchResponse> {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
        return {
            success: false,
            results: images.map((_, index) => ({
                index,
                success: false,
                error: 'GEMINI_API_KEY not configured'
            })),
            error: 'GEMINI_API_KEY not configured'
        };
    }

    if (images.length === 0) {
        return { success: true, results: [] };
    }

    // Build parts array with all images and their context
    const parts: GeminiPart[] = [];

    // Add instruction text first
    parts.push({
        text: `Analyze the following ${images.length} screenshots and describe what the user is doing in each one. For each screenshot, provide 2-3 detailed sentences. Include specific details visible on screen: file names, function names, URLs, error messages, UI elements, document titles, or data being viewed. Do NOT give generic descriptions like "editing code" — instead say WHAT code, WHAT file, WHAT function.

Respond with ONLY a JSON array containing exactly ${images.length} objects, one for each image in order. Each object should have:
- "description": a detailed activity description (2-3 sentences)
- "confidence": a number between 0 and 1 indicating your confidence

Example response format:
[
  {"description": "Editing the handleSubmit function in src/components/LoginForm.tsx, adding form validation logic for email and password fields. The VS Code editor shows TypeScript with React hooks.", "confidence": 0.95},
  {"description": "Reviewing pull request #142 on GitHub titled 'Add user authentication flow'. The diff view shows changes to the auth middleware with new JWT token validation.", "confidence": 0.9}
]

Now analyze these ${images.length} screenshots:`
    });

    // Add each image with its context
    for (let i = 0; i < images.length; i++) {
        const img = images[i];

        // Add image
        parts.push({
            inlineData: {
                mimeType: img.mimeType,
                data: img.base64,
            }
        });

        // Add context for this image
        let context = `\n\nImage ${i + 1}`;
        if (img.appName || img.windowTitle) {
            context += ' context:';
            if (img.appName) context += ` Application: ${img.appName}`;
            if (img.windowTitle) context += ` Window: ${img.windowTitle}`;
        }
        if (img.ocrText && img.ocrText.length > 0) {
            context += `\nText on screen: ${img.ocrText.slice(0, 30).join(', ')}`;
        }
        parts.push({ text: context });
    }

    const content: GeminiRequestContent = { parts };

    const requestBody = JSON.stringify({
        contents: [content],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048, // Increased for multiple descriptions
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
                    return {
                        success: false,
                        results: images.map((_, index) => ({
                            index,
                            success: false,
                            error: data.error!.message
                        })),
                        error: data.error.message
                    };
                }

                if (!data.candidates || data.candidates.length === 0) {
                    return {
                        success: false,
                        results: images.map((_, index) => ({
                            index,
                            success: false,
                            error: 'No response from Gemini'
                        })),
                        error: 'No response from Gemini'
                    };
                }

                const text = data.candidates[0].content.parts
                    .map(part => part.text)
                    .join('');

                // Parse the JSON array response
                const parsed = extractJsonFromResponse<Array<{ description: string; confidence?: number }>>(text);

                if (!parsed || !Array.isArray(parsed)) {
                    console.error('[Gemini] Failed to parse batch response as JSON array:', text);
                    // Try to extract at least some descriptions from the text
                    return {
                        success: false,
                        results: images.map((_, index) => ({
                            index,
                            success: false,
                            error: 'Failed to parse response as JSON array'
                        })),
                        error: 'Failed to parse response as JSON array'
                    };
                }

                // Map parsed results back to indices
                const results: BatchImageResult[] = images.map((_, index) => {
                    const result = parsed[index];
                    if (result && result.description) {
                        return {
                            index,
                            success: true,
                            description: result.description,
                            confidence: result.confidence ?? 0.8
                        };
                    } else {
                        return {
                            index,
                            success: false,
                            error: 'No description returned for this image'
                        };
                    }
                });

                // Check if at least some succeeded
                const successCount = results.filter(r => r.success).length;
                return {
                    success: successCount > 0,
                    results
                };
            }

            // Handle non-OK response
            const errorText = await response.text();
            lastError = `Gemini API error: ${response.status}`;
            console.error(`[Gemini] Batch API error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, response.status, errorText);

            // Check if retryable
            if (!RETRY_CONFIG.retryableStatusCodes.includes(response.status) || attempt >= RETRY_CONFIG.maxRetries) {
                return {
                    success: false,
                    results: images.map((_, index) => ({
                        index,
                        success: false,
                        error: lastError
                    })),
                    error: lastError
                };
            }

            // Calculate delay with exponential backoff
            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );

            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            const actualDelay = retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, delayMs) : delayMs;

            console.log(`[Gemini] Retrying batch request in ${actualDelay}ms...`);
            await sleep(actualDelay);

        } catch (error) {
            lastError = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Gemini] Batch request error (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}):`, error);

            if (attempt >= RETRY_CONFIG.maxRetries) {
                return {
                    success: false,
                    results: images.map((_, index) => ({
                        index,
                        success: false,
                        error: lastError
                    })),
                    error: lastError
                };
            }

            const delayMs = Math.min(
                RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
                RETRY_CONFIG.maxDelayMs
            );
            console.log(`[Gemini] Retrying in ${delayMs}ms...`);
            await sleep(delayMs);
        }
    }

    return {
        success: false,
        results: images.map((_, index) => ({
            index,
            success: false,
            error: lastError
        })),
        error: lastError
    };
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
