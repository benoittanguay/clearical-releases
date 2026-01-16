/**
 * AppDiscoveryService - macOS Application Discovery
 *
 * Discovers installed applications on macOS and extracts metadata:
 * - Bundle identifiers (e.g., com.apple.Safari)
 * - Display names
 * - Categories (from LSApplicationCategoryType)
 * - Icon paths
 *
 * Used for app blacklist feature to help users exclude specific apps
 * from activity recording.
 */

import fs from 'fs';
import path from 'path';
import plist from 'plist';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface InstalledApp {
    bundleId: string;
    name: string;
    path: string;
    category?: string;
    iconPath?: string;
}

/**
 * Common macOS app categories from LSApplicationCategoryType
 */
export const AppCategories = {
    PRODUCTIVITY: 'public.app-category.productivity',
    DEVELOPER_TOOLS: 'public.app-category.developer-tools',
    MUSIC: 'public.app-category.music',
    VIDEO: 'public.app-category.video',
    GRAPHICS_DESIGN: 'public.app-category.graphics-design',
    GAMES: 'public.app-category.games',
    SOCIAL_NETWORKING: 'public.app-category.social-networking',
    BUSINESS: 'public.app-category.business',
    FINANCE: 'public.app-category.finance',
    EDUCATION: 'public.app-category.education',
    ENTERTAINMENT: 'public.app-category.entertainment',
    LIFESTYLE: 'public.app-category.lifestyle',
    NEWS: 'public.app-category.news',
    PHOTOGRAPHY: 'public.app-category.photography',
    REFERENCE: 'public.app-category.reference',
    SPORTS: 'public.app-category.sports',
    TRAVEL: 'public.app-category.travel',
    UTILITIES: 'public.app-category.utilities',
    WEATHER: 'public.app-category.weather',
    BOOKS: 'public.app-category.books',
    MEDICAL: 'public.app-category.medical',
} as const;

