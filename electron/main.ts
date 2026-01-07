import { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain, systemPreferences, shell, desktopCapturer, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null;
let tray: Tray | null;

// Ensure screenshots directory exists
const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

ipcMain.handle('capture-screenshot', async () => {
    console.log('[Main] capture-screenshot requested');

    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen');
        console.log('[Main] Current Screen Access Status:', status);
    }

    try {
        // Get current active window info first
        let currentWindow = null;
        try {
            // Get the active window using our existing handler
            if (process.platform === 'darwin') {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);

                // Get active app name and window title
                const appResult = await execAsync(
                    `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
                );
                const appName = appResult.stdout.trim();

                let windowTitle = '';
                try {
                    const titleResult = await execAsync(
                        `osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`
                    );
                    windowTitle = titleResult.stdout.trim();
                } catch (e) {
                    windowTitle = '(No window title available)';
                }

                currentWindow = { appName, windowTitle };
                console.log('[Main] capture-screenshot - Active window:', currentWindow);
            }
        } catch (error) {
            console.log('[Main] Could not get active window info for screenshot:', error);
        }

        // Get all window sources
        const sources = await desktopCapturer.getSources({ 
            types: ['window'], 
            thumbnailSize: { width: 1920, height: 1080 },
            fetchWindowIcons: true 
        });
        console.log('[Main] Window sources found:', sources.length);

        // Log all available windows for debugging
        console.log('[Main] Available windows:');
        sources.forEach((source, index) => {
            const size = source.thumbnail.getSize();
            console.log(`[Main] ${index}: "${source.name}" (${size.width}x${size.height})`);
        });

        // Filter out the TimePortal app window itself and very small windows
        const validSources = sources.filter(source => {
            const lowerName = source.name.toLowerCase();
            const size = source.thumbnail.getSize();
            
            // Only filter out the actual TimePortal app window (exact match)
            if (lowerName === 'time-portal' || lowerName === 'timeportal') {
                console.log('[Main] Filtering out TimePortal app window:', source.name);
                return false;
            }
            
            // Filter out very small windows (likely toolbar or menu items)
            if (size.width < 200 || size.height < 100) {
                console.log('[Main] Filtering out small window:', source.name, `(${size.width}x${size.height})`);
                return false;
            }
            
            // Filter out empty or unnamed windows
            if (!source.name || source.name.trim() === '') {
                console.log('[Main] Filtering out unnamed window');
                return false;
            }
            
            // Log which windows pass the filter
            console.log('[Main] Window passed filtering:', source.name, `(${size.width}x${size.height})`);
            return true;
        });

        console.log('[Main] Valid window sources after filtering:', validSources.length);
        if (validSources.length > 0) {
            console.log('[Main] Valid windows:');
            validSources.forEach((source, index) => {
                const size = source.thumbnail.getSize();
                console.log(`[Main] ${index}: "${source.name}" (${size.width}x${size.height})`);
            });
        }

        if (validSources.length > 0) {
            // Try to find the window that matches the active window
            let targetSource = null;
            
            if (currentWindow && currentWindow.appName && currentWindow.windowTitle) {
                console.log('[Main] Looking for window match - App:', currentWindow.appName, 'Title:', currentWindow.windowTitle);
                
                // Strategy 1: Exact window title match
                const exactTitleMatch = validSources.find(source => 
                    source.name === currentWindow.windowTitle
                );
                
                if (exactTitleMatch) {
                    targetSource = exactTitleMatch;
                    console.log('[Main] Found exact window title match:', targetSource.name);
                } else {
                    // Strategy 2: Match windows that contain the app name
                    const appNameMatches = validSources.filter(source => {
                        const sourceLower = source.name.toLowerCase();
                        const appNameLower = currentWindow.appName.toLowerCase();
                        
                        // Check if the window name contains the app name or vice versa
                        return sourceLower.includes(appNameLower) || appNameLower.includes(sourceLower);
                    });
                    
                    if (appNameMatches.length > 0) {
                        // If multiple matches, prefer the one with the window title
                        const titleMatch = appNameMatches.find(source => 
                            source.name.includes(currentWindow.windowTitle) || 
                            currentWindow.windowTitle.includes(source.name)
                        );
                        
                        targetSource = titleMatch || appNameMatches[0];
                        console.log('[Main] Found app name match:', targetSource.name, 'from', appNameMatches.length, 'candidates');
                    } else {
                        // Strategy 3: Partial title matching
                        const partialMatch = validSources.find(source => 
                            source.name.includes(currentWindow.windowTitle) || 
                            currentWindow.windowTitle.includes(source.name)
                        );
                        
                        if (partialMatch) {
                            targetSource = partialMatch;
                            console.log('[Main] Found partial window title match:', partialMatch.name);
                        } else {
                            console.log('[Main] No window match found. App:', currentWindow.appName, 'Title:', currentWindow.windowTitle);
                            console.log('[Main] Available windows:', validSources.map(s => s.name));
                        }
                    }
                }
            } else {
                console.log('[Main] No active window info available');
            }
            
            // If we still don't have a target, we could either skip or fallback to screen capture
            if (!targetSource) {
                console.log('[Main] No matching window found for app:', currentWindow?.appName || 'unknown');
                console.log('[Main] Available windows:', validSources.map(s => `"${s.name}"`).join(', '));
                
                // For now, return null to skip capturing unmatched windows
                // This prevents capturing random windows when we can't match properly
                return null;
            }
            
            console.log('[Main] Capturing window:', targetSource.name, 
                       `(${targetSource.thumbnail.getSize().width}x${targetSource.thumbnail.getSize().height})`);
            
            const image = targetSource.thumbnail.toPNG();
            
            // Create a more descriptive filename with app name and timestamp
            const timestamp = Date.now();
            const appNameSafe = (currentWindow?.appName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
            const windowTitleSafe = targetSource.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const filename = `${timestamp}_${appNameSafe}_${windowTitleSafe}.png`;
            const filePath = path.join(SCREENSHOTS_DIR, filename);

            await fs.promises.writeFile(filePath, image);
            console.log('[Main] Window screenshot saved:', filePath);
            return filePath;
        } else {
            console.log('[Main] No valid window sources found for screenshot');
            
            // Fallback to screen capture if no windows available
            const screenSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
            if (screenSources.length > 0) {
                console.log('[Main] Falling back to screen capture');
                const image = screenSources[0].thumbnail.toPNG();
                
                // Use same naming convention for fallback
                const timestamp = Date.now();
                const appNameSafe = (currentWindow?.appName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
                const filename = `${timestamp}_${appNameSafe}_SCREEN_FALLBACK.png`;
                const filePath = path.join(SCREENSHOTS_DIR, filename);

                await fs.promises.writeFile(filePath, image);
                console.log('[Main] Screen screenshot saved (fallback):', filePath);
                return filePath;
            }
        }
    } catch (error) {
        console.error('[Main] Failed to capture screenshot:', error);
    }
    return null;
});

// Permission Handlers
ipcMain.handle('check-screen-permission', async () => {
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen');
        console.log('[Main] check-screen-permission status:', status);

        if (status === 'not-determined') {
            console.log('[Main] Status not determined, triggering prompt via getSources...');
            try {
                // This triggers the macOS permission prompt
                await desktopCapturer.getSources({ types: ['screen'] });
            } catch (e) {
                console.warn('[Main] Trigger prompt catch (expected if denied/cancelled):', e);
            }
        }
        return status;
    }
    return 'granted';
});

ipcMain.handle('open-screen-permission-settings', async () => {
    console.log('[Main] open-screen-permission-settings requested');
    if (process.platform === 'darwin') {
        const paths = [
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture', // Old
            'x-apple.systempreferences:com.apple.ScreenRecording-Settings.extension', // Newer
            'x-apple.systempreferences:com.apple.SystemSettings.PrivacySecurity.extension?Privacy_ScreenCapture', // Ventura+
        ];

        for (const p of paths) {
            try {
                console.log(`[Main] Trying to open: ${p}`);
                await shell.openExternal(p);
                return; // Success
            } catch (e) {
                console.warn(`[Main] Failed to open ${p}`, e);
            }
        }

        // Final fallback: just open System Settings app
        try {
            await shell.openExternal('x-apple.systempreferences:');
        } catch (e) {
            console.error('[Main] All attempts to open settings failed.', e);
        }
    }
});

ipcMain.on('hide-window', () => {
    toggleWindow();
});

ipcMain.on('ping', () => {
    console.log('[Main] Received ping from renderer - IPC is working');
});

// Active Window Tracking
ipcMain.handle('get-active-window', async () => {
    if (process.platform === 'darwin') {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Get active app name
            const appResult = await execAsync(
                `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
            );
            const appName = appResult.stdout.trim();

            // Get window title (may fail for some apps)
            let windowTitle = '';
            try {
                const titleResult = await execAsync(
                    `osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`
                );
                windowTitle = titleResult.stdout.trim();
            } catch (e) {
                windowTitle = '(No window title available)';
            }

            console.log('[Main] get-active-window result:', { appName, windowTitle });
            return { appName, windowTitle };
        } catch (error) {
            console.error('[Main] Failed to get active window:', error);
            return { appName: 'Unknown', windowTitle: 'Unknown' };
        }
    }
    return { appName: 'Not supported', windowTitle: 'Not supported' };
});

