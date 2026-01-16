import { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain, systemPreferences, shell, desktopCapturer, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables from .env.local
const __dirnameTemp = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameTemp, '../.env.local');
if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    console.log('[Main] Loaded environment variables from .env.local');
} else {
    console.log('[Main] No .env.local found at:', envPath);
}
import { saveEncryptedFile, decryptFile, getEncryptionKey, isFileEncrypted } from './encryption.js';
import { storeCredential, getCredential, deleteCredential, hasCredential, listCredentialKeys, isSecureStorageAvailable } from './credentialStorage.js';
import { initializeSubscription, cleanupSubscription } from './subscription/ipcHandlers.js';
import { requirePremium } from './subscription/premiumGuard.js';
import { initializeAuth } from './auth/ipcHandlers.js';
import { AIAssignmentService, ActivityContext, AssignmentSuggestion } from './aiAssignmentService.js';
import { AIAccountService, TempoAccount, AccountSelection, HistoricalAccountUsage } from './aiAccountService.js';
import { LinkedJiraIssue } from '../src/types/shared.js';
import { DatabaseService } from './databaseService.js';
import { MigrationService } from './migration.js';
import { updater } from './autoUpdater.js';
import { AppDiscoveryService } from './appDiscoveryService.js';
import { BlacklistService } from './blacklistService.js';
import { fastVLMServer } from './fastvlm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In production (packaged), app.getAppPath() returns the path to the asar file
// In development, it returns the project root directory
// This ensures DIST always points to the correct absolute path
const appPath = app.getAppPath();
process.env.DIST = app.isPackaged
    ? path.join(appPath, 'dist')  // In asar: /path/to/app.asar/dist
    : path.join(__dirname, '../dist');  // In dev: project-root/dist
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');

// Handle EPIPE errors gracefully to prevent crash dialogs
// EPIPE occurs when console.log tries to write to a closed stdout pipe
// This is common in Electron apps and should not crash the application
process.on('uncaughtException', (error: Error) => {
    // Check if this is an EPIPE error
    if ('code' in error && (error as any).code === 'EPIPE') {
        // EPIPE errors are non-fatal - the console output destination is unavailable
        // This commonly happens when stdout is redirected to a closed pipe
        // Silently ignore these errors to prevent crash dialogs
        return;
    }

    // For all other uncaught exceptions, log them and show error dialog
    console.error('[Main] Uncaught Exception:', error);

    // In production, we might want to show an error dialog
    if (app.isReady()) {
        dialog.showErrorBox(
            'Unexpected Error',
            `An unexpected error occurred: ${error.message}\n\nThe application will continue running.`
        );
    }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any) => {
    console.error('[Main] Unhandled Promise Rejection:', reason);
});

// Wrap console methods to handle EPIPE errors gracefully
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

const safeConsoleWrapper = (originalMethod: typeof console.log) => {
    return (...args: any[]) => {
        try {
            originalMethod.apply(console, args);
        } catch (error: any) {
            // Silently ignore EPIPE errors in console output
            if (error.code !== 'EPIPE') {
                // If it's not an EPIPE error, try to report it via stderr
                try {
                    process.stderr.write(`Console output error: ${error.message}\n`);
                } catch {
                    // If even stderr fails, there's nothing we can do
                }
            }
        }
    };
};

console.log = safeConsoleWrapper(originalConsoleLog);
console.error = safeConsoleWrapper(originalConsoleError);
console.warn = safeConsoleWrapper(originalConsoleWarn);

let win: BrowserWindow | null;
let tray: Tray | null;
let currentTimerText: string = '';

// Timer state managed in main process to avoid renderer throttling
let timerState: {
    isRunning: boolean;
    isPaused: boolean;
    startTime: number | null;
    elapsed: number;
} = {
    isRunning: false,
    isPaused: false,
    startTime: null,
    elapsed: 0
};
let timerInterval: NodeJS.Timeout | null = null;

/**
 * ANSI color codes for tray title styling.
 * Note: Background colors in macOS menu bar have limited support and may not render
 * as expected due to system-level constraints. macOS typically only allows the system
 * to control background colors for proper light/dark mode adaptation.
 */
const ANSI_COLORS = {
    // Foreground colors
    BLACK: '\x1b[30m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    WHITE: '\x1b[37m',

    // Bright foreground colors
    BRIGHT_BLACK: '\x1b[90m',
    BRIGHT_RED: '\x1b[91m',
    BRIGHT_GREEN: '\x1b[92m',
    BRIGHT_YELLOW: '\x1b[93m',
    BRIGHT_BLUE: '\x1b[94m',
    BRIGHT_MAGENTA: '\x1b[95m',
    BRIGHT_CYAN: '\x1b[96m',
    BRIGHT_WHITE: '\x1b[97m',

    // Background colors (LIMITED SUPPORT on macOS menu bar)
    // macOS menu bar typically ignores background color codes and uses system colors
    BG_BLACK: '\x1b[40m',
    BG_RED: '\x1b[41m',
    BG_GREEN: '\x1b[42m',
    BG_YELLOW: '\x1b[43m',
    BG_BLUE: '\x1b[44m',
    BG_MAGENTA: '\x1b[45m',
    BG_CYAN: '\x1b[46m',
    BG_WHITE: '\x1b[47m',

    // Reset
    RESET: '\x1b[0m'
};

/**
 * Apply color styling to timer text using ANSI codes.
 *
 * IMPORTANT LIMITATION: macOS menu bar has strict styling constraints:
 * - Background colors are typically NOT supported (macOS controls the background)
 * - Foreground colors have limited support and may be overridden by the system theme
 * - The system automatically adjusts text color for light/dark mode
 *
 * Alternative approaches for visual distinction:
 * 1. Use Unicode box-drawing characters to create a "frame" around the text
 * 2. Use different Unicode characters (e.g., enclosed alphanumerics)
 * 3. Use emoji or symbols to add visual interest
 * 4. Generate dynamic tray icons with embedded text (using nativeImage)
 *    Example: Create a canvas, draw colored background + text, convert to PNG
 *    Pros: Full control over colors, fonts, and styling
 *    Cons: More complex, requires image generation on every update, higher CPU usage
 *
 * @param text - The text to style
 * @returns Styled text with ANSI codes (may not render as expected on macOS)
 */
function styleTimerText(text: string): string {
    // Attempt to use foreground color (may be overridden by system)
    // Using cyan for a professional look that works in both light and dark modes
    // Note: You can experiment with other colors like GREEN, YELLOW, MAGENTA, etc.
    return `${ANSI_COLORS.CYAN}${text}${ANSI_COLORS.RESET}`;
}

/**
 * Format elapsed time in milliseconds to HH:MM:SS
 */
function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}


/**
 * Update the tray title based on current timer state.
 * This runs in the main process and is not affected by renderer throttling.
 *
 * FONT STYLING: Uses Electron's native `monospacedDigit` fontType option (macOS 10.11+)
 * which provides true system-level monospace digits. This is superior to Unicode
 * monospace characters as it uses the system's San Francisco Mono font on macOS,
 * ensuring perfect alignment and readability.
 *
 * COLOR LIMITATIONS: While Electron's setTitle() supports ANSI colors, macOS menu bar
 * has strict visual guidelines and typically overrides custom colors to maintain
 * consistency with the system theme (black text in light mode, white in dark mode).
 * Background colors are not supported at all in the menu bar.
 *
 * For more visual customization, consider using dynamic tray icons (nativeImage)
 * with rendered text, though this is more complex and less performant.
 */
function updateTrayTitle(): void {
    if (!tray) return;

    if (timerState.isRunning && !timerState.isPaused && timerState.startTime) {
        // Calculate current elapsed time
        const elapsed = Date.now() - timerState.startTime;
        const formattedTime = formatTime(elapsed);

        // Apply color styling (may be overridden by system theme)
        const styledTime = styleTimerText(formattedTime);
        currentTimerText = formattedTime;

        if (process.platform === 'darwin') {
            // Use native monospacedDigit font for perfect digit alignment
            // This leverages SF Mono on macOS 10.11+ for professional appearance
            tray.setTitle(styledTime, {
                fontType: 'monospacedDigit'
            });
        }
    } else if (timerState.isPaused) {
        // Show paused state with last elapsed time
        const formattedTime = formatTime(timerState.elapsed);
        const styledTime = styleTimerText(formattedTime);
        currentTimerText = `⏸ ${formattedTime}`;

        if (process.platform === 'darwin') {
            tray.setTitle(`⏸ ${styledTime}`, {
                fontType: 'monospacedDigit'
            });
        }
    } else {
        // Timer stopped - clear title
        currentTimerText = '';
        if (process.platform === 'darwin') {
            tray.setTitle('');
        }
    }
}

