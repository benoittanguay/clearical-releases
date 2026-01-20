/**
 * Supabase client for Edge Functions
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Service role client for admin operations (e.g., updating user subscription status)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Create a client with the user's JWT for authenticated operations
// Note: The token should be passed to getUser(token) for validation
export function createSupabaseClient(authHeader: string | null) {
    const token = authHeader?.replace('Bearer ', '') || '';
    return createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
}

/**
 * Extract JWT token from Authorization header
 * Use this to pass the token directly to getUser(token) for validation
 */
export function extractToken(authHeader: string | null): string {
    return authHeader?.replace('Bearer ', '') || '';
}
