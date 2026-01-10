/**
 * Example: How to Integrate UpdateNotification Component
 *
 * This file demonstrates different ways to integrate the auto-update
 * notification into your application. Choose the approach that best
 * fits your app architecture.
 */

import React from 'react';
import { UpdateNotification } from './UpdateNotification';
import { UpdateSettings } from './UpdateSettings';

// ============================================================================
// Example 1: Basic Integration (Recommended)
// ============================================================================
// Add to your main App component. The notification auto-hides when not needed.

export function AppWithUpdates() {
    return (
        <div className="app">
            {/* Your existing app content */}
            <div className="main-content">
                <h1>TimePortal</h1>
                {/* ... rest of your app ... */}
            </div>

            {/* Add update notification - it positions itself */}
            <UpdateNotification />
        </div>
    );
}

// ============================================================================
// Example 2: With Manual Check Button
// ============================================================================
// Add a "Check for Updates" button in your app menu or settings

export function AppWithManualCheck() {
    const [showUpdatePanel, setShowUpdatePanel] = React.useState(false);

    const handleCheckForUpdates = async () => {
        setShowUpdatePanel(true);
    };

    return (
        <div className="app">
            <header>
                <button onClick={handleCheckForUpdates}>
                    Check for Updates
                </button>
            </header>

            <main>{/* Your app content */}</main>

            {/* Show update notification when user clicks check */}
            {showUpdatePanel && (
                <UpdateNotification
                    showManualCheck={true}
                    onClose={() => setShowUpdatePanel(false)}
                />
            )}
        </div>
    );
}

// ============================================================================
// Example 3: Settings Page Integration
// ============================================================================
// Add update settings to your settings/preferences page

export function SettingsPageWithUpdates() {
    return (
        <div className="settings-page">
            <h2>Settings</h2>

            {/* General Settings */}
            <section>
                <h3>General</h3>
                {/* Your general settings */}
            </section>

            {/* Update Settings */}
            <section>
                <h3>Updates</h3>
                <UpdateSettings />
            </section>

            {/* Other Settings */}
            <section>
                <h3>Advanced</h3>
                {/* Your advanced settings */}
            </section>
        </div>
    );
}

// ============================================================================
// Example 4: Custom Update Status Display
// ============================================================================
// Create a custom UI using the update status

