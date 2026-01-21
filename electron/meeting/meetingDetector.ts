/**
 * Meeting Detection Service
 *
 * Detects when the user is in a video meeting by checking active window
 * bundle IDs and window titles against known video meeting apps.
 */

import { EventEmitter } from 'events';
import {
    MeetingPlatform,
    MeetingStatus,
    MeetingEvent,
    MEETING_EVENTS,
} from './types';

/**
 * Bundle IDs for native video meeting applications
 */
const VIDEO_MEETING_BUNDLE_IDS: Record<string, MeetingPlatform> = {
    'us.zoom.videomeetings': 'Zoom',
    'us.zoom.xos': 'Zoom',
    'com.microsoft.teams': 'Microsoft Teams',
    'com.microsoft.teams2': 'Microsoft Teams',
    'com.discord.Discord': 'Discord',
    'com.tinyspeck.slackmacgap': 'Slack',
    'com.apple.FaceTime': 'FaceTime',
    'com.cisco.webex.meetings': 'Webex',
    'com.skype.skype': 'Skype',
};

/**
 * Browser bundle IDs that might host web-based meetings
 */
const BROWSER_BUNDLE_IDS = [
    'com.google.Chrome',
    'com.apple.Safari',
    'org.mozilla.firefox',
    'com.microsoft.edgemac',
    'com.brave.Browser',
    'com.operasoftware.Opera',
    'com.vivaldi.Vivaldi',
    'company.thebrowser.Browser', // Arc
];

/**
 * Patterns to detect web-based meetings from window titles
 */
