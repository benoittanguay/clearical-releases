/**
 * Centralized Prompt Management
 *
 * All AI prompts are stored in JSON files for easy modification.
 * This module provides utilities to load and format prompts.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

export interface PromptConfig {
    name: string;
    model: string;
    description: string;
    version: string;
    template: string;
    parameters: {
        max_tokens: number;
        temperature: number;
    };
}

// Cache for loaded prompts
const promptCache: Map<string, PromptConfig> = new Map();

/**
 * Get the prompts directory path
 */
function getPromptsDir(): string {
    // In development, use the source directory
    // In production, prompts are bundled with the app
    if (app.isPackaged) {
        return join(process.resourcesPath, 'prompts');
    }
    return join(__dirname, 'prompts');
}

/**
 * Load a prompt configuration by name
 */
export function loadPrompt(name: string): PromptConfig {
    // Check cache first
    if (promptCache.has(name)) {
        return promptCache.get(name)!;
    }

    try {
        const promptPath = join(getPromptsDir(), `${name}.json`);
        const content = readFileSync(promptPath, 'utf-8');
        const config = JSON.parse(content) as PromptConfig;

        // Cache the loaded prompt
        promptCache.set(name, config);

        return config;
    } catch (error) {
        console.error(`[Prompts] Failed to load prompt "${name}":`, error);
        throw new Error(`Prompt "${name}" not found`);
    }
}

/**
 * Format a prompt template with variables
 *
 * @param template - The prompt template with {variable} placeholders
 * @param variables - Key-value pairs to substitute
 * @returns Formatted prompt string
 */
export function formatPrompt(template: string, variables: Record<string, string>): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{${key}}`;
        result = result.split(placeholder).join(value || '');
    }

    // Remove any remaining empty placeholders
    result = result.replace(/\{[^}]+\}/g, '');

    return result.trim();
}

/**
 * Get a formatted prompt ready for use
 *
 * @param name - Prompt name (without .json extension)
 * @param variables - Variables to substitute in the template
 * @returns Object with formatted prompt and parameters
 */
export function getPrompt(name: string, variables: Record<string, string> = {}): {
    prompt: string;
    parameters: PromptConfig['parameters'];
    model: string;
} {
    const config = loadPrompt(name);
    const prompt = formatPrompt(config.template, variables);

    return {
        prompt,
        parameters: config.parameters,
        model: config.model,
    };
}

/**
 * Clear the prompt cache (useful for development/hot reload)
 */
export function clearPromptCache(): void {
    promptCache.clear();
}

// Export prompt names as constants for type safety
export const PROMPTS = {
    SCREENSHOT_ANALYSIS: 'screenshot-analysis',
    ACTIVITY_SUMMARY: 'activity-summary',
    ACTIVITY_CLASSIFICATION: 'activity-classification',
    ACCOUNT_SELECTION: 'account-selection',
} as const;

export type PromptName = typeof PROMPTS[keyof typeof PROMPTS];
