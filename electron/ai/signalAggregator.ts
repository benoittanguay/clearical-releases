/**
 * Signal Aggregator Service
 *
 * Centralized service for collecting, storing, and providing context signals
 * to AI tasks. Each entry has its own signal store, and AI tasks request
 * signals by category to prevent cross-contamination.
 *
 * Architecture:
 * - Signals are stored per entry ID
 * - Each signal has a category (user, activity, temporal, external)
 * - AI tasks specify which categories they need
 * - User context is stored separately and can be optionally included
 */

import {
    AnyContextSignal,
    SignalCategory,
    AITaskType,
    AITaskRequest,
    filterSignalsForTask,
    filterSignalsByCategory,
    groupSignalsByCategory,
    hasSignalData,
    getSignalSummary,
    getRequiredCategories,
    // Signal types
    ScreenshotAnalysisSignal,
    WindowActivitySignal,
    CalendarEventsSignal,
    UserProfileSignal,
    HistoricalPatternsSignal,
    JiraContextSignal,
    MeetingTranscriptionSignal,
    // Helper functions
    createScreenshotSignal,
    createWindowActivitySignal,
    createCalendarSignal,
    createUserProfileSignal,
    createTimeContextSignal,
    createTechnologiesSignal,
    createHistoricalPatternsSignal,
    createJiraContextSignal,
    createMeetingTranscriptionSignal
} from './contextSignals.js';

/**
 * Entry-specific signal store
 */
interface EntrySignalStore {
    entryId: string;
    signals: AnyContextSignal[];
    createdAt: number;
    lastUpdated: number;
}

/**
 * Global user context (persists across entries)
 */
interface UserContext {
    profile?: UserProfileSignal;
    patterns?: HistoricalPatternsSignal;
    lastUpdated: number;
}

/**
 * Signal Aggregator Service
 * Singleton service for managing context signals across the application
 */
class SignalAggregatorService {
    /** Signal stores keyed by entry ID */
    private entryStores: Map<string, EntrySignalStore> = new Map();

    /** Global user context (shared across entries) */
    private userContext: UserContext = { lastUpdated: 0 };

    /** Maximum age for cached signals (1 hour) */
    private readonly MAX_SIGNAL_AGE_MS = 60 * 60 * 1000;

    /** Maximum number of entries to keep in cache */
    private readonly MAX_CACHED_ENTRIES = 50;

    // =========================================================================
    // SIGNAL COLLECTION
    // =========================================================================

    /**
     * Add a signal to an entry's store
     */
    addSignal(entryId: string, signal: AnyContextSignal): void {
        const store = this.getOrCreateStore(entryId);

        // Remove existing signal of the same type (replace)
        store.signals = store.signals.filter(s => s.type !== signal.type);

        // Add the new signal
        store.signals.push(signal);
        store.lastUpdated = Date.now();

        console.log(`[SignalAggregator] Added ${signal.type} signal to entry ${entryId}`);
    }

    /**
     * Add multiple signals to an entry's store
     */
    addSignals(entryId: string, signals: AnyContextSignal[]): void {
        for (const signal of signals) {
            this.addSignal(entryId, signal);
        }
    }

    /**
     * Set screenshot analysis signal for an entry
     */
    setScreenshotAnalysis(entryId: string, descriptions: string[]): void {
        if (descriptions.length > 0) {
            this.addSignal(entryId, createScreenshotSignal(descriptions));
        }
    }

    /**
     * Set window activity signal for an entry
     */
    setWindowActivity(
        entryId: string,
        appNames: string[],
        windowTitles: string[],
        appDurations?: Record<string, number>
    ): void {
        if (appNames.length > 0 || windowTitles.length > 0) {
            this.addSignal(entryId, createWindowActivitySignal(appNames, windowTitles, appDurations));
        }
    }

    /**
     * Set calendar events signal for an entry
     */
    setCalendarEvents(
        entryId: string,
        currentEvent?: string,
        recentEvents: string[] = [],
        upcomingEvents: string[] = []
    ): void {
        if (currentEvent || recentEvents.length > 0 || upcomingEvents.length > 0) {
            this.addSignal(entryId, createCalendarSignal(currentEvent, recentEvents, upcomingEvents));
        }
    }