const BROWSER_MEETING_PATTERNS: Array<{
    pattern: RegExp;
    platform: MeetingPlatform;
}> = [
    { pattern: /meet\.google\.com/i, platform: 'Google Meet' },
    { pattern: /Google Meet/i, platform: 'Google Meet' },
    { pattern: /zoom\.us\/j\//i, platform: 'Zoom Web' },
    { pattern: /Zoom Meeting/i, platform: 'Zoom Web' },
    { pattern: /teams\.microsoft\.com/i, platform: 'Teams Web' },
    { pattern: /Microsoft Teams.*Meeting/i, platform: 'Teams Web' },
];

/**
 * Window title patterns that indicate an active meeting (not just the app open)
 */
const ACTIVE_MEETING_PATTERNS: Record<string, RegExp[]> = {
    'Zoom': [
        /^Zoom Meeting$/i,
        /^Zoom Webinar$/i,
        /Meeting in progress/i,
        /^Meeting/i,
    ],
    'Microsoft Teams': [
        /Meeting with/i,
        /Call with/i,
        /^Meeting$/i,
    ],
    'Discord': [
        /Voice Connected/i,
        /^[^|]+\|.*voice/i,
    ],
    'Slack': [
        /Huddle/i,
        /Call with/i,
    ],
    'FaceTime': [
        /FaceTime/i,
    ],
    'Webex': [
        /Meeting/i,
        /Webinar/i,
    ],
    'Skype': [
        /Call with/i,
        /Meeting/i,
    ],
};

/**
 * Meeting Detector Service
 *
 * Singleton service that detects video meetings and emits events
 * when meetings start or end.
 */
export class MeetingDetector extends EventEmitter {
    private static instance: MeetingDetector | null = null;

    private currentStatus: MeetingStatus = {
        inMeeting: false,
        platform: null,
        windowTitle: null,
        bundleId: null,
        startedAt: null,
    };

    private constructor() {
        super();
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): MeetingDetector {
        if (!MeetingDetector.instance) {
            MeetingDetector.instance = new MeetingDetector();
        }
        return MeetingDetector.instance;
    }

    /**
     * Get current meeting status
     */
    public getMeetingStatus(): MeetingStatus {
        return { ...this.currentStatus };
    }

    /**
     * Check if currently in a meeting
     */
    public isInMeeting(): boolean {
        return this.currentStatus.inMeeting;
    }

    /**
     * Get current meeting platform
     */
    public getCurrentPlatform(): MeetingPlatform | null {
        return this.currentStatus.platform;
    }

    /**
     * Update meeting status based on active window info
     *
     * This should be called from the window polling loop.
     *
     * @param bundleId - Bundle identifier of the active app
     * @param windowTitle - Window title of the active window
     * @returns The updated meeting status
     */
    public updateFromActiveWindow(
        bundleId: string,
        windowTitle: string
    ): MeetingStatus {
        const detectedMeeting = this.detectMeeting(bundleId, windowTitle);

        if (detectedMeeting && !this.currentStatus.inMeeting) {
            // Meeting started
            this.currentStatus = {
                inMeeting: true,
                platform: detectedMeeting.platform,
                windowTitle,
                bundleId,
                startedAt: Date.now(),
            };

            const event: MeetingEvent = {
                type: 'meeting-started',
                platform: detectedMeeting.platform,
                windowTitle,
                timestamp: Date.now(),
                bundleId,
            };

            this.emit(MEETING_EVENTS.MEETING_STARTED, event);
            console.log('[MeetingDetector] Meeting started:', event);
        } else if (!detectedMeeting && this.currentStatus.inMeeting) {
            // Meeting ended
            const previousPlatform = this.currentStatus.platform!;
            const previousTitle = this.currentStatus.windowTitle || '';

            this.currentStatus = {
                inMeeting: false,
                platform: null,
                windowTitle: null,
                bundleId: null,
                startedAt: null,
            };

            const event: MeetingEvent = {
                type: 'meeting-ended',
                platform: previousPlatform,
                windowTitle: previousTitle,
                timestamp: Date.now(),
                bundleId,
            };

            this.emit(MEETING_EVENTS.MEETING_ENDED, event);
            console.log('[MeetingDetector] Meeting ended:', event);
        } else if (detectedMeeting && this.currentStatus.inMeeting) {
            // Update window title if still in meeting
            this.currentStatus.windowTitle = windowTitle;
            this.currentStatus.bundleId = bundleId;
        }

        return this.getMeetingStatus();
    }

    /**
     * Detect if the active window is a video meeting
     *
     * @param bundleId - Bundle identifier of the active app
     * @param windowTitle - Window title of the active window
     * @returns Platform info if meeting detected, null otherwise
     */
    private detectMeeting(
        bundleId: string,
        windowTitle: string
    ): { platform: MeetingPlatform } | null {
        // Check native video meeting apps
        const nativePlatform = VIDEO_MEETING_BUNDLE_IDS[bundleId];
        if (nativePlatform) {
            // For native apps, check if we're actually in a meeting
            // (not just viewing the app's main window)
            if (this.isActiveMeetingWindow(nativePlatform, windowTitle)) {
                return { platform: nativePlatform };
            }
            // Some apps like FaceTime are always in a "meeting" when open
            if (nativePlatform === 'FaceTime') {
                return { platform: nativePlatform };
            }
        }

        // Check for web-based meetings in browsers
        if (BROWSER_BUNDLE_IDS.includes(bundleId)) {
            for (const { pattern, platform } of BROWSER_MEETING_PATTERNS) {
                if (pattern.test(windowTitle)) {
                    return { platform };
                }
            }
        }

        return null;
    }

    /**
     * Check if the window title indicates an active meeting
     * (as opposed to just having the app open)
     */
    private isActiveMeetingWindow(
        platform: MeetingPlatform,
        windowTitle: string
    ): boolean {
        const patterns = ACTIVE_MEETING_PATTERNS[platform];

        // If no specific patterns defined, assume app being active means meeting
        if (!patterns || patterns.length === 0) {
            return true;
        }

        // Check if window title matches any active meeting pattern
        return patterns.some((pattern) => pattern.test(windowTitle));
    }

    /**
     * Reset meeting status (for cleanup/testing)
     */
    public reset(): void {
        if (this.currentStatus.inMeeting) {
            const event: MeetingEvent = {
                type: 'meeting-ended',
                platform: this.currentStatus.platform!,
                windowTitle: this.currentStatus.windowTitle || '',
                timestamp: Date.now(),
            };
            this.emit(MEETING_EVENTS.MEETING_ENDED, event);
        }

        this.currentStatus = {
            inMeeting: false,
            platform: null,
            windowTitle: null,
            bundleId: null,
            startedAt: null,
        };
    }

    /**
     * Get meeting duration in milliseconds (if in meeting)
     */
    public getMeetingDuration(): number {
        if (!this.currentStatus.inMeeting || !this.currentStatus.startedAt) {
            return 0;
        }
        return Date.now() - this.currentStatus.startedAt;
    }
}

// Export singleton getter for convenience
export function getMeetingDetector(): MeetingDetector {
    return MeetingDetector.getInstance();
}
