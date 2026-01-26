/**
 * Context Signals for AI Tasks
 *
 * This module defines the signal-based architecture for collecting and
 * aggregating context from various sources for AI tasks.
 *
 * SIGNAL CATEGORIES:
 * - USER: Persistent user-specific context (profile, preferences, patterns)
 * - ACTIVITY: Per-entry activity context (screenshots, windows, technologies)
 * - TEMPORAL: Time-based context (calendar, time of day, work patterns)
 * - EXTERNAL: External integration context (Jira, Git, Slack)
 *
 * Each AI task specifies which categories it needs, preventing cross-contamination
 * of context between unrelated tasks.
 */

/**
 * Signal categories for organizing and filtering signals
 */
export type SignalCategory = 'user' | 'activity' | 'temporal' | 'external';

/**
 * Available signal types for context gathering
 */
export type ContextSignalType =
    // USER category - persistent user context
    | 'user_profile'           // User's role/job title for domain context
    | 'user_preferences'       // User's AI preferences and settings
    | 'historical_patterns'    // Learned patterns from user history
    // ACTIVITY category - per-entry activity context
    | 'screenshot_analysis'    // AI-analyzed screenshot descriptions
    | 'window_activity'        // App names and window titles
    | 'detected_technologies'  // Technologies detected in activities
    | 'meeting_transcription'  // Meeting recording transcriptions
    // TEMPORAL category - time-based context
    | 'calendar_events'        // Calendar context (current, recent, upcoming)
    | 'time_context'           // Time of day, day of week patterns
    // EXTERNAL category - integration context
    | 'jira_context'           // Jira issue context
    | 'git_activity'           // Git commits, branch info
    | 'browser_context'        // Browser tabs, URLs
    | 'communication'          // Slack, email context
    // Other
    | 'custom';                // Custom/user-defined signals

/**
 * Mapping of signal types to their categories
 */
export const SIGNAL_CATEGORY_MAP: Record<ContextSignalType, SignalCategory> = {
    // USER category
    'user_profile': 'user',
    'user_preferences': 'user',
    'historical_patterns': 'user',
    // ACTIVITY category
    'screenshot_analysis': 'activity',
    'window_activity': 'activity',
    'detected_technologies': 'activity',
    'meeting_transcription': 'activity',
    // TEMPORAL category
    'calendar_events': 'temporal',
    'time_context': 'temporal',
    // EXTERNAL category
    'jira_context': 'external',
    'git_activity': 'external',
    'browser_context': 'external',
    'communication': 'external',
    // Custom defaults to activity
    'custom': 'activity'
};

/**
 * Get the category for a signal type
 */
export function getSignalCategory(type: ContextSignalType): SignalCategory {
    return SIGNAL_CATEGORY_MAP[type] || 'activity';
}

/**
 * Confidence levels for signals
 */
export type SignalConfidence = 'high' | 'medium' | 'low';

/**
 * Base interface for all context signals
 */
export interface ContextSignal {
    /** Type of the signal */
    type: ContextSignalType;
    /** Category of the signal (derived from type) */
    category: SignalCategory;
    /** Source identifier (e.g., 'gemini', 'system', 'calendar') */
    source: string;
    /** Confidence level of the signal */
    confidence: SignalConfidence;
    /** Timestamp when the signal was captured */
    timestamp: number;
    /** Signal-specific data */
    data: unknown;
}

/**
 * Screenshot analysis signal (ACTIVITY category)
 */
export interface ScreenshotAnalysisSignal extends ContextSignal {
    type: 'screenshot_analysis';
    category: 'activity';
    data: {
        descriptions: string[];
        count: number;
    };
}

/**
 * Window activity signal (ACTIVITY category)
 */
export interface WindowActivitySignal extends ContextSignal {
    type: 'window_activity';
    category: 'activity';
    data: {
        appNames: string[];
        windowTitles: string[];
        /** Duration spent in each app (optional) */
        appDurations?: Record<string, number>;
    };
}

/**
 * Detected technologies signal (ACTIVITY category)
 */
export interface DetectedTechnologiesSignal extends ContextSignal {
    type: 'detected_technologies';
    category: 'activity';
    data: {
        technologies: string[];
        frameworks?: string[];
        languages?: string[];
    };
}

/**
 * Meeting transcription signal (ACTIVITY category)
 */