    /**
     * Set time context signal for an entry
     */
    setTimeContext(entryId: string, timestamp: number): void {
        this.addSignal(entryId, createTimeContextSignal(timestamp));
    }

    /**
     * Set detected technologies signal for an entry
     */
    setDetectedTechnologies(
        entryId: string,
        technologies: string[],
        frameworks?: string[],
        languages?: string[]
    ): void {
        if (technologies.length > 0) {
            this.addSignal(entryId, createTechnologiesSignal(technologies, frameworks, languages));
        }
    }

    /**
     * Set Jira context signal for an entry
     */
    setJiraContext(
        entryId: string,
        issueKey?: string,
        issueSummary?: string,
        issueType?: string,
        projectKey?: string
    ): void {
        if (issueKey) {
            this.addSignal(entryId, createJiraContextSignal(issueKey, issueSummary, issueType, projectKey));
        }
    }

    /**
     * Set meeting transcription signal for an entry
     */
    setMeetingTranscription(
        entryId: string,
        transcriptionText: string,
        recordingCount: number,
        totalDuration: number,
        languages: string[]
    ): void {
        if (transcriptionText && transcriptionText.trim().length > 0) {
            this.addSignal(entryId, createMeetingTranscriptionSignal(
                transcriptionText,
                recordingCount,
                totalDuration,
                languages
            ));
        }
    }

    // =========================================================================
    // USER CONTEXT (Global, not per-entry)
    // =========================================================================

    /**
     * Set user profile (global context)
     */
    setUserProfile(role?: string, domain?: string, company?: string): void {
        if (role || domain || company) {
            this.userContext.profile = createUserProfileSignal(role, domain, company);
            this.userContext.lastUpdated = Date.now();
            console.log('[SignalAggregator] Updated user profile');
        }
    }

    /**
     * Set historical patterns (global context)
     */
    setHistoricalPatterns(
        commonActivities: string[],
        frequentBuckets: Array<{ id: string; name: string; frequency: number }>
    ): void {
        if (commonActivities.length > 0 || frequentBuckets.length > 0) {
            this.userContext.patterns = createHistoricalPatternsSignal(commonActivities, frequentBuckets);
            this.userContext.lastUpdated = Date.now();
            console.log('[SignalAggregator] Updated historical patterns');
        }
    }

    /**
     * Get user context signals
     */
    getUserContextSignals(): AnyContextSignal[] {
        const signals: AnyContextSignal[] = [];
        if (this.userContext.profile) signals.push(this.userContext.profile);
        if (this.userContext.patterns) signals.push(this.userContext.patterns);
        return signals;
    }

    // =========================================================================
    // SIGNAL RETRIEVAL
    // =========================================================================

    /**
     * Get all signals for an entry
     */
    getAllSignals(entryId: string): AnyContextSignal[] {
        const store = this.entryStores.get(entryId);
        return store ? [...store.signals] : [];
    }

    /**
     * Get signals for an entry filtered by categories
     */
    getSignalsByCategory(entryId: string, categories: SignalCategory[]): AnyContextSignal[] {
        const signals = this.getAllSignals(entryId);
        return filterSignalsByCategory(signals, categories);
    }

    /**
     * Get signals for a specific AI task
     * This is the main method AI tasks should use
     */
    getSignalsForTask(
        entryId: string,
        taskType: AITaskType,
        includeUserContext: boolean = false
    ): AnyContextSignal[] {
        const entrySignals = this.getAllSignals(entryId);

        // Filter entry signals by task requirements (don't pass includeUserContext here
        // as user signals are stored globally, not in entry stores)
        const filteredSignals = filterSignalsForTask(entrySignals, taskType, false);

        // Add user context separately if requested (from global store)
        if (includeUserContext) {
            const userSignals = this.getUserContextSignals();
            return [...filteredSignals, ...userSignals];
        }

        return filteredSignals;
    }

