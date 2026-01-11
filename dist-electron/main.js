import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, systemPreferences, shell, desktopCapturer, dialog } from 'electron';
import { spawn } from 'child_process';
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
}
else {
    console.log('[Main] No .env.local found at:', envPath);
}
import { saveEncryptedFile, decryptFile, getEncryptionKey } from './encryption.js';
import { storeCredential, getCredential, deleteCredential, hasCredential, listCredentialKeys, isSecureStorageAvailable } from './credentialStorage.js';
import { initializeLicensing } from './licensing/ipcHandlers.js';
import { initializeSubscription, cleanupSubscription } from './subscription/ipcHandlers.js';
import { initializeAuth } from './auth/ipcHandlers.js';
import { AIAssignmentService } from './aiAssignmentService.js';
import { AIAccountService } from './aiAccountService.js';
import { DatabaseService } from './databaseService.js';
import { MigrationService } from './migration.js';
import { updater } from './autoUpdater.js';
import { AppDiscoveryService } from './appDiscoveryService.js';
import { BlacklistService } from './blacklistService.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production (packaged), app.getAppPath() returns the path to the asar file
// In development, it returns the project root directory
// This ensures DIST always points to the correct absolute path
const appPath = app.getAppPath();
process.env.DIST = app.isPackaged
    ? path.join(appPath, 'dist') // In asar: /path/to/app.asar/dist
    : path.join(__dirname, '../dist'); // In dev: project-root/dist
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');
// Handle EPIPE errors gracefully to prevent crash dialogs
// EPIPE occurs when console.log tries to write to a closed stdout pipe
// This is common in Electron apps and should not crash the application
process.on('uncaughtException', (error) => {
    // Check if this is an EPIPE error
    if ('code' in error && error.code === 'EPIPE') {
        // EPIPE errors are non-fatal - the console output destination is unavailable
        // This commonly happens when stdout is redirected to a closed pipe
        // Silently ignore these errors to prevent crash dialogs
        return;
    }
    // For all other uncaught exceptions, log them and show error dialog
    console.error('[Main] Uncaught Exception:', error);
    // In production, we might want to show an error dialog
    if (app.isReady()) {
        dialog.showErrorBox('Unexpected Error', `An unexpected error occurred: ${error.message}\n\nThe application will continue running.`);
    }
});
// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    console.error('[Main] Unhandled Promise Rejection:', reason);
});
// Wrap console methods to handle EPIPE errors gracefully
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const safeConsoleWrapper = (originalMethod) => {
    return (...args) => {
        try {
            originalMethod.apply(console, args);
        }
        catch (error) {
            // Silently ignore EPIPE errors in console output
            if (error.code !== 'EPIPE') {
                // If it's not an EPIPE error, try to report it via stderr
                try {
                    process.stderr.write(`Console output error: ${error.message}\n`);
                }
                catch {
                    // If even stderr fails, there's nothing we can do
                }
            }
        }
    };
};
console.log = safeConsoleWrapper(originalConsoleLog);
console.error = safeConsoleWrapper(originalConsoleError);
console.warn = safeConsoleWrapper(originalConsoleWarn);
let win;
let tray;
let currentTimerText = '';
// Timer state managed in main process to avoid renderer throttling
let timerState = {
    isRunning: false,
    isPaused: false,
    startTime: null,
    elapsed: 0
};
let timerInterval = null;
/**
 * Convert regular digits to monospace digits to prevent menu bar jiggling.
 * Uses Unicode Numeric Forms block (U+1D7F6 - U+1D7FF) which renders as fixed-width.
 * Falls back to padding with hair spaces if monospace digits aren't supported.
 */
function toMonospaceDigits(text) {
    // Map of regular digits to their monospace equivalents
    const monoDigits = {
        '0': '𝟶',
        '1': '𝟷',
        '2': '𝟸',
        '3': '𝟹',
        '4': '𝟺',
        '5': '𝟻',
        '6': '𝟼',
        '7': '𝟽',
        '8': '𝟾',
        '9': '𝟿'
    };
    return text.split('').map(char => monoDigits[char] || char).join('');
}
/**
 * Format elapsed time in milliseconds to HH:MM:SS
 */
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
/**
 * Update the tray title based on current timer state.
 * This runs in the main process and is not affected by renderer throttling.
 */
