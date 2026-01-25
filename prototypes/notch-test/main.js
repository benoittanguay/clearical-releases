/**
 * Notch-style Widget Prototype
 *
 * Run with: npx electron prototypes/notch-test/main.js
 *
 * This creates a floating widget positioned at the top center of the screen,
 * overlapping the macOS menu bar like Apple's Dynamic Island.
 */

const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

// Widget dimensions
const WIDGET_WIDTH = 520;
const WIDGET_HEIGHT = 80;

let widgetWindow = null;

function createWidget() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.size;

    // Position at top center - y=0 puts it at the very top
    // On macOS, menu bar is typically 25px tall
    // We position at y=4 to slightly overlap/touch the menu bar area
    const x = Math.round((screenWidth - WIDGET_WIDTH) / 2);
    const y = 4;

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
        hasShadow: true,
        roundedCorners: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Critical: Set window level to float above menu bar on macOS
    if (process.platform === 'darwin') {
        // 'screen-saver' level allows the window to appear above the menu bar
        widgetWindow.setAlwaysOnTop(true, 'screen-saver');
        widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // Hide from dock and app switcher for a cleaner notch-like feel
        app.dock.hide();
    }

    // Load the v2 notch prototype (flat top, rounded bottom)
    const htmlPath = path.join(__dirname, '..', 'audio-widget-v2-notch.html');
    widgetWindow.loadFile(htmlPath);

    // Show when ready
    widgetWindow.once('ready-to-show', () => {
        widgetWindow.show();
    });

    // Quit when window is closed
    widgetWindow.on('closed', () => {
        widgetWindow = null;
        app.quit();
    });

    console.log('Widget created at position:', { x, y });
    console.log('Press Cmd+Q or close the widget to exit');
}

// When Electron is ready
app.whenReady().then(() => {
    createWidget();
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
    app.quit();
});
