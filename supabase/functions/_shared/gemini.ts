/**
 * Gemini API Client for Edge Functions
 *
 * Shared module for calling Google Gemini 1.5 Flash API.
 * API key is stored in Supabase secrets.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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
 */
export async function generateText(prompt: string): Promise<GeminiResponse> {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
        return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Gemini] API error:', response.status, errorText);
            return { success: false, error: `Gemini API error: ${response.status}` };
        }

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
    } catch (error) {
        console.error('[Gemini] Request error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Analyze an image with Gemini Vision
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

    try {
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

        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [content],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 1024,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Gemini] Vision API error:', response.status, errorText);
            return { success: false, error: `Gemini API error: ${response.status}` };
        }

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
    } catch (error) {
        console.error('[Gemini] Vision request error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
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
