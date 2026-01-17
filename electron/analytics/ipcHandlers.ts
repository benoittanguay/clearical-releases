/**
 * Analytics IPC Handlers
 *
 * Handles analytics events from renderer and inserts into Supabase.
 */

import { ipcMain, app } from 'electron';
import os from 'os';
import { getAuthService } from '../auth/supabaseAuth.js';

interface AnalyticsEvent {
    event_name: string;
    properties?: Record<string, unknown>;
}

/**
 * Initialize analytics IPC handlers
 */
export function initializeAnalytics(): void {
    console.log('[Analytics] Initializing analytics handlers...');
    registerIpcHandlers();
    console.log('[Analytics] Analytics handlers initialized');
}

/**
 * Register IPC handlers for analytics
 */
function registerIpcHandlers(): void {
    // Send batched events
    ipcMain.handle('analytics:send-events', handleSendEvents);

    // Get analytics enabled state
    ipcMain.handle('analytics:get-enabled', handleGetEnabled);

    // Set analytics enabled state
    ipcMain.handle('analytics:set-enabled', handleSetEnabled);
}

/**
 * Handle sending batched analytics events
 */
async function handleSendEvents(
    _event: Electron.IpcMainInvokeEvent,
    events: AnalyticsEvent[],
    sessionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, error: 'Supabase client not initialized' };
        }

        // Build rows with metadata
        const rows = events.map(event => ({
            user_id: session.user.id,
            event_name: event.event_name,
            properties: event.properties || {},
            session_id: sessionId,
            app_version: app.getVersion(),
            platform: os.platform(),
        }));

        const { error } = await supabase
            .from('analytics_events')
            .insert(rows);

        if (error) {
            console.error('[Analytics] Insert failed:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error('[Analytics] Error sending events:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Get analytics enabled state from profile
 */
async function handleGetEnabled(): Promise<{ success: boolean; enabled: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, enabled: true, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, enabled: true, error: 'Supabase client not initialized' };
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('analytics_enabled')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error('[Analytics] Failed to get enabled state:', error);
            return { success: false, enabled: true, error: error.message };
        }

        // Default to true if not set
        const enabled = data?.analytics_enabled ?? true;
        return { success: true, enabled };
    } catch (error) {
        console.error('[Analytics] Error getting enabled state:', error);
        return {
            success: false,
            enabled: true,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Set analytics enabled state in profile
 */
async function handleSetEnabled(
    _event: Electron.IpcMainInvokeEvent,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const authService = getAuthService();
        const session = await authService.getSession();

        if (!session) {
            return { success: false, error: 'Not authenticated' };
        }

        const supabase = authService.getSupabaseClient();
        if (!supabase) {
            return { success: false, error: 'Supabase client not initialized' };
        }

        const { error } = await supabase
            .from('profiles')
            .update({ analytics_enabled: enabled })
            .eq('id', session.user.id);

        if (error) {
            console.error('[Analytics] Failed to set enabled state:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error) {
        console.error('[Analytics] Error setting enabled state:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
