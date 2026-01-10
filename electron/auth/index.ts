/**
 * Auth Module
 *
 * Exports for the Supabase authentication system.
 */

export { SupabaseAuthService, getAuthService } from './supabaseAuth.js';
export type { AuthUser, AuthSession, AuthResult } from './supabaseAuth.js';
export { initializeAuth } from './ipcHandlers.js';