ipcMain.handle('check-accessibility-permission', () => {
    if (process.platform === 'darwin') {
        // Note: Accessibility permission cannot be checked programmatically
        // We return 'unknown' and rely on the AppleScript calls to trigger the prompt
        return 'unknown';
    }
    return 'granted';
});

// App Icon Cache
const appIconCache = new Map<string, string>();

// Robust app path detection using macOS system APIs
const findAppPaths = async (appName: string, execAsync: any): Promise<string[]> => {
    const foundPaths: string[] = [];
    
    try {
        // Method 1: Use mdfind to search for apps by display name
        const mdfindCmd = `mdfind "kMDItemDisplayName == '${appName.replace(/'/g, "\\'")}'c && kMDItemContentType == 'com.apple.application-bundle'"`;
        const mdfindResult = await execAsync(mdfindCmd, { timeout: 3000 }).catch(() => ({ stdout: '' }));
        
        if (mdfindResult.stdout.trim()) {
            const paths = mdfindResult.stdout.trim().split('\n').filter((p: string) => p.endsWith('.app'));
            foundPaths.push(...paths);
        }
    } catch (error) {
        console.log(`[Main] get-app-icon: mdfind failed for ${appName}:`, error);
    }
    
    try {
        // Method 2: Use mdfind to search by bundle name variations
        const variations = [
            appName,
            appName.replace(/\s+/g, ''),
            appName.replace(/\s+/g, '-'),
            appName.replace(/\s+/g, '_'),
        ];
        
        for (const variation of variations) {
            const bundleCmd = `mdfind "kMDItemCFBundleName == '${variation.replace(/'/g, "\\'")}'c && kMDItemContentType == 'com.apple.application-bundle'"`;
            const bundleResult = await execAsync(bundleCmd, { timeout: 2000 }).catch(() => ({ stdout: '' }));
            
            if (bundleResult.stdout.trim()) {
                const paths = bundleResult.stdout.trim().split('\n').filter((p: string) => p.endsWith('.app'));
                foundPaths.push(...paths);
            }
        }
    } catch (error) {
        console.log(`[Main] get-app-icon: bundle search failed for ${appName}:`, error);
    }
    
    // Method 3: Common /Applications paths (fallback)
    const commonPaths = [
        `/Applications/${appName}.app`,
        `/Applications/${appName.replace(/\s+/g, '')}.app`,
        `/Applications/${appName.replace(/\s+/g, '-')}.app`,
        `/Applications/${appName.replace(/\s+/g, '_')}.app`,
    ];
    
    // Add system apps
    if (appName === 'Finder') commonPaths.push('/System/Library/CoreServices/Finder.app');
    if (appName === 'Safari') commonPaths.push('/Applications/Safari.app');
    if (appName === 'Terminal') commonPaths.push('/Applications/Utilities/Terminal.app');
    if (appName === 'Activity Monitor') commonPaths.push('/Applications/Utilities/Activity Monitor.app');
    
    foundPaths.push(...commonPaths);
    
    // Filter to only existing paths and remove duplicates
    const existingPaths = [...new Set(foundPaths)].filter(p => fs.existsSync(p));
    console.log(`[Main] get-app-icon: Found ${existingPaths.length} potential paths for ${appName}:`, existingPaths);
    
    return existingPaths;
};