export interface MeetingTranscriptionSignal extends ContextSignal {
    type: 'meeting_transcription';
    category: 'activity';
    data: {
        /** Combined transcription text from all recordings */
        transcriptionText: string;
        /** Number of recording sessions */
        recordingCount: number;
        /** Total audio duration in seconds */
        totalDuration: number;
        /** Detected languages (ISO 639-1 codes) */
        languages: string[];
    };
}

/**
 * Calendar events signal (TEMPORAL category)
 */
export interface CalendarEventsSignal extends ContextSignal {
    type: 'calendar_events';
    category: 'temporal';
    data: {
        currentEvent?: string;
        recentEvents: string[];
        upcomingEvents: string[];
    };
}

/**
 * Time context signal (TEMPORAL category)
 */
export interface TimeContextSignal extends ContextSignal {
    type: 'time_context';
    category: 'temporal';
    data: {
        timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
        dayOfWeek: string;
        isWorkHours: boolean;
    };
}

/**
 * User profile signal (USER category)
 */
export interface UserProfileSignal extends ContextSignal {
    type: 'user_profile';
    category: 'user';
    data: {
        role?: string;
        domain?: string;
        company?: string;
    };
}

/**
 * User preferences signal (USER category)
 */
export interface UserPreferencesSignal extends ContextSignal {
    type: 'user_preferences';
    category: 'user';
    data: {
        preferredTerminology?: Record<string, string>;
        excludedApps?: string[];
        focusAreas?: string[];
    };
}

/**
 * Historical patterns signal (USER category)
 */
export interface HistoricalPatternsSignal extends ContextSignal {
    type: 'historical_patterns';
    category: 'user';
    data: {
        commonActivities: string[];
        frequentBuckets: Array<{ id: string; name: string; frequency: number }>;
        typicalWorkPatterns?: string[];
    };
}

/**
 * Jira context signal (EXTERNAL category)
 */
export interface JiraContextSignal extends ContextSignal {
    type: 'jira_context';
    category: 'external';
    data: {
        issueKey?: string;
        issueSummary?: string;
        issueType?: string;
        projectKey?: string;
        recentIssues?: Array<{ key: string; summary: string }>;
    };
}

/**
 * Union type of all signal types
 */
export type AnyContextSignal =
    | ScreenshotAnalysisSignal
    | WindowActivitySignal
    | DetectedTechnologiesSignal
    | MeetingTranscriptionSignal
    | CalendarEventsSignal
    | TimeContextSignal
    | UserProfileSignal
    | UserPreferencesSignal
    | HistoricalPatternsSignal
    | JiraContextSignal
    | ContextSignal; // Generic fallback

/**
 * AI Task types that can request signals
 */
export type AITaskType =
    | 'summarization'      // Generate activity description
    | 'classification'     // Classify to bucket/issue
    | 'account_selection'  // Select Tempo account
    | 'split_suggestion';  // Suggest entry splits

/**
 * Configuration for which signal categories each AI task needs
 */
export const AI_TASK_SIGNAL_REQUIREMENTS: Record<AITaskType, SignalCategory[]> = {
    'summarization': ['activity', 'temporal'],           // Activity + calendar context
    'classification': ['activity'],                       // Only activity context
    'account_selection': ['activity', 'external'],        // Activity + Jira context
    'split_suggestion': ['activity', 'temporal']          // Activity + time patterns
};

/**
 * Get required signal categories for an AI task
 */
export function getRequiredCategories(task: AITaskType): SignalCategory[] {
    return AI_TASK_SIGNAL_REQUIREMENTS[task] || ['activity'];
}

/**
 * Request structure for AI tasks with category filtering
 */
export interface AITaskRequest {
    /** Type of AI task */
    taskType: AITaskType;
    /** Array of context signals (will be filtered by task requirements) */
    signals: AnyContextSignal[];
    /** Optional: Include user context even if not required (e.g., for terminology) */
    includeUserContext?: boolean;
    /** Activity duration in milliseconds */
    duration?: number;
    /** Activity start time */
    startTime?: number;
    /** Activity end time */
    endTime?: number;
    /** Additional task-specific options */
    options?: Record<string, unknown>;
}

/**
 * Legacy request structure for backwards compatibility
 * @deprecated Use AITaskRequest instead
 */
export interface SummarizeRequest {
    signals: AnyContextSignal[];
    duration?: number;
    startTime?: number;
    endTime?: number;
}

// =============================================================================
// SIGNAL CREATION HELPERS
// =============================================================================