/**
 * Start the main process timer interval.
 * Updates tray title every second independently of renderer process.
 */
function startTimerInterval(): void {
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    // Update immediately
    updateTrayTitle();
    // Then update every second (1000ms is sufficient for display)
    timerInterval = setInterval(updateTrayTitle, 1000);
}

/**
 * Stop the main process timer interval.
 */
function stopTimerInterval(): void {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    updateTrayTitle(); // Update one last time to show final state
}

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
        let currentWindow: { appName: string; windowTitle: string; bundleId: string } | null = null;
        try {
            // Get the active window using our existing handler
            if (process.platform === 'darwin') {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);

                // Get active app name, window title, and bundle ID
                // Enhanced to handle empty titles, missing values, and apps with no windows
                // Uses multiple strategies for Electron apps (Cursor, VS Code, etc.) which may not expose window titles via standard API
                const result = await execAsync(`osascript -e '
                    tell application "System Events"
                        set frontApp to first application process whose frontmost is true
                        set appName to name of frontApp
                        set bundleId to bundle identifier of frontApp
                        set windowTitle to ""

                        -- Strategy 1: Try to get title from front window (standard approach)
                        set windowCount to 0
                        try
                            set windowCount to count of windows of frontApp
                        end try

                        if windowCount > 0 then
                            try
                                set windowTitle to title of front window of frontApp
                                if windowTitle is missing value then
                                    set windowTitle to ""
                                end if
                            on error
                                set windowTitle to ""
                            end try
                        end if

                        -- Strategy 2: For Electron apps, try AXTitle from UI elements
                        -- Electron apps often have the title in a different accessibility element
                        if windowTitle is "" then
                            try
                                set uiElements to UI elements of frontApp
                                repeat with elem in uiElements
                                    try
                                        set elemRole to role of elem
                                        if elemRole is "AXWindow" then
                                            set axTitle to value of attribute "AXTitle" of elem
                                            if axTitle is not missing value and axTitle is not "" then
                                                set windowTitle to axTitle
                                                exit repeat
                                            end if
                                        end if
                                    end try
                                end repeat
                            end try
                        end if

                        -- Strategy 3: Try getting title from the first window directly via AXTitle attribute
                        if windowTitle is "" and windowCount > 0 then
                            try
                                set firstWindow to window 1 of frontApp
                                set axTitle to value of attribute "AXTitle" of firstWindow
                                if axTitle is not missing value and axTitle is not "" then
                                    set windowTitle to axTitle
                                end if
                            end try
                        end if

                        -- Strategy 4: For Electron apps, the document title is sometimes in AXDocument
                        if windowTitle is "" then
                            try
                                set firstWindow to window 1 of frontApp
                                set docTitle to value of attribute "AXDocument" of firstWindow
                                if docTitle is not missing value and docTitle is not "" then
                                    -- Extract filename from path if it looks like a path
                                    if docTitle contains "/" then
                                        set AppleScript'"'"'s text item delimiters to "/"
                                        set pathParts to text items of docTitle
                                        set windowTitle to last item of pathParts
                                        set AppleScript'"'"'s text item delimiters to ""
                                    else
                                        set windowTitle to docTitle
                                    end if
                                end if
                            end try
                        end if

                        return appName & "|||" & windowTitle & "|||" & bundleId
                    end tell
                '`);

                const parts = result.stdout.trim().split('|||');
                const appName = parts[0] || 'Unknown';
                const windowTitle = parts[1] || 'Unknown';
                const bundleId = parts[2] || '';

                currentWindow = { appName, windowTitle, bundleId };
                console.log('[Main] capture-screenshot - Active window:', currentWindow);

                // Check if the active app is blacklisted
                const blacklistService = BlacklistService.getInstance();
                if (bundleId && blacklistService.isAppBlacklisted(bundleId)) {
                    console.log(`[Main] capture-screenshot - App is blacklisted (${appName}, ${bundleId}), skipping screenshot`);
                    return null;
                }

                // NOTE: We don't skip here based on active window - we'll filter Clearical
                // from the window sources later. This allows screenshots to be taken even
                // when Clearical is in focus (we'll capture other windows).
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

        // Filter out the Clearical app window itself and very small windows
        const validSources = sources.filter(source => {
            const lowerName = source.name.toLowerCase();
            const size = source.thumbnail.getSize();

            // Filter out the actual Clearical app window
            if (lowerName === 'time-portal' || lowerName === 'timeportal' || lowerName === 'clearical') {
                console.log('[Main] Filtering out Clearical app window:', source.name);
                return false;
            }

            // Filter out Electron windows (these are usually the Clearical app or dev tools)
            if (lowerName === 'electron' || source.name === 'Electron') {
                console.log('[Main] Filtering out Electron window:', source.name);
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
                        // Strategy 3: Enhanced partial title matching for browsers
                        let partialMatch = null;
                        
                        // Try matching by removing browser-specific suffixes
                        const cleanTitle = currentWindow.windowTitle
                            .replace(/ - Audio playing.*/i, '')  // Remove "- Audio playing - Browser"
                            .replace(/ - Google Chrome$/i, '')   // Remove "- Google Chrome"
                            .replace(/ - Safari$/i, '')          // Remove "- Safari"
                            .replace(/ - Firefox$/i, '')         // Remove "- Firefox"
                            .replace(/ - Brave$/i, '')           // Remove "- Brave"
                            .replace(/ - Opera$/i, '')           // Remove "- Opera"
                            .trim();
                        
                        console.log('[Main] Cleaned title for matching:', cleanTitle);
                        
                        partialMatch = validSources.find(source => {
                            // Direct partial match
                            if (source.name.includes(cleanTitle) || cleanTitle.includes(source.name)) {
                                return true;
                            }
                            
                            // Try matching the first significant part (before " - ")
                            const sourceMainPart = source.name.split(' - ')[0];
                            const titleMainPart = cleanTitle.split(' - ')[0];
                            
                            if (sourceMainPart.length > 10 && titleMainPart.length > 10) {
                                return sourceMainPart.includes(titleMainPart) || titleMainPart.includes(sourceMainPart);
                            }
                            
                            return false;
                        });
                        
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
            
            // If we still don't have a target, use a heuristic fallback
            if (!targetSource) {
                console.log('[Main] No matching window found for app:', currentWindow?.appName || 'unknown');
                console.log('[Main] Available windows:', validSources.map(s => `"${s.name}"`).join(', '));

                // Fallback strategy: If there's only one valid window, use it
                // This handles cases where the window title doesn't match but there's clearly
                // only one active work window
                if (validSources.length === 1) {
                    targetSource = validSources[0];
                    console.log('[Main] Using single available window as fallback:', targetSource.name);
                } else if (validSources.length > 1 && currentWindow?.appName) {
                    // Try a more lenient matching: find any window containing part of the app name
                    const appNameWords = currentWindow.appName.toLowerCase().split(/\s+/);
                    const possibleMatches = validSources.filter(source => {
                        const sourceLower = source.name.toLowerCase();
                        return appNameWords.some(word => word.length > 3 && sourceLower.includes(word));
                    });

                    if (possibleMatches.length > 0) {
                        targetSource = possibleMatches[0];
                        console.log('[Main] Using lenient app name match:', targetSource.name);
                    } else {
                        // Last resort: use the largest window by area (most likely the active work window)
                        targetSource = validSources.reduce((largest, current) => {
                            const currentSize = current.thumbnail.getSize();
                            const largestSize = largest.thumbnail.getSize();
                            const currentArea = currentSize.width * currentSize.height;
                            const largestArea = largestSize.width * largestSize.height;
                            return currentArea > largestArea ? current : largest;
                        });
                        console.log('[Main] Using largest window as last resort fallback:', targetSource.name);
                    }
                }

                // If still no target after all fallbacks, give up
                if (!targetSource) {
                    console.log('[Main] No suitable window found after all fallback strategies');
                    return null;
                }
            }
            
            console.log('[Main] Capturing window:', targetSource.name, 
                       `(${targetSource.thumbnail.getSize().width}x${targetSource.thumbnail.getSize().height})`);
            
            const image = targetSource.thumbnail.toPNG();

            // Create a more descriptive filename with app name and timestamp
            // Format: timestamp|||AppName|||WindowTitle.png
            // Using ||| as delimiter to preserve spaces in app names and window titles
            const timestamp = Date.now();
            const appNameSafe = (currentWindow?.appName || 'Unknown').replace(/[\/\\:*?"<>|]/g, '_');
            const windowTitleSafe = targetSource.name.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
            const filename = `${timestamp}|||${appNameSafe}|||${windowTitleSafe}.png`;
            const filePath = path.join(SCREENSHOTS_DIR, filename);

            // Save screenshot with encryption
            try {
                await saveEncryptedFile(filePath, image);
                console.log('[Main] Window screenshot saved (encrypted):', filePath);
            } catch (encryptError) {
                console.error('[Main] Failed to encrypt screenshot, saving unencrypted:', encryptError);
                // Fallback to unencrypted if encryption fails
                await fs.promises.writeFile(filePath, image);
                console.log('[Main] Window screenshot saved (unencrypted fallback):', filePath);
            }
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
                const appNameSafe = (currentWindow?.appName || 'Unknown').replace(/[\/\\:*?"<>|]/g, '_');
                const filename = `${timestamp}|||${appNameSafe}|||SCREEN_FALLBACK.png`;
                const filePath = path.join(SCREENSHOTS_DIR, filename);

                // Save screenshot with encryption
                try {
                    await saveEncryptedFile(filePath, image);
                    console.log('[Main] Screen screenshot saved (encrypted, fallback):', filePath);
                } catch (encryptError) {
                    console.error('[Main] Failed to encrypt screenshot, saving unencrypted:', encryptError);
                    // Fallback to unencrypted if encryption fails
                    await fs.promises.writeFile(filePath, image);
                    console.log('[Main] Screen screenshot saved (unencrypted fallback):', filePath);
                }
                return filePath;
            }
        }
    } catch (error) {
        console.error('[Main] Failed to capture screenshot:', error);
    }
    return null;
});

// FastVLM Python server for VLM analysis
ipcMain.handle('analyze-screenshot', async (event, imagePath: string, requestId?: string) => {
    console.log('[Main] analyze-screenshot requested for:', imagePath);
    console.log('[Main] Using FastVLM backend for screenshot analysis');

    // Check if the image file exists
    if (!fs.existsSync(imagePath)) {
        console.log('[Main] analyze-screenshot: Image file not found:', imagePath);
        return {
            success: false,
            error: 'Image file not found',
            description: 'Screenshot captured',  // Fallback description
            rawVisionData: null,
            aiDescription: null
        };
    }

    // Decrypt screenshot if encrypted (analyzers need raw PNG data)
    let analyzeImagePath = imagePath;
    let tempDecryptedPath: string | null = null;

    try {
        if (isFileEncrypted(imagePath)) {
            console.log('[Main] Screenshot is encrypted, decrypting for analysis...');
            const decryptedData = await decryptFile(imagePath);
            // Write to temp file for analyzers
            // Preserve original filename so they can extract app info from it
            const originalFilename = path.basename(imagePath);
            tempDecryptedPath = path.join(app.getPath('temp'), originalFilename);
            await fs.promises.writeFile(tempDecryptedPath, decryptedData);
            analyzeImagePath = tempDecryptedPath;
            console.log('[Main] Decrypted screenshot to temp file:', tempDecryptedPath);
        }
    } catch (decryptError) {
        console.error('[Main] Failed to decrypt screenshot:', decryptError);
        // Continue with original path - might be unencrypted
    }

    // Helper function to generate fallback description from filename
    const generateFallbackFromFilename = (filepath: string): string => {
        try {
            const filename = path.basename(filepath, '.png');

            // Try new format first (timestamp|||AppName|||WindowTitle)
            if (filename.includes('|||')) {
                const parts = filename.split('|||');
                if (parts.length >= 3) {
                    const appName = parts[1];
                    const windowTitle = parts[2];
                    if (windowTitle && windowTitle !== appName && windowTitle !== 'Unknown') {
                        return `Viewing ${windowTitle} in ${appName}.`;
                    }
                    return `Working in ${appName}.`;
                }
            }

            // Fallback to legacy format (timestamp_AppName_WindowTitle)
            const parts = filename.split('_');
            if (parts.length >= 3) {
                const appName = parts[1].replace(/_/g, ' ');
                const windowTitle = parts.slice(2).join(' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
                if (windowTitle && windowTitle !== appName && windowTitle !== 'Unknown') {
                    return `Viewing ${windowTitle} in ${appName}.`;
                }
                return `Working in ${appName}.`;
            }
        } catch (e) {
            console.log('[Main] Could not parse filename for fallback:', e);
        }
        return 'Screenshot captured';
    };

    // TRY FASTVLM FIRST (PRIMARY METHOD)
    // Note: analyzeScreenshot() will start the server on-demand if not running
    console.log('[Main] Attempting analysis with FastVLM (will start server if needed)...');

    // Parse app name and window title from filename
    // Filename format: {timestamp}|||{app_name}|||{window_title}.png
    let appName: string | undefined;
    let windowTitle: string | undefined;
    try {
        const filename = path.basename(analyzeImagePath, '.png');
        if (filename.includes('|||')) {
            const parts = filename.split('|||');
            if (parts.length >= 3) {
                appName = parts[1] || undefined;
                windowTitle = parts[2] || undefined;
                console.log('[Main] Parsed from filename - app:', appName, 'window:', windowTitle);
            }
        }
    } catch (parseError) {
        console.log('[Main] Could not parse app info from filename:', parseError);
    }

    // Get user role from settings for AI context optimization
    let userRole: string | undefined;
    let roleContext: string | undefined;
    try {
        const db = DatabaseService.getInstance();
        const aiSettings = db.getSetting('ai');
        if (aiSettings?.userRole) {
            userRole = aiSettings.userRole;
            // Build role context string based on role metadata
            const roleMetadata: Record<string, { context: string }> = {
                software_developer: { context: 'software development, coding, debugging, code review, testing' },
                designer: { context: 'design, user interface, user experience, visual design, prototyping' },
                product_manager: { context: 'product management, roadmap planning, feature prioritization' },
                project_manager: { context: 'project management, scheduling, resource allocation, status tracking' },
                data_analyst: { context: 'data analysis, reporting, visualization, insights, modeling' },
                marketing: { context: 'marketing, content creation, campaigns, analytics, social media' },
                sales: { context: 'sales, business development, client relationships, proposals' },
                finance: { context: 'finance, accounting, budgeting, financial analysis' },
                customer_support: { context: 'customer support, ticket resolution, customer communication' },
                executive: { context: 'executive management, strategic planning, leadership, decision-making' },
                researcher: { context: 'research, analysis, documentation, literature review' },
                other: { context: aiSettings.customRoleDescription || 'general knowledge work' }
            };
            roleContext = userRole ? roleMetadata[userRole]?.context : undefined;
            roleContext = roleContext || 'general knowledge work';
            console.log('[Main] Using role context for analysis - role:', userRole);
        }
    } catch (settingsError) {
        console.log('[Main] Could not get user role from settings:', settingsError);
    }

    try {
        const fastVLMResult = await fastVLMServer.analyzeScreenshot(analyzeImagePath, appName, windowTitle, requestId);

        // Clean up temp decrypted file if we created one
        if (tempDecryptedPath) {
            try {
                await fs.promises.unlink(tempDecryptedPath);
                console.log('[Main] Cleaned up temp decrypted file');
            } catch (cleanupError) {
                console.warn('[Main] Failed to cleanup temp file:', cleanupError);
            }
        }

        if (fastVLMResult.success && fastVLMResult.description) {
            console.log('[Main] FastVLM analysis successful');
            console.log('[Main] Description:', fastVLMResult.description);
            return {
                success: true,
                description: fastVLMResult.description,
                confidence: fastVLMResult.confidence || 0.9,
                requestId: fastVLMResult.requestId,
                rawVisionData: null,
                aiDescription: fastVLMResult.description,
                llmError: null,
                analyzer: 'fastvlm'
            };
        } else {
            // FastVLM analysis failed - return error with fallback description
            console.warn('[Main] FastVLM analysis failed:', fastVLMResult.error);
            const fallbackDescription = generateFallbackFromFilename(imagePath);
            return {
                success: false,
                error: fastVLMResult.error || 'FastVLM analysis failed',
                description: fallbackDescription,
                rawVisionData: null,
                aiDescription: null,
                analyzer: 'fallback'
            };
        }
    } catch (fastVLMError) {
        console.error('[Main] FastVLM error:', fastVLMError);

        // Clean up temp decrypted file if we created one
        if (tempDecryptedPath) {
            try {
                await fs.promises.unlink(tempDecryptedPath);
            } catch (cleanupError) {
                console.warn('[Main] Failed to cleanup temp file:', cleanupError);
            }
        }

        // Generate fallback from filename
        const fallbackDescription = generateFallbackFromFilename(imagePath);

        return {
            success: false,
            error: fastVLMError instanceof Error ? fastVLMError.message : 'Unknown error',
            description: fallbackDescription,
            rawVisionData: null,
            aiDescription: null,
            analyzer: 'fallback'
        };
    }
});

// Permission Handlers

/**
 * Tests if screen recording permission actually works by attempting to capture.
 * This is critical for detecting "zombie" permissions - where macOS system settings
 * show the app has permission, but the TCC database has stale entries from a previous
 * app signature (common with ad-hoc signed apps during updates).
 *
 * @returns Object with { works: boolean, error?: string }
 */
async function testScreenRecordingWorks(): Promise<{ works: boolean; error?: string }> {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 100, height: 100 }
        });

        if (sources.length === 0) {
            console.warn('[Main] Screen recording test: No sources returned (permission may be stale)');
            return { works: false, error: 'no_sources' };
        }

        // Try to get a thumbnail - this will fail if permission is stale
        const thumbnail = sources[0].thumbnail;
        const size = thumbnail.getSize();

        if (size.width === 0 || size.height === 0) {
            console.warn('[Main] Screen recording test: Empty thumbnail (permission may be stale)');
            return { works: false, error: 'empty_thumbnail' };
        }

        console.log('[Main] Screen recording test: SUCCESS - captured thumbnail', size);
        return { works: true };
    } catch (error) {
        console.error('[Main] Screen recording test: ERROR -', error);
        return { works: false, error: String(error) };
    }
}

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
            return systemPreferences.getMediaAccessStatus('screen');
        }

        // CRITICAL: If status is 'granted', verify it actually works
        // This detects "zombie" permissions from app updates with signature changes
        if (status === 'granted') {
            const testResult = await testScreenRecordingWorks();

            if (!testResult.works) {
                console.error('[Main] STALE PERMISSION DETECTED: System says granted but capture fails!');
                console.error('[Main] This typically happens after app updates with ad-hoc signing');
                console.error('[Main] User needs to remove and re-add the app in System Settings');
                // Return 'stale' as a special status to trigger UI notification
                return 'stale';
            }
        }

        return status;
    }
    return 'granted';
});