export class AppDiscoveryService {
    /**
     * Get all installed applications on macOS
     */
    public static async getInstalledApps(): Promise<InstalledApp[]> {
        if (process.platform !== 'darwin') {
            console.log('[AppDiscoveryService] Not macOS, returning empty list');
            return [];
        }

        const apps: InstalledApp[] = [];

        // Method 1: Use mdfind to get all apps (most comprehensive)
        try {
            const { stdout } = await execAsync(
                'mdfind "kMDItemContentType == \'com.apple.application-bundle\'" 2>/dev/null',
                { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
            );

            const appPaths = stdout.trim().split('\n').filter(p => p.endsWith('.app'));
            console.log(`[AppDiscoveryService] mdfind found ${appPaths.length} apps`);

            // Process apps in parallel for better performance
            const batchSize = 50;
            for (let i = 0; i < appPaths.length; i += batchSize) {
                const batch = appPaths.slice(i, i + batchSize);
                const batchResults = await Promise.all(
                    batch.map(appPath => this.extractAppInfo(appPath).catch(() => null))
                );
                apps.push(...batchResults.filter((app): app is InstalledApp => app !== null));
            }
        } catch (error) {
            console.error('[AppDiscoveryService] mdfind failed, falling back to directory scan:', error);

            // Fallback: Directory scan
            const searchPaths = [
                '/Applications',
                '/System/Applications',
                '/System/Applications/Utilities',
                path.join(process.env.HOME || '', 'Applications'),
            ];

            for (const searchPath of searchPaths) {
                if (!fs.existsSync(searchPath)) {
                    continue;
                }

                try {
                    const foundApps = await this.scanDirectory(searchPath);
                    apps.push(...foundApps);
                } catch (error) {
                    console.error(`[AppDiscoveryService] Error scanning ${searchPath}:`, error);
                }
            }
        }

        // Remove duplicates based on bundle ID
        const uniqueApps = new Map<string, InstalledApp>();
        for (const app of apps) {
            if (!uniqueApps.has(app.bundleId)) {
                uniqueApps.set(app.bundleId, app);
            }
        }

        console.log(`[AppDiscoveryService] Found ${uniqueApps.size} unique apps`);

        // Sort by name
        return Array.from(uniqueApps.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Scan a directory for .app bundles
     */
    private static async scanDirectory(dirPath: string, depth: number = 0): Promise<InstalledApp[]> {
        const apps: InstalledApp[] = [];

        // Limit recursion depth to avoid scanning too deep
        if (depth > 2) {
            return apps;
        }

        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                // Check if this is an .app bundle
                if (entry.isDirectory() && entry.name.endsWith('.app')) {
                    const appInfo = await this.extractAppInfo(fullPath);
                    if (appInfo) {
                        apps.push(appInfo);
                    }
                }
                // Recursively scan subdirectories (but not .app bundles)
                else if (entry.isDirectory() && !entry.name.endsWith('.app') && depth < 2) {
                    const subApps = await this.scanDirectory(fullPath, depth + 1);
                    apps.push(...subApps);
                }
            }
        } catch (error) {
            console.error(`[AppDiscoveryService] Error reading directory ${dirPath}:`, error);
        }

        return apps;
    }

    /**
     * Extract app information from Info.plist
     */
    private static async extractAppInfo(appPath: string): Promise<InstalledApp | null> {
        const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');

        if (!fs.existsSync(infoPlistPath)) {
            console.log(`[AppDiscoveryService] No Info.plist found at ${infoPlistPath}`);
            return null;
        }

        try {
            const plistContent = await fs.promises.readFile(infoPlistPath, 'utf8');
            const plistData = plist.parse(plistContent) as any;

            const bundleId = plistData.CFBundleIdentifier;
            const name = plistData.CFBundleDisplayName || plistData.CFBundleName || path.basename(appPath, '.app');
            const category = plistData.LSApplicationCategoryType;

            if (!bundleId) {
                console.log(`[AppDiscoveryService] No bundle ID found for ${appPath}`);
                return null;
            }

            // Find icon path
            const iconPath = await this.findAppIcon(appPath, plistData);

            return {
                bundleId,
                name,
                path: appPath,
                category,
                iconPath,
            };
        } catch (error) {
            console.error(`[AppDiscoveryService] Error parsing Info.plist for ${appPath}:`, error);
            return null;
        }
    }

    /**
     * Find the app's icon file
     */
    private static async findAppIcon(appPath: string, plistData: any): Promise<string | undefined> {
        const resourcesDir = path.join(appPath, 'Contents', 'Resources');

        if (!fs.existsSync(resourcesDir)) {
            console.log(`[AppDiscoveryService] Resources directory not found for ${path.basename(appPath)}`);
            return undefined;
        }

        try {
            // Check for icon file specified in Info.plist
            const iconFile = plistData.CFBundleIconFile;
            if (iconFile) {
                let iconPath = path.join(resourcesDir, iconFile);

                // Add .icns extension if not present
                if (!iconPath.endsWith('.icns')) {
                    iconPath += '.icns';
                }

                if (fs.existsSync(iconPath)) {
                    console.log(`[AppDiscoveryService] Found icon from Info.plist for ${path.basename(appPath)}: ${iconFile}`);
                    return iconPath;
                }
            }

            // Fallback: look for common icon names
            const commonIconNames = ['AppIcon.icns', 'app.icns', 'icon.icns', 'application.icns'];
            for (const iconName of commonIconNames) {
                const iconPath = path.join(resourcesDir, iconName);
                if (fs.existsSync(iconPath)) {
                    console.log(`[AppDiscoveryService] Found icon via common name for ${path.basename(appPath)}: ${iconName}`);
                    return iconPath;
                }
            }

            // Last resort: find any .icns file
            const files = await fs.promises.readdir(resourcesDir);
            const icnsFile = files.find(f => f.toLowerCase().endsWith('.icns'));
            if (icnsFile) {
                console.log(`[AppDiscoveryService] Found icon via directory scan for ${path.basename(appPath)}: ${icnsFile}`);
                return path.join(resourcesDir, icnsFile);
            }

            console.log(`[AppDiscoveryService] No icon found for ${path.basename(appPath)}`);
        } catch (error) {
            console.error(`[AppDiscoveryService] Error finding icon for ${appPath}:`, error);
        }

        return undefined;
    }

    /**
     * Get app info by bundle ID
     */
    public static async getAppByBundleId(bundleId: string): Promise<InstalledApp | null> {
        const apps = await this.getInstalledApps();
        return apps.find(app => app.bundleId === bundleId) || null;
    }

    /**
     * Get human-readable category name
     */
    public static getCategoryName(category?: string): string {
        if (!category) {
            return 'Other';
        }

        const categoryMap: Record<string, string> = {
            'public.app-category.productivity': 'Productivity',
            'public.app-category.developer-tools': 'Developer Tools',
            'public.app-category.music': 'Music',
            'public.app-category.video': 'Video',
            'public.app-category.graphics-design': 'Graphics & Design',
            'public.app-category.games': 'Games',
            'public.app-category.social-networking': 'Social Networking',
            'public.app-category.business': 'Business',
            'public.app-category.finance': 'Finance',
            'public.app-category.education': 'Education',
            'public.app-category.entertainment': 'Entertainment',
            'public.app-category.lifestyle': 'Lifestyle',
            'public.app-category.news': 'News',
            'public.app-category.photography': 'Photography',
            'public.app-category.reference': 'Reference',
            'public.app-category.sports': 'Sports',
            'public.app-category.travel': 'Travel',
            'public.app-category.utilities': 'Utilities',
            'public.app-category.weather': 'Weather',
            'public.app-category.books': 'Books',
            'public.app-category.medical': 'Medical',
        };

        return categoryMap[category] || 'Other';
    }
}
