import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, systemPreferences, shell, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public');
let win;
let tray;
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
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
        console.log('[Main] Sources found:', sources.length);
        const primarySource = sources[0]; // Assuming primary screen for now
        if (primarySource) {
            console.log('[Main] Capturing source:', primarySource.name);
            const image = primarySource.thumbnail.toPNG();
            const filename = `screenshot-${Date.now()}.png`;
            const filePath = path.join(SCREENSHOTS_DIR, filename);
            await fs.promises.writeFile(filePath, image);
            console.log('[Main] Screenshot saved:', filePath);
            return filePath;
        }
        else {
            console.log('[Main] No primary source found');
        }
    }
    catch (error) {
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
            }
            catch (e) {
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
            const appResult = await execAsync(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`);
            const appName = appResult.stdout.trim();
            // Get window title (may fail for some apps)
            let windowTitle = '';
            try {
                const titleResult = await execAsync(`osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`);
                windowTitle = titleResult.stdout.trim();
            }
            catch (e) {
                windowTitle = '(No window title available)';
            }
            console.log('[Main] get-active-window result:', { appName, windowTitle });
            return { appName, windowTitle };
        }
        catch (error) {
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
function createWindow() {
    const preloadPath = path.join(__dirname, 'preload.cjs');
    console.log('[Main] Preload Path:', preloadPath);
    win = new BrowserWindow({
        width: 500,
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
    }
    else {
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
