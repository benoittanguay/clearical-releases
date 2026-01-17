/**
 * Analytics Service
 *
 * Tracks product usage events for feature engagement and workflow analysis.
 * Events are batched and sent to Supabase via IPC.
 */

interface AnalyticsEvent {
    event_name: string;
    properties?: Record<string, unknown>;
}

class AnalyticsService {
    private sessionId: string;
    private queue: AnalyticsEvent[] = [];
    private flushIntervalMs = 30000; // 30 seconds
    private maxQueueSize = 10;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private analyticsEnabled: boolean | null = null;
    private initialized = false;
    private beforeUnloadListener: (() => void) | null = null;

    constructor() {
        this.sessionId = crypto.randomUUID();
    }

    /**
     * Initialize the analytics service
     * Call this after the app is ready and user is authenticated
     */
    initialize(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        // Start periodic flush
        this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);

        // Flush on page unload
        this.beforeUnloadListener = () => this.flush();
        window.addEventListener('beforeunload', this.beforeUnloadListener);

        console.log('[Analytics] Initialized with session:', this.sessionId);
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.beforeUnloadListener) {
            window.removeEventListener('beforeunload', this.beforeUnloadListener);
            this.beforeUnloadListener = null;
        }
        this.flush();
        this.initialized = false;
    }

    /**
     * Track an event
     * @param eventName - Event name in category.action format (e.g., 'settings.opened')
     * @param properties - Optional event-specific data
     */
    track(eventName: string, properties?: Record<string, unknown>): void {
        // Check opt-out (cached for performance)
        if (!this.isEnabled()) {
            return;
        }

        this.queue.push({
            event_name: eventName,
            properties,
        });

        // Flush if queue is full
        if (this.queue.length >= this.maxQueueSize) {
            this.flush();
        }
    }

    /**
     * Send queued events to backend
     */
    private async flush(): Promise<void> {
        if (this.queue.length === 0) {
            return;
        }

        const events = [...this.queue];

        try {
            await window.electron.analytics.sendEvents(events, this.sessionId);
            // Only clear queue after successful send
            this.queue = this.queue.filter(e => !events.includes(e));
        } catch (error) {
            // Analytics should never break the app - log and continue
            // Events remain in queue for retry
            console.error('[Analytics] Failed to send events:', error);
        }
    }

    /**
     * Check if analytics is enabled
     * Caches the result to avoid repeated IPC calls
     */
    private isEnabled(): boolean {
        // Use cached value if available
        if (this.analyticsEnabled !== null) {
            return this.analyticsEnabled;
        }

        // Default to true (opt-out model) until we get the actual value
        return true;
    }

    /**
     * Update the enabled state (called when user changes preference)
     */
    setEnabled(enabled: boolean): void {
        this.analyticsEnabled = enabled;
    }

    /**
     * Refresh enabled state from profile
     */
    async refreshEnabledState(): Promise<void> {
        try {
            const result = await window.electron.analytics.getEnabled();
            if (result.success) {
                this.analyticsEnabled = result.enabled;
            }
        } catch (error) {
            console.error('[Analytics] Failed to get enabled state:', error);
        }
    }
}

// Singleton instance
export const analytics = new AnalyticsService();