    /**
     * Build a complete AITaskRequest for an AI task
     */
    buildTaskRequest(
        entryId: string,
        taskType: AITaskType,
        options?: {
            includeUserContext?: boolean;
            duration?: number;
            startTime?: number;
            endTime?: number;
            additionalOptions?: Record<string, unknown>;
        }
    ): AITaskRequest {
        const signals = this.getSignalsForTask(
            entryId,
            taskType,
            options?.includeUserContext ?? false
        );

        return {
            taskType,
            signals,
            includeUserContext: options?.includeUserContext,
            duration: options?.duration,
            startTime: options?.startTime,
            endTime: options?.endTime,
            options: options?.additionalOptions
        };
    }

    /**
     * Check if an entry has sufficient signals for a task
     */
    hasSignalsForTask(entryId: string, taskType: AITaskType): boolean {
        const signals = this.getSignalsForTask(entryId, taskType, false);
        return hasSignalData(signals);
    }

    /**
     * Get a summary of signals for an entry (for logging)
     */
    getSignalSummaryForEntry(entryId: string): Record<string, number | string> {
        const signals = this.getAllSignals(entryId);
        return getSignalSummary(signals);
    }

    /**
     * Get signals grouped by category for an entry
     */
    getGroupedSignals(entryId: string): Record<SignalCategory, AnyContextSignal[]> {
        const signals = this.getAllSignals(entryId);
        return groupSignalsByCategory(signals);
    }

    // =========================================================================
    // STORE MANAGEMENT
    // =========================================================================

    /**
     * Get or create a signal store for an entry
     */
    private getOrCreateStore(entryId: string): EntrySignalStore {
        let store = this.entryStores.get(entryId);

        if (!store) {
            store = {
                entryId,
                signals: [],
                createdAt: Date.now(),
                lastUpdated: Date.now()
            };
            this.entryStores.set(entryId, store);

            // Cleanup old entries if we exceed the limit
            this.cleanupOldEntries();
        }

        return store;
    }

    /**
     * Clear signals for an entry
     */
    clearEntry(entryId: string): void {
        this.entryStores.delete(entryId);
        console.log(`[SignalAggregator] Cleared signals for entry ${entryId}`);
    }

    /**
     * Clear all signals (useful for testing or logout)
     */
    clearAll(): void {
        this.entryStores.clear();
        this.userContext = { lastUpdated: 0 };
        console.log('[SignalAggregator] Cleared all signals');
    }

    /**
     * Cleanup old entries to prevent memory leaks
     */
    private cleanupOldEntries(): void {
        const now = Date.now();
        const entries = Array.from(this.entryStores.entries());

        // Remove entries older than MAX_SIGNAL_AGE_MS
        for (const [entryId, store] of entries) {
            if (now - store.lastUpdated > this.MAX_SIGNAL_AGE_MS) {
                this.entryStores.delete(entryId);
            }
        }

        // If still over limit, remove oldest entries
        if (this.entryStores.size > this.MAX_CACHED_ENTRIES) {
            const sortedEntries = entries
                .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);

            const toRemove = sortedEntries.slice(0, this.entryStores.size - this.MAX_CACHED_ENTRIES);
            for (const [entryId] of toRemove) {
                this.entryStores.delete(entryId);
            }
        }
    }

    /**
     * Get stats about the signal aggregator (for debugging)
     */
    getStats(): {
        entryCount: number;
        totalSignals: number;
        hasUserProfile: boolean;
        hasHistoricalPatterns: boolean;
    } {
        let totalSignals = 0;
        for (const store of this.entryStores.values()) {
            totalSignals += store.signals.length;
        }

        return {
            entryCount: this.entryStores.size,
            totalSignals,
            hasUserProfile: !!this.userContext.profile,
            hasHistoricalPatterns: !!this.userContext.patterns
        };
    }
}

// Export singleton instance
export const signalAggregator = new SignalAggregatorService();

// Re-export types and utilities for convenience
export {
    AnyContextSignal,
    SignalCategory,
    AITaskType,
    AITaskRequest,
    filterSignalsForTask,
    filterSignalsByCategory,
    groupSignalsByCategory,
    hasSignalData,
    getSignalSummary,
    getRequiredCategories
} from './contextSignals.js';