/**
 * Helper function to create a screenshot analysis signal
 */
export function createScreenshotSignal(descriptions: string[]): ScreenshotAnalysisSignal {
    return {
        type: 'screenshot_analysis',
        category: 'activity',
        source: 'gemini',
        confidence: 'high',
        timestamp: Date.now(),
        data: {
            descriptions,
            count: descriptions.length
        }
    };
}

/**
 * Helper function to create a window activity signal
 */
export function createWindowActivitySignal(
    appNames: string[],
    windowTitles: string[],
    appDurations?: Record<string, number>
): WindowActivitySignal {
    return {
        type: 'window_activity',
        category: 'activity',
        source: 'system',
        confidence: 'high',
        timestamp: Date.now(),
        data: {
            appNames: [...new Set(appNames)],
            windowTitles: [...new Set(windowTitles)].filter(t => t && t !== '(No window title available)'),
            appDurations
        }
    };
}

/**
 * Helper function to create a detected technologies signal
 */
export function createTechnologiesSignal(
    technologies: string[],
    frameworks?: string[],
    languages?: string[]
): DetectedTechnologiesSignal {
    return {
        type: 'detected_technologies',
        category: 'activity',
        source: 'analysis',
        confidence: 'medium',
        timestamp: Date.now(),
        data: {
            technologies: [...new Set(technologies)],
            frameworks: frameworks ? [...new Set(frameworks)] : undefined,
            languages: languages ? [...new Set(languages)] : undefined
        }
    };
}

/**
 * Helper function to create a meeting transcription signal
 */
export function createMeetingTranscriptionSignal(
    transcriptionText: string,
    recordingCount: number,
    totalDuration: number,
    languages: string[]
): MeetingTranscriptionSignal {
    return {
        type: 'meeting_transcription',
        category: 'activity',
        source: 'audio_recording',
        confidence: 'high',
        timestamp: Date.now(),
        data: {
            transcriptionText,
            recordingCount,
            totalDuration,
            languages: [...new Set(languages)]
        }
    };
}

/**
 * Helper function to create a calendar events signal
 */
export function createCalendarSignal(
    currentEvent?: string,
    recentEvents: string[] = [],
    upcomingEvents: string[] = []
): CalendarEventsSignal {
    return {
        type: 'calendar_events',
        category: 'temporal',
        source: 'calendar',
        confidence: currentEvent ? 'high' : 'medium',
        timestamp: Date.now(),
        data: {
            currentEvent,
            recentEvents,
            upcomingEvents
        }
    };
}

/**
 * Helper function to create a time context signal
 */
export function createTimeContextSignal(timestamp: number): TimeContextSignal {
    const date = new Date(timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });

    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
    else timeOfDay = 'night';

    const isWeekday = date.getDay() >= 1 && date.getDay() <= 5;
    const isWorkHours = isWeekday && hour >= 9 && hour < 18;

    return {
        type: 'time_context',
        category: 'temporal',
        source: 'system',
        confidence: 'high',
        timestamp: Date.now(),
        data: {
            timeOfDay,
            dayOfWeek,
            isWorkHours
        }
    };
}

/**
 * Helper function to create a user profile signal
 */
export function createUserProfileSignal(
    role?: string,
    domain?: string,
    company?: string
): UserProfileSignal {
    return {
        type: 'user_profile',
        category: 'user',
        source: 'settings',
        confidence: 'medium',
        timestamp: Date.now(),
        data: {
            role,
            domain,
            company
        }
    };
}

/**
 * Helper function to create a historical patterns signal
 */
export function createHistoricalPatternsSignal(
    commonActivities: string[],
    frequentBuckets: Array<{ id: string; name: string; frequency: number }>
): HistoricalPatternsSignal {
    return {
        type: 'historical_patterns',
        category: 'user',
        source: 'history',
        confidence: 'medium',
        timestamp: Date.now(),
        data: {
            commonActivities,
            frequentBuckets
        }
    };
}

/**
 * Helper function to create a Jira context signal
 */
export function createJiraContextSignal(
    issueKey?: string,
    issueSummary?: string,
    issueType?: string,
    projectKey?: string
): JiraContextSignal {
    return {
        type: 'jira_context',
        category: 'external',
        source: 'jira',
        confidence: issueKey ? 'high' : 'low',
        timestamp: Date.now(),
        data: {
            issueKey,
            issueSummary,
            issueType,
            projectKey
        }
    };
}