ipcMain.handle('request-screen-permission', async () => {
    console.log('[Main] request-screen-permission requested');
    if (process.platform === 'darwin') {
        try {
            // Trigger the macOS permission prompt by requesting screen sources
            await desktopCapturer.getSources({ types: ['screen'] });
            const status = systemPreferences.getMediaAccessStatus('screen');
            console.log('[Main] Screen permission after request:', status);
            return status;
        } catch (e) {
            console.warn('[Main] request-screen-permission error:', e);
            return 'denied';
        }
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

ipcMain.handle('open-accessibility-settings', async () => {
    console.log('[Main] open-accessibility-settings requested');
    if (process.platform === 'darwin') {
        const paths = [
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
            'x-apple.systempreferences:com.apple.SystemSettings.PrivacySecurity.extension?Privacy_Accessibility',
        ];

        for (const p of paths) {
            try {
                console.log(`[Main] Trying to open: ${p}`);
                await shell.openExternal(p);
                return;
            } catch (e) {
                console.warn(`[Main] Failed to open ${p}`, e);
            }
        }

        // Final fallback
        try {
            await shell.openExternal('x-apple.systempreferences:');
        } catch (e) {
            console.error('[Main] All attempts to open settings failed.', e);
        }
    }
});

/**
 * Shows instructions for resetting TCC permissions to fix stale permission issues.
 * This is needed when macOS shows the app has permission but it doesn't actually work
 * (common after app updates with ad-hoc signing).
 */
ipcMain.handle('show-permission-reset-instructions', async () => {
    console.log('[Main] show-permission-reset-instructions requested');

    if (process.platform === 'darwin') {
        const appName = app.getName();
        const message = `Permission Reset Required

After an app update, macOS may have stale permission entries. To fix this:

1. Open System Settings (or System Preferences)
2. Go to "Privacy & Security" → "Screen Recording"
3. Find "${appName}" in the list
4. Click the toggle to DISABLE it
5. Click the toggle again to ENABLE it
6. Restart ${appName}

Alternatively, you can reset using Terminal:
tccutil reset ScreenCapture ${app.getPath('exe')}

This is a known macOS issue with app updates. Your data is safe.`;

        const result = await dialog.showMessageBox({
            type: 'warning',
            title: 'Permission Reset Required',
            message: 'Screen Recording Permission Needs Reset',
            detail: message,
            buttons: ['Open System Settings', 'Copy Terminal Command', 'Cancel'],
            defaultId: 0,
            cancelId: 2
        });

        if (result.response === 0) {
            // Open System Settings
            await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        } else if (result.response === 1) {
            // Copy terminal command to clipboard
            const { clipboard } = await import('electron');
            clipboard.writeText(`tccutil reset ScreenCapture "${app.getPath('exe')}"`);

            await dialog.showMessageBox({
                type: 'info',
                title: 'Command Copied',
                message: 'Terminal command copied to clipboard',
                detail: 'Paste this command in Terminal and press Enter to reset permissions.',
                buttons: ['OK']
            });
        }
    }
});

// Get environment information
ipcMain.handle('get-environment-info', async () => {
    // Check if we're in production mode based on BUILD_ENV or app.isPackaged
    const isProduction = process.env.BUILD_ENV === 'production' || app.isPackaged;

    // Get app version - in dev mode app.getVersion() returns Electron version,
    // so we read from package.json directly
    let version = app.getVersion();
    if (!app.isPackaged) {
        try {
            const pkgPath = path.resolve(__dirnameTemp, '../package.json');
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            version = pkg.version;
        } catch (error) {
            console.warn('[Main] Could not read package.json version:', error);
        }
    }

    return {
        isProduction,
        isDevelopment: !isProduction,
        isPackaged: app.isPackaged,
        buildEnv: process.env.BUILD_ENV || 'not-set',
        version,
    };
});

// Open external URL in default browser
ipcMain.handle('open-external-url', async (_event, url: string) => {
    console.log('[Main] Opening external URL:', url);
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        console.error('[Main] Failed to open external URL:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.on('hide-window', () => {
    toggleWindow();
});

ipcMain.on('ping', () => {
    console.log('[Main] Received ping from renderer - IPC is working');
});

// Timer state update handler for menu bar display
// Main process maintains its own timer to avoid renderer throttling issues
ipcMain.on('update-timer-display', (event, timerData: { isRunning: boolean; isPaused: boolean; elapsed: number; startTime: number | null }) => {
    console.log('[Main] Timer state update received:', timerData);

    const wasRunning = timerState.isRunning && !timerState.isPaused;

    // Update timer state
    timerState.isRunning = timerData.isRunning;
    timerState.isPaused = timerData.isPaused;
    timerState.startTime = timerData.startTime;
    timerState.elapsed = timerData.elapsed;

    const isNowRunning = timerState.isRunning && !timerState.isPaused;

    // Manage the timer interval based on running state
    if (isNowRunning && !wasRunning) {
        // Timer started or resumed - start interval
        console.log('[Main] Starting timer interval');
        startTimerInterval();
    } else if (!isNowRunning && wasRunning) {
        // Timer paused or stopped - stop interval but update display
        console.log('[Main] Stopping timer interval');
        stopTimerInterval();
    } else if (isNowRunning) {
        // Timer is running and was already running - ensure interval is active
        // This handles edge cases like window reload
        if (!timerInterval) {
            console.log('[Main] Timer is running but interval was missing - restarting');
            startTimerInterval();
        }
    } else {
        // Timer not running - just update display once
        updateTrayTitle();
    }
});

// Active Window Tracking
ipcMain.handle('get-active-window', async () => {
    if (process.platform === 'darwin') {
        try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            // Get app name, window title, and bundle ID in a single AppleScript call to avoid race conditions
            // Enhanced with multiple strategies for Electron apps (Cursor, VS Code, etc.)
            const result = await execAsync(`osascript -e '
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set appName to name of frontApp
                    set bundleId to bundle identifier of frontApp
                    set windowTitle to ""

                    -- Strategy 1: Try to get title from front window (standard approach)
                    set windowCount to 0
                    try
                        set windowCount to count of windows of frontApp
                    end try

                    if windowCount > 0 then
                        try
                            set windowTitle to title of front window of frontApp
                            if windowTitle is missing value then
                                set windowTitle to ""
                            end if
                        on error
                            set windowTitle to ""
                        end try
                    end if

                    -- Strategy 2: For Electron apps, try AXTitle from UI elements
                    if windowTitle is "" then
                        try
                            set uiElements to UI elements of frontApp
                            repeat with elem in uiElements
                                try
                                    set elemRole to role of elem
                                    if elemRole is "AXWindow" then
                                        set axTitle to value of attribute "AXTitle" of elem
                                        if axTitle is not missing value and axTitle is not "" then
                                            set windowTitle to axTitle
                                            exit repeat
                                        end if
                                    end if
                                end try
                            end repeat
                        end try
                    end if

                    -- Strategy 3: Try AXTitle attribute directly on first window
                    if windowTitle is "" and windowCount > 0 then
                        try
                            set firstWindow to window 1 of frontApp
                            set axTitle to value of attribute "AXTitle" of firstWindow
                            if axTitle is not missing value and axTitle is not "" then
                                set windowTitle to axTitle
                            end if
                        end try
                    end if

                    -- Strategy 4: For Electron apps, try AXDocument attribute
                    if windowTitle is "" then
                        try
                            set firstWindow to window 1 of frontApp
                            set docTitle to value of attribute "AXDocument" of firstWindow
                            if docTitle is not missing value and docTitle is not "" then
                                if docTitle contains "/" then
                                    set AppleScript'"'"'s text item delimiters to "/"
                                    set pathParts to text items of docTitle
                                    set windowTitle to last item of pathParts
                                    set AppleScript'"'"'s text item delimiters to ""
                                else
                                    set windowTitle to docTitle
                                end if
                            end if
                        end try
                    end if

                    return appName & "|||" & windowTitle & "|||" & bundleId
                end tell
            '`);

            const parts = result.stdout.trim().split('|||');
            const appName = parts[0] || 'Unknown';
            const windowTitle = parts[1] || 'Unknown';
            const bundleId = parts[2] || '';

            console.log('[Main] get-active-window result:', { appName, windowTitle, bundleId });
            return { appName, windowTitle, bundleId };
        } catch (error) {
            console.error('[Main] Failed to get active window:', error);
            return { appName: 'Unknown', windowTitle: 'Unknown', bundleId: '' };
        }
    }
    return { appName: 'Not supported', windowTitle: 'Not supported', bundleId: '' };
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

        // Read and decrypt file (supports both encrypted and unencrypted)
        let fileBuffer: Buffer;
        try {
            fileBuffer = await decryptFile(filePath);
        } catch (decryptError) {
            console.error('[Main] Failed to decrypt screenshot, trying raw read:', decryptError);
            // Fallback to raw read if decryption fails
            fileBuffer = await fs.promises.readFile(filePath);
        }

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
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('tempo-api-request', requirePremium('Tempo Integration', async (event, { url, method = 'GET', headers = {}, body }) => {
    console.log('[Main] Tempo API request:', method, url);
    if (body) {
        console.log('[Main] Tempo API request body type:', typeof body);
        console.log('[Main] Tempo API request body preview:', JSON.stringify(body).substring(0, 200));
    }

    try {
        const requestBody = body && (method === 'POST' || method === 'PUT')
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined;

        if (requestBody) {
            console.log('[Main] Tempo API final request body length:', requestBody.length);
        }

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: requestBody,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        console.log('[Main] Tempo API response status:', response.status, response.statusText);

        let responseData;
        const contentType = responseHeaders['content-type'] || '';

        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        if (!response.ok) {
            console.error('[Main] Tempo API error response:', responseData);
            return {
                success: false,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: responseHeaders,
            };
        }

        console.log('[Main] Tempo API success response');
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
}));

// Jira API handlers - Proxy requests through main process to avoid CORS
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('jira-api-request', requirePremium('Jira Integration', async (event, { url, method = 'GET', headers = {}, body }) => {
    console.log('[Main] Jira API request:', method, url);
    if (body) {
        console.log('[Main] Jira API request body type:', typeof body);
        console.log('[Main] Jira API request body preview:', JSON.stringify(body).substring(0, 200));
    }

    try {
        const requestBody = body && (method === 'POST' || method === 'PUT')
            ? (typeof body === 'string' ? body : JSON.stringify(body))
            : undefined;

        if (requestBody) {
            console.log('[Main] Jira API final request body length:', requestBody.length);
        }

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: requestBody,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        console.log('[Main] Jira API response status:', response.status, response.statusText);

        let responseData;
        const contentType = responseHeaders['content-type'] || '';

        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        if (!response.ok) {
            console.error('[Main] Jira API error response:', responseData);
            return {
                success: false,
                status: response.status,
                statusText: response.statusText,
                data: responseData,
                headers: responseHeaders,
            };
        }

        console.log('[Main] Jira API success response');
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
}));

// Secure Credential Storage handlers
ipcMain.handle('secure-store-credential', async (event, key: string, value: string) => {
    console.log('[Main] secure-store-credential requested for key:', key);

    try {
        await storeCredential(key, value);
        return {
            success: true,
        };
    } catch (error) {
        console.error('[Main] Failed to store credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});

ipcMain.handle('secure-get-credential', async (event, key: string) => {
    console.log('[Main] secure-get-credential requested for key:', key);

    try {
        const value = await getCredential(key);
        return {
            success: true,
            value: value,
        };
    } catch (error) {
        console.error('[Main] Failed to get credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            value: null,
        };
    }
});

ipcMain.handle('secure-delete-credential', async (event, key: string) => {
    console.log('[Main] secure-delete-credential requested for key:', key);

    try {
        await deleteCredential(key);
        return {
            success: true,
        };
    } catch (error) {
        console.error('[Main] Failed to delete credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});

ipcMain.handle('secure-has-credential', async (event, key: string) => {
    console.log('[Main] secure-has-credential requested for key:', key);

    try {
        const exists = await hasCredential(key);
        return {
            success: true,
            exists: exists,
        };
    } catch (error) {
        console.error('[Main] Failed to check credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            exists: false,
        };
    }
});

ipcMain.handle('secure-list-credentials', async () => {
    console.log('[Main] secure-list-credentials requested');

    try {
        const keys = await listCredentialKeys();
        return {
            success: true,
            keys: keys,
        };
    } catch (error) {
        console.error('[Main] Failed to list credentials:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            keys: [],
        };
    }
});

ipcMain.handle('secure-is-available', async () => {
    console.log('[Main] secure-is-available requested');

    try {
        const available = isSecureStorageAvailable();
        return {
            success: true,
            available: available,
        };
    } catch (error) {
        console.error('[Main] Failed to check secure storage availability:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            available: false,
        };
    }
});

// AI Assignment Suggestion Handler
ipcMain.handle('suggest-assignment', async (event, request: {
    context: ActivityContext;
    buckets: any[];
    jiraIssues: LinkedJiraIssue[];
    historicalEntries: any[];
}) => {
    console.log('[Main] suggest-assignment requested');
    console.log('[Main] Context:', {
        description: request.context.description?.substring(0, 50) + '...',
        appNames: request.context.appNames,
        technologies: request.context.detectedTechnologies
    });

    try {
        // Create AI service with provided data
        const service = new AIAssignmentService(
            request.buckets,
            request.jiraIssues,
            request.historicalEntries
        );

        // Get suggestion
        const suggestion = await service.suggestAssignment(request.context);

        console.log('[Main] Assignment suggestion result:', {
            hasAssignment: !!suggestion.assignment,
            confidence: (suggestion.confidence * 100).toFixed(1) + '%',
            reason: suggestion.reason
        });

        return {
            success: true,
            suggestion: suggestion
        };
    } catch (error) {
        console.error('[Main] suggest-assignment failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            suggestion: null
        };
    }
});

// AI Activity Summary Generation Handler
ipcMain.handle('generate-activity-summary', async (event, context: {
    screenshotDescriptions: string[];
    windowTitles: string[];
    appNames: string[];
    duration: number;
    startTime: number;
    endTime: number;
}) => {
    console.log('[Main] generate-activity-summary requested');
    console.log('[Main] Screenshot descriptions:', context.screenshotDescriptions.length);
    console.log('[Main] App names:', context.appNames);

    try {
        // Use the Qwen3 reasoning model via FastVLM server to generate narrative summary
        const result = await fastVLMServer.summarizeActivities(
            context.screenshotDescriptions,
            context.appNames
        );

        if (result.success && result.summary) {
            console.log('[Main] Summary generated successfully:', result.summary.substring(0, 100));

            // Return the narrative summary
            return {
                success: true,
                summary: result.summary,
                metadata: {
                    technologies: [],
                    activities: []
                }
            };
        } else {
            throw new Error(result.error || 'Failed to generate summary');
        }
    } catch (error) {
        console.error('[Main] generate-activity-summary failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// AI Tempo Account Selection Handler
ipcMain.handle('select-tempo-account', async (event, request: {
    issue: LinkedJiraIssue;
    accounts: TempoAccount[];
    description?: string;
    historicalAccounts: HistoricalAccountUsage[];
    historicalEntries?: any[];  // NEW: Pass full entries for enhanced learning
}) => {
    console.log('[Main] select-tempo-account requested');
    console.log('[Main] Issue:', request.issue.key);
    console.log('[Main] Available accounts:', request.accounts.length);
    console.log('[Main] Historical records:', request.historicalAccounts.length);
    console.log('[Main] Historical entries:', request.historicalEntries?.length || 0);

    try {
        // Create AI service
        const service = new AIAccountService();

        // Get account selection
        const selection = await service.selectAccount(
            request.issue,
            request.accounts,
            {
                description: request.description,
                historicalAccounts: request.historicalAccounts,
                historicalEntries: request.historicalEntries  // NEW: Pass full entries
            }
        );

        console.log('[Main] Account selection result:', {
            hasAccount: !!selection.account,
            accountName: selection.account?.name,
            confidence: (selection.confidence * 100).toFixed(1) + '%',
            reason: selection.reason
        });

        return {
            success: true,
            selection: selection
        };
    } catch (error) {
        console.error('[Main] select-tempo-account failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            selection: null
        };
    }
});

// ========================================================================
// DATABASE IPC HANDLERS
// ========================================================================

// Entries
ipcMain.handle('db:get-all-entries', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllEntries() };
    } catch (error) {
        console.error('[Main] db:get-all-entries failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:get-entry', async (event, id: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntry(id) };
    } catch (error) {
        console.error('[Main] db:get-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:insert-entry', async (event, entry: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.insertEntry(entry);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:insert-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:update-entry', async (event, id: string, updates: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.updateEntry(id, updates);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:update-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:delete-entry', async (event, id: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteEntry(id);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:delete-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:delete-all-entries', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteAllEntries();
        return { success: true };
    } catch (error) {
        console.error('[Main] db:delete-all-entries failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Buckets
ipcMain.handle('db:get-all-buckets', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllBuckets() };
    } catch (error) {
        console.error('[Main] db:get-all-buckets failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:insert-bucket', async (event, bucket: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.insertBucket(bucket);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:insert-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:update-bucket', async (event, id: string, updates: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.updateBucket(id, updates);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:update-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:delete-bucket', async (event, id: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteBucket(id);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:delete-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Settings
ipcMain.handle('db:get-setting', async (event, key: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getSetting(key) };
    } catch (error) {
        console.error('[Main] db:get-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:set-setting', async (event, key: string, value: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.setSetting(key, value);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:set-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:delete-setting', async (event, key: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteSetting(key);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:delete-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:get-all-settings', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllSettings() };
    } catch (error) {
        console.error('[Main] db:get-all-settings failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: {} };
    }
});

// Jira Issues Cache
ipcMain.handle('db:get-all-jira-issues', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllJiraIssues() };
    } catch (error) {
        console.error('[Main] db:get-all-jira-issues failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:get-jira-issues-by-project', async (event, projectKey: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraIssuesByProject(projectKey) };
    } catch (error) {
        console.error('[Main] db:get-jira-issues-by-project failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:get-jira-issue', async (event, key: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraIssue(key) };
    } catch (error) {
        console.error('[Main] db:get-jira-issue failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:upsert-jira-issue', async (event, issue: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.upsertJiraIssue(issue);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:upsert-jira-issue failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:clear-jira-cache', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearJiraCache();
        return { success: true };
    } catch (error) {
        console.error('[Main] db:clear-jira-cache failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Jira Cache Metadata
ipcMain.handle('db:get-jira-cache-meta', async (event, key: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraCacheMeta(key) };
    } catch (error) {
        console.error('[Main] db:get-jira-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:set-jira-cache-meta', async (event, key: string, data: any, query?: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.setJiraCacheMeta(key, data, query);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:set-jira-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Tempo Cache Metadata
ipcMain.handle('db:get-tempo-cache-meta', async (event, key: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getTempoCacheMeta(key) };
    } catch (error) {
        console.error('[Main] db:get-tempo-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:set-tempo-cache-meta', async (event, key: string, data: any, query?: string) => {
    try {
        const db = DatabaseService.getInstance();
        db.setTempoCacheMeta(key, data, query);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:set-tempo-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Tempo Accounts Cache
ipcMain.handle('db:upsert-tempo-account', async (event, account: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.upsertTempoAccount(account);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:upsert-tempo-account failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:get-all-tempo-accounts', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllTempoAccounts() };
    } catch (error) {
        console.error('[Main] db:get-all-tempo-accounts failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:get-tempo-accounts-by-status', async (event, status: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getTempoAccountsByStatus(status) };
    } catch (error) {
        console.error('[Main] db:get-tempo-accounts-by-status failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});

ipcMain.handle('db:clear-tempo-cache', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearTempoCache();
        return { success: true };
    } catch (error) {
        console.error('[Main] db:clear-tempo-cache failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// ========================================================================
// AUTO-UPDATE IPC HANDLERS
// ========================================================================

// Check for updates
ipcMain.handle('updater:check-for-updates', async () => {
    console.log('[Main] updater:check-for-updates requested');
    try {
        const status = await updater.checkForUpdates();
        return { success: true, status };
    } catch (error) {
        console.error('[Main] updater:check-for-updates failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            status: updater.getStatus()
        };
    }
});

// Get current update status
ipcMain.handle('updater:get-status', async () => {
    console.log('[Main] updater:get-status requested');
    try {
        const status = updater.getStatus();
        return { success: true, status };
    } catch (error) {
        console.error('[Main] updater:get-status failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            status: {
                available: false,
                downloaded: false,
                downloading: false
            }
        };
    }
});

// Download update
ipcMain.handle('updater:download-update', async () => {
    console.log('[Main] updater:download-update requested');
    try {
        await updater.downloadUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Main] updater:download-update failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Install update and restart
ipcMain.handle('updater:quit-and-install', async () => {
    console.log('[Main] updater:quit-and-install requested');
    try {
        updater.quitAndInstall();
        return { success: true };
    } catch (error) {
        console.error('[Main] updater:quit-and-install failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Configure updater
ipcMain.handle('updater:configure', async (event, options: {
    checkOnStartup?: boolean;
    checkOnStartupDelay?: number;
    autoDownload?: boolean;
    allowPrerelease?: boolean;
}) => {
    console.log('[Main] updater:configure requested:', options);
    try {
        updater.configure(options);
        return { success: true };
    } catch (error) {
        console.error('[Main] updater:configure failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Crawler State
ipcMain.handle('db:get-crawler-state', async (event, projectKey: string) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getCrawlerState(projectKey) };
    } catch (error) {
        console.error('[Main] db:get-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

ipcMain.handle('db:set-crawler-state', async (event, projectKey: string, state: any) => {
    try {
        const db = DatabaseService.getInstance();
        db.setCrawlerState(projectKey, state);
        return { success: true };
    } catch (error) {
        console.error('[Main] db:set-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

ipcMain.handle('db:clear-crawler-state', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearCrawlerState();
        return { success: true };
    } catch (error) {
        console.error('[Main] db:clear-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});

// Database Stats
ipcMain.handle('db:get-stats', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getStats() };
    } catch (error) {
        console.error('[Main] db:get-stats failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});

// Migration
ipcMain.handle('db:needs-migration', async () => {
    try {
        return { success: true, needsMigration: MigrationService.needsMigration() };
    } catch (error) {
        console.error('[Main] db:needs-migration failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', needsMigration: false };
    }
});

ipcMain.handle('db:migrate-from-localstorage', async (event, localStorageData: Record<string, string>) => {
    try {
        console.log('[Main] Starting migration from localStorage...');
        const result = await MigrationService.migrateFromLocalStorage(localStorageData);
        return { success: true, result };
    } catch (error) {
        console.error('[Main] db:migrate-from-localstorage failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            result: {
                success: false,
                entriesMigrated: 0,
                bucketsMigrated: 0,
                jiraIssuesMigrated: 0,
                crawlerStatesMigrated: 0,
                settingsMigrated: 0,
                errors: [error instanceof Error ? error.message : 'Unknown error']
            }
        };
    }
});

// ========================================================================
// APP BLACKLIST IPC HANDLERS
// ========================================================================

// Get all blacklisted apps
ipcMain.handle('get-blacklisted-apps', async () => {
    console.log('[Main] get-blacklisted-apps requested');
    try {
        const blacklistService = BlacklistService.getInstance();
        const apps = blacklistService.getAllBlacklistedApps();
        return { success: true, data: apps };
    } catch (error) {
        console.error('[Main] get-blacklisted-apps failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});

// Add app to blacklist
ipcMain.handle('add-blacklisted-app', async (event, bundleId: string, name: string, category?: string) => {
    console.log('[Main] add-blacklisted-app requested:', { bundleId, name, category });
    try {
        const blacklistService = BlacklistService.getInstance();
        blacklistService.addApp(bundleId, name, category);
        return { success: true };
    } catch (error) {
        console.error('[Main] add-blacklisted-app failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Remove app from blacklist
ipcMain.handle('remove-blacklisted-app', async (event, bundleId: string) => {
    console.log('[Main] remove-blacklisted-app requested:', bundleId);
    try {
        const blacklistService = BlacklistService.getInstance();
        blacklistService.removeApp(bundleId);
        return { success: true };
    } catch (error) {
        console.error('[Main] remove-blacklisted-app failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Check if app is blacklisted
ipcMain.handle('is-app-blacklisted', async (event, bundleId: string) => {
    console.log('[Main] is-app-blacklisted requested:', bundleId);
    try {
        const blacklistService = BlacklistService.getInstance();
        const isBlacklisted = blacklistService.isAppBlacklisted(bundleId);
        return { success: true, isBlacklisted };
    } catch (error) {
        console.error('[Main] is-app-blacklisted failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            isBlacklisted: false
        };
    }
});

// Refresh blacklist cache
ipcMain.handle('refresh-blacklist', async () => {
    console.log('[Main] refresh-blacklist requested');
    try {
        const blacklistService = BlacklistService.getInstance();
        blacklistService.refreshBlacklist();
        return { success: true };
    } catch (error) {
        console.error('[Main] refresh-blacklist failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Get list of installed apps (macOS only)
ipcMain.handle('get-installed-apps', async () => {
    console.log('[Main] get-installed-apps requested');

    if (process.platform !== 'darwin') {
        console.log('[Main] get-installed-apps: Not macOS, returning empty list');
        return {
            success: false,
            error: 'App discovery is only available on macOS',
            data: []
        };
    }

    try {
        const apps = await AppDiscoveryService.getInstalledApps();
        console.log(`[Main] Found ${apps.length} installed apps`);

        // Convert to serializable format with iconPath included
        const serializedApps = apps.map(app => ({
            bundleId: app.bundleId,
            name: app.name,
            path: app.path,
            category: app.category,
            categoryName: AppDiscoveryService.getCategoryName(app.category),
            iconPath: app.iconPath
        }));

        // Log icon statistics
        const appsWithIcons = serializedApps.filter(app => app.iconPath);
        console.log(`[Main] Apps with icons: ${appsWithIcons.length}/${apps.length}`);

        // Log first 3 apps with icons for debugging
        if (appsWithIcons.length > 0) {
            console.log('[Main] Sample apps with icons:');
            appsWithIcons.slice(0, 3).forEach(app => {
                console.log(`  - ${app.name}: ${app.iconPath}`);
            });
        }

        return { success: true, data: serializedApps };
    } catch (error) {
        console.error('[Main] get-installed-apps failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});

// Convert .icns icon to base64 data URL for display in UI
ipcMain.handle('get-app-icon-base64', async (_event, iconPath: string) => {
    console.log(`[Main] get-app-icon-base64 requested for: ${iconPath}`);

    if (!iconPath) {
        console.log('[Main] get-app-icon-base64: No icon path provided');
        return { success: false, error: 'No icon path provided' };
    }

    if (!fs.existsSync(iconPath)) {
        console.log(`[Main] get-app-icon-base64: Icon path does not exist: ${iconPath}`);
        return { success: false, error: 'Icon path does not exist' };
    }

    try {
        // Use nativeImage to convert .icns to PNG
        const image = nativeImage.createFromPath(iconPath);
        if (image.isEmpty()) {
            console.log(`[Main] get-app-icon-base64: Failed to load icon (empty image): ${iconPath}`);
            return { success: false, error: 'Failed to load icon (empty image)' };
        }

        // Resize to a reasonable size (64x64) to keep data URL small
        const resized = image.resize({ width: 64, height: 64 });
        const png = resized.toPNG();
        const base64 = png.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        console.log(`[Main] get-app-icon-base64: Successfully converted icon (${Math.round(dataUrl.length / 1024)}KB)`);
        return { success: true, dataUrl };
    } catch (error) {
        console.error('[Main] get-app-icon-base64 failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// ========================================================================
// TEMPO ACCOUNT BLACKLIST IPC HANDLERS
// ========================================================================

// Get all blacklisted Tempo accounts
ipcMain.handle('get-blacklisted-tempo-accounts', async () => {
    console.log('[Main] get-blacklisted-tempo-accounts requested');
    try {
        const dbService = DatabaseService.getInstance();
        const accounts = dbService.getAllBlacklistedTempoAccounts();
        return { success: true, data: accounts };
    } catch (error) {
        console.error('[Main] get-blacklisted-tempo-accounts failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});

// Add Tempo account to blacklist
ipcMain.handle('add-blacklisted-tempo-account', async (event, accountKey: string, accountId: string, name: string) => {
    console.log('[Main] add-blacklisted-tempo-account requested:', { accountKey, accountId, name });
    try {
        const dbService = DatabaseService.getInstance();
        dbService.addBlacklistedTempoAccount(accountKey, accountId, name);
        return { success: true };
    } catch (error) {
        console.error('[Main] add-blacklisted-tempo-account failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Remove Tempo account from blacklist
ipcMain.handle('remove-blacklisted-tempo-account', async (event, accountKey: string) => {
    console.log('[Main] remove-blacklisted-tempo-account requested:', accountKey);
    try {
        const dbService = DatabaseService.getInstance();
        dbService.removeBlacklistedTempoAccount(accountKey);
        return { success: true };
    } catch (error) {
        console.error('[Main] remove-blacklisted-tempo-account failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});

// Check if Tempo account is blacklisted
ipcMain.handle('is-tempo-account-blacklisted', async (event, accountKey: string) => {
    console.log('[Main] is-tempo-account-blacklisted requested:', accountKey);
    try {
        const dbService = DatabaseService.getInstance();
        const isBlacklisted = dbService.isTempoAccountBlacklisted(accountKey);
        return { success: true, isBlacklisted };
    } catch (error) {
        console.error('[Main] is-tempo-account-blacklisted failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            isBlacklisted: false
        };
    }
});

/**
 * Comprehensive cleanup of all app resources
 * Ensures no orphan processes remain after quit
 */
async function cleanupAndQuit(): Promise<void> {
    console.log('[Main] Starting comprehensive cleanup...');

    try {
        // 1. Cleanup subscription system (webhook server, trial notifications)
        await cleanupSubscription();

        // 2. Cleanup auto-updater interval
        updater.cleanup();

        // 3. Destroy tray icon
        if (tray) {
            tray.destroy();
            tray = null;
            console.log('[Main] Tray icon destroyed');
        }

        // 4. Close all windows
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(window => {
            if (!window.isDestroyed()) {
                window.destroy();
            }
        });
        console.log('[Main] All windows closed');

        console.log('[Main] Cleanup completed successfully');
    } catch (error) {
        console.error('[Main] Error during cleanup:', error);
    } finally {
        // Force quit the app to ensure all processes are terminated
        // Using app.exit() instead of app.quit() to bypass any remaining handlers
        app.exit(0);
    }
}

function createTray() {
    // In packaged app, tray icons are in resources folder; in dev, they're in public/
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'tray-icon.png')
        : path.join(process.env.VITE_PUBLIC || '', 'tray-icon.png');
    console.log('Tray Icon Path:', iconPath);
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    // Set initial title and tooltip
    tray.setTitle(''); // Start with empty title (icon only)
    tray.setToolTip('Clearical');

    // Click toggles the main window
    tray.on('click', () => {
        toggleWindow();
    });

    // Right-click shows context menu
    tray.on('right-click', () => {
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Quit', click: () => {
                // Use comprehensive cleanup instead of simple quit
                cleanupAndQuit();
            } }
        ]);
        tray?.popUpContextMenu(contextMenu);
    });
}

function getWindowPosition() {
    const windowBounds = win?.getBounds();
    const trayBounds = tray?.getBounds();

    if (!windowBounds || !trayBounds) {
        console.warn('[Main] Cannot calculate window position - missing bounds', {
            hasWindowBounds: !!windowBounds,
            hasTrayBounds: !!trayBounds,
            trayBounds
        });
        return null;
    }

    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);

    return { x, y };
}

function toggleWindow() {
    if (win?.isVisible()) {
        win.hide();
    } else {
        const position = getWindowPosition();
        if (position) {
            win?.setPosition(position.x, position.y, false);
        } else {
            console.warn('[Main] Unable to position window, showing at last known position');
        }
        win?.show();
        win?.focus();
    }
}

function showWindowBelowTray() {
    if (!win || !tray) {
        console.warn('[Main] Cannot show window - window or tray not initialized');
        return;
    }

    const position = getWindowPosition();
    if (!position) {
        console.warn('[Main] Cannot show window - tray bounds not available yet, will retry');
        // Retry after a short delay to allow tray to fully initialize
        setTimeout(() => {
            showWindowBelowTray();
        }, 50);
        return;
    }

    win.setPosition(position.x, position.y, false);
    win.show();
    win.focus();
    console.log('[Main] Window shown below tray icon at position:', position);
}

function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);

    win = new BrowserWindow({
        width: 520,
        height: 660,
        show: false, // Don't show immediately - we'll position and show after tray is ready
        frame: false,
        resizable: true,
        minWidth: 400,
        minHeight: 300,
        movable: true,
        minimizable: true,  // Enable minimize to dock
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: false, // Show in dock
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: false,
            devTools: false // Disable devTools
        },
    });

    // Position window off-screen initially to prevent flash at (0,0)
    // This prevents the window from appearing in lower-left corner before repositioning
    win.setPosition(-9999, -9999);

    // In test mode or production, load from built files
    // In development (not test), load from Vite dev server
    const isTestMode = process.env.NODE_ENV === 'test';

    if (!app.isPackaged && !isTestMode) {
        win.loadURL('http://127.0.0.1:5173');
        // win.webContents.openDevTools({ mode: 'detach' });
    } else {
        // Use loadFile for production/test - it has built-in asar support
        // Electron's loadFile() correctly handles files inside asar archives
        const indexPath = path.join(process.env.DIST || '', 'index.html');
        console.log('[Main] Loading index.html from:', indexPath);
        win.loadFile(indexPath);
    }

    // Handle dock icon click on macOS
    if (process.platform === 'darwin') {
        win.on('close', (event) => {
            // Prevent window from closing completely - just hide it
            event.preventDefault();
            win?.hide();
        });
    }

    win.on('blur', () => {
        if (!win?.webContents.isDevToolsOpened()) {
            win?.hide();
        }
    });
}

// Track if cleanup has already been initiated to prevent multiple cleanups
let isCleaningUp = false;

app.on('before-quit', async (event) => {
    if (!isCleaningUp) {
        // Prevent the app from quitting until cleanup is complete
        event.preventDefault();
        isCleaningUp = true;

        console.log('[Main] App quitting, performing cleanup...');
        await cleanupAndQuit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Don't call app.quit() directly, use cleanupAndQuit instead
        if (!isCleaningUp) {
            cleanupAndQuit();
        }
    }
});

// Handle app activation (macOS)
// Note: Since dock icon is hidden, this mainly handles edge cases
app.on('activate', () => {
    if (win === null) {
        createTray();
        createWindow();
        // Give tray time to initialize before showing window
        setTimeout(() => {
            showWindowBelowTray();
        }, 150);
    } else {
        toggleWindow();
    }
});

app.whenReady().then(() => {
    // Initialize encryption key on app startup
    try {
        getEncryptionKey();
        console.log('[Main] Encryption system initialized');
    } catch (error) {
        console.error('[Main] Failed to initialize encryption:', error);
        console.warn('[Main] Screenshots will be saved unencrypted as fallback');
    }

    // Initialize auth system (Supabase)
    try {
        initializeAuth();
        console.log('[Main] Auth system initialized (Supabase)');
    } catch (error) {
        console.error('[Main] Failed to initialize auth:', error);
    }

    // Initialize subscription system (Stripe-based)
    try {
        initializeSubscription();
        console.log('[Main] Subscription system initialized (Stripe)');
    } catch (error) {
        console.error('[Main] Failed to initialize subscription system:', error);
        console.warn('[Main] App will run without subscription features');
    }

    // FastVLM server is now on-demand - it will start automatically when needed
    // and shut down after 60 seconds of inactivity to save resources
    console.log('[Main] FastVLM server configured for on-demand startup');
    console.log('[Main] Server will start when first screenshot analysis is requested');

    // Create tray first to ensure it's fully initialized before window positioning
    createTray();

    // Create window (it will be positioned off-screen initially)
    createWindow();

    // Hide dock icon on macOS - app only appears in menu bar
    // Do this before showing window to avoid visual glitches
    if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
        console.log('[Main] Dock icon hidden - app runs from menu bar only');
    }

    // Now that both tray and window are created, show the window below the tray icon
    // The showWindowBelowTray function has built-in retry logic if tray bounds aren't ready
    // We use a small delay to ensure the tray icon is fully rendered by the OS
    setTimeout(() => {
        showWindowBelowTray();
    }, 150);

    // Initialize auto-updater
    // Set main window reference so updater can send status updates
    updater.setMainWindow(win);
    // Start auto-update checks (with delay)
    updater.start();
    console.log('[Main] Auto-updater initialized');
});
