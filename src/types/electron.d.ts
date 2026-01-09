/**
 * TypeScript declarations for Electron IPC API exposed via preload script
 */

import type { WorkAssignment, TimeBucket, LinkedJiraIssue, TimeEntry } from './shared';

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
    };
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export {};
