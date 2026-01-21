/**
 * TypeScript declarations for Electron IPC API exposed via preload script
 */

import type { WorkAssignment, TimeBucket, LinkedJiraIssue, TimeEntry } from './shared';
import type { JiraIssue } from '../services/jiraService';
import type { TempoAccount } from '../services/tempoService';

// Structured screenshot analysis types
export interface ExtractedText {
    filenames: string[];
    code: string[];
    urls: string[];
    commands: string[];
    uiLabels: string[];
    documentText: string[];
    errors: string[];
    projectIdentifiers: string[];
}

export interface VisualContext {
    application: string;
    applicationMode?: string;
    layout?: string;
    activeTab?: string;
    sidebar?: string;
    visiblePanels: string[];
}

export interface FileContext {
    filename?: string;
    path?: string;
    language?: string;
    extension?: string;
}

export interface ProjectContext {
    projectName?: string;
    directoryStructure: string[];
    branchName?: string;
    issueReferences: string[];
    featureName?: string;
    configFiles: string[];
}

export interface StructuredExtraction {
    extractedText: ExtractedText;
    visualContext: VisualContext;
    fileContext?: FileContext;
    projectContext: ProjectContext;
    detectedTechnologies: string[];
    detectedActivities: string[];
}

export interface ScreenshotAnalysisResult {
    success: boolean;
    description?: string;
    confidence?: number;
    error?: string;
    detectedText?: string[];
    objects?: string[];
    extraction?: StructuredExtraction;
    requestId?: string;
}

export interface SplitSuggestion {
    startTime: number;
    endTime: number;
    description: string;
    suggestedBucket: string | null;
    suggestedJiraKey: string | null;
    confidence: number;
}

export interface ActivityDataForSplitting {
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
    screenshots: Array<{ timestamp: number; description: string }>;
}

export interface UpdateStatus {
    available: boolean;
    downloaded: boolean;
    downloading: boolean;
    version?: string;
    releaseDate?: string;
    releaseNotes?: string;
    error?: string;
    downloadProgress?: {
        percent: number;
        transferred: number;
        total: number;
    };
}

export interface BlacklistedApp {
    bundleId: string;
    name: string;
    category?: string;
}

export interface BlacklistedTempoAccount {
    accountKey: string;
    accountId: string;
    name: string;
}

export interface InstalledApp {
    bundleId: string;
    name: string;
    path: string;
    category?: string;
    categoryName?: string;
    iconPath?: string;
}

