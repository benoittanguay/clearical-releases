/**
 * Working Hours Scheduler
 *
 * Manages the daily "Ready to start your day?" prompt based on user's
 * configured working hours. Checks every minute if it's time to show
 * the prompt.
 */

import { BrowserWindow } from 'electron';
import { getRecordingWidgetManager } from './meeting/recordingWidgetManager.js';
import { DatabaseService } from './databaseService.js';

export interface WorkingHoursSettings {
    enabled: boolean;
    startTime: string;           // "HH:mm" format
    endTime: string;             // "HH:mm" format
    daysOfWeek: number[];        // 0=Sun, 1=Mon, ..., 6=Sat
    reminderSnoozeDuration: number;  // Minutes
    lastPromptDate: string | null;   // "YYYY-MM-DD"
    snoozedUntil: number | null;     // Timestamp
}

// Grace period in hours - show prompt if app launched within this many hours of start time
const GRACE_PERIOD_HOURS = 2;

// Delay before first check to ensure window is ready
const INITIAL_CHECK_DELAY_MS = 5000;

export class WorkingHoursScheduler {
    private static instance: WorkingHoursScheduler | null = null;
    private checkInterval: NodeJS.Timeout | null = null;
    private mainWindow: BrowserWindow | null = null;
    private onStartTimerCallback: (() => void) | null = null;
    private isTimerRunningCallback: (() => boolean) | null = null;
    private isPromptShowing = false;

    private constructor() {
        // Register widget callbacks
        this.setupWidgetCallbacks();
    }

    public static getInstance(): WorkingHoursScheduler {
        if (!WorkingHoursScheduler.instance) {
            WorkingHoursScheduler.instance = new WorkingHoursScheduler();
        }
        return WorkingHoursScheduler.instance;
    }

    /**
     * Set the main window reference for IPC communication
     */
    public setMainWindow(window: BrowserWindow | null): void {
        this.mainWindow = window;
    }

    /**
     * Set callback for when user accepts the prompt and wants to start timer
     */
    public setOnStartTimerCallback(callback: () => void): void {
        this.onStartTimerCallback = callback;
    }

    /**
     * Set callback to check if timer is currently running
     * Used to skip showing the prompt if user already has an active timer
     */
    public setIsTimerRunningCallback(callback: () => boolean): void {
        this.isTimerRunningCallback = callback;
    }

    /**
     * Setup callbacks for widget button responses
     */
    private setupWidgetCallbacks(): void {
        const widgetManager = getRecordingWidgetManager();

        // Handle "Yes, Start" button
        widgetManager.setOnWorkingHoursAcceptedCallback(() => {
            console.log('[WorkingHoursScheduler] User accepted - starting timer');
            this.isPromptShowing = false;

            // Mark as shown today
            this.updateLastPromptDate();

            // Close the widget
            widgetManager.close();

            // Trigger timer start
            if (this.onStartTimerCallback) {
                this.onStartTimerCallback();
            }
        });

        // Handle "Snooze" button
        widgetManager.setOnWorkingHoursSnoozedCallback(async () => {
            console.log('[WorkingHoursScheduler] User snoozed');
            this.isPromptShowing = false;

            // Get current settings and set snooze time
            const settings = this.getSettings();
            if (settings) {
                const snoozeDuration = settings.reminderSnoozeDuration || 30;
                const snoozedUntil = Date.now() + (snoozeDuration * 60 * 1000);
                this.updateSnoozedUntil(snoozedUntil);
                console.log(`[WorkingHoursScheduler] Snoozed for ${snoozeDuration} minutes`);
            }

            // Widget should already be hiding via animation
        });

        // Handle "Day Off" button
        widgetManager.setOnWorkingHoursDayOffCallback(async () => {
            console.log('[WorkingHoursScheduler] User taking day off');
            this.isPromptShowing = false;

            // Mark as shown today (prevents further prompts)
            this.updateLastPromptDate();

            // Widget should already be hiding via animation
        });
    }

    /**
     * Start the scheduler - checks every minute
     */
    public start(): void {
        if (this.checkInterval) {
            console.log('[WorkingHoursScheduler] Already started');
            return;
        }

        console.log('[WorkingHoursScheduler] Starting scheduler');

        // Delay the first check to ensure database and window are fully ready
        setTimeout(() => {
            this.checkAndShowPrompt();
        }, INITIAL_CHECK_DELAY_MS);

        // Then check every 60 seconds
        this.checkInterval = setInterval(() => {
            this.checkAndShowPrompt();
        }, 60 * 1000);
    }

