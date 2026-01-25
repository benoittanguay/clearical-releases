/**
 * Notch-style Widget Prototype
 *
 * Run with: npx electron prototypes/notch-test/main.cjs
 *
 * This creates a floating widget positioned at the top center of the screen,
 * overlapping the macOS menu bar like Apple's Dynamic Island.
 */

const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// Widget dimensions (extra space for shadow to render)
const SHADOW_PADDING = 40; // Space for box-shadow to render
const WIDGET_WIDTH = 520 + (SHADOW_PADDING * 2);
const WIDGET_HEIGHT = 120 + SHADOW_PADDING; // Only need padding on bottom/sides

let widgetWindow = null;

function createWidget() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.size;

    // Position flush with bottom of menu bar
    // workAreaSize excludes menu bar, so workArea.y gives us menu bar height
    const workArea = primaryDisplay.workArea;
    const menuBarHeight = workArea.y; // Usually ~25px or ~37px on notched Macs

    const x = Math.round((screenWidth - WIDGET_WIDTH) / 2);
    const y = menuBarHeight - 0; // Sit right at the bottom edge of menu bar (no top padding needed)

    widgetWindow = new BrowserWindow({
        width: WIDGET_WIDTH,
        height: WIDGET_HEIGHT,
        x,
        y,
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        minimizable: false,
        maximizable: false,
        closable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,          // No window shadow
        roundedCorners: false,     // No rounded corners from OS
        titleBarStyle: 'hidden',   // Hide title bar completely
        trafficLightPosition: { x: -100, y: -100 }, // Move traffic lights off-screen
        vibrancy: null,            // No vibrancy effect
        visualEffectState: 'inactive',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    // Critical: Set window level to float above menu bar on macOS
    if (process.platform === 'darwin') {
        // Try 'pop-up-menu' level which is above menu bar
        // Levels in order: normal < floating < torn-off-menu < modal-panel < main-menu < status < pop-up-menu < screen-saver
        widgetWindow.setAlwaysOnTop(true, 'pop-up-menu');
        widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // Ignore mouse events outside to prevent menu bar interaction issues
        widgetWindow.setIgnoreMouseEvents(false);

        // Hide from dock and app switcher for a cleaner notch-like feel
        app.dock.hide();
    }

    // Load the v2 notch prototype (flat top, rounded bottom)
    const htmlPath = path.join(__dirname, '..', 'audio-widget-v2-notch.html');
    widgetWindow.loadFile(htmlPath);

    // Remove any window background
    widgetWindow.setBackgroundColor('#00000000');

    // Show when ready, then reposition to overlap menu bar
    widgetWindow.once('ready-to-show', () => {
        widgetWindow.show();

        // After showing, force position to overlap menu bar
        // Use a small delay to bypass initial positioning restrictions
        setTimeout(() => {
            const targetY = 0; // Top of screen, overlapping menu bar
            widgetWindow.setPosition(x, targetY);
            console.log('Repositioned to y=0 after show');
        }, 100);
    });

    // Quit when window is closed
    widgetWindow.on('closed', () => {
        widgetWindow = null;
        app.quit();
    });

    console.log('Menu bar height:', menuBarHeight);
    console.log('Widget created at position:', { x, y });
    console.log('Press Cmd+Q or close the widget to exit');
}

// IPC handlers
ipcMain.on('widget:hide', () => {
    console.log('Hide requested');
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.hide();
    }
});

ipcMain.on('widget:stop', () => {
    console.log('Stop requested');
    // In real app, this would stop recording
    // For prototype, just quit
    app.quit();
});

// Function to show widget with animation
function showWidget() {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.show();
        widgetWindow.webContents.send('widget:show');

        // Reposition after show
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth } = primaryDisplay.size;
        const x = Math.round((screenWidth - WIDGET_WIDTH) / 2);
        setTimeout(() => {
            widgetWindow.setPosition(x, 0);
        }, 50);
    }
}

// When Electron is ready
app.whenReady().then(() => {
    createWidget();

    // For prototype: show widget again after 2 seconds when hidden
    // In real app, this would be triggered by recording state
    setInterval(() => {
        if (widgetWindow && !widgetWindow.isDestroyed() && !widgetWindow.isVisible()) {
            console.log('Re-showing widget after hide (prototype behavior)');
            showWidget();
        }
    }, 3000);
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});
