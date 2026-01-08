/**
 * TypeScript declarations for Electron IPC API exposed via preload script
 */

export interface ElectronAPI {
    ipcRenderer: {
        send: (channel: string, data: any) => void;
        on: (channel: string, func: (...args: any[]) => void) => () => void;
        once: (channel: string, func: (...args: any[]) => void) => void;
        invoke: (channel: string, ...args: any[]) => Promise<any>;
        captureScreenshot: () => Promise<string | null>;
        analyzeScreenshot: (imagePath: string, requestId?: string) => Promise<any>;
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
    };
}

declare global {
    interface Window {
        electron: ElectronAPI;
    }
}

export {};