// Find all possible icon paths in an app bundle
const findIconPaths = (bundlePath: string): string[] => {
    const iconPaths: string[] = [];
    const resourcesDir = path.join(bundlePath, 'Contents', 'Resources');
    
    if (!fs.existsSync(resourcesDir)) {
        return iconPaths;
    }
    
    try {
        // Read all files in Resources directory
        const files = fs.readdirSync(resourcesDir);
        
        // Look for .icns files
        const icnsFiles = files.filter(f => f.toLowerCase().endsWith('.icns'));
        
        // Prioritize common icon names
        const priorityOrder = ['AppIcon.icns', 'app.icns', 'icon.icns', 'application.icns'];
        const foundPriority = icnsFiles.filter(f => priorityOrder.includes(f));
        const otherIcns = icnsFiles.filter(f => !priorityOrder.includes(f));
        
        // Add all found icons (priority first)
        [...foundPriority, ...otherIcns].forEach(iconFile => {
            iconPaths.push(path.join(resourcesDir, iconFile));
        });
        
    } catch (error) {
        console.log(`[Main] get-app-icon: Error reading resources directory for ${bundlePath}:`, error);
    }
    
    return iconPaths;
};

// Get App Icon
ipcMain.handle('get-app-icon', async (event, appName: string) => {
    if (process.platform !== 'darwin') {
        console.log(`[Main] get-app-icon: Not macOS, returning null for ${appName}`);
        return null;
    }

    // Check cache first
    if (appIconCache.has(appName)) {
        console.log(`[Main] get-app-icon: Using cached icon for ${appName}`);
        return appIconCache.get(appName);
    }

    console.log(`[Main] get-app-icon: Attempting to get icon for ${appName}`);

    try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        // Use robust app path detection
        const appPaths = await findAppPaths(appName, execAsync);
        
        if (appPaths.length === 0) {
            console.log(`[Main] get-app-icon: No app paths found for ${appName}`);
            return null;
        }

        // Try each found app path
        for (const bundlePath of appPaths) {
            console.log(`[Main] get-app-icon: Processing app bundle: ${bundlePath}`);
            
            // Find all icon paths in this bundle
            const iconPaths = findIconPaths(bundlePath);
            
            if (iconPaths.length === 0) {
                console.log(`[Main] get-app-icon: No icons found in ${bundlePath}`);
                continue;
            }
            
            // Try each icon path
            for (const iconPath of iconPaths) {
                console.log(`[Main] get-app-icon: Trying icon: ${iconPath}`);
                
                try {
                    // Convert ICNS to PNG using sips
                    const tempPngPath = path.join(os.tmpdir(), `icon-${appName.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.png`);
                    const convertScript = `sips -s format png "${iconPath}" --out "${tempPngPath}"`;
                    
                    const convertResult = await execAsync(convertScript, { 
                        timeout: 10000,
                        maxBuffer: 2 * 1024 * 1024
                    });
                    
                    // Check if conversion was successful
                    if (fs.existsSync(tempPngPath)) {
                        const iconBuffer = await fs.promises.readFile(tempPngPath);
                        const base64Icon = iconBuffer.toString('base64');
                        
                        // Clean up temp file
                        await fs.promises.unlink(tempPngPath).catch((err) => {
                            console.log(`[Main] get-app-icon: Failed to delete temp file: ${err}`);
                        });
                        
                        if (base64Icon && base64Icon.length > 100) {
                            const dataUri = `data:image/png;base64,${base64Icon}`;
                            appIconCache.set(appName, dataUri);
                            console.log(`[Main] get-app-icon: Successfully converted icon for ${appName} from ${iconPath} (${Math.round(base64Icon.length / 1024)}KB)`);
                            return dataUri;
                        } else {
                            console.log(`[Main] get-app-icon: Icon too small or invalid: ${base64Icon?.length || 0} bytes`);
                        }
                    } else {
                        console.log(`[Main] get-app-icon: Conversion failed - no output file created`);
                    }
                } catch (error: any) {
                    console.log(`[Main] get-app-icon: Error converting icon ${iconPath}: ${error.message}`);
                    continue;
                }
            }
        }

        console.log(`[Main] get-app-icon: Could not find usable icon for ${appName}`);
        return null;
    } catch (error) {
        console.error(`[Main] get-app-icon: Error getting icon for ${appName}:`, error);
        return null;
    }
});