export function CustomUpdateStatus() {
    const [updateStatus, setUpdateStatus] = React.useState<any>(null);

    React.useEffect(() => {
        // Subscribe to update status changes
        const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate(
            (status) => {
                setUpdateStatus(status);
            }
        );

        // Get initial status
        window.electron.ipcRenderer.updater.getStatus().then((result) => {
            if (result.success) {
                setUpdateStatus(result.status);
            }
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    if (!updateStatus?.available) {
        return null;
    }

    return (
        <div className="custom-update-badge">
            <span className="badge">
                {updateStatus.downloaded
                    ? 'Update Ready!'
                    : updateStatus.downloading
                    ? 'Downloading...'
                    : 'Update Available'}
            </span>
            {updateStatus.version && <span className="version">v{updateStatus.version}</span>}
        </div>
    );
}

// ============================================================================
// Example 5: Menu Bar Integration
// ============================================================================
// Show update status in menu bar or navigation

export function MenuBarWithUpdates() {
    const [updateAvailable, setUpdateAvailable] = React.useState(false);

    React.useEffect(() => {
        const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate(
            (status) => {
                setUpdateAvailable(status.available);
            }
        );

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    return (
        <nav className="menu-bar">
            <div className="menu-items">
                <button>File</button>
                <button>Edit</button>
                <button>View</button>
            </div>

            {updateAvailable && (
                <div className="update-indicator">
                    <span className="pulse-dot" />
                    <span>Update Available</span>
                </div>
            )}
        </nav>
    );
}

// ============================================================================
// Example 6: Programmatic Update Check
// ============================================================================
// Trigger update check programmatically

export function ProgrammaticUpdateCheck() {
    const [isChecking, setIsChecking] = React.useState(false);
    const [updateInfo, setUpdateInfo] = React.useState<any>(null);

    const checkForUpdates = async () => {
        setIsChecking(true);
        try {
            const result = await window.electron.ipcRenderer.updater.checkForUpdates();
            if (result.success && result.status) {
                setUpdateInfo(result.status);
            }
        } catch (error) {
            console.error('Failed to check for updates:', error);
        } finally {
            setIsChecking(false);
        }
    };

    const downloadAndInstall = async () => {
        try {
            // Download if not already downloaded
            if (updateInfo?.available && !updateInfo?.downloaded) {
                await window.electron.ipcRenderer.updater.downloadUpdate();
            }
            // Install and restart
            await window.electron.ipcRenderer.updater.quitAndInstall();
        } catch (error) {
            console.error('Failed to install update:', error);
        }
    };

    return (
        <div className="update-checker">
            <button onClick={checkForUpdates} disabled={isChecking}>
                {isChecking ? 'Checking...' : 'Check for Updates'}
            </button>

            {updateInfo?.available && (
                <div className="update-info">
                    <p>Version {updateInfo.version} is available!</p>
                    <button onClick={downloadAndInstall}>
                        {updateInfo.downloaded ? 'Install and Restart' : 'Download and Install'}
                    </button>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Example 7: Notification with Custom Styling
// ============================================================================
// Override default notification styling

export function CustomStyledNotification() {
    return (
        <div className="app">
            <main>{/* Your app */}</main>

            {/* Wrap in custom container for styling */}
            <div className="custom-notification-container">
                <UpdateNotification />
            </div>

            <style>{`
                .custom-notification-container {
                    /* Custom positioning */
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 9999;
                }

                .custom-notification-container > div {
                    /* Custom notification styling */
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                    border-radius: 12px;
                    animation: slideDown 0.3s ease-out;
                }

                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `}</style>
        </div>
    );
}

// ============================================================================
// Example 8: Update Status in System Tray/Menu Bar
// ============================================================================
// For apps with system tray, show update status there too

export function SystemTrayIntegration() {
    React.useEffect(() => {
        // Listen for update status changes
        const unsubscribe = window.electron.ipcRenderer.updater.onStatusUpdate(
            (status) => {
                // You could send this to main process to update tray menu
                if (status.available) {
                    console.log('Update available - could update tray menu');
                    // window.electron.ipcRenderer.send('update-tray-menu', {
                    //     updateAvailable: true,
                    //     version: status.version
                    // });
                }
            }
        );

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    return <div>Your app content</div>;
}

// ============================================================================
// Best Practices
// ============================================================================

/**
 * RECOMMENDED SETUP:
 *
 * 1. Add <UpdateNotification /> to your main App component
 *    - It auto-hides when no updates available
 *    - Automatically shows when updates are found
 *    - Handles all user interactions
 *
 * 2. Add <UpdateSettings /> to your Settings page
 *    - Let users configure update preferences
 *    - Settings persist in localStorage
 *
 * 3. Add a manual "Check for Updates" menu item
 *    - Useful for users who want to check immediately
 *    - Can trigger the notification programmatically
 *
 * 4. Handle edge cases:
 *    - No internet connection (show friendly error)
 *    - Failed downloads (allow retry)
 *    - User cancels update (save preference)
 */

/**
 * INTEGRATION CHECKLIST:
 *
 * ✅ Add UpdateNotification component to main app
 * ✅ Add UpdateSettings to settings page
 * ✅ Test update flow in production build
 * ✅ Verify GitHub releases are configured
 * ✅ Test with actual version bump
 * ✅ Document update process for team
 * ✅ Add release notes template
 * ✅ Set up code signing (for production)
 * ✅ Monitor update adoption rates
 * ✅ Plan rollback strategy
 */

export default {
    AppWithUpdates,
    AppWithManualCheck,
    SettingsPageWithUpdates,
    CustomUpdateStatus,
    MenuBarWithUpdates,
    ProgrammaticUpdateCheck,
    CustomStyledNotification,
    SystemTrayIntegration,
};
