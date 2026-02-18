import { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain, systemPreferences, shell, desktopCapturer, dialog, powerMonitor, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { config as dotenvConfig } from 'dotenv';
// Initialize main process file logger FIRST - before any other logging
import { mainLogger } from './mainLogger.js';
mainLogger.initialize();
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
import { saveEncryptedFile, decryptFile, getEncryptionKey, isFileEncrypted } from './encryption.js';
import { storeCredential, getCredential, deleteCredential, hasCredential, listCredentialKeys, isSecureStorageAvailable } from './credentialStorage.js';
import { initializeSubscription, cleanupSubscription } from './subscription/ipcHandlers.js';
import { requirePremium } from './subscription/premiumGuard.js';
import { initializeAuth, syncAppVersionOnStartup } from './auth/ipcHandlers.js';
import { getAuthService } from './auth/supabaseAuth.js';
import { initializeAnalytics } from './analytics/ipcHandlers.js';
import { AIAssignmentService } from './aiAssignmentService.js';
import { AIAccountService } from './aiAccountService.js';
import { DatabaseService } from './databaseService.js';
import { MigrationService } from './migration.js';
import { updater } from './autoUpdater.js';
import { AppDiscoveryService } from './appDiscoveryService.js';
import { BlacklistService } from './blacklistService.js';
import { BackgroundActivityTracker } from './backgroundActivityTracker.js';
import { aiService, signalAggregator, createCalendarSignal, createUserProfileSignal, createTimeContextSignal } from './ai/aiService.js';
import { getCalendarService, initializeCalendarService } from './calendar/calendarService.js';
import { getRecordingManager } from './meeting/recordingManager.js';
import { MEETING_IPC_CHANNELS } from './meeting/types.js';
import { getAudioRecorder } from './meeting/audioRecorder.js';
import { mediaMonitor } from './native/index.js';
import { getWorkingHoursScheduler } from './workingHoursScheduler.js';
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
    // Handle server listen/bind permission errors gracefully
    // These can escape http.Server error handlers in edge cases
    if ('code' in error && error.code === 'EPERM') {
        const msg = error.message.toLowerCase();
        if (msg.includes('listen') || msg.includes('server') || msg.includes('bind') || msg.includes('port')) {
            console.error('[Main] Server permission error (handled gracefully):', error.message);
            return;
        }
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
// Register custom URL protocol for deep linking (clearical://)
// This must be called before app.whenReady()
const PROTOCOL_NAME = 'clearical';
if (process.defaultApp) {
    // Development: need to register with path to electron executable
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL_NAME, process.execPath, [path.resolve(process.argv[1])]);
    }
}
else {
    // Production: register normally
    app.setAsDefaultProtocolClient(PROTOCOL_NAME);
}
// Register custom protocol for serving decrypted screenshots directly
// This must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([{
        scheme: 'clearical-screenshot',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: false,
        }
    }]);
// Handle protocol URL on macOS (app already running)
app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('[Main] Received deep link:', url);
    handleDeepLink(url);
});
// Handle deep link URL
function handleDeepLink(url) {
    // Parse the URL (e.g., clearical://open or clearical://auth/success)
    try {
        const parsed = new URL(url);
        console.log('[Main] Deep link path:', parsed.pathname);
        // Bring window to front
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.show();
            win.focus();
        }
    }
    catch (error) {
        console.error('[Main] Failed to parse deep link URL:', error);
    }
}
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
 * Check if the timer is currently running (not paused)
 * Exported for use by RecordingManager to avoid showing prompts when timer is already active
 */