// File Save Dialog
ipcMain.handle('show-save-dialog', async (event, options: { defaultFilename?: string }) => {
    try {
        if (!win) {
            return { canceled: true };
        }
        
        const result = await dialog.showSaveDialog(win, {
            title: 'Export Timesheet',
            defaultPath: options.defaultFilename || 'timesheet.csv',
            filters: [
                { name: 'CSV Files', extensions: ['csv'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        return result;
    } catch (error) {
        console.error('[Main] Error showing save dialog:', error);
        return { canceled: true, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Write file
ipcMain.handle('write-file', async (event, filePath: string, content: string) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }
        if (typeof content !== 'string') {
            throw new Error('Content must be a string');
        }
        
        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        // Write file with UTF-8 encoding
        await fs.promises.writeFile(filePath, content, 'utf-8');
        console.log('[Main] File written successfully:', filePath);
        return { success: true };
    } catch (error) {
        console.error('[Main] Failed to write file:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    }
});

// Copy file
ipcMain.handle('copy-file', async (event, sourcePath: string, destinationPath: string) => {
    try {
        if (!sourcePath || !destinationPath) {
            throw new Error('Source and destination paths are required');
        }

        // Ensure destination directory exists
        const dir = path.dirname(destinationPath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        await fs.promises.copyFile(sourcePath, destinationPath);
        console.log(`[Main] File copied from ${sourcePath} to ${destinationPath}`);
        return { success: true };
    } catch (error) {
        console.error('[Main] Error copying file:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    }
});

// Delete file
ipcMain.handle('delete-file', async (event, filePath: string) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }

        // Check if file exists before trying to delete
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            console.log(`[Main] File deleted: ${filePath}`);
        } else {
            console.log(`[Main] File not found (already deleted?): ${filePath}`);
        }
        
        return { success: true };
    } catch (error) {
        console.error('[Main] Error deleting file:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    }
});

// Get screenshot as data URL
ipcMain.handle('get-screenshot', async (event, filePath: string) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.log(`[Main] Screenshot not found: ${filePath}`);
            return null;
        }

        // Read file and convert to base64
        const fileBuffer = await fs.promises.readFile(filePath);
        const base64Data = fileBuffer.toString('base64');
        const mimeType = 'image/png'; // Screenshots are PNG files
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        
        console.log(`[Main] Screenshot loaded: ${filePath} (${Math.round(base64Data.length / 1024)}KB)`);
        return dataUrl;
    } catch (error) {
        console.error('[Main] Error loading screenshot:', error);
        return null;
    }
});

// Open file in Finder (macOS) or File Explorer (Windows/Linux)
ipcMain.handle('show-item-in-folder', async (event, filePath: string) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }

        console.log(`[Main] Opening file in folder: ${filePath}`);
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (error) {
        console.error('[Main] Error opening file in folder:', error);
        return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    }
});

// Tempo API handlers - Proxy requests through main process to avoid CORS
ipcMain.handle('tempo-api-request', async (event, { url, method = 'GET', headers = {}, body }) => {
    console.log('[Main] Tempo API request:', method, url);
    
    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        console.log('[Main] Tempo API response status:', response.status, response.statusText);
        console.log('[Main] Tempo API response headers:', responseHeaders);

        let responseData;
        const contentType = responseHeaders['content-type'] || '';
        
        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        if (!response.ok) {
            console.log('[Main] Tempo API error response:', responseData);
            return {
                success: false,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: responseHeaders,
            };
        }

        console.log('[Main] Tempo API success response:', typeof responseData === 'object' ? 'JSON data' : 'Text data');
        return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            data: responseData,
            headers: responseHeaders,
        };

    } catch (error) {
        console.error('[Main] Tempo API request failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});

// Jira API handlers - Proxy requests through main process to avoid CORS
ipcMain.handle('jira-api-request', async (event, { url, method = 'GET', headers = {}, body }) => {
    console.log('[Main] Jira API request:', method, url);
    
    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        console.log('[Main] Jira API response status:', response.status, response.statusText);
        console.log('[Main] Jira API response headers:', responseHeaders);

        let responseData;
        const contentType = responseHeaders['content-type'] || '';
        
        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        if (!response.ok) {
            console.log('[Main] Jira API error response:', responseData);
            return {
                success: false,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: responseHeaders,
            };
        }

        console.log('[Main] Jira API success response:', typeof responseData === 'object' ? 'JSON data' : 'Text data');
        return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            data: responseData,
            headers: responseHeaders,
        };

    } catch (error) {
        console.error('[Main] Jira API request failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});

function createTray() {
    const iconPath = path.join(process.env.VITE_PUBLIC || '', 'tray-icon.png');
    console.log('Tray Icon Path:', iconPath);
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    tray.setToolTip('TimePortal');

    tray.on('click', () => {
        toggleWindow();
    });

    tray.on('right-click', () => {
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Quit', click: () => app.quit() }
        ]);
        tray?.popUpContextMenu(contextMenu);
    });
}

function getWindowPosition() {
    const windowBounds = win?.getBounds();
    const trayBounds = tray?.getBounds();

    if (!windowBounds || !trayBounds) return { x: 0, y: 0 };

    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);

    return { x, y };
}

function toggleWindow() {
    if (win?.isVisible()) {
        win.hide();
    } else {
        const { x, y } = getWindowPosition();
        win?.setPosition(x, y, false);
        win?.show();
        win?.focus();
    }
}

function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);

    win = new BrowserWindow({
        width: 640,
        height: 450,
        show: true, // DEBUG
        frame: false,
        resizable: false,
        movable: true, // DEBUG
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: false, // DEBUG
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: false
        },
    });

    if (!app.isPackaged) {
        win.loadURL('http://127.0.0.1:5173');
        // win.webContents.openDevTools({ mode: 'detach' }); 
    } else {
        win.loadFile(path.join(process.env.DIST || '', 'index.html'));
    }

    win.on('blur', () => {
        if (!win?.webContents.isDevToolsOpened()) {
            win?.hide();
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.whenReady().then(() => {
    createWindow();
    createTray();

    // if (process.platform === 'darwin') {
    //     app.dock.hide();
    // }
});