    /**
     * Stop the scheduler
     */
    public stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('[WorkingHoursScheduler] Scheduler stopped');
        }
    }

    /**
     * Main check logic - determines if prompt should be shown
     */
    private checkAndShowPrompt(): void {
        try {
            // Don't show if a prompt is already visible
            if (this.isPromptShowing) {
                return;
            }

            // Don't show if timer is already running - user has already started their day
            if (this.isTimerRunningCallback && this.isTimerRunningCallback()) {
                return;
            }

            const settings = this.getSettings();
            if (!settings) {
                console.log('[WorkingHoursScheduler] No settings found or feature disabled');
                return;
            }

            // 1. Is working hours enabled?
            if (!settings.enabled) {
                return;
            }

            // 2. Is today a working day?
            const now = new Date();
            const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
            if (!settings.daysOfWeek.includes(dayOfWeek)) {
                return;
            }

            // 3. Was prompt already accepted/day-off'd today?
            const todayStr = this.getTodayDateString();
            if (settings.lastPromptDate === todayStr) {
                return;
            }

            // 4. Is there an active snooze?
            if (settings.snoozedUntil && settings.snoozedUntil > Date.now()) {
                return;
            }

            // 5. Is current time within the appropriate window?
            const shouldShow = this.shouldShowPrompt(settings, now);
            if (!shouldShow) {
                return;
            }

            // All checks passed - show the prompt
            console.log('[WorkingHoursScheduler] Showing working hours prompt');
            this.isPromptShowing = true;

            const widgetManager = getRecordingWidgetManager();
            widgetManager.showWorkingHoursPrompt();

        } catch (error) {
            console.error('[WorkingHoursScheduler] Error in checkAndShowPrompt:', error);
        }
    }

    /**
     * Determine if prompt should show based on time
     * Shows if:
     * - Within 5 minutes of start time, OR
     * - App just launched and within grace period (GRACE_PERIOD_HOURS hours of start time)
     */
    private shouldShowPrompt(settings: WorkingHoursSettings, now: Date): boolean {
        const [startHour, startMinute] = settings.startTime.split(':').map(Number);

        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = startHour * 60 + startMinute;

        // Check if within 5 minutes of start time
        const diffFromStart = currentMinutes - startMinutes;
        if (diffFromStart >= 0 && diffFromStart <= 5) {
            console.log('[WorkingHoursScheduler] Within 5 minutes of start time');
            return true;
        }

        // Check if within grace period (for late app launches)
        const graceMinutes = GRACE_PERIOD_HOURS * 60;
        if (diffFromStart > 5 && diffFromStart <= graceMinutes) {
            console.log(`[WorkingHoursScheduler] Within ${GRACE_PERIOD_HOURS}h grace period of start time`);
            return true;
        }

        return false;
    }

    /**
     * Get today's date as YYYY-MM-DD string
     */
    private getTodayDateString(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    /**
     * Get working hours settings from the database directly
     */
    private getSettings(): WorkingHoursSettings | null {
        try {
            const db = DatabaseService.getInstance();
            const settings = db.getSetting('workingHours');

            if (settings && typeof settings === 'object') {
                return settings as WorkingHoursSettings;
            }

            return null;
        } catch (error) {
            console.error('[WorkingHoursScheduler] Error getting settings:', error);
            return null;
        }
    }

    /**
     * Update lastPromptDate to today
     */
    private updateLastPromptDate(): void {
        const todayStr = this.getTodayDateString();

        try {
            const db = DatabaseService.getInstance();
            const currentSettings = this.getSettings();

            if (currentSettings) {
                const updated = {
                    ...currentSettings,
                    lastPromptDate: todayStr,
                    snoozedUntil: null,
                };
                db.setSetting('workingHours', updated);
                console.log('[WorkingHoursScheduler] Updated lastPromptDate to', todayStr);
            }
        } catch (error) {
            console.error('[WorkingHoursScheduler] Error updating lastPromptDate:', error);
        }
    }

    /**
     * Update snoozedUntil timestamp
     */
    private updateSnoozedUntil(timestamp: number): void {
        try {
            const db = DatabaseService.getInstance();
            const currentSettings = this.getSettings();

            if (currentSettings) {
                const updated = {
                    ...currentSettings,
                    snoozedUntil: timestamp,
                };
                db.setSetting('workingHours', updated);
                console.log('[WorkingHoursScheduler] Updated snoozedUntil to', new Date(timestamp).toLocaleTimeString());
            }
        } catch (error) {
            console.error('[WorkingHoursScheduler] Error updating snoozedUntil:', error);
        }
    }

    /**
     * Reset the prompt state at midnight (for next day)
     * This should be called by a midnight check or on app startup
     */
    public resetForNewDay(): void {
        const todayStr = this.getTodayDateString();

        try {
            const settings = this.getSettings();
            if (settings && settings.lastPromptDate !== todayStr) {
                // It's a new day - clear the snoozed state
                const db = DatabaseService.getInstance();
                const updated = {
                    ...settings,
                    snoozedUntil: null,
                };
                db.setSetting('workingHours', updated);
                console.log('[WorkingHoursScheduler] Reset snoozedUntil for new day');
            }
        } catch (error) {
            console.error('[WorkingHoursScheduler] Error resetting for new day:', error);
        }
    }
}

// Export singleton getter
export function getWorkingHoursScheduler(): WorkingHoursScheduler {
    return WorkingHoursScheduler.getInstance();
}