export function isTimerRunning() {
    return timerState.isRunning && !timerState.isPaused;
}
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
function styleTimerText(text) {
    // Attempt to use foreground color (may be overridden by system)
    // Using cyan for a professional look that works in both light and dark modes
    // Note: You can experiment with other colors like GREEN, YELLOW, MAGENTA, etc.
    return `${ANSI_COLORS.CYAN}${text}${ANSI_COLORS.RESET}`;
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
function updateTrayTitle() {
    if (!tray)
        return;
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
    }
    else if (timerState.isPaused) {
        // Show paused state with last elapsed time
        const formattedTime = formatTime(timerState.elapsed);
        const styledTime = styleTimerText(formattedTime);
        currentTimerText = `⏸ ${formattedTime}`;
        if (process.platform === 'darwin') {
            tray.setTitle(`⏸ ${styledTime}`, {
                fontType: 'monospacedDigit'
            });
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
ipcMain.handle('capture-screenshot', async (_event, windowInfo) => {
    console.log('[Main] capture-screenshot requested', windowInfo ? `for ${windowInfo.appName} (pid=${windowInfo.pid})` : '(no window info)');
    // Check screen recording permission
    if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('screen');
        console.log('[Main] Current Screen Access Status:', status);
    }
    // Guard: return null if no window info or no PID
    if (!windowInfo || !windowInfo.pid) {
        console.log('[Main] No window info or PID provided, skipping screenshot');
        return null;
    }
    // Check if the active app is blacklisted
    const blacklistService = BlacklistService.getInstance();
    if (windowInfo.bundleId && blacklistService.isAppBlacklisted(windowInfo.bundleId)) {
        console.log(`[Main] capture-screenshot - App is blacklisted (${windowInfo.appName}, ${windowInfo.bundleId}), skipping screenshot`);
        return null;
    }
    // Skip screenshots when Clearical itself is the frontmost app
    const appNameLower = windowInfo.appName.toLowerCase();
    if (appNameLower === 'clearical' || appNameLower === 'time-portal' || appNameLower === 'timeportal' || windowInfo.bundleId === 'io.clearical.app') {
        console.log(`[Main] capture-screenshot - Clearical app is frontmost, skipping to avoid self-capture`);
        return null;
    }
    try {
        // Capture the specific window by PID using native CGWindowListCreateImage
        const image = mediaMonitor.captureWindowScreenshot(windowInfo.pid, windowInfo.windowTitle);
        if (!image) {
            console.log(`[Main] Native capture returned null for PID ${windowInfo.pid}`);
            return null;
        }
        // Save encrypted PNG with descriptive filename
        // Format: timestamp|||AppName|||WindowTitle.png
        const timestamp = Date.now();
        const appNameSafe = windowInfo.appName.replace(/[\/\\:*?"<>|]/g, '_');
        const windowTitleSafe = windowInfo.windowTitle.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100);
        const filename = `${timestamp}|||${appNameSafe}|||${windowTitleSafe}.png`;
        const filePath = path.join(SCREENSHOTS_DIR, filename);
        try {
            await saveEncryptedFile(filePath, image);
            console.log('[Main] Window screenshot saved (encrypted, native):', filePath);
        }
        catch (encryptError) {
            console.error('[Main] Failed to encrypt screenshot, saving unencrypted:', encryptError);
            await fs.promises.writeFile(filePath, image);
            console.log('[Main] Window screenshot saved (unencrypted fallback):', filePath);
        }
        return filePath;
    }
    catch (error) {
        console.error('[Main] Failed to capture screenshot:', error);
        return null;
    }
});
// AI Screenshot Analysis (via Gemini cloud service)
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('analyze-screenshot', requirePremium('AI Analysis', async (event, imagePath, requestId, ocrText) => {
    console.log('[Main] analyze-screenshot requested for:', imagePath);
    console.log('[Main] Using Gemini cloud AI for screenshot analysis');
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
    // Decrypt screenshot if encrypted (analyzers need raw PNG data)
    let analyzeImagePath = imagePath;
    let tempDecryptedPath = null;
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
    }
    catch (decryptError) {
        console.error('[Main] Failed to decrypt screenshot:', decryptError);
        // Continue with original path - might be unencrypted
    }
    // Helper function to generate fallback description from filename
    const generateFallbackFromFilename = (filepath) => {
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
        }
        catch (e) {
            console.log('[Main] Could not parse filename for fallback:', e);
        }
        return 'Screenshot captured';
    };
    // Use Gemini AI service for screenshot analysis
    console.log('[Main] Attempting analysis with Gemini cloud AI...');
    // Parse app name and window title from filename
    // Filename format: {timestamp}|||{app_name}|||{window_title}.png
    let appName;
    let windowTitle;
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
    }
    catch (parseError) {
        console.log('[Main] Could not parse app info from filename:', parseError);
    }
    // Build context signals for richer screenshot analysis
    const contextSignals = [];
    // Get user role from settings for AI context optimization
    let userRole;
    let roleContext;
    try {
        const db = DatabaseService.getInstance();
        const aiSettings = db.getSetting('ai');
        if (aiSettings?.userRole) {
            userRole = aiSettings.userRole;
            // Build role context string based on role metadata
            const roleMetadata = {
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
            // Add user profile signal
            contextSignals.push(createUserProfileSignal(userRole, roleContext));
        }
    }
    catch (settingsError) {
        console.log('[Main] Could not get user role from settings:', settingsError);
    }
    // Get calendar context for the current time
    try {
        const calendarService = getCalendarService();
        const calendarContext = calendarService.getCalendarContext(Date.now());
        if (calendarContext.currentEvent || calendarContext.recentEvents.length > 0) {
            contextSignals.push(createCalendarSignal(calendarContext.currentEvent ?? undefined, calendarContext.recentEvents, calendarContext.upcomingEvents));
            console.log('[Main] Added calendar context for analysis');
        }
    }
    catch (calendarError) {
        console.log('[Main] Could not get calendar context:', calendarError);
    }
    // Add time context
    contextSignals.push(createTimeContextSignal(Date.now()));
    try {
        const aiResult = await aiService.analyzeScreenshot(analyzeImagePath, appName, windowTitle, requestId, contextSignals.length > 0 ? contextSignals : undefined, ocrText);
        // Clean up temp decrypted file if we created one
        if (tempDecryptedPath) {
            try {
                await fs.promises.unlink(tempDecryptedPath);
                console.log('[Main] Cleaned up temp decrypted file');
            }
            catch (cleanupError) {
                console.warn('[Main] Failed to cleanup temp file:', cleanupError);
            }
        }
        if (aiResult.success && aiResult.description) {
            console.log('[Main] AI analysis successful');
            console.log('[Main] Description:', aiResult.description);
            return {
                success: true,
                description: aiResult.description,
                confidence: aiResult.confidence || 0.9,
                requestId: aiResult.requestId,
                rawVisionData: null,
                aiDescription: aiResult.description,
                llmError: null,
                analyzer: 'gemini'
            };
        }
        else {
            // AI analysis failed - return error with fallback description
            console.warn('[Main] AI analysis failed:', aiResult.error);
            const fallbackDescription = generateFallbackFromFilename(imagePath);
            return {
                success: false,
                error: aiResult.error || 'AI analysis failed',
                description: fallbackDescription,
                rawVisionData: null,
                aiDescription: null,
                analyzer: 'fallback',
                isRateLimited: aiResult.isRateLimited || false
            };
        }
    }
    catch (aiError) {
        console.error('[Main] AI error:', aiError);
        // Clean up temp decrypted file if we created one
        if (tempDecryptedPath) {
            try {
                await fs.promises.unlink(tempDecryptedPath);
            }
            catch (cleanupError) {
                console.warn('[Main] Failed to cleanup temp file:', cleanupError);
            }
        }
        // Generate fallback from filename
        const fallbackDescription = generateFallbackFromFilename(imagePath);
        return {
            success: false,
            error: aiError instanceof Error ? aiError.message : 'Unknown error',
            description: fallbackDescription,
            rawVisionData: null,
            aiDescription: null,
            analyzer: 'fallback'
        };
    }
}));
// Batch screenshot analysis handler - analyzes multiple screenshots in a single API call
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('analyze-screenshot-batch', requirePremium('AI Analysis', async (event, inputs) => {
    console.log(`[Main] analyze-screenshot-batch requested for ${inputs.length} screenshots`);
    if (!inputs || inputs.length === 0) {
        return { success: true, results: [] };
    }
    // Process each input to prepare for batch analysis
    const batchInputs = [];
    const tempFiles = [];
    for (const input of inputs) {
        let analyzeImagePath = input.imagePath;
        // Check if file exists
        if (!fs.existsSync(input.imagePath)) {
            console.log(`[Main] Image file not found: ${input.imagePath}`);
            continue;
        }
        // Decrypt if encrypted
        try {
            if (isFileEncrypted(input.imagePath)) {
                console.log(`[Main] Decrypting screenshot for batch: ${path.basename(input.imagePath)}`);
                const decryptedData = await decryptFile(input.imagePath);
                const originalFilename = path.basename(input.imagePath);
                const tempPath = path.join(app.getPath('temp'), `batch_${Date.now()}_${originalFilename}`);
                await fs.promises.writeFile(tempPath, decryptedData);
                analyzeImagePath = tempPath;
                tempFiles.push(tempPath);
            }
        }
        catch (decryptError) {
            console.error(`[Main] Failed to decrypt screenshot: ${input.imagePath}`, decryptError);
            // Continue with original path - might be unencrypted
        }
        // Parse app name and window title from filename if not provided
        let appName = input.appName;
        let windowTitle = input.windowTitle;
        if (!appName || !windowTitle) {
            try {
                const filename = path.basename(analyzeImagePath, '.png');
                if (filename.includes('|||')) {
                    const parts = filename.split('|||');
                    if (parts.length >= 3) {
                        appName = appName || parts[1] || undefined;
                        windowTitle = windowTitle || parts[2] || undefined;
                    }
                }
            }
            catch (parseError) {
                // Ignore parse errors
            }
        }
        batchInputs.push({
            imagePath: analyzeImagePath,
            appName,
            windowTitle,
            requestId: input.requestId,
            ocrText: input.ocrText
        });
    }
    if (batchInputs.length === 0) {
        return {
            success: false,
            results: inputs.map(input => ({
                imagePath: input.imagePath,
                success: false,
                description: 'Screenshot captured',
                error: 'Failed to process image'
            })),
            error: 'All images failed processing'
        };
    }
    try {
        // Call the batch analysis method
        const result = await aiService.analyzeScreenshotBatch(batchInputs);
        console.log(`[Main] Batch analysis completed: ${result.results.filter(r => r.success).length}/${batchInputs.length} successful`);
        // Map results back to original image paths (for encrypted files)
        const finalResults = result.results.map((r, i) => {
            const originalInput = inputs.find(input => {
                const batchInput = batchInputs[i];
                return batchInput && (input.imagePath === batchInput.imagePath ||
                    path.basename(input.imagePath) === path.basename(batchInput.imagePath).replace(/^batch_\d+_/, ''));
            });
            return {
                ...r,
                imagePath: originalInput?.imagePath || r.imagePath
            };
        });
        return {
            success: result.success,
            results: finalResults
        };
    }
    catch (error) {
        console.error('[Main] Batch analysis error:', error);
        return {
            success: false,
            results: inputs.map(input => ({
                imagePath: input.imagePath,
                success: false,
                description: 'Screenshot captured',
                error: error instanceof Error ? error.message : 'Batch analysis failed'
            })),
            error: error instanceof Error ? error.message : 'Batch analysis failed'
        };
    }
    finally {
        // Clean up temp files
        for (const tempFile of tempFiles) {
            try {
                await fs.promises.unlink(tempFile);
            }
            catch (cleanupError) {
                console.warn(`[Main] Failed to cleanup temp file: ${tempFile}`, cleanupError);
            }
        }
    }
}));
// Permission Handlers
/**
 * Tests if screen recording permission actually works by attempting to capture.
 * This is critical for detecting "zombie" permissions - where macOS system settings
 * show the app has permission, but the TCC database has stale entries from a previous
 * app signature (common with ad-hoc signed apps during updates).
 *
 * @returns Object with { works: boolean, error?: string }
 */
async function testScreenRecordingWorks() {
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
    }
    catch (error) {
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
            }
            catch (e) {
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
        }
        else if (result.response === 1) {
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
// Get temp directory path
ipcMain.handle('get-temp-path', () => {
    return app.getPath('temp');
});
// Main process log file handlers
ipcMain.handle('get-main-log-path', async () => {
    return mainLogger.getLogPath();
});
ipcMain.handle('open-main-log-folder', async () => {
    const logPath = mainLogger.getLogPath();
    shell.showItemInFolder(logPath);
});
ipcMain.handle('get-main-log-content', async () => {
    try {
        const logPath = mainLogger.getLogPath();
        if (fs.existsSync(logPath)) {
            return fs.readFileSync(logPath, 'utf-8');
        }
        return null;
    }
    catch (err) {
        console.error('[Main] Failed to read log file:', err);
        return null;
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
        }
        catch (error) {
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
            // Enhanced with multiple strategies for Electron apps (Cursor, VS Code, etc.)
            const result = await execAsync(`osascript -e '
                tell application "System Events"
                    set frontApp to first application process whose frontmost is true
                    set appName to name of frontApp
                    set bundleId to bundle identifier of frontApp
                    set appPID to unix id of frontApp
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

                    return appName & "|||" & windowTitle & "|||" & bundleId & "|||" & appPID
                end tell
            '`);
            const parts = result.stdout.trim().split('|||');
            const appName = parts[0] || 'Unknown';
            const rawWindowTitle = parts[1];
            const bundleId = parts[2] || '';
            const pid = parseInt(parts[3], 10) || 0;
            // Check if we got an actual window title
            const windowTitle = (rawWindowTitle && rawWindowTitle.trim() !== '') ? rawWindowTitle : 'Unknown';
            // Log warning if window title is consistently empty (might indicate Accessibility permission issue)
            if (!rawWindowTitle || rawWindowTitle.trim() === '') {
                console.warn('[Main] get-active-window: No window title returned for', appName);
                console.warn('[Main] This may indicate Accessibility permission is not granted.');
                console.warn('[Main] Grant Accessibility permission in System Settings > Privacy & Security > Accessibility');
            }
            console.log('[Main] get-active-window result:', { appName, windowTitle, bundleId, pid, rawWindowTitle });
            return { appName, windowTitle, bundleId, pid };
        }
        catch (error) {
            console.error('[Main] Failed to get active window:', error);
            return { appName: 'Unknown', windowTitle: 'Unknown', bundleId: '', pid: 0 };
        }
    }
    return { appName: 'Not supported', windowTitle: 'Not supported', bundleId: '', pid: 0 };
});
ipcMain.handle('check-accessibility-permission', () => {
    if (process.platform === 'darwin') {
        // Use Electron's API to check if we have accessibility permission
        // Pass false to avoid prompting - we just want to check the status
        const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
        return isTrusted ? 'granted' : 'denied';
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
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('tempo-api-request', requirePremium('Tempo Integration', async (event, { url, method = 'GET', headers = {}, body }) => {
    console.log('[Main] Tempo API request:', method, url);
    if (body) {
        console.log('[Main] Tempo API request body type:', typeof body);
        console.log('[Main] Tempo API request body preview:', JSON.stringify(body).substring(0, 200));
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
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
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
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
        clearTimeout(timeoutId);
        console.error('[Main] Tempo API request failed:', error);
        const message = error instanceof Error
            ? (error.name === 'AbortError' ? 'Request timed out after 30s' : error.message)
            : 'Unknown error';
        return {
            success: false,
            error: message,
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
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
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
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
        clearTimeout(timeoutId);
        console.error('[Main] Jira API request failed:', error);
        const message = error instanceof Error
            ? (error.name === 'AbortError' ? 'Request timed out after 30s' : error.message)
            : 'Unknown error';
        return {
            success: false,
            error: message,
        };
    }
}));
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
// Recording Manager IPC handlers
ipcMain.handle(MEETING_IPC_CHANNELS.SET_ACTIVE_ENTRY, (_event, entryId, forceStart = false) => {
    console.log('[Main] SET_ACTIVE_ENTRY called:', entryId, 'forceStart:', forceStart);
    const recordingManager = getRecordingManager();
    recordingManager.setActiveEntry(entryId, forceStart);
    return { success: true };
});
ipcMain.handle(MEETING_IPC_CHANNELS.GET_MEDIA_STATUS, () => {
    console.log('[Main] GET_MEDIA_STATUS called');
    const recordingManager = getRecordingManager();
    return recordingManager.getMediaStatus();
});
ipcMain.handle(MEETING_IPC_CHANNELS.GET_RECORDING_STATUS, () => {
    console.log('[Main] GET_RECORDING_STATUS called');
    return getAudioRecorder().getStatus();
});
ipcMain.handle(MEETING_IPC_CHANNELS.SET_AUTO_RECORD_ENABLED, (_event, enabled) => {
    console.log('[Main] SET_AUTO_RECORD_ENABLED called:', enabled);
    const recordingManager = getRecordingManager();
    recordingManager.setEnabled(enabled);
    return { success: true };
});
// Audio levels forwarding to widget
let audioLevelsForwardedCount = 0;
ipcMain.on(MEETING_IPC_CHANNELS.SEND_AUDIO_LEVELS, async (_event, data) => {
    audioLevelsForwardedCount++;
    if (audioLevelsForwardedCount <= 3 || audioLevelsForwardedCount % 100 === 0) {
        console.log('[Main] Forwarding audio levels to widget, count:', audioLevelsForwardedCount);
    }
    const { getRecordingWidgetManager } = await import('./meeting/recordingWidgetManager.js');
    const widgetManager = getRecordingWidgetManager();
    widgetManager.sendAudioLevels(data.levels, data.elapsedMs);
});
// Recording failed to start - close widget and notify user
ipcMain.on('meeting:recording-failed', async (_event, data) => {
    console.error('[Main] *** RECORDING FAILED TO START ***');
    console.error('[Main] entryId:', data.entryId, 'error:', data.error);
    // Close the widget since recording couldn't start
    const { getRecordingWidgetManager } = await import('./meeting/recordingWidgetManager.js');
    const widgetManager = getRecordingWidgetManager();
    widgetManager.close();
    // Reset recording manager state
    const recordingManager = getRecordingManager();
    recordingManager.setActiveEntry(null);
    // Show user-friendly error dialog
    const { dialog } = await import('electron');
    const userFriendlyMessage = data.error.includes('audio mixer worklet')
        ? 'Could not initialize audio recording. Please try again or restart the app.'
        : data.error.includes('No audio capture')
            ? 'No audio source available. Please check your microphone permissions in System Preferences.'
            : `Recording could not start: ${data.error}`;
    dialog.showMessageBox({
        type: 'warning',
        title: 'Recording Failed',
        message: 'Unable to Start Recording',
        detail: userFriendlyMessage,
        buttons: ['OK'],
    });
    console.log('[Main] Widget closed and user notified of recording failure');
});
// Silence detection - meeting may have ended due to extended silence
ipcMain.on('meeting:silence-detected', async (_event, data) => {
    console.log('[Main] *** SILENCE DETECTED ***');
    console.log('[Main] entryId:', data.entryId, 'silenceDuration:', data.silenceDuration, 'askConfirmation:', data.askConfirmation);
    const recordingManager = getRecordingManager();
    const { getRecordingWidgetManager } = await import('./meeting/recordingWidgetManager.js');
    const widgetManager = getRecordingWidgetManager();
    // Check if we're still recording
    if (recordingManager.getActiveEntry() !== data.entryId && recordingManager.getActiveEntry() !== null) {
        console.log('[Main] Entry mismatch, ignoring silence detection');
        return;
    }
    if (data.askConfirmation) {
        // Show confirmation in widget instead of system dialog
        console.log('[Main] Showing meeting ended prompt in widget');
        widgetManager.sendMeetingEndedPrompt(data.entryId, data.silenceDuration);
    }
});
// Handle widget meeting-ended response (yes/no from user)
ipcMain.handle('widget:meeting-ended-response', async (_event, data) => {
    console.log('[Main] *** WIDGET MEETING ENDED RESPONSE ***');
    console.log('[Main] response:', data.response, 'entryId:', data.entryId);
    const recordingManager = getRecordingManager();
    const { getRecordingWidgetManager } = await import('./meeting/recordingWidgetManager.js');
    const widgetManager = getRecordingWidgetManager();
    if (data.response === 'yes') {
        // User confirmed meeting ended
        console.log('[Main] User confirmed meeting ended via widget');
        // Send stop event to renderer to stop the MediaRecorder
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (!win.isDestroyed()) {
                win.webContents.send(MEETING_IPC_CHANNELS.EVENT_RECORDING_SHOULD_STOP, {
                    entryId: data.entryId,
                    duration: 0,
                    reason: 'user_confirmed_meeting_ended',
                });
            }
        }
        // Don't close the widget here - let it show its animation first
        // Widget will send widget:request-close when animation completes
        return { success: true };
    }
    else {
        // User wants to continue recording
        console.log('[Main] User chose to continue recording via widget');
        // Notify renderer to reset silence timer
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
            if (!win.isDestroyed()) {
                win.webContents.send('meeting:reset-silence-timer');
            }
        }
        return { success: true };
    }
});
// Audio transcription IPC handlers
// Audio recordings directory
const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings');
// Ensure recordings directory exists
function ensureRecordingsDir() {
    if (!fs.existsSync(RECORDINGS_DIR)) {
        fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
        console.log('[Main] Created recordings directory:', RECORDINGS_DIR);
    }
}
// Get file extension from MIME type
function getAudioExtension(mimeType) {
    const mimeToExt = {
        'audio/webm': 'webm',
        'audio/mp4': 'm4a',
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
    };
    return mimeToExt[mimeType] || 'webm';
}
/**
 * Compress audio file for transcription to reduce upload size
 * Uses ffmpeg to convert to WebM/Opus format optimized for speech
 *
 * @param inputPath - Path to the input audio file
 * @param outputPath - Path for the compressed output file
 * @returns Compression result with success status, output path, and compression stats
 */
async function compressAudioForTranscription(inputPath, outputPath) {
    console.log('[AudioCompression] Compressing audio for transcription:', inputPath);
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
        return {
            success: false,
            error: 'Input file not found'
        };
    }
    // Check if ffmpeg is available
    const { isFfmpegAvailable, getFfmpegPath } = await import('./meeting/audioChunker.js');
    const ffmpegAvailable = await isFfmpegAvailable();
    if (!ffmpegAvailable) {
        console.log('[AudioCompression] ffmpeg not available, skipping compression');
        return {
            success: false,
            error: 'ffmpeg not available'
        };
    }
    // Get the bundled ffmpeg path (already verified available above)
    const ffmpegPath = getFfmpegPath();
    // Get input file size for logging
    const inputStats = fs.statSync(inputPath);
    const inputSizeMB = Math.round(inputStats.size / 1024 / 1024 * 10) / 10;
    console.log('[AudioCompression] Input file size:', inputSizeMB, 'MB');
    // Create output directory if needed
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    return new Promise((resolve) => {
        // ffmpeg command optimized for speech transcription:
        // - libopus codec (best for speech)
        // - 32kbps bitrate (excellent quality for speech, very small file)
        // - 16kHz sample rate (Whisper's expected input)
        // - Mono channel (speech doesn't need stereo)
        const ffmpeg = spawn(ffmpegPath, [
            '-y', // Overwrite output
            '-i', inputPath, // Input file
            '-c:a', 'libopus', // Opus codec
            '-b:a', '32k', // 32kbps bitrate
            '-ar', '16000', // 16kHz sample rate
            '-ac', '1', // Mono (1 channel)
            outputPath
        ]);
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        ffmpeg.on('error', (err) => {
            console.error('[AudioCompression] ffmpeg error:', err);
            resolve({
                success: false,
                error: `ffmpeg error: ${err.message}`
            });
        });
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                // Get output file size and calculate compression ratio
                const outputStats = fs.statSync(outputPath);
                const outputSizeMB = Math.round(outputStats.size / 1024 / 1024 * 10) / 10;
                const compressionRatio = `${inputSizeMB}MB → ${outputSizeMB}MB (${Math.round((1 - outputStats.size / inputStats.size) * 100)}% reduction)`;
                console.log('[AudioCompression] Compression successful:', compressionRatio);
                resolve({
                    success: true,
                    outputPath,
                    compressionRatio
                });
            }
            else {
                console.error('[AudioCompression] ffmpeg failed with code:', code);
                console.error('[AudioCompression] stderr:', stderr.slice(-500));
                resolve({
                    success: false,
                    error: `ffmpeg exited with code ${code}`
                });
            }
        });
        // Timeout after 5 minutes for long recordings
        setTimeout(() => {
            console.error('[AudioCompression] ffmpeg compression timeout');
            ffmpeg.kill();
            resolve({
                success: false,
                error: 'Compression timeout'
            });
        }, 300000);
    });
}
ipcMain.handle(MEETING_IPC_CHANNELS.SAVE_AUDIO_AND_TRANSCRIBE, async (_event, entryId, audioDataOrPath, mimeType, isFilePath) => {
    console.log('[Main] SAVE_AUDIO_AND_TRANSCRIBE called for entry:', entryId, 'isFilePath:', isFilePath);
    const actualMimeType = mimeType || 'audio/webm';
    let audioPath;
    let audioBase64;
    let compressedPath;
    try {
        // Handle file path vs base64 data
        if (isFilePath) {
            // audioDataOrPath is a file path - read and use it directly
            console.log('[Main] Using file path for transcription:', audioDataOrPath);
            if (!fs.existsSync(audioDataOrPath)) {
                throw new Error(`Audio file not found: ${audioDataOrPath}`);
            }
            const audioBuffer = fs.readFileSync(audioDataOrPath);
            audioBase64 = audioBuffer.toString('base64');
            console.log('[Main] Read audio file:', audioDataOrPath, 'size:', audioBuffer.length);
            // Copy to recordings directory for storage
            ensureRecordingsDir();
            const extension = getAudioExtension(actualMimeType);
            const timestamp = Date.now();
            const filename = `${entryId}-${timestamp}.${extension}`;
            audioPath = path.join(RECORDINGS_DIR, filename);
            fs.copyFileSync(audioDataOrPath, audioPath);
            console.log('[Main] Audio file copied to:', audioPath);
        }
        else {
            // audioDataOrPath is base64 data
            audioBase64 = audioDataOrPath;
            // 1. Save audio file locally first (before transcription)
            ensureRecordingsDir();
            const extension = getAudioExtension(actualMimeType);
            const timestamp = Date.now();
            const filename = `${entryId}-${timestamp}.${extension}`;
            audioPath = path.join(RECORDINGS_DIR, filename);
            // Convert base64 to buffer and save
            const audioBuffer = Buffer.from(audioBase64, 'base64');
            fs.writeFileSync(audioPath, audioBuffer);
            console.log('[Main] Audio file saved:', audioPath, 'size:', audioBuffer.length);
        }
        // 2. Compress audio before transcription to reduce upload size
        let transcriptionMimeType = actualMimeType;
        let transcriptionBase64 = audioBase64;
        // Check file size threshold (10MB) and file type
        const audioSizeBytes = Buffer.byteLength(audioBase64, 'base64');
        const audioSizeMB = Math.round(audioSizeBytes / 1024 / 1024 * 10) / 10;
        const shouldCompress = audioSizeMB > 10 || actualMimeType === 'audio/wav';
        if (shouldCompress && audioPath) {
            console.log(`[Main] Audio file is ${audioSizeMB}MB, attempting compression...`);
            const timestamp = Date.now();
            const compressedFilename = `${entryId}-${timestamp}-compressed.webm`;
            compressedPath = path.join(RECORDINGS_DIR, compressedFilename);
            const compressionResult = await compressAudioForTranscription(audioPath, compressedPath);
            if (compressionResult.success && compressionResult.outputPath) {
                // Compression succeeded - use compressed file for transcription
                console.log('[Main] Using compressed audio for transcription:', compressionResult.compressionRatio);
                const compressedBuffer = fs.readFileSync(compressedPath);
                transcriptionBase64 = compressedBuffer.toString('base64');
                transcriptionMimeType = 'audio/webm';
            }
            else {
                // Compression failed - fall back to original file
                console.log('[Main] Compression failed, using original file:', compressionResult.error);
                compressedPath = undefined; // Don't try to clean up a file that doesn't exist
            }
        }
        else {
            console.log(`[Main] Audio file is ${audioSizeMB}MB, skipping compression (threshold: 10MB)`);
        }
        // 3. Ensure auth session is fresh before transcription (long recordings can outlast tokens)
        try {
            const authService = getAuthService();
            await authService.proactiveRefresh();
        }
        catch (refreshError) {
            console.warn('[Main] Auth refresh before transcription failed:', refreshError);
        }
        // 4. Attempt transcription
        const { getTranscriptionService } = await import('./meeting/transcriptionService.js');
        const transcriptionService = getTranscriptionService();
        const result = await transcriptionService.transcribe(transcriptionBase64, entryId, transcriptionMimeType);
        if (result.success) {
            // Transcription succeeded - clean up audio files to save disk space
            if (audioPath && fs.existsSync(audioPath)) {
                try {
                    fs.unlinkSync(audioPath);
                    console.log('[Main] Transcription succeeded, cleaned up audio file:', audioPath);
                }
                catch (cleanupErr) {
                    console.warn('[Main] Failed to clean up audio file:', audioPath, cleanupErr);
                }
            }
            // Clean up compressed file if it exists
            if (compressedPath && fs.existsSync(compressedPath)) {
                try {
                    fs.unlinkSync(compressedPath);
                    console.log('[Main] Cleaned up compressed audio file:', compressedPath);
                }
                catch (cleanupErr) {
                    console.warn('[Main] Failed to clean up compressed file:', compressedPath, cleanupErr);
                }
            }
            return {
                success: true,
                audioPath,
                transcription: {
                    transcriptionId: result.transcriptionId,
                    fullText: result.fullText,
                    segments: result.segments,
                    language: result.language,
                    duration: result.duration,
                    wordCount: result.wordCount,
                },
            };
        }
        else {
            // Transcription failed but audio file is saved
            console.log('[Main] Transcription failed but audio saved at:', audioPath);
            // Clean up compressed file on failure (keep original for retry)
            if (compressedPath && fs.existsSync(compressedPath)) {
                try {
                    fs.unlinkSync(compressedPath);
                    console.log('[Main] Cleaned up compressed file after transcription failure:', compressedPath);
                }
                catch (cleanupErr) {
                    console.warn('[Main] Failed to clean up compressed file:', compressedPath, cleanupErr);
                }
            }
            return {
                success: false,
                audioPath,
                mimeType: actualMimeType,
                error: result.error || 'Transcription failed',
            };
        }
    }
    catch (error) {
        console.error('[Main] SAVE_AUDIO_AND_TRANSCRIBE error:', error);
        // Clean up compressed file on exception (keep original for retry)
        if (compressedPath && fs.existsSync(compressedPath)) {
            try {
                fs.unlinkSync(compressedPath);
                console.log('[Main] Cleaned up compressed file after error:', compressedPath);
            }
            catch (cleanupErr) {
                console.warn('[Main] Failed to clean up compressed file:', compressedPath, cleanupErr);
            }
        }
        return {
            success: false,
            audioPath, // May be undefined if save failed
            mimeType: actualMimeType,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
// Pending transcription store IPC handlers
ipcMain.handle('meeting:save-pending-transcription', async (_event, sessionId, transcriptions) => {
    console.log('[Main] SAVE_PENDING_TRANSCRIPTION called for session:', sessionId, 'count:', transcriptions.length);
    try {
        const { save } = await import('./meeting/pendingTranscriptionStore.js');
        save(sessionId, transcriptions);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] Failed to save pending transcription:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to save',
        };
    }
});
ipcMain.handle('meeting:load-pending-transcriptions', async () => {
    console.log('[Main] LOAD_PENDING_TRANSCRIPTIONS called');
    try {
        const { load } = await import('./meeting/pendingTranscriptionStore.js');
        const transcriptions = load();
        console.log('[Main] Loaded pending transcriptions for', Object.keys(transcriptions).length, 'sessions');
        return { success: true, transcriptions };
    }
    catch (error) {
        console.error('[Main] Failed to load pending transcriptions:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to load',
            transcriptions: {},
        };
    }
});
ipcMain.handle('meeting:remove-pending-transcription', async (_event, sessionId) => {
    console.log('[Main] REMOVE_PENDING_TRANSCRIPTION called for session:', sessionId);
    try {
        const { remove } = await import('./meeting/pendingTranscriptionStore.js');
        remove(sessionId);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] Failed to remove pending transcription:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to remove',
        };
    }
});
// Retry transcription for an entry with saved audio
ipcMain.handle('meeting:retry-transcription', async (_event, entryId, audioPath, mimeType) => {
    console.log('[Main] RETRY_TRANSCRIPTION called for entry:', entryId);
    try {
        // Read audio file
        if (!fs.existsSync(audioPath)) {
            return {
                success: false,
                error: 'Audio file not found',
            };
        }
        const audioBuffer = fs.readFileSync(audioPath);
        const audioBase64 = audioBuffer.toString('base64');
        console.log('[Main] Loaded audio file for retry:', audioPath, 'size:', audioBuffer.length);
        // Ensure auth session is fresh before retry transcription
        try {
            const authService = getAuthService();
            await authService.proactiveRefresh();
        }
        catch (refreshError) {
            console.warn('[Main] Auth refresh before retry transcription failed:', refreshError);
        }
        // Attempt transcription
        const { getTranscriptionService } = await import('./meeting/transcriptionService.js');
        const transcriptionService = getTranscriptionService();
        const result = await transcriptionService.transcribe(audioBase64, entryId, mimeType);
        if (result.success) {
            // Clean up audio file after successful retry transcription
            if (audioPath && fs.existsSync(audioPath)) {
                try {
                    fs.unlinkSync(audioPath);
                    console.log('[Main] Retry transcription succeeded, cleaned up audio file:', audioPath);
                }
                catch (cleanupErr) {
                    console.warn('[Main] Failed to clean up audio file after retry:', audioPath, cleanupErr);
                }
            }
            return {
                success: true,
                transcription: {
                    transcriptionId: result.transcriptionId,
                    fullText: result.fullText,
                    segments: result.segments,
                    language: result.language,
                    duration: result.duration,
                    wordCount: result.wordCount,
                },
            };
        }
        else {
            return {
                success: false,
                error: result.error || 'Transcription failed',
            };
        }
    }
    catch (error) {
        console.error('[Main] RETRY_TRANSCRIPTION error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
ipcMain.handle(MEETING_IPC_CHANNELS.GET_TRANSCRIPTION_USAGE, async () => {
    console.log('[Main] GET_TRANSCRIPTION_USAGE called');
    try {
        const { getTranscriptionService } = await import('./meeting/transcriptionService.js');
        const transcriptionService = getTranscriptionService();
        const usage = await transcriptionService.getUsage();
        if (usage) {
            return {
                success: true,
                usage,
            };
        }
        else {
            return {
                success: false,
                error: 'Failed to get usage information',
            };
        }
    }
    catch (error) {
        console.error('[Main] GET_TRANSCRIPTION_USAGE error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
});
// System Audio Capture IPC handlers
ipcMain.handle('meeting:is-system-audio-available', () => {
    console.log('[Main] meeting:is-system-audio-available called');
    return mediaMonitor.isSystemAudioCaptureAvailable();
});
let systemAudioSampleCount = 0;
ipcMain.handle('meeting:start-system-audio-capture', () => {
    console.log('[Main] meeting:start-system-audio-capture called');
    systemAudioSampleCount = 0;
    try {
        const result = mediaMonitor.startSystemAudioCapture((info) => {
            systemAudioSampleCount++;
            // Log every 100th callback to avoid spam
            if (systemAudioSampleCount % 100 === 1) {
                console.log(`[Main] System audio samples received #${systemAudioSampleCount}: sampleCount=${info.sampleCount}, channelCount=${info.channelCount}, sampleRate=${info.sampleRate}`);
            }
            // Forward audio samples to all renderer windows
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
                if (!win.isDestroyed()) {
                    // Convert Float32Array to regular array for IPC
                    win.webContents.send('meeting:system-audio-samples', {
                        samples: Array.from(info.samples),
                        channelCount: info.channelCount,
                        sampleRate: info.sampleRate,
                        sampleCount: info.sampleCount,
                    });
                }
            }
        });
        console.log('[Main] meeting:start-system-audio-capture result:', result);
        return result;
    }
    catch (error) {
        console.error('[Main] meeting:start-system-audio-capture error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('meeting:stop-system-audio-capture', () => {
    console.log('[Main] meeting:stop-system-audio-capture called');
    mediaMonitor.stopSystemAudioCapture();
    return { success: true };
});
// Native microphone capture (bypasses getUserMedia limitations)
ipcMain.handle('meeting:is-mic-capture-available', () => {
    console.log('[Main] meeting:is-mic-capture-available called');
    return mediaMonitor.isMicCaptureAvailable();
});
let micSampleCount = 0;
ipcMain.handle('meeting:start-mic-capture', () => {
    console.log('[Main] meeting:start-mic-capture called');
    micSampleCount = 0;
    try {
        const result = mediaMonitor.startMicCapture((info) => {
            micSampleCount++;
            // Log every 100th callback to avoid spam
            if (micSampleCount % 100 === 1) {
                console.log(`[Main] Native mic samples received #${micSampleCount}: sampleRate=${info.sampleRate}, sampleCount=${info.sampleCount}, channelCount=${info.channelCount}`);
            }
            // Send to all renderer windows
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
                if (!win.isDestroyed()) {
                    win.webContents.send('meeting:mic-audio-samples', {
                        samples: Array.from(info.samples),
                        channelCount: info.channelCount,
                        sampleRate: info.sampleRate,
                        sampleCount: info.sampleCount,
                    });
                }
            }
        });
        console.log('[Main] meeting:start-mic-capture result:', result);
        return result;
    }
    catch (error) {
        console.error('[Main] meeting:start-mic-capture error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('meeting:stop-mic-capture', () => {
    console.log('[Main] meeting:stop-mic-capture called');
    mediaMonitor.stopMicCapture();
    return { success: true };
});
// File-based recording (records directly to WAV files, no resampling)
ipcMain.handle('meeting:start-file-recording', (_event, micPath, systemPath) => {
    console.log('[Main] meeting:start-file-recording called');
    console.log('[Main]   Mic path:', micPath);
    console.log('[Main]   System path:', systemPath);
    const results = {
        mic: { success: false, error: '' },
        system: { success: false, error: '' }
    };
    try {
        // Start mic file recording
        if (micPath) {
            const micResult = mediaMonitor.startMicFileRecording(micPath);
            results.mic = { success: micResult.success, error: '' };
            console.log('[Main] Mic file recording started:', micResult.success);
        }
        // Start system audio file recording
        if (systemPath) {
            const sysResult = mediaMonitor.startSystemAudioFileRecording(systemPath);
            results.system = { success: sysResult.success, error: sysResult.error || '' };
            console.log('[Main] System audio file recording started:', sysResult.success);
        }
        return {
            success: results.mic.success || results.system.success,
            mic: results.mic,
            system: results.system
        };
    }
    catch (error) {
        console.error('[Main] meeting:start-file-recording error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
ipcMain.handle('meeting:stop-file-recording', async () => {
    console.log('[Main] meeting:stop-file-recording called');
    try {
        // Stop both recordings
        const micResult = mediaMonitor.stopMicFileRecording();
        const sysResult = mediaMonitor.stopSystemAudioFileRecording();
        console.log('[Main] Mic recording stopped:', micResult);
        console.log('[Main] System recording stopped:', sysResult);
        return {
            success: true,
            mic: {
                filePath: micResult.filePath,
                sampleRate: micResult.sampleRate,
                success: micResult.success
            },
            system: {
                filePath: sysResult.filePath,
                sampleRate: sysResult.sampleRate,
                success: sysResult.success
            }
        };
    }
    catch (error) {
        console.error('[Main] meeting:stop-file-recording error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
ipcMain.handle('meeting:merge-audio-files', async (_event, micPath, systemPath, outputPath) => {
    console.log('[Main] meeting:merge-audio-files called');
    console.log('[Main]   Mic:', micPath);
    console.log('[Main]   System:', systemPath);
    console.log('[Main]   Output:', outputPath);
    try {
        const { mergeAudioFiles } = await import('./meeting/audioChunker.js');
        const result = await mergeAudioFiles(micPath, systemPath, outputPath);
        console.log('[Main] Merge result:', result);
        return result;
    }
    catch (error) {
        console.error('[Main] meeting:merge-audio-files error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// AI Assignment Suggestion Handler
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('suggest-assignment', requirePremium('AI Analysis', async (event, request) => {
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
}));
// AI Activity Summary Generation Handler
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('generate-activity-summary', requirePremium('AI Analysis', async (event, context) => {
    console.log('[Main] generate-activity-summary requested for entry:', context.entryId);
    console.log('[Main] Screenshot descriptions:', context.screenshotDescriptions.length);
    console.log('[Main] Window titles:', context.windowTitles?.length || 0);
    console.log('[Main] App names:', context.appNames);
    console.log('[Main] App durations:', context.appDurations);
    console.log('[Main] Transcriptions:', context.transcriptions?.length || 0);
    try {
        // Use signal aggregator to collect and store signals for this entry
        // This centralizes signal management and enables reuse across AI tasks
        // ACTIVITY signals: Screenshot analysis
        if (context.screenshotDescriptions && context.screenshotDescriptions.length > 0) {
            signalAggregator.setScreenshotAnalysis(context.entryId, context.screenshotDescriptions);
        }
        // ACTIVITY signals: Window activity (with app durations for weighting)
        if ((context.appNames && context.appNames.length > 0) ||
            (context.windowTitles && context.windowTitles.length > 0)) {
            signalAggregator.setWindowActivity(context.entryId, context.appNames || [], context.windowTitles || [], context.appDurations // Pass app durations for primary task identification
            );
        }
        // ACTIVITY signals: Meeting transcriptions
        if (context.transcriptions && context.transcriptions.length > 0) {
            // Combine all transcription texts
            const combinedText = context.transcriptions
                .map(t => t.text)
                .filter(text => text && text.trim())
                .join('\n\n---\n\n');
            const totalDuration = context.transcriptions.reduce((sum, t) => sum + (t.duration || 0), 0);
            const languages = [...new Set(context.transcriptions.map(t => t.language).filter(Boolean))];
            if (combinedText.trim()) {
                signalAggregator.setMeetingTranscription(context.entryId, combinedText, context.transcriptions.length, totalDuration, languages);
                console.log('[Main] Added meeting transcription signal:', {
                    recordingCount: context.transcriptions.length,
                    totalDuration,
                    textLength: combinedText.length
                });
            }
        }
        // TEMPORAL signals: Calendar events
        const calendarService = getCalendarService();
        const calendarContext = calendarService.getCalendarContext(context.startTime);
        console.log('[Main] Calendar context:', {
            currentEvent: calendarContext.currentEvent,
            recentCount: calendarContext.recentEvents.length,
            upcomingCount: calendarContext.upcomingEvents.length
        });
        signalAggregator.setCalendarEvents(context.entryId, calendarContext.currentEvent || undefined, calendarContext.recentEvents, calendarContext.upcomingEvents);
        // TEMPORAL signals: Time context
        signalAggregator.setTimeContext(context.entryId, context.startTime);
        // USER signals: User profile (stored globally, not per-entry)
        if (context.userRole) {
            signalAggregator.setUserProfile(context.userRole);
        }
        // Build task request using aggregator
        // The aggregator will filter signals based on task requirements:
        // - summarization task gets: activity + temporal signals
        // - user context is NOT included by default (prevents cross-contamination)
        const taskRequest = signalAggregator.buildTaskRequest(context.entryId, 'summarization', {
            includeUserContext: false, // Don't mix user context into summaries
            duration: context.duration,
            startTime: context.startTime,
            endTime: context.endTime
        });
        console.log('[Main] Signal summary:', signalAggregator.getSignalSummaryForEntry(context.entryId));
        // Execute the AI task with filtered signals
        const result = await aiService.executeTask(taskRequest);
        if (result.success && result.summary) {
            console.log('[Main] Summary generated successfully:', result.summary.substring(0, 100));
            return {
                success: true,
                summary: result.summary,
                metadata: {
                    technologies: [],
                    activities: []
                }
            };
        }
        else {
            throw new Error((result.error && result.error.trim()) || 'Failed to generate summary');
        }
    }
    catch (error) {
        console.error('[Main] generate-activity-summary failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}));
// AI Tempo Account Selection Handler
// PREMIUM FEATURE: Requires Workplace Plan subscription
ipcMain.handle('select-tempo-account', requirePremium('AI Analysis', async (event, request) => {
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
}));
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
ipcMain.handle('db:get-entries-by-date-range', async (event, startTime, endTime) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntriesByDateRange(startTime, endTime) };
    }
    catch (error) {
        console.error('[Main] db:get-entries-by-date-range failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-entries-by-bucket', async (event, bucketId) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntriesByBucketId(bucketId) };
    }
    catch (error) {
        console.error('[Main] db:get-entries-by-bucket failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-entries-by-jira-key', async (event, jiraKey) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntriesByJiraKey(jiraKey) };
    }
    catch (error) {
        console.error('[Main] db:get-entries-by-jira-key failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-entry-count', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getEntryCount() };
    }
    catch (error) {
        console.error('[Main] db:get-entry-count failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: 0 };
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
// Tempo Cache Metadata
ipcMain.handle('db:get-tempo-cache-meta', async (event, key) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getTempoCacheMeta(key) };
    }
    catch (error) {
        console.error('[Main] db:get-tempo-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: null };
    }
});
ipcMain.handle('db:set-tempo-cache-meta', async (event, key, data, query) => {
    try {
        const db = DatabaseService.getInstance();
        db.setTempoCacheMeta(key, data, query);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:set-tempo-cache-meta failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
// Tempo Accounts Cache
ipcMain.handle('db:upsert-tempo-account', async (event, account) => {
    try {
        const db = DatabaseService.getInstance();
        db.upsertTempoAccount(account);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] db:upsert-tempo-account failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('db:get-all-tempo-accounts', async () => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getAllTempoAccounts() };
    }
    catch (error) {
        console.error('[Main] db:get-all-tempo-accounts failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:get-tempo-accounts-by-status', async (event, status) => {
    try {
        const db = DatabaseService.getInstance();
        return { success: true, data: db.getTempoAccountsByStatus(status) };
    }
    catch (error) {
        console.error('[Main] db:get-tempo-accounts-by-status failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] };
    }
});
ipcMain.handle('db:clear-tempo-cache', async () => {
    try {
        const db = DatabaseService.getInstance();
        db.clearTempoCache();
        return { success: true };
    }
    catch (error) {
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
        // Method 1: Use nativeImage to convert .icns to PNG
        const image = nativeImage.createFromPath(iconPath);
        if (!image.isEmpty()) {
            // Resize to a reasonable size (64x64) to keep data URL small
            const resized = image.resize({ width: 64, height: 64 });
            const png = resized.toPNG();
            const base64 = png.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;
            console.log(`[Main] get-app-icon-base64: Successfully converted icon via nativeImage (${Math.round(dataUrl.length / 1024)}KB)`);
            return { success: true, dataUrl };
        }
        // Method 2: Fallback to sips command for .icns files that nativeImage can't handle
        console.log(`[Main] get-app-icon-base64: nativeImage failed, trying sips fallback for: ${iconPath}`);
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const tempPngPath = path.join(os.tmpdir(), `icon-blacklist-${Date.now()}.png`);
        const convertScript = `sips -s format png -z 64 64 "${iconPath}" --out "${tempPngPath}" 2>/dev/null`;
        await execAsync(convertScript, { timeout: 5000 });
        if (fs.existsSync(tempPngPath)) {
            const iconBuffer = await fs.promises.readFile(tempPngPath);
            const base64 = iconBuffer.toString('base64');
            const dataUrl = `data:image/png;base64,${base64}`;
            // Clean up temp file
            await fs.promises.unlink(tempPngPath).catch(() => { });
            if (base64 && base64.length > 100) {
                console.log(`[Main] get-app-icon-base64: Successfully converted icon via sips (${Math.round(dataUrl.length / 1024)}KB)`);
                return { success: true, dataUrl };
            }
        }
        console.log(`[Main] get-app-icon-base64: Both methods failed for: ${iconPath}`);
        return { success: false, error: 'Failed to convert icon' };
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('[Main] get-blacklisted-tempo-accounts failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            data: []
        };
    }
});
// Add Tempo account to blacklist
ipcMain.handle('add-blacklisted-tempo-account', async (event, accountKey, accountId, name) => {
    console.log('[Main] add-blacklisted-tempo-account requested:', { accountKey, accountId, name });
    try {
        const dbService = DatabaseService.getInstance();
        dbService.addBlacklistedTempoAccount(accountKey, accountId, name);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] add-blacklisted-tempo-account failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Remove Tempo account from blacklist
ipcMain.handle('remove-blacklisted-tempo-account', async (event, accountKey) => {
    console.log('[Main] remove-blacklisted-tempo-account requested:', accountKey);
    try {
        const dbService = DatabaseService.getInstance();
        dbService.removeBlacklistedTempoAccount(accountKey);
        return { success: true };
    }
    catch (error) {
        console.error('[Main] remove-blacklisted-tempo-account failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
});
// Check if Tempo account is blacklisted
ipcMain.handle('is-tempo-account-blacklisted', async (event, accountKey) => {
    console.log('[Main] is-tempo-account-blacklisted requested:', accountKey);
    try {
        const dbService = DatabaseService.getInstance();
        const isBlacklisted = dbService.isTempoAccountBlacklisted(accountKey);
        return { success: true, isBlacklisted };
    }
    catch (error) {
        console.error('[Main] is-tempo-account-blacklisted failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            isBlacklisted: false
        };
    }
});
// ========================================================================
// TimeWarp: Background activity tracking IPC
// ========================================================================
ipcMain.handle('get-background-activities', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    return tracker.getActivities();
});
ipcMain.handle('claim-background-activities', async (_event, fromTimestamp, toTimestamp) => {
    const tracker = BackgroundActivityTracker.getInstance();
    return tracker.claimActivities(fromTimestamp, toTimestamp);
});
ipcMain.on('pause-background-tracker', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    tracker.pause();
});
ipcMain.on('resume-background-tracker', () => {
    const tracker = BackgroundActivityTracker.getInstance();
    tracker.resume();
});
const bundleIconCache = new Map();
ipcMain.handle('get-app-icon-by-bundle', async (_event, bundleId) => {
    if (!bundleId || !/^[a-zA-Z0-9._-]+$/.test(bundleId))
        return null;
    if (bundleIconCache.has(bundleId))
        return bundleIconCache.get(bundleId) ?? null;
    try {
        const { exec } = await import('child_process');
        const appPath = await new Promise((resolve, reject) => {
            exec(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'" | head -1`, { timeout: 3000 }, (err, stdout) => err ? reject(err) : resolve(stdout.toString().trim()));
        });
        if (!appPath) {
            bundleIconCache.set(bundleId, null);
            return null;
        }
        const icon = await app.getFileIcon(appPath, { size: 'small' });
        const dataUrl = icon.toDataURL();
        bundleIconCache.set(bundleId, dataUrl);
        return dataUrl;
    }
    catch (err) {
        console.error(`[Main] get-app-icon failed for ${bundleId}:`, err);
        bundleIconCache.set(bundleId, null);
        return null;
    }
});
// Calendar Integration
ipcMain.handle('calendar:connect', async () => {
    try {
        const service = getCalendarService();
        await service.connectGoogle();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] calendar:connect failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('calendar:disconnect', async () => {
    try {
        const service = getCalendarService();
        await service.disconnect();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] calendar:disconnect failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('calendar:is-connected', async () => {
    try {
        const service = getCalendarService();
        return { success: true, connected: await service.isConnected() };
    }
    catch (error) {
        console.error('[Main] calendar:is-connected failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', connected: false };
    }
});
ipcMain.handle('calendar:get-account', async () => {
    try {
        const service = getCalendarService();
        const email = await service.getAccountEmail();
        const provider = await service.getProviderName();
        return { success: true, email, provider };
    }
    catch (error) {
        console.error('[Main] calendar:get-account failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', email: null, provider: null };
    }
});
ipcMain.handle('calendar:sync', async () => {
    try {
        const service = getCalendarService();
        await service.syncEvents();
        return { success: true };
    }
    catch (error) {
        console.error('[Main] calendar:sync failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
});
ipcMain.handle('calendar:get-context', async (_, timestamp) => {
    try {
        const service = getCalendarService();
        const context = service.getCalendarContext(timestamp);
        return { success: true, ...context };
    }
    catch (error) {
        console.error('[Main] calendar:get-context failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', currentEvent: null, recentEvents: [], upcomingEvents: [] };
    }
});
ipcMain.handle('calendar:create-focus-time', async (_, input) => {
    try {
        const service = getCalendarService();
        const eventId = await service.createFocusTimeEvent(input);
        return { success: true, eventId };
    }
    catch (error) {
        console.error('[Main] calendar:create-focus-time failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', eventId: null };
    }
});
// Helper function to build split analysis prompt
function buildSplitAnalysisPrompt(activityData, calendarContext, manuallyTriggered = false) {
    const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString();
    const formatDuration = (ms) => `${Math.round(ms / 60000)} minutes`;
    let prompt = `Analyze the following sequence of work activities and identify points where the user switched between different tasks or areas of work. The goal is to produce granular time entries that accurately reflect how time was spent — it is better to over-split into smaller entries (they can always be grouped later) than to leave a long session as one vague block.

**Time Range:** ${formatTime(activityData.startTime)} - ${formatTime(activityData.endTime)} (${formatDuration(activityData.duration)})

**Calendar Context:**`;
    if (calendarContext.currentEvent) {
        prompt += `\n- Current Event: ${calendarContext.currentEvent}`;
    }
    if (calendarContext.recentEvents.length > 0) {
        prompt += `\n- Recent Events: ${calendarContext.recentEvents.join(', ')}`;
    }
    if (calendarContext.upcomingEvents.length > 0) {
        prompt += `\n- Upcoming Events: ${calendarContext.upcomingEvents.join(', ')}`;
    }
    prompt += `\n\n**Activity Screenshots (chronological order):**\n`;
    activityData.screenshots.forEach((screenshot, i) => {
        prompt += `${i + 1}. [${formatTime(screenshot.timestamp)}] ${screenshot.description}\n`;
    });
    if (manuallyTriggered) {
        prompt += `\n**Important Context:** The user manually requested this split analysis, which means they believe this session contains multiple distinct tasks. Be generous with splitting — look for any reasonable boundary including:`;
        prompt += `
- Switching between different projects, repos, or codebases
- Shifting between different types of work (coding vs reviewing vs communicating vs researching)
- Calendar events that overlap with the session (meetings, standups, etc.)
- Gaps or transitions in activity that suggest a context switch
- Working on different features, tickets, or topics within the same project
- Switching between different communication threads or channels

Even subtle shifts in focus should be treated as split points. When in doubt, split.`;
    }
    else {
        prompt += `\n**Instructions:**`;
        prompt += `
- Split when the user shifts between different projects, tasks, meetings, or areas of work
- Split when there is a calendar event that represents a distinct block of time (e.g., a meeting)
- Split when the type of work changes meaningfully (e.g., coding → code review → Slack conversations)
- Split when working on different features or tickets, even within the same project
- Do NOT split for trivial app switches that are part of the same workflow (e.g., IDE ↔ browser while debugging the same issue)
- When in doubt, prefer splitting — smaller accurate entries are more useful than one large vague entry`;
    }
    prompt += `

Each suggested split should have a clear, concise description of the work done in that segment.
Provide a confidence score (0.0 to 1.0) based on how clear the boundary is.

**Output Format:**
Return a JSON array of split suggestions. Each suggestion should have:
{
  "startTime": <timestamp in ms>,
  "endTime": <timestamp in ms>,
  "description": "<concise description of work done in this segment>",
  "suggestedBucket": null,
  "suggestedJiraKey": null,
  "confidence": <0.0 to 1.0>
}

If no meaningful splits are detected, return an empty array.

Respond with ONLY valid JSON (no markdown, no explanation):`;
    return prompt;
}
function parseSplitSuggestions(rawSuggestions, activityStartTime, activityEndTime) {
    try {
        if (!Array.isArray(rawSuggestions)) {
            console.warn('[Main] parseSplitSuggestions: expected array, got:', typeof rawSuggestions);
            return [];
        }
        return rawSuggestions
            .map((suggestion) => {
            let startTime = suggestion.startTime || 0;
            let endTime = suggestion.endTime || 0;
            // Validate timestamps fall within activity range if provided
            if (activityStartTime !== undefined && activityEndTime !== undefined) {
                // Check if timestamps are completely outside the valid range
                if (endTime < activityStartTime || startTime > activityEndTime) {
                    console.warn('[Main] parseSplitSuggestions: suggestion outside valid range, discarding:', {
                        suggestionStart: startTime,
                        suggestionEnd: endTime,
                        activityStart: activityStartTime,
                        activityEnd: activityEndTime
                    });
                    return null; // Will be filtered out
                }
                // Clamp timestamps to valid range
                if (startTime < activityStartTime) {
                    console.warn('[Main] parseSplitSuggestions: clamping startTime from', startTime, 'to', activityStartTime);
                    startTime = activityStartTime;
                }
                if (endTime > activityEndTime) {
                    console.warn('[Main] parseSplitSuggestions: clamping endTime from', endTime, 'to', activityEndTime);
                    endTime = activityEndTime;
                }
            }
            return {
                startTime,
                endTime,
                description: suggestion.description || '',
                suggestedBucket: suggestion.suggestedBucket || null,
                suggestedJiraKey: suggestion.suggestedJiraKey || null,
                confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 0.5
            };
        })
            .filter((suggestion) => suggestion !== null);
    }
    catch (error) {
        console.error('[Main] parseSplitSuggestions error:', error);
        return [];
    }
}
// AI Splitting Analysis
ipcMain.handle('ai:analyze-splits', async (_, activityData) => {
    try {
        console.log('[Main] ai:analyze-splits called for activity:', activityData.id);
        // Validate input
        if (!activityData.screenshots || activityData.screenshots.length === 0) {
            console.warn('[Main] ai:analyze-splits: no screenshots provided');
            return { success: true, suggestions: [] };
        }
        // 1. Get calendar context for the activity period
        const calendarService = getCalendarService();
        const calendarContext = calendarService.getCalendarContext(activityData.startTime);
        // 2. Collect signals using signal aggregator for consistency
        const screenshotDescriptions = activityData.screenshots.map(s => s.description);
        signalAggregator.setScreenshotAnalysis(activityData.id, screenshotDescriptions);
        signalAggregator.setCalendarEvents(activityData.id, calendarContext.currentEvent ?? undefined, calendarContext.recentEvents, calendarContext.upcomingEvents);
        signalAggregator.setTimeContext(activityData.id, activityData.startTime);
        // 3. Build analysis prompt with all signals
        // Note: Split analysis requires a specific prompt format for JSON output,
        // so we use a custom prompt builder rather than the generic signal-based approach
        const prompt = buildSplitAnalysisPrompt(activityData, calendarContext, activityData.manuallyTriggered ?? false);
        // 4. Call AI service to analyze and suggest splits
        // Build task request for 'split_suggestion' task type
        const taskRequest = signalAggregator.buildTaskRequest(activityData.id, 'split_suggestion', {
            duration: activityData.duration,
            startTime: activityData.startTime,
            endTime: activityData.endTime
        });
        // For split analysis, we still use the custom prompt approach since it
        // requires specific JSON output format. The signals are collected for
        // consistency and can be used by the proxy for additional context.
        const result = await aiService.summarizeActivities([prompt], // Send the full prompt as a single "activity"
        []);
        if (!result.success || !result.summary) {
            console.warn('[Main] ai:analyze-splits failed:', result.error);
            return {
                success: false,
                error: result.error || 'Split analysis failed',
                suggestions: []
            };
        }
        // 4. Parse response - the summary should contain JSON
        let suggestions = [];
        try {
            // Try to extract JSON from the response (handling potential markdown wrapping)
            let jsonText = result.summary.trim();
            // Remove markdown code blocks if present
            const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonText = jsonMatch[1].trim();
            }
            const parsed = JSON.parse(jsonText);
            suggestions = parseSplitSuggestions(Array.isArray(parsed) ? parsed : [], activityData.startTime, activityData.endTime);
        }
        catch (parseError) {
            console.error('[Main] ai:analyze-splits: Failed to parse AI response:', parseError);
            console.error('[Main] ai:analyze-splits: Response was:', result.summary);
            return {
                success: false,
                error: 'Failed to parse AI response',
                suggestions: []
            };
        }
        console.log('[Main] ai:analyze-splits completed with', suggestions.length, 'suggestions');
        return { success: true, suggestions };
    }
    catch (error) {
        console.error('[Main] ai:analyze-splits error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            suggestions: []
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
        // 0. Stop background activity tracker
        try {
            const tracker = BackgroundActivityTracker.getInstance();
            tracker.stop();
            await tracker.cleanupAll();
            console.log('[Main] Background activity tracker cleaned up');
        }
        catch (error) {
            console.error('[Main] Failed to cleanup background activity tracker:', error);
        }
        // 1. Cleanup subscription system (webhook server, trial notifications)
        await cleanupSubscription();
        // 2. Cleanup auto-updater interval
        if (!process.mas) {
            updater.cleanup();
        }
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
    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    // Set initial title and tooltip
    tray.setTitle(''); // Start with empty title (icon only)
    tray.setToolTip('Clearical');
    // Click toggles the main window
    tray.on('click', () => {
        toggleWindow();
    });
    // Right-click shows context menu
    tray.on('right-click', () => {
        // Get current recording state
        const recordingManager = getRecordingManager();
        const mediaStatus = recordingManager.getMediaStatus();
        const contextMenu = Menu.buildFromTemplate([
            {
                label: timerState.isRunning ? (timerState.isPaused ? '▶ Resume Chrono' : '⏹ Stop Chrono') : '▶ Start Chrono',
                click: () => {
                    // Send toggle command to renderer
                    const windows = BrowserWindow.getAllWindows();
                    for (const window of windows) {
                        if (!window.isDestroyed()) {
                            window.webContents.send('tray:toggle-chrono');
                        }
                    }
                }
            },
            {
                label: mediaStatus.isRecording ? '⏹ Stop Recording' : '🎙 Start Recording',
                click: () => {
                    // Send toggle command to renderer
                    const windows = BrowserWindow.getAllWindows();
                    for (const window of windows) {
                        if (!window.isDestroyed()) {
                            window.webContents.send('tray:toggle-recording');
                        }
                    }
                }
            },
            { type: 'separator' },
            { label: 'Quit', click: () => {
                    // Use comprehensive cleanup instead of simple quit
                    cleanupAndQuit();
                } }
        ]);
        tray?.popUpContextMenu(contextMenu);
    });
}
// --- Window bounds persistence ---
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
let saveBoundsTimer = null;
function loadWindowState() {
    try {
        if (fs.existsSync(windowStatePath)) {
            const data = JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'));
            // Validate saved bounds are on a visible display
            const display = screen.getDisplayMatching(data);
            const { x, y, width, height } = display.workArea;
            // Check that at least part of the window is visible
            if (data.x + data.width > x && data.x < x + width &&
                data.y + data.height > y && data.y < y + height) {
                return data;
            }
            console.log('[Main] Saved window bounds are off-screen, ignoring');
        }
    }
    catch (err) {
        console.warn('[Main] Failed to load window state:', err);
    }
    return null;
}
function saveWindowState() {
    if (!win || win.isDestroyed() || win.isMinimized())
        return;
    const bounds = win.getBounds();
    try {
        fs.writeFileSync(windowStatePath, JSON.stringify(bounds));
    }
    catch (err) {
        console.warn('[Main] Failed to save window state:', err);
    }
}
function debouncedSaveWindowState() {
    if (saveBoundsTimer)
        clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(saveWindowState, 300);
}
function toggleWindow() {
    if (win?.isVisible()) {
        win.hide();
    }
    else {
        win?.show();
        win?.focus();
    }
}
function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);
    const savedState = loadWindowState();
    win = new BrowserWindow({
        width: savedState?.width ?? 640,
        height: savedState?.height ?? 660,
        x: savedState?.x,
        y: savedState?.y,
        show: false,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 16 },
        resizable: true,
        minWidth: 400,
        minHeight: 300,
        movable: true,
        minimizable: true,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: false,
        webPreferences: {
            preload: preloadPath,
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            sandbox: false,
            devTools: true
        },
    });
    // Center on first launch (no saved state)
    if (!savedState) {
        win.center();
    }
    // Persist window bounds on move/resize
    win.on('move', debouncedSaveWindowState);
    win.on('resize', debouncedSaveWindowState);
    // In test mode or production, load from built files
    // In development (not test), load from Vite dev server
    const isTestMode = process.env.NODE_ENV === 'test';
    // Add keyboard shortcut to open DevTools (Cmd+Option+I on Mac, Ctrl+Shift+I on Windows/Linux)
    win.webContents.on('before-input-event', (event, input) => {
        if ((input.meta || input.control) && input.alt && input.key.toLowerCase() === 'i') {
            win?.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
    if (!app.isPackaged && !isTestMode) {
        win.loadURL('http://127.0.0.1:5173');
        // win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
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
}
/**
 * Create macOS application menu
 * Required by App Store guidelines to provide window management options
 */
function createApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
        // App menu (macOS only)
        ...(isMac ? [{
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    {
                        label: 'Settings...',
                        accelerator: 'Cmd+,',
                        click: () => {
                            if (win && !win.isDestroyed()) {
                                win.show();
                                win.focus();
                                win.webContents.send('navigate-to-settings');
                            }
                        }
                    },
                    { type: 'separator' },
                    { role: 'services' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' }
                ]
            }] : []),
        // File menu
        {
            label: 'File',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        // Edit menu
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                ...(isMac ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                    { type: 'separator' },
                    {
                        label: 'Speech',
                        submenu: [
                            { role: 'startSpeaking' },
                            { role: 'stopSpeaking' }
                        ]
                    }
                ] : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
            ]
        },
        // View menu
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        // Window menu (REQUIRED by App Store)
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Show Clearical',
                    accelerator: 'Cmd+0',
                    click: () => {
                        if (win) {
                            if (win.isMinimized()) {
                                win.restore();
                            }
                            win.show();
                            win.focus();
                        }
                        else {
                            createWindow();
                            win.show();
                            win.focus();
                        }
                    }
                },
                { type: 'separator' },
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close' }
                ])
            ]
        },
        // Help menu
        {
            role: 'help',
            submenu: [
                {
                    label: 'Learn More',
                    click: async () => {
                        await shell.openExternal('https://clearical.app');
                    }
                },
                {
                    label: 'Report an Issue',
                    click: async () => {
                        await shell.openExternal('https://clearical.app/support');
                    }
                }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    console.log('[Main] Application menu created');
}
// Track if cleanup has already been initiated to prevent multiple cleanups
let isCleaningUp = false;
app.on('before-quit', async (event) => {
    // When the auto-updater is installing, let the quit proceed unblocked
    // so electron-updater can replace the app and relaunch
    if (updater.isInstallingUpdate) {
        console.log('[Main] Quit triggered by auto-updater install — allowing quit to proceed');
        return;
    }
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
// Handle app activation (macOS) - clicking dock icon shows the window
app.on('activate', () => {
    if (win === null) {
        createTray();
        createWindow();
        win.show();
        win.focus();
    }
    else {
        win.show();
        win.focus();
    }
});
app.whenReady().then(async () => {
    // Initialize encryption key on app startup
    try {
        getEncryptionKey();
        console.log('[Main] Encryption system initialized');
    }
    catch (error) {
        console.error('[Main] Failed to initialize encryption:', error);
        console.warn('[Main] Screenshots will be saved unencrypted as fallback');
    }
    // Register clearical-screenshot:// protocol handler
    // Serves decrypted screenshots directly to <img> tags without base64 IPC transfer
    protocol.handle('clearical-screenshot', async (request) => {
        try {
            const url = new URL(request.url);
            const filePath = decodeURIComponent(url.searchParams.get('path') || '');
            if (!filePath) {
                return new Response('Missing path parameter', { status: 400 });
            }
            if (!fs.existsSync(filePath)) {
                return new Response('File not found', { status: 404 });
            }
            // Read and decrypt (supports both encrypted and unencrypted)
            let fileBuffer;
            try {
                fileBuffer = await decryptFile(filePath);
            }
            catch (decryptError) {
                // Fallback to raw read if decryption fails
                fileBuffer = await fs.promises.readFile(filePath);
            }
            return new Response(fileBuffer, {
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'private, max-age=3600',
                }
            });
        }
        catch (error) {
            console.error('[Main] clearical-screenshot protocol error:', error);
            return new Response('Internal error', { status: 500 });
        }
    });
    console.log('[Main] clearical-screenshot:// protocol registered');
    // Initialize auth system (Supabase)
    try {
        initializeAuth();
        console.log('[Main] Auth system initialized (Supabase)');
        // Sync app version to user profile (async, non-blocking)
        syncAppVersionOnStartup().catch((error) => {
            console.error('[Main] Failed to sync app version on startup:', error);
        });
    }
    catch (error) {
        console.error('[Main] Failed to initialize auth:', error);
    }
    // Initialize transcription service with auth refresh callback
    try {
        const { getTranscriptionService } = await import('./meeting/transcriptionService.js');
        const transcriptionService = getTranscriptionService();
        // Register auth refresh callback for token expiration handling
        transcriptionService.setRefreshAuthCallback(async () => {
            const authService = getAuthService();
            await authService.proactiveRefresh();
        });
        console.log('[Main] Transcription service initialized with auth refresh callback');
    }
    catch (error) {
        console.error('[Main] Failed to initialize transcription service:', error);
    }
    // Set up system wake/unlock detection for token refresh
    // This ensures auth tokens stay fresh after sleep/hibernate
    powerMonitor.on('resume', async () => {
        console.log('[Main] System resumed from sleep, refreshing auth token...');
        try {
            const authService = getAuthService();
            await authService.proactiveRefresh();
        }
        catch (error) {
            console.error('[Main] Failed to refresh auth on resume:', error);
        }
    });
    powerMonitor.on('unlock-screen', async () => {
        console.log('[Main] Screen unlocked, refreshing auth token...');
        try {
            const authService = getAuthService();
            await authService.proactiveRefresh();
        }
        catch (error) {
            console.error('[Main] Failed to refresh auth on unlock:', error);
        }
    });
    console.log('[Main] Power monitor listeners registered for auth refresh');
    // Initialize analytics system
    try {
        initializeAnalytics();
        console.log('[Main] Analytics system initialized');
    }
    catch (error) {
        console.error('[Main] Failed to initialize analytics:', error);
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
    // Initialize calendar service (async)
    initializeCalendarService()
        .then(() => {
        console.log('[Main] Calendar service initialized');
    })
        .catch((error) => {
        console.error('[Main] Failed to initialize calendar service:', error);
    });
    // AI service uses cloud-based Gemini API via Supabase Edge Function
    // No local server needed - requests are made on-demand
    console.log('[Main] AI service configured (Gemini cloud via Supabase)');
    // Initialize recording manager for mic/camera detection
    try {
        const recordingManager = getRecordingManager();
        // Set up callback for recording manager to check timer state
        // This prevents showing prompts when timer is already running
        recordingManager.setIsTimerRunningCallback(() => {
            return timerState.isRunning && !timerState.isPaused;
        });
        recordingManager.start();
        console.log('[Main] Recording manager initialized (mic/camera detection)');
        // Set up periodic cleanup of old pending transcriptions (every 6 hours)
        // Clean up transcriptions older than 24 hours to handle crash recovery scenarios
        const cleanupInterval = 6 * 60 * 60 * 1000; // 6 hours
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        setInterval(async () => {
            try {
                const { cleanupOld } = await import('./meeting/pendingTranscriptionStore.js');
                cleanupOld(maxAge);
            }
            catch (error) {
                console.error('[Main] Failed to cleanup old pending transcriptions:', error);
            }
        }, cleanupInterval);
        console.log('[Main] Pending transcription cleanup scheduled (every 6h, max age 24h)');
    }
    catch (error) {
        console.error('[Main] Failed to initialize recording manager:', error);
    }
    // Initialize background activity tracker for TimeWarp feature
    try {
        const tracker = BackgroundActivityTracker.getInstance();
        // Push updates to renderer
        tracker.setUpdateCallback((activities) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('background-activities-update', activities);
            }
        });
        await tracker.start();
        console.log('[Main] Background activity tracker initialized');
    }
    catch (error) {
        console.error('[Main] Failed to initialize background activity tracker:', error);
    }
    // Create application menu (required by App Store)
    createApplicationMenu();
    createTray();
    createWindow();
    // Show the window at saved position (or centered on first launch)
    win?.show();
    win?.focus();
    setTimeout(() => {
        // Initialize working hours scheduler after window is ready
        // This allows the scheduler to use the main window for IPC
        try {
            const workingHoursScheduler = getWorkingHoursScheduler();
            workingHoursScheduler.setMainWindow(win);
            // Set up callback for when user accepts the prompt
            workingHoursScheduler.setOnStartTimerCallback(() => {
                console.log('[Main] Working hours: User wants to start timer');
                // Send IPC to renderer to start timer
                if (win && !win.isDestroyed()) {
                    win.webContents.send('working-hours:start-timer');
                }
            });
            // Set up callback to check if timer is already running
            // This prevents showing the "Ready to start?" prompt when user already has an active timer
            workingHoursScheduler.setIsTimerRunningCallback(() => {
                return timerState.isRunning;
            });
            workingHoursScheduler.start();
            console.log('[Main] Working hours scheduler initialized');
        }
        catch (error) {
            console.error('[Main] Failed to initialize working hours scheduler:', error);
        }
    }, 150);
    // Initialize auto-updater (skip for Mac App Store builds)
    if (!process.mas) {
        updater.setMainWindow(win);
        updater.start();
        console.log('[Main] Auto-updater initialized');
    }
    else {
        console.log('[Main] Skipping auto-updater (Mac App Store build)');
    }
});
