/**
 * TypeScript declarations for Electron IPC API exposed via preload script
 */

import type { WorkAssignment, TimeBucket, LinkedJiraIssue, TimeEntry } from './shared';
import type { JiraIssue } from '../services/jiraService';

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

export interface ElectronAPI {
    ipcRenderer: {
        send: (channel: string, data: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => () => void;
        once: (channel: string, func: (...args: any[]) => void) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        captureScreenshot: () => Promise<string | null>;
        analyzeScreenshot: (imagePath: string, requestId?: string) => Promise<ScreenshotAnalysisResult>;
        generateActivitySummary: (context: {
            screenshotDescriptions: string[];
            windowTitles: string[];
            appNames: string[];
            duration: number;
            startTime: number;
            endTime: number;
        }) => Promise<{
            success: boolean;
            summary?: string;
            metadata?: {
                technologies?: string[];
                activities?: string[];
            };
            error?: string;
        }>;
        getActiveWindow: () => Promise<{ appName: string; windowTitle: string }>;
        checkAccessibilityPermission: () => Promise<string>;
        getAppIcon: (appName: string) => Promise<string | null>;
        getScreenshot: (filePath: string) => Promise<string | null>;
        showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
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
    };
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export {};