export interface ElectronAPI {
    ipcRenderer: {
        send: (channel: string, data: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => () => void;
        once: (channel: string, func: (...args: any[]) => void) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        // OAuth authentication
        signInWithOAuth: (provider: 'google' | 'azure' | 'apple') => Promise<{
            success: boolean;
            user?: {
                id: string;
                email: string;
                stripeCustomerId?: string;
                createdAt: string;
                lastSignIn?: string;
            };
            error?: string;
        }>;
        captureScreenshot: () => Promise<string | null>;
        analyzeScreenshot: (imagePath: string, requestId?: string) => Promise<ScreenshotAnalysisResult>;
        generateActivitySummary: (context: {
            entryId: string;
            screenshotDescriptions: string[];
            windowTitles: string[];
            appNames: string[];
            appDurations?: Record<string, number>;
            duration: number;
            startTime: number;
            endTime: number;
            userRole?: string;
        }) => Promise<{
            success: boolean;
            summary?: string;
            metadata?: {
                technologies?: string[];
                activities?: string[];
            };
            error?: string;
        }>;
        analyzeSplits: (activityData: ActivityDataForSplitting) => Promise<{
            success: boolean;
            suggestions: SplitSuggestion[];
            error?: string;
        }>;
        getActiveWindow: () => Promise<{ appName: string; windowTitle: string; bundleId: string }>;
        getEnvironmentInfo: () => Promise<{ isDevelopment: boolean; buildEnv: string; isPackaged: boolean; version: string }>;
        checkAccessibilityPermission: () => Promise<string>;
        checkScreenPermission: () => Promise<string>;
        requestScreenPermission: () => Promise<string>;
        openScreenPermissionSettings: () => Promise<void>;
        openAccessibilitySettings: () => Promise<void>;
        getAppIcon: (appName: string) => Promise<string | null>;
        getScreenshot: (filePath: string) => Promise<string | null>;
        showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
        tempoApiRequest: (requestParams: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: any;
        }) => Promise<any>;
        jiraApiRequest: (requestParams: {
            url: string;
            method?: string;
            headers?: Record<string, string>;
            body?: any;
        }) => Promise<any>;
        // Secure credential storage
        secureStoreCredential: (key: string, value: string) => Promise<{
            success: boolean;
            error?: string;
        }>;
        secureGetCredential: (key: string) => Promise<{
            success: boolean;
            value: string | null;
            error?: string;
        }>;
        secureDeleteCredential: (key: string) => Promise<{
            success: boolean;
            error?: string;
        }>;
        secureHasCredential: (key: string) => Promise<{
            success: boolean;
            exists: boolean;
            error?: string;
        }>;
        secureListCredentials: () => Promise<{
            success: boolean;
            keys: string[];
            error?: string;
        }>;
        secureIsAvailable: () => Promise<{
            success: boolean;
            available: boolean;
            error?: string;
        }>;
        // AI features
        suggestAssignment: (request: {
            context: {
                description: string;
                appNames: string[];
                windowTitles: string[];
                detectedTechnologies: string[];
                detectedActivities: string[];
                duration: number;
                startTime: number;
                // Calendar context fields
                currentCalendarEvent: string | null;
                recentCalendarEvents: string[];
                upcomingCalendarEvents: string[];
            };
            buckets: TimeBucket[];
            jiraIssues: LinkedJiraIssue[];
            historicalEntries: TimeEntry[];
        }) => Promise<{
            success: boolean;
            suggestion?: {
                assignment: WorkAssignment | null;
                confidence: number;
                reason: string;
                alternatives?: Array<{
                    assignment: WorkAssignment;
                    confidence: number;
                    reason: string;
                }>;
            };
            error?: string;
        }>;
        selectTempoAccount: (request: {
            issue: LinkedJiraIssue;
            accounts: Array<{
                id: string;
                key: string;
                name: string;
                status: string;
                global: boolean;
            }>;
            description: string;
            historicalAccounts: Array<{
                issueKey: string;
                accountKey: string;
            }>;
            historicalEntries?: TimeEntry[];  // NEW: Full entries for enhanced learning
        }) => Promise<{
            success: boolean;
            selection?: {
                account: {
                    id: string;
                    key: string;
                    name: string;
                };
                confidence: number;
                reason: string;
                alternatives?: Array<{
                    account: {
                        id: string;
                        key: string;
                        name: string;
                    };
                    confidence: number;
                    reason: string;
                }>;
            };
            error?: string;
        }>;
        // Auto-updater
        updater: {
            checkForUpdates: () => Promise<{
                success: boolean;
                status?: UpdateStatus;
                error?: string;
            }>;
            getStatus: () => Promise<{
                success: boolean;
                status?: UpdateStatus;
                error?: string;
            }>;
            downloadUpdate: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            quitAndInstall: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            configure: (options: {
                checkOnStartup?: boolean;
                checkOnStartupDelay?: number;
                autoDownload?: boolean;
                allowPrerelease?: boolean;
            }) => Promise<{
                success: boolean;
                error?: string;
            }>;
            onStatusUpdate: (callback: (status: UpdateStatus) => void) => (() => void) | undefined;
        };
        // Database operations
        db: {
            // Entries
            getAllEntries: () => Promise<{ success: boolean; data: TimeEntry[]; error?: string }>;
            getEntry: (id: string) => Promise<{ success: boolean; data: TimeEntry | null; error?: string }>;
            insertEntry: (entry: TimeEntry) => Promise<{ success: boolean; error?: string }>;
            updateEntry: (id: string, updates: Partial<TimeEntry>) => Promise<{ success: boolean; error?: string }>;
            deleteEntry: (id: string) => Promise<{ success: boolean; error?: string }>;
            deleteAllEntries: () => Promise<{ success: boolean; error?: string }>;
            // Buckets
            getAllBuckets: () => Promise<{ success: boolean; data: TimeBucket[]; error?: string }>;
            insertBucket: (bucket: TimeBucket) => Promise<{ success: boolean; error?: string }>;
            updateBucket: (id: string, updates: Partial<TimeBucket>) => Promise<{ success: boolean; error?: string }>;
            deleteBucket: (id: string) => Promise<{ success: boolean; error?: string }>;
            // Settings
            getSetting: (key: string) => Promise<{ success: boolean; data: any; error?: string }>;
            setSetting: (key: string, value: any) => Promise<{ success: boolean; error?: string }>;
            deleteSetting: (key: string) => Promise<{ success: boolean; error?: string }>;
            getAllSettings: () => Promise<{ success: boolean; data: Record<string, any>; error?: string }>;
            // Jira Issues Cache
            getAllJiraIssues: () => Promise<{ success: boolean; data: JiraIssue[]; error?: string }>;
            getJiraIssuesByProject: (projectKey: string) => Promise<{ success: boolean; data: JiraIssue[]; error?: string }>;
            getJiraIssue: (key: string) => Promise<{ success: boolean; data: JiraIssue | null; error?: string }>;
            upsertJiraIssue: (issue: JiraIssue) => Promise<{ success: boolean; error?: string }>;
            clearJiraCache: () => Promise<{ success: boolean; error?: string }>;
            // Jira Cache Metadata
            getJiraCacheMeta: (key: string) => Promise<{ success: boolean; data: any; error?: string }>;
            setJiraCacheMeta: (key: string, data: any, query?: string) => Promise<{ success: boolean; error?: string }>;
            // Tempo Cache Metadata
            getTempoCacheMeta: (key: string) => Promise<{ success: boolean; data: any; error?: string }>;
            setTempoCacheMeta: (key: string, data: any, query?: string) => Promise<{ success: boolean; error?: string }>;
            // Tempo Accounts Cache
            getAllTempoAccounts: () => Promise<{ success: boolean; data: TempoAccount[]; error?: string }>;
            getTempoAccountsByStatus: (status: string) => Promise<{ success: boolean; data: TempoAccount[]; error?: string }>;
            upsertTempoAccount: (account: TempoAccount) => Promise<{ success: boolean; error?: string }>;
            clearTempoCache: () => Promise<{ success: boolean; error?: string }>;
            // Crawler State
            getCrawlerState: (projectKey: string) => Promise<{ success: boolean; data: any; error?: string }>;
            setCrawlerState: (projectKey: string, state: any) => Promise<{ success: boolean; error?: string }>;
            clearCrawlerState: () => Promise<{ success: boolean; error?: string }>;
            // Database Stats
            getStats: () => Promise<{ success: boolean; data: any; error?: string }>;
            // Migration
            needsMigration: () => Promise<{ success: boolean; needsMigration: boolean; error?: string }>;
            migrateFromLocalStorage: (localStorageData: Record<string, string>) => Promise<{ success: boolean; result: any; error?: string }>;
        };
        // App Blacklist operations
        appBlacklist: {
            getBlacklistedApps: () => Promise<{ success: boolean; data: BlacklistedApp[]; error?: string }>;
            addBlacklistedApp: (bundleId: string, name: string, category?: string) => Promise<{ success: boolean; error?: string }>;
            removeBlacklistedApp: (bundleId: string) => Promise<{ success: boolean; error?: string }>;
            isAppBlacklisted: (bundleId: string) => Promise<{ success: boolean; isBlacklisted: boolean; error?: string }>;
            getInstalledApps: () => Promise<{ success: boolean; data: InstalledApp[]; error?: string }>;
            getAppIconBase64: (iconPath: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
        };
        // Tempo Account Blacklist operations
        tempoAccountBlacklist: {
            getBlacklistedAccounts: () => Promise<{ success: boolean; data: BlacklistedTempoAccount[]; error?: string }>;
            addBlacklistedAccount: (accountKey: string, accountId: string, name: string) => Promise<{ success: boolean; error?: string }>;
            removeBlacklistedAccount: (accountKey: string) => Promise<{ success: boolean; error?: string }>;
            isAccountBlacklisted: (accountKey: string) => Promise<{ success: boolean; isBlacklisted: boolean; error?: string }>;
        };
        // Calendar operations
        calendar: {
            connect: () => Promise<{ success: boolean; error?: string }>;
            disconnect: () => Promise<{ success: boolean; error?: string }>;
            isConnected: () => Promise<{ success: boolean; connected: boolean; error?: string }>;
            getAccount: () => Promise<{ success: boolean; email: string | null; provider: string | null; error?: string }>;
            sync: () => Promise<{ success: boolean; error?: string }>;
            getContext: (timestamp: number) => Promise<{
                success: boolean;
                currentEvent: string | null;
                recentEvents: string[];
                upcomingEvents: string[];
                error?: string;
            }>;
            createFocusTime: (input: {
                title: string;
                description: string;
                startTime: number;
                endTime: number;
            }) => Promise<{ success: boolean; eventId: string | null; error?: string }>;
        };
        // Meeting/Recording operations (mic/camera detection)
        meeting: {
            setActiveEntry: (entryId: string | null) => Promise<{ success: boolean; error?: string }>;
            getMediaStatus: () => Promise<{ success: boolean; micInUse: boolean; cameraInUse: boolean; error?: string }>;
            getRecordingStatus: () => Promise<{ success: boolean; isRecording: boolean; entryId: string | null; platform: string | null; error?: string }>;
            setAutoRecordEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
            // Audio capture and transcription
            saveAudioAndTranscribe: (entryId: string, audioBase64: string, mimeType?: string) => Promise<{
                success: boolean;
                transcription?: {
                    transcriptionId: string;
                    fullText: string;
                    segments: Array<{
                        id: number;
                        start: number;
                        end: number;
                        text: string;
                    }>;
                    language: string;
                    duration: number;
                    wordCount: number;
                };
                usage?: {
                    durationSeconds: number;
                    monthlyUsedSeconds: number;
                    monthlyLimitSeconds: number;
                    remainingSeconds: number;
                };
                error?: string;
            }>;
            getTranscriptionUsage: () => Promise<{
                success: boolean;
                usage?: {
                    monthlyUsedSeconds: number;
                    monthlyLimitSeconds: number;
                    remainingSeconds: number;
                    isPremium: boolean;
                };
                error?: string;
            }>;
            // Event subscriptions for automatic recording
            onRecordingShouldStart: (callback: (data: { entryId: string; timestamp: number }) => void) => (() => void) | undefined;
            onRecordingShouldStop: (callback: (data: { entryId: string; duration: number }) => void) => (() => void) | undefined;
        };
    };
    // Analytics (top-level, not inside ipcRenderer)
    analytics: {
        sendEvents: (events: { event_name: string; properties?: Record<string, unknown> }[], sessionId: string) => Promise<{ success: boolean; error?: string }>;
        getEnabled: () => Promise<{ success: boolean; enabled: boolean; error?: string }>;
        setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    };
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export {};