// =============================================================================
// SIGNAL FILTERING UTILITIES
// =============================================================================

/**
 * Filter signals by category
 */
export function filterSignalsByCategory(
    signals: AnyContextSignal[],
    categories: SignalCategory[]
): AnyContextSignal[] {
    return signals.filter(signal => categories.includes(signal.category));
}

/**
 * Filter signals for a specific AI task
 */
export function filterSignalsForTask(
    signals: AnyContextSignal[],
    taskType: AITaskType,
    includeUserContext: boolean = false
): AnyContextSignal[] {
    // Create a copy to avoid mutating the global AI_TASK_SIGNAL_REQUIREMENTS
    const requiredCategories = [...getRequiredCategories(taskType)];

    // Optionally include user context for terminology/personalization
    if (includeUserContext && !requiredCategories.includes('user')) {
        requiredCategories.push('user');
    }

    return filterSignalsByCategory(signals, requiredCategories);
}

/**
 * Group signals by category
 */
export function groupSignalsByCategory(
    signals: AnyContextSignal[]
): Record<SignalCategory, AnyContextSignal[]> {
    const grouped: Record<SignalCategory, AnyContextSignal[]> = {
        user: [],
        activity: [],
        temporal: [],
        external: []
    };

    for (const signal of signals) {
        grouped[signal.category].push(signal);
    }

    return grouped;
}

/**
 * Utility to check if signals contain meaningful data
 */
export function hasSignalData(signals: AnyContextSignal[]): boolean {
    return signals.some(signal => {
        switch (signal.type) {
            case 'screenshot_analysis':
                return (signal.data as ScreenshotAnalysisSignal['data']).descriptions.length > 0;
            case 'window_activity':
                const wa = signal.data as WindowActivitySignal['data'];
                return wa.appNames.length > 0 || wa.windowTitles.length > 0;
            case 'calendar_events':
                const ce = signal.data as CalendarEventsSignal['data'];
                return !!ce.currentEvent || ce.recentEvents.length > 0;
            case 'user_profile':
                const up = signal.data as UserProfileSignal['data'];
                return !!up.role || !!up.domain;
            case 'jira_context':
                const jc = signal.data as JiraContextSignal['data'];
                return !!jc.issueKey;
            case 'meeting_transcription':
                const mt = signal.data as MeetingTranscriptionSignal['data'];
                return mt.transcriptionText.length > 0;
            default:
                return signal.data !== null && signal.data !== undefined;
        }
    });
}

/**
 * Check if signals have data for specific categories
 */
export function hasSignalDataForCategories(
    signals: AnyContextSignal[],
    categories: SignalCategory[]
): boolean {
    const filtered = filterSignalsByCategory(signals, categories);
    return hasSignalData(filtered);
}

/**
 * Utility to get a summary of available signals for logging
 */
export function getSignalSummary(signals: AnyContextSignal[]): Record<string, number | string> {
    const summary: Record<string, number | string> = {};
    const grouped = groupSignalsByCategory(signals);

    // Add category counts
    for (const [category, categorySignals] of Object.entries(grouped)) {
        if (categorySignals.length > 0) {
            summary[`${category}_signals`] = categorySignals.length;
        }
    }

    // Add detailed signal info
    for (const signal of signals) {
        switch (signal.type) {
            case 'screenshot_analysis':
                summary['screenshots'] = (signal.data as ScreenshotAnalysisSignal['data']).descriptions.length;
                break;
            case 'window_activity':
                const wa = signal.data as WindowActivitySignal['data'];
                summary['apps'] = wa.appNames.length;
                summary['windows'] = wa.windowTitles.length;
                break;
            case 'calendar_events':
                const ce = signal.data as CalendarEventsSignal['data'];
                summary['calendar'] = ce.currentEvent ? 'active' : `${ce.recentEvents.length} recent`;
                break;
            case 'user_profile':
                const up = signal.data as UserProfileSignal['data'];
                if (up.role) summary['role'] = up.role;
                break;
            case 'jira_context':
                const jc = signal.data as JiraContextSignal['data'];
                if (jc.issueKey) summary['jira'] = jc.issueKey;
                break;
            case 'meeting_transcription':
                const mt = signal.data as MeetingTranscriptionSignal['data'];
                summary['transcriptions'] = mt.recordingCount;
                summary['transcription_duration'] = `${Math.round(mt.totalDuration)}s`;
                break;
        }
    }

    return summary;
}
