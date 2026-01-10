/**
 * Type declarations for Electron IPC API
 * Extends the Window interface with electronAPI methods
 */

import type { AppCategory, BlacklistedApp, InstalledApp } from '../components/AppBlacklistManager';

declare global {
    interface Window {
        electronAPI: {
            invoke: {
                /**
                 * Get all blacklisted apps
                 * @returns Promise resolving to array of blacklisted apps
                 */
                (channel: 'get-blacklisted-apps'): Promise<BlacklistedApp[]>;

                /**
                 * Add an app to the blacklist
                 * @param data App data to add to blacklist
                 */
                (channel: 'add-blacklisted-app', data: {
                    bundleId: string;
                    name: string;
                    category?: AppCategory;
                }): Promise<void>;

                /**
                 * Remove an app from the blacklist
                 * @param bundleId Bundle ID of the app to remove
                 */
                (channel: 'remove-blacklisted-app', bundleId: string): Promise<void>;

                /**
                 * Get all installed apps on the system
                 * @returns Promise resolving to array of installed apps
                 */
                (channel: 'get-installed-apps'): Promise<InstalledApp[]>;
            };
        };
    }
}

export {};