function updateTrayTitle() {
    if (!tray)
        return;
    if (timerState.isRunning && !timerState.isPaused && timerState.startTime) {
        // Calculate current elapsed time
        const elapsed = Date.now() - timerState.startTime;
        const formattedTime = formatTime(elapsed);
        const monoTime = toMonospaceDigits(formattedTime);
        currentTimerText = monoTime;
        if (process.platform === 'darwin') {
            tray.setTitle(monoTime);
        }
    }
    else if (timerState.isPaused) {
        // Show paused state with last elapsed time
        const formattedTime = formatTime(timerState.elapsed);
        const monoTime = toMonospaceDigits(formattedTime);
        currentTimerText = `⏸ ${monoTime}`;
        if (process.platform === 'darwin') {
            tray.setTitle(`⏸ ${monoTime}`);
        }
    }
    else {
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
function startTimerInterval() {
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
function stopTimerInterval() {
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
        let currentWindow = null;
        try {
            // Get the active window using our existing handler
            if (process.platform === 'darwin') {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                // Get active app name, window title, and bundle ID
                const result = await execAsync(`osascript -e '
                    tell application "System Events"
                        set frontApp to first application process whose frontmost is true
                        set appName to name of frontApp
                        set bundleId to bundle identifier of frontApp
                        try
                            set windowTitle to title of front window of frontApp
                        on error
                            set windowTitle to "(No window title available)"
                        end try
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
        }
        catch (error) {
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
                const exactTitleMatch = validSources.find(source => source.name === currentWindow.windowTitle);
                if (exactTitleMatch) {
                    targetSource = exactTitleMatch;
                    console.log('[Main] Found exact window title match:', targetSource.name);
                }
                else {
                    // Strategy 2: Match windows that contain the app name
                    const appNameMatches = validSources.filter(source => {
                        const sourceLower = source.name.toLowerCase();
                        const appNameLower = currentWindow.appName.toLowerCase();
                        // Check if the window name contains the app name or vice versa
                        return sourceLower.includes(appNameLower) || appNameLower.includes(sourceLower);
                    });
                    if (appNameMatches.length > 0) {
                        // If multiple matches, prefer the one with the window title
                        const titleMatch = appNameMatches.find(source => source.name.includes(currentWindow.windowTitle) ||
                            currentWindow.windowTitle.includes(source.name));
                        targetSource = titleMatch || appNameMatches[0];
                        console.log('[Main] Found app name match:', targetSource.name, 'from', appNameMatches.length, 'candidates');
                    }
                    else {
                        // Strategy 3: Enhanced partial title matching for browsers
                        let partialMatch = null;
                        // Try matching by removing browser-specific suffixes
                        const cleanTitle = currentWindow.windowTitle
                            .replace(/ - Audio playing.*/i, '') // Remove "- Audio playing - Browser"
                            .replace(/ - Google Chrome$/i, '') // Remove "- Google Chrome"
                            .replace(/ - Safari$/i, '') // Remove "- Safari"
                            .replace(/ - Firefox$/i, '') // Remove "- Firefox"
                            .replace(/ - Brave$/i, '') // Remove "- Brave"
                            .replace(/ - Opera$/i, '') // Remove "- Opera"
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
                        }
                        else {
                            console.log('[Main] No window match found. App:', currentWindow.appName, 'Title:', currentWindow.windowTitle);
                            console.log('[Main] Available windows:', validSources.map(s => s.name));
                        }
                    }
                }
            }
            else {
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
                }
                else if (validSources.length > 1 && currentWindow?.appName) {
                    // Try a more lenient matching: find any window containing part of the app name
                    const appNameWords = currentWindow.appName.toLowerCase().split(/\s+/);
                    const possibleMatches = validSources.filter(source => {
                        const sourceLower = source.name.toLowerCase();
                        return appNameWords.some(word => word.length > 3 && sourceLower.includes(word));
                    });
                    if (possibleMatches.length > 0) {
                        targetSource = possibleMatches[0];
                        console.log('[Main] Using lenient app name match:', targetSource.name);
                    }
                    else {
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
            console.log('[Main] Capturing window:', targetSource.name, `(${targetSource.thumbnail.getSize().width}x${targetSource.thumbnail.getSize().height})`);
            const image = targetSource.thumbnail.toPNG();
            // Create a more descriptive filename with app name and timestamp
            const timestamp = Date.now();
            const appNameSafe = (currentWindow?.appName || 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
            const windowTitleSafe = targetSource.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const filename = `${timestamp}_${appNameSafe}_${windowTitleSafe}.png`;
            const filePath = path.join(SCREENSHOTS_DIR, filename);
            // Save screenshot with encryption
            try {
                await saveEncryptedFile(filePath, image);
                console.log('[Main] Window screenshot saved (encrypted):', filePath);
            }
            catch (encryptError) {
                console.error('[Main] Failed to encrypt screenshot, saving unencrypted:', encryptError);
                // Fallback to unencrypted if encryption fails
                await fs.promises.writeFile(filePath, image);
                console.log('[Main] Window screenshot saved (unencrypted fallback):', filePath);
            }
            return filePath;
        }
        else {
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
                // Save screenshot with encryption
                try {
                    await saveEncryptedFile(filePath, image);
                    console.log('[Main] Screen screenshot saved (encrypted, fallback):', filePath);
                }
                catch (encryptError) {
                    console.error('[Main] Failed to encrypt screenshot, saving unencrypted:', encryptError);
                    // Fallback to unencrypted if encryption fails
                    await fs.promises.writeFile(filePath, image);
                    console.log('[Main] Screen screenshot saved (unencrypted fallback):', filePath);
                }
                return filePath;
            }
        }
    }
    catch (error) {
        console.error('[Main] Failed to capture screenshot:', error);
    }
    return null;
});
// Activity Summary Generation with Apple Intelligence
ipcMain.handle('generate-activity-summary', async (event, context) => {
    console.log('[Main] generate-activity-summary requested');
    console.log('[Main] Context:', {
        descriptionsCount: context.screenshotDescriptions.length,
        windowTitlesCount: context.windowTitles.length,
        appNamesCount: context.appNames.length,
        duration: context.duration
    });
    if (process.platform !== 'darwin') {
        console.log('[Main] generate-activity-summary: Not macOS, returning fallback');
        return {
            success: false,
            error: 'AI summary generation only available on macOS',
            summary: null
        };
    }
    // Path to our Swift helper - relative to app root
    // In development: native/screenshot-analyzer/build/screenshot-analyzer
    // In production: bundled with the app in resources
    const helperPath = app.isPackaged
        ? path.join(process.resourcesPath, 'screenshot-analyzer')
        : path.join(app.getAppPath(), 'native', 'screenshot-analyzer', 'build', 'screenshot-analyzer');
    // Check if the helper exists
    if (!fs.existsSync(helperPath)) {
        console.log('[Main] generate-activity-summary: Swift helper not found at:', helperPath);
        return {
            success: false,
            error: 'Vision Framework helper not built. Run: cd native/screenshot-analyzer && ./build.sh',
            summary: null
        };
    }
    try {
        // Build a comprehensive context string for analysis
        const durationMinutes = Math.round(context.duration / 1000 / 60);
        const startDate = new Date(context.startTime);
        const endDate = new Date(context.endTime);
        // Create a text-based context that simulates what we'd extract from screenshots
        const contextLines = [];
        // Add temporal context
        contextLines.push(`Time Session: ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}`);
        contextLines.push(`Duration: ${durationMinutes} minutes`);
        contextLines.push('');
        // Add app context
        if (context.appNames.length > 0) {
            contextLines.push('Applications Used:');
            context.appNames.forEach(app => contextLines.push(`- ${app}`));
            contextLines.push('');
        }
        // Add window titles context
        if (context.windowTitles.length > 0) {
            contextLines.push('Window Titles:');
            context.windowTitles.forEach(title => contextLines.push(`- ${title}`));
            contextLines.push('');
        }
        // Add screenshot analysis context
        if (context.screenshotDescriptions.length > 0) {
            contextLines.push('Activity Analysis from Screenshots:');
            context.screenshotDescriptions.forEach((desc, idx) => {
                contextLines.push(`${idx + 1}. ${desc}`);
            });
        }
        const fullContext = contextLines.join('\n');
        // Create a summarization prompt
        const summarizationRequest = {
            mode: 'summarize',
            context: fullContext,
            appNames: context.appNames,
            windowTitles: context.windowTitles,
            screenshotDescriptions: context.screenshotDescriptions,
            duration: context.duration
        };
        console.log('[Main] Generating summary with context length:', fullContext.length);
        // For now, we'll create a simple heuristic-based summary since we're using text-only
        // In a future iteration, this could call a local LLM or use more sophisticated analysis
        const result = generateTextBasedSummary(context);
        console.log('[Main] generate-activity-summary success:', result.summary.substring(0, 100) + '...');
        console.log('[Main] Detected activities:', result.metadata.detectedActivities);
        console.log('[Main] Detected technologies:', result.metadata.detectedTechnologies);
        return {
            success: true,
            summary: result.summary,
            metadata: result.metadata,
            error: null
        };
    }
    catch (error) {
        console.error('[Main] generate-activity-summary failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            summary: null
        };
    }
});
/**
 * Helper function to generate a narrative-focused activity summary
 *
 * This function analyzes screenshot descriptions, window titles, and app context
 * to build a cohesive narrative about what the user worked on. The summary focuses
 * on the "what" rather than the "how long", creating a work log entry style description.
 */
function generateTextBasedSummary(context) {
    // Combine all available text for comprehensive analysis
    const allText = [
        ...context.screenshotDescriptions,
        ...context.windowTitles,
        ...context.appNames
    ].join(' ').toLowerCase();
    // Detect primary activities with more granular patterns
    const activities = [];
    const activityPatterns = [
        { patterns: ['implement', 'build', 'creat', 'develop', 'add', 'writing', 'coding'], label: 'implementing' },
        { patterns: ['debug', 'fix', 'error', 'troubleshoot', 'resolv'], label: 'debugging' },
        { patterns: ['refactor', 'restructur', 'reorganiz', 'clean'], label: 'refactoring' },
        { patterns: ['test', 'qa', 'quality'], label: 'testing' },
        { patterns: ['document', 'readme', 'comment', 'annotation'], label: 'documenting' },
        { patterns: ['design', 'ui', 'ux', 'interface', 'layout'], label: 'designing' },
        { patterns: ['research', 'investigat', 'explor', 'learn'], label: 'researching' },
        { patterns: ['review', 'audit', 'inspect', 'analyz'], label: 'reviewing' },
        { patterns: ['deploy', 'release', 'ship', 'publish'], label: 'deploying' },
        { patterns: ['configur', 'setup', 'install'], label: 'configuring' }
    ];
    activityPatterns.forEach(({ patterns, label }) => {
        if (patterns.some(p => allText.includes(p)) && !activities.includes(label)) {
            activities.push(label);
        }
    });
    // Enhanced technology detection with common frameworks and tools
    const technologies = [];
    const techPatterns = [
        { pattern: /\b(react|reactjs|react\.js)\b/i, name: 'React' },
        { pattern: /\btypescript\b/i, name: 'TypeScript' },
        { pattern: /\bjavascript\b/i, name: 'JavaScript' },
        { pattern: /\belectron\b/i, name: 'Electron' },
        { pattern: /\b(swift|swiftui)\b/i, name: 'Swift' },
        { pattern: /\bpython\b/i, name: 'Python' },
        { pattern: /\b(node|nodejs|node\.js)\b/i, name: 'Node.js' },
        { pattern: /\b(git|github|gitlab)\b/i, name: 'Git' },
        { pattern: /\bdocker\b/i, name: 'Docker' },
        { pattern: /\bjira\b/i, name: 'Jira' },
        { pattern: /\b(api|rest|graphql)\b/i, name: 'API' },
        { pattern: /\b(vue|vuejs)\b/i, name: 'Vue' },
        { pattern: /\bangular\b/i, name: 'Angular' },
        { pattern: /\b(postgres|postgresql|mysql|mongodb)\b/i, name: 'Database' },
        { pattern: /\b(aws|azure|gcp|cloud)\b/i, name: 'Cloud' },
        { pattern: /\b(kubernetes|k8s)\b/i, name: 'Kubernetes' }
    ];
    techPatterns.forEach(({ pattern, name }) => {
        if (pattern.test(allText) && !technologies.includes(name)) {
            technologies.push(name);
        }
    });
    // Extract project name from descriptions and window titles
    let projectName = null;
    const projectPatterns = [
        /\b(timeportal|time[\s-]?portal|clearical)\b/gi,
        /\bthe\s+([A-Z][a-zA-Z]{3,20})\s+(?:app|application|project|system)\b/g,
        /\b([A-Z][a-zA-Z]{3,20})\s+(?:application|project)\b/g
    ];
    for (const pattern of projectPatterns) {
        const matches = allText.match(pattern);
        if (matches && matches.length > 0) {
            const match = matches[0].trim();
            if (match.toLowerCase().includes('timeportal') || match.toLowerCase().includes('time portal') || match.toLowerCase().includes('clearical')) {
                projectName = 'Clearical';
                break;
            }
            // Extract project name from pattern captures
            const cleanMatch = match.replace(/\b(the|app|application|project|system)\b/gi, '').trim();
            if (cleanMatch.length > 3 && cleanMatch.length < 30) {
                projectName = cleanMatch.charAt(0).toUpperCase() + cleanMatch.slice(1).toLowerCase();
                break;
            }
        }
    }
    // Extract file and directory context from descriptions
    const fileMatches = allText.match(/\b([a-zA-Z0-9_-]+\.(ts|tsx|js|jsx|py|swift|java|go|rs|cpp|c|h|json|yaml|yml))\b/gi);
    const dirMatches = allText.match(/\b(electron|native|components|services|handlers|api|utils|lib|src)(?:\s+(?:directory|folder|module))?/gi);
    const files = fileMatches ? [...new Set(fileMatches.slice(0, 3))].map(f => f.toLowerCase()) : [];
    const directories = dirMatches ? [...new Set(dirMatches.slice(0, 2))].map(d => d.replace(/\s+(directory|folder|module)$/i, '').trim()) : [];
    // Extract specific work context from screenshot descriptions
    const workContext = [];
    context.screenshotDescriptions.forEach(desc => {
        const descLower = desc.toLowerCase();
        // Extract main action/focus from descriptions
        if (descLower.includes('main process') || descLower.includes('main.ts') || descLower.includes('main.js')) {
            workContext.push('the Electron main process');
        }
        if (descLower.includes('build') && (descLower.includes('config') || descLower.includes('output'))) {
            workContext.push('build configuration');
        }
        if (descLower.includes('terminal') && descLower.includes('compil')) {
            workContext.push('compilation issues');
        }
        if (descLower.includes('problems panel') || descLower.includes('error') || descLower.includes('debug')) {
            workContext.push('troubleshooting errors');
        }
        if (descLower.includes('file explorer') || descLower.includes('file tree')) {
            workContext.push('project structure');
        }
    });
    // Build a narrative summary (3-5 sentences)
    const sentences = [];
    // Sentence 1: Main activity + project context
    let firstSentence = '';
    if (projectName) {
        if (activities.length > 0) {
            const primaryActivity = activities[0].charAt(0).toUpperCase() + activities[0].slice(1);
            firstSentence = `${primaryActivity} the ${projectName} application`;
        }
        else {
            firstSentence = `Worked on the ${projectName} application`;
        }
    }
    else if (activities.length > 0) {
        const primaryActivity = activities[0].charAt(0).toUpperCase() + activities[0].slice(1);
        firstSentence = `${primaryActivity} work on a software project`;
    }
    else {
        firstSentence = 'Worked on software development tasks';
    }
    // Add technology stack to first sentence
    if (technologies.length > 0) {
        const techStack = technologies.slice(0, 2).join(' and ');
        firstSentence += `, utilizing ${techStack}`;
    }
    sentences.push(firstSentence + '.');
    // Sentence 2: Specific focus area (files, directories, features)
    const focusElements = [];
    if (workContext.length > 0) {
        focusElements.push(...workContext.slice(0, 2));
    }
    if (directories.length > 0 && workContext.length === 0) {
        const dirList = directories.slice(0, 2).join(' and ');
        focusElements.push(`the ${dirList} ${directories.length === 1 ? 'directory' : 'directories'}`);
    }
    if (files.length > 0 && focusElements.length === 0) {
        const fileList = files.slice(0, 2).join(', ');
        focusElements.push(fileList);
    }
    if (focusElements.length > 0) {
        const focusDescription = focusElements.join(', focusing on ');
        if (focusDescription.includes('the ') || focusDescription.includes('.ts') || focusDescription.includes('.js')) {
            sentences.push(`Focused on ${focusDescription}.`);
        }
        else {
            sentences.push(`Worked primarily on ${focusDescription}.`);
        }
    }
    // Sentence 3: IDE and tools used
    const uniqueApps = [...new Set(context.appNames)].filter(app => app && !['Electron', 'Time-Portal', 'TimePortal', 'Clearical', 'Unknown'].includes(app));
    if (uniqueApps.length > 0) {
        const toolsDesc = uniqueApps.length === 1
            ? uniqueApps[0]
            : `${uniqueApps.slice(0, -1).join(', ')} and ${uniqueApps[uniqueApps.length - 1]}`;
        // Check if debugging or terminal work was mentioned
        if (allText.includes('debug') || allText.includes('problems panel')) {
            sentences.push(`Used ${toolsDesc} with debugging tools and error panels for troubleshooting.`);
        }
        else if (allText.includes('terminal') || allText.includes('command')) {
            sentences.push(`Used ${toolsDesc} with integrated terminal for development tasks.`);
        }
        else {
            sentences.push(`Development environment: ${toolsDesc}.`);
        }
    }
    // Sentence 4: Additional activities
    if (activities.length > 1) {
        const secondaryActivities = activities.slice(1, 3);
        const activityList = secondaryActivities.join(' and ');
        sentences.push(`Additional work included ${activityList}.`);
    }
    // Calculate confidence based on richness of context
    let confidence = 0.3; // Base confidence
    if (context.screenshotDescriptions.length > 0)
        confidence += 0.2;
    if (context.screenshotDescriptions.length > 2)
        confidence += 0.1;
    if (activities.length > 0)
        confidence += 0.15;
    if (technologies.length > 0)
        confidence += 0.15;
    if (workContext.length > 0 || files.length > 0)
        confidence += 0.1;
    // Join sentences with proper spacing
    const summary = sentences.join(' ');
    return {
        summary,
        metadata: {
            detectedActivities: activities,
            detectedTechnologies: technologies,
            confidence: Math.min(confidence, 1.0)
        }
    };
}
// Screenshot Analysis with TWO-STAGE ARCHITECTURE
// Stage 1: Vision Framework (Swift) extracts raw data
// Stage 2: LLM (Claude) generates narrative description
ipcMain.handle('analyze-screenshot', async (event, imagePath, requestId) => {
    console.log('[Main] analyze-screenshot requested for:', imagePath);
    console.log('[Main] Using two-stage architecture: Vision Framework → Claude LLM');
    if (process.platform !== 'darwin') {
        console.log('[Main] analyze-screenshot: Not macOS, skipping Vision Framework analysis');
        return {
            success: false,
            error: 'Vision Framework analysis only available on macOS',
            description: 'Screenshot captured', // Fallback description
            rawVisionData: null,
            aiDescription: null
        };
    }
    // Path to our Swift helper - relative to app root
    // In development: native/screenshot-analyzer/build/screenshot-analyzer
    // In production: bundled with the app in resources
    const helperPath = app.isPackaged
        ? path.join(process.resourcesPath, 'screenshot-analyzer')
        : path.join(app.getAppPath(), 'native', 'screenshot-analyzer', 'build', 'screenshot-analyzer');
    console.log('[Main] Looking for Swift helper at:', helperPath);
    // Check if the helper exists
    if (!fs.existsSync(helperPath)) {
        console.log('[Main] analyze-screenshot: Swift helper not found at:', helperPath);
        return {
            success: false,
            error: 'Vision Framework helper not built. Run: cd native/screenshot-analyzer && ./build.sh',
            description: 'Screenshot captured', // Fallback description
            rawVisionData: null,
            aiDescription: null
        };
    }
    // Check if the image file exists
    if (!fs.existsSync(imagePath)) {
        console.log('[Main] analyze-screenshot: Image file not found:', imagePath);
        return {
            success: false,
            error: 'Image file not found',
            description: 'Screenshot captured', // Fallback description
            rawVisionData: null,
            aiDescription: null
        };
    }
    try {
        // STAGE 1: Vision Framework Extraction (Swift)
        console.log('[Main] Stage 1: Running Vision Framework extraction...');
        const visionResult = await new Promise((resolve, reject) => {
            const child = spawn(helperPath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code === 0) {
                    try {
                        const response = JSON.parse(stdout.trim());
                        resolve(response);
                    }
                    catch (parseError) {
                        console.error('[Main] Failed to parse Swift helper response:', stdout);
                        reject(new Error(`Failed to parse response: ${parseError}`));
                    }
                }
                else {
                    console.error('[Main] Swift helper failed with code:', code);
                    console.error('[Main] stderr:', stderr);
                    reject(new Error(`Helper exited with code ${code}: ${stderr}`));
                }
            });
            child.on('error', (error) => {
                console.error('[Main] Failed to spawn Swift helper:', error);
                reject(error);
            });
            // Send the request as JSON to stdin
            const request = {
                imagePath: imagePath,
                requestId: requestId || null
            };
            child.stdin.write(JSON.stringify(request) + '\n');
            child.stdin.end();
        });
        console.log('[Main] Stage 1 complete - Vision Framework extraction successful');
        console.log('[Main] Extracted:', {
            textItems: visionResult.detectedText?.length || 0,
            objects: visionResult.objects?.length || 0,
            hasExtraction: !!visionResult.extraction,
            confidence: visionResult.confidence
        });
        // Prepare raw Vision data for response
        const rawVisionData = {
            confidence: visionResult.confidence,
            detectedText: visionResult.detectedText,
            objects: visionResult.objects,
            extraction: visionResult.extraction
        };
        // STAGE 2: On-device AI narrative (already generated by Swift)
        // The Swift analyzer now includes intelligent narrative generation using
        // Apple's NaturalLanguage framework combined with advanced heuristics
        const aiDescription = visionResult.description || 'Screenshot captured';
        console.log('[Main] Stage 2 complete - On-device AI narrative generated by Swift analyzer');
        console.log('[Main] Description length:', aiDescription.length, 'characters');
        console.log('[Main] Using Apple Intelligence (NaturalLanguage framework + heuristics)');
        // Return both raw Vision data AND AI-generated description
        return {
            success: true,
            // The description field now contains the on-device AI-generated narrative
            description: aiDescription,
            confidence: visionResult.confidence,
            detectedText: visionResult.detectedText,
            objects: visionResult.objects,
            extraction: visionResult.extraction,
            requestId: visionResult.requestId,
            // NEW: Separate fields for two-stage architecture
            rawVisionData: rawVisionData,
            aiDescription: aiDescription,
            llmError: null // No external LLM, so no errors
        };
    }
    catch (error) {
        console.error('[Main] analyze-screenshot failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            description: 'Screenshot captured', // Fallback description
            rawVisionData: null,
            aiDescription: null
        };
    }
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
            }
            catch (e) {
                console.warn('[Main] Trigger prompt catch (expected if denied/cancelled):', e);
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
        }
        catch (e) {
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
            }
            catch (e) {
                console.warn(`[Main] Failed to open ${p}`, e);
            }
        }
        // Final fallback: just open System Settings app
        try {
            await shell.openExternal('x-apple.systempreferences:');
        }
        catch (e) {
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
            }
            catch (e) {
                console.warn(`[Main] Failed to open ${p}`, e);
            }
        }
        // Final fallback
        try {
            await shell.openExternal('x-apple.systempreferences:');
        }
        catch (e) {
            console.error('[Main] All attempts to open settings failed.', e);
        }
    }
});
// Get environment information
ipcMain.handle('get-environment-info', async () => {
    // Check if we're in production mode based on BUILD_ENV or app.isPackaged
    const isProduction = process.env.BUILD_ENV === 'production' || app.isPackaged;
    return {
        isProduction,
        isDevelopment: !isProduction,
        isPackaged: app.isPackaged,
        buildEnv: process.env.BUILD_ENV || 'not-set',
    };
});
// Open external URL in default browser
ipcMain.handle('open-external-url', async (_event, url) => {
    console.log('[Main] Opening external URL:', url);
    try {
        await shell.openExternal(url);
        return { success: true };
    }
    catch (error) {
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
ipcMain.on('update-timer-display', (event, timerData) => {
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
    }
    else if (!isNowRunning && wasRunning) {
        // Timer paused or stopped - stop interval but update display
        console.log('[Main] Stopping timer interval');
        stopTimerInterval();
    }
    else if (isNowRunning) {
        // Timer is running and was already running - ensure interval is active
        // This handles edge cases like window reload
        if (!timerInterval) {
            console.log('[Main] Timer is running but interval was missing - restarting');
            startTimerInterval();
        }
    }
    else {
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
            const result = await execAsync(`osascript -e '
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set appName to name of frontApp
                    set bundleId to bundle identifier of frontApp
                    try
                        set windowTitle to title of front window of frontApp
                    on error
                        set windowTitle to "(No window title available)"
                    end try
                    return appName & "|||" & windowTitle & "|||" & bundleId
                end tell
            '`);
            const parts = result.stdout.trim().split('|||');
            const appName = parts[0] || 'Unknown';
            const windowTitle = parts[1] || 'Unknown';
            const bundleId = parts[2] || '';
            console.log('[Main] get-active-window result:', { appName, windowTitle, bundleId });
            return { appName, windowTitle, bundleId };
        }
        catch (error) {
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
const appIconCache = new Map();
// Robust app path detection using macOS system APIs
const findAppPaths = async (appName, execAsync) => {
    const foundPaths = [];
    try {
        // Method 1: Use mdfind to search for apps by display name
        const mdfindCmd = `mdfind "kMDItemDisplayName == '${appName.replace(/'/g, "\\'")}'c && kMDItemContentType == 'com.apple.application-bundle'"`;
        const mdfindResult = await execAsync(mdfindCmd, { timeout: 3000 }).catch(() => ({ stdout: '' }));
        if (mdfindResult.stdout.trim()) {
            const paths = mdfindResult.stdout.trim().split('\n').filter((p) => p.endsWith('.app'));
            foundPaths.push(...paths);
        }
    }
    catch (error) {
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
                const paths = bundleResult.stdout.trim().split('\n').filter((p) => p.endsWith('.app'));
                foundPaths.push(...paths);
            }
        }
    }
    catch (error) {
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
    if (appName === 'Finder')
        commonPaths.push('/System/Library/CoreServices/Finder.app');
    if (appName === 'Safari')
        commonPaths.push('/Applications/Safari.app');
    if (appName === 'Terminal')
        commonPaths.push('/Applications/Utilities/Terminal.app');
    if (appName === 'Activity Monitor')
        commonPaths.push('/Applications/Utilities/Activity Monitor.app');
    foundPaths.push(...commonPaths);
    // Filter to only existing paths and remove duplicates
    const existingPaths = [...new Set(foundPaths)].filter(p => fs.existsSync(p));
    console.log(`[Main] get-app-icon: Found ${existingPaths.length} potential paths for ${appName}:`, existingPaths);
    return existingPaths;
};
// Find all possible icon paths in an app bundle
const findIconPaths = (bundlePath) => {
    const iconPaths = [];
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
    }
    catch (error) {
        console.log(`[Main] get-app-icon: Error reading resources directory for ${bundlePath}:`, error);
    }
    return iconPaths;
};
// Get App Icon
ipcMain.handle('get-app-icon', async (event, appName) => {
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
                        }
                        else {
                            console.log(`[Main] get-app-icon: Icon too small or invalid: ${base64Icon?.length || 0} bytes`);
                        }
                    }
                    else {
                        console.log(`[Main] get-app-icon: Conversion failed - no output file created`);
                    }
                }
                catch (error) {
                    console.log(`[Main] get-app-icon: Error converting icon ${iconPath}: ${error.message}`);
                    continue;
                }
            }
        }
        console.log(`[Main] get-app-icon: Could not find usable icon for ${appName}`);
        return null;
    }
    catch (error) {
        console.error(`[Main] get-app-icon: Error getting icon for ${appName}:`, error);
        return null;
    }
});
// File Save Dialog
ipcMain.handle('show-save-dialog', async (event, options) => {
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
    }
    catch (error) {
        console.error('[Main] Error showing save dialog:', error);
        return { canceled: true, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Write file
ipcMain.handle('write-file', async (event, filePath, content) => {
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
    }
    catch (error) {
        console.error('[Main] Failed to write file:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Copy file
ipcMain.handle('copy-file', async (event, sourcePath, destinationPath) => {
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
    }
    catch (error) {
        console.error('[Main] Error copying file:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Delete file
ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }
        // Check if file exists before trying to delete
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            console.log(`[Main] File deleted: ${filePath}`);
        }
        else {
            console.log(`[Main] File not found (already deleted?): ${filePath}`);
        }
        return { success: true };
    }
    catch (error) {
        console.error('[Main] Error deleting file:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Get screenshot as data URL
ipcMain.handle('get-screenshot', async (event, filePath) => {
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
        let fileBuffer;
        try {
            fileBuffer = await decryptFile(filePath);
        }
        catch (decryptError) {
            console.error('[Main] Failed to decrypt screenshot, trying raw read:', decryptError);
            // Fallback to raw read if decryption fails
            fileBuffer = await fs.promises.readFile(filePath);
        }
        const base64Data = fileBuffer.toString('base64');
        const mimeType = 'image/png'; // Screenshots are PNG files
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        console.log(`[Main] Screenshot loaded: ${filePath} (${Math.round(base64Data.length / 1024)}KB)`);
        return dataUrl;
    }
    catch (error) {
        console.error('[Main] Error loading screenshot:', error);
        return null;
    }
});
// Open file in Finder (macOS) or File Explorer (Windows/Linux)
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
        if (!filePath) {
            throw new Error('File path is required');
        }
        console.log(`[Main] Opening file in folder: ${filePath}`);
        shell.showItemInFolder(filePath);
        return { success: true };
    }
    catch (error) {
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
        }
        else {
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
    }
    catch (error) {
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
        }
        else {
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
    }
    catch (error) {
        console.error('[Main] Jira API request failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
// Secure Credential Storage handlers
ipcMain.handle('secure-store-credential', async (event, key, value) => {
    console.log('[Main] secure-store-credential requested for key:', key);
    try {
        await storeCredential(key, value);
        return {
            success: true,
        };
    }
    catch (error) {
        console.error('[Main] Failed to store credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
ipcMain.handle('secure-get-credential', async (event, key) => {
    console.log('[Main] secure-get-credential requested for key:', key);
    try {
        const value = await getCredential(key);
        return {
            success: true,
            value: value,
        };
    }
    catch (error) {
        console.error('[Main] Failed to get credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            value: null,
        };
    }
});
ipcMain.handle('secure-delete-credential', async (event, key) => {
    console.log('[Main] secure-delete-credential requested for key:', key);
    try {
        await deleteCredential(key);
        return {
            success: true,
        };
    }
    catch (error) {
        console.error('[Main] Failed to delete credential:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
ipcMain.handle('secure-has-credential', async (event, key) => {
    console.log('[Main] secure-has-credential requested for key:', key);
    try {
        const exists = await hasCredential(key);
        return {
            success: true,
            exists: exists,
        };
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Main] Failed to check secure storage availability:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            available: false,
        };
    }
});
// AI Assignment Suggestion Handler
ipcMain.handle('suggest-assignment', async (event, request) => {
    console.log('[Main] suggest-assignment requested');
    console.log('[Main] Context:', {
        description: request.context.description?.substring(0, 50) + '...',
        appNames: request.context.appNames,
        technologies: request.context.detectedTechnologies
    });
    try {
        // Create AI service with provided data
        const service = new AIAssignmentService(request.buckets, request.jiraIssues, request.historicalEntries);
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
    }
    catch (error) {
        console.error('[Main] suggest-assignment failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            suggestion: null
        };
    }
});
// AI Tempo Account Selection Handler
ipcMain.handle('select-tempo-account', async (event, request) => {
    console.log('[Main] select-tempo-account requested');
    console.log('[Main] Issue:', request.issue.key);
    console.log('[Main] Available accounts:', request.accounts.length);
    console.log('[Main] Historical records:', request.historicalAccounts.length);
    console.log('[Main] Historical entries:', request.historicalEntries?.length || 0);
    try {
        // Create AI service
        const service = new AIAccountService();
        // Get account selection
        const selection = await service.selectAccount(request.issue, request.accounts, {
            description: request.description,
            historicalAccounts: request.historicalAccounts,
            historicalEntries: request.historicalEntries // NEW: Pass full entries
        });
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Main] db:get-all-entries failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-entry', async (event, id) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntry(id) };
    }
    catch (error) {
        console.error('[Main] db:get-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:insert-entry', async (event, entry) => {
    try {
        const db = DatabaseService.getInstance();
        db.insertEntry(entry);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:insert-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:update-entry', async (event, id, updates) => {
    try {
        const db = DatabaseService.getInstance();
        db.updateEntry(id, updates);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:update-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:delete-entry', async (event, id) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteEntry(id);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:delete-entry failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:delete-all-entries', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteAllEntries();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:delete-all-entries failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Buckets
ipcMain.handle('db:get-all-buckets', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllBuckets() };
    }
    catch (error) {
        console.error('[Main] db:get-all-buckets failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:insert-bucket', async (event, bucket) => {
    try {
        const db = DatabaseService.getInstance();
        db.insertBucket(bucket);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:insert-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:update-bucket', async (event, id, updates) => {
    try {
        const db = DatabaseService.getInstance();
        db.updateBucket(id, updates);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:update-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:delete-bucket', async (event, id) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteBucket(id);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:delete-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Settings
ipcMain.handle('db:get-setting', async (event, key) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getSetting(key) };
    }
    catch (error) {
        console.error('[Main] db:get-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:set-setting', async (event, key, value) => {
    try {
        const db = DatabaseService.getInstance();
        db.setSetting(key, value);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:set-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:delete-setting', async (event, key) => {
    try {
        const db = DatabaseService.getInstance();
        db.deleteSetting(key);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:delete-setting failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:get-all-settings', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllSettings() };
    }
    catch (error) {
        console.error('[Main] db:get-all-settings failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: {} };
    }
});
// Jira Issues Cache
ipcMain.handle('db:get-all-jira-issues', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllJiraIssues() };
    }
    catch (error) {
        console.error('[Main] db:get-all-jira-issues failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-jira-issues-by-project', async (event, projectKey) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraIssuesByProject(projectKey) };
    }
    catch (error) {
        console.error('[Main] db:get-jira-issues-by-project failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-jira-issue', async (event, key) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraIssue(key) };
    }
    catch (error) {
        console.error('[Main] db:get-jira-issue failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:upsert-jira-issue', async (event, issue) => {
    try {
        const db = DatabaseService.getInstance();
        db.upsertJiraIssue(issue);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:upsert-jira-issue failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:clear-jira-cache', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearJiraCache();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:clear-jira-cache failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Jira Cache Metadata
ipcMain.handle('db:get-jira-cache-meta', async (event, key) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getJiraCacheMeta(key) };
    }
    catch (error) {
        console.error('[Main] db:get-jira-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:set-jira-cache-meta', async (event, key, data, query) => {
    try {
        const db = DatabaseService.getInstance();
        db.setJiraCacheMeta(key, data, query);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:set-jira-cache-meta failed:', error);
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Main] updater:quit-and-install failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Configure updater
ipcMain.handle('updater:configure', async (event, options) => {
    console.log('[Main] updater:configure requested:', options);
    try {
        updater.configure(options);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] updater:configure failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Crawler State
ipcMain.handle('db:get-crawler-state', async (event, projectKey) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getCrawlerState(projectKey) };
    }
    catch (error) {
        console.error('[Main] db:get-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:set-crawler-state', async (event, projectKey, state) => {
    try {
        const db = DatabaseService.getInstance();
        db.setCrawlerState(projectKey, state);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:set-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:clear-crawler-state', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearCrawlerState();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:clear-crawler-state failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Database Stats
ipcMain.handle('db:get-stats', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getStats() };
    }
    catch (error) {
        console.error('[Main] db:get-stats failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
// Migration
ipcMain.handle('db:needs-migration', async () => {
    try {
        return { success: true, needsMigration: MigrationService.needsMigration() };
    }
    catch (error) {
        console.error('[Main] db:needs-migration failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', needsMigration: false };
    }
});
ipcMain.handle('db:migrate-from-localstorage', async (event, localStorageData) => {
    try {
        console.log('[Main] Starting migration from localStorage...');
        const result = await MigrationService.migrateFromLocalStorage(localStorageData);
        return { success: true, result };
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Main] get-blacklisted-apps failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});
// Add app to blacklist
ipcMain.handle('add-blacklisted-app', async (event, bundleId, name, category) => {
    console.log('[Main] add-blacklisted-app requested:', { bundleId, name, category });
    try {
        const blacklistService = BlacklistService.getInstance();
        blacklistService.addApp(bundleId, name, category);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] add-blacklisted-app failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Remove app from blacklist
ipcMain.handle('remove-blacklisted-app', async (event, bundleId) => {
    console.log('[Main] remove-blacklisted-app requested:', bundleId);
    try {
        const blacklistService = BlacklistService.getInstance();
        blacklistService.removeApp(bundleId);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] remove-blacklisted-app failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Check if app is blacklisted
ipcMain.handle('is-app-blacklisted', async (event, bundleId) => {
    console.log('[Main] is-app-blacklisted requested:', bundleId);
    try {
        const blacklistService = BlacklistService.getInstance();
        const isBlacklisted = blacklistService.isAppBlacklisted(bundleId);
        return { success: true, isBlacklisted };
    }
    catch (error) {
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
    }
    catch (error) {
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
        return { success: true, data: serializedApps };
    }
    catch (error) {
        console.error('[Main] get-installed-apps failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});
// Convert .icns icon to base64 data URL for display in UI
ipcMain.handle('get-app-icon-base64', async (_event, iconPath) => {
    if (!iconPath || !fs.existsSync(iconPath)) {
        return { success: false, error: 'Icon path does not exist' };
    }
    try {
        // Use nativeImage to convert .icns to PNG
        const image = nativeImage.createFromPath(iconPath);
        if (image.isEmpty()) {
            return { success: false, error: 'Failed to load icon' };
        }
        // Resize to a reasonable size (64x64) to keep data URL small
        const resized = image.resize({ width: 64, height: 64 });
        const png = resized.toPNG();
        const base64 = png.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;
        return { success: true, dataUrl };
    }
    catch (error) {
        console.error('[Main] get-app-icon-base64 failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
/**
 * Comprehensive cleanup of all app resources
 * Ensures no orphan processes remain after quit
 */
async function cleanupAndQuit() {
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
    }
    catch (error) {
        console.error('[Main] Error during cleanup:', error);
    }
    finally {
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
    if (!windowBounds || !trayBounds)
        return { x: 0, y: 0 };
    const x = Math.round(trayBounds.x + (trayBounds.width / 2) - (windowBounds.width / 2));
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    return { x, y };
}
function toggleWindow() {
    if (win?.isVisible()) {
        win.hide();
    }
    else {
        const { x, y } = getWindowPosition();
        win?.setPosition(x, y, false);
        win?.show();
        win?.focus();
    }
}
function showWindowBelowTray() {
    if (!win || !tray) {
        console.warn('[Main] Cannot show window - window or tray not initialized');
        return;
    }
    const { x, y } = getWindowPosition();
    win.setPosition(x, y, false);
    win.show();
    win.focus();
    console.log('[Main] Window shown below tray icon at position:', { x, y });
}
function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);
    win = new BrowserWindow({
        width: 640,
        height: 450,
        show: false, // Don't show immediately - we'll position and show after tray is ready
        frame: false,
        resizable: true,
        minWidth: 400,
        minHeight: 300,
        movable: true,
        minimizable: true, // Enable minimize to dock
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
    if (!app.isPackaged) {
        win.loadURL('http://127.0.0.1:5173');
        // win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        // Use loadURL with proper URL formatting for asar compatibility
        // pathToFileURL ensures correct encoding and path resolution on all platforms
        const indexPath = path.join(process.env.DIST || '', 'index.html');
        win.loadURL(pathToFileURL(indexPath).toString());
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
        createWindow();
        createTray();
    }
    else {
        toggleWindow();
    }
});
app.whenReady().then(() => {
    // Initialize encryption key on app startup
    try {
        getEncryptionKey();
        console.log('[Main] Encryption system initialized');
    }
    catch (error) {
        console.error('[Main] Failed to initialize encryption:', error);
        console.warn('[Main] Screenshots will be saved unencrypted as fallback');
    }
    // Initialize licensing system (legacy - being replaced by Stripe)
    try {
        initializeLicensing();
        console.log('[Main] Licensing system initialized (legacy)');
    }
    catch (error) {
        console.error('[Main] Failed to initialize licensing:', error);
        console.warn('[Main] App will run without licensing (development mode)');
    }
    // Initialize auth system (Supabase)
    try {
        initializeAuth();
        console.log('[Main] Auth system initialized (Supabase)');
    }
    catch (error) {
        console.error('[Main] Failed to initialize auth:', error);
    }
    // Initialize subscription system (Stripe-based)
    try {
        initializeSubscription();
        console.log('[Main] Subscription system initialized (Stripe)');
    }
    catch (error) {
        console.error('[Main] Failed to initialize subscription system:', error);
        console.warn('[Main] App will run without subscription features');
    }
    createWindow();
    createTray();
    // Hide dock icon on macOS - app only appears in menu bar
    // Do this before showing window to avoid visual glitches
    if (process.platform === 'darwin') {
        app.dock.hide();
        console.log('[Main] Dock icon hidden - app runs from menu bar only');
    }
    // Now that both window and tray are created, show the window below the tray icon
    // Use a small delay to ensure tray icon is fully rendered and positioned
    setTimeout(() => {
        showWindowBelowTray();
    }, 100);
    // Initialize auto-updater
    // Set main window reference so updater can send status updates
    updater.setMainWindow(win);
    // Start auto-update checks (with delay)
    updater.start();
    console.log('[Main] Auto-updater initialized');
});
