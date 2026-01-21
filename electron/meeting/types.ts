/**
 * Video Meeting Audio Recording Types
 *
 * Type definitions for meeting detection, audio recording, and transcription services.
 */

/**
 * Video meeting platforms that can be detected
 */
export type MeetingPlatform =
    | 'Zoom'
    | 'Microsoft Teams'
    | 'Google Meet'
    | 'Discord'
    | 'Slack'
    | 'FaceTime'
    | 'Webex'
    | 'Skype'
    | 'Zoom Web'
    | 'Teams Web'
    | 'System Audio';  // Hardware-triggered recordings (mic/camera detection)

/**
 * Current meeting status
 */
export interface MeetingStatus {
    inMeeting: boolean;
    platform: MeetingPlatform | null;
    windowTitle: string | null;
    bundleId: string | null;
    startedAt: number | null;
}

/**
 * Meeting detection event data
 */
export interface MeetingEvent {
    type: 'meeting-started' | 'meeting-ended';
    platform: MeetingPlatform;
    windowTitle: string;
    timestamp: number;
    bundleId?: string;
}

/**
 * Audio recording configuration
 */
export interface AudioRecordingConfig {
    /** Include system audio (requires Screen Recording permission) */
    captureSystemAudio: boolean;
    /** Include microphone audio */
    captureMicrophone: boolean;
    /** Sample rate in Hz (default: 48000) */
    sampleRate: number;
    /** Number of channels (1 for mono, 2 for stereo) */
    channels: 1 | 2;
    /** Audio bitrate in kbps */
    bitrate: number;
}

/**
 * Default audio recording configuration
 */
export const DEFAULT_AUDIO_CONFIG: AudioRecordingConfig = {
    captureSystemAudio: true,
    captureMicrophone: true,
    sampleRate: 48000,
    channels: 1,
    bitrate: 128,
};

/**
 * Recording status information
 */
export interface RecordingStatus {
    isRecording: boolean;
    recordingId: string | null;
    entryId: string | null;
    platform: MeetingPlatform | null;
    startedAt: number | null;
    duration: number;
    filePath: string | null;
    fileSize: number;
}

/**
 * Audio recording result
 */
export interface RecordingResult {
    success: boolean;
    recordingId: string;
    filePath: string;
    duration: number;
    fileSize: number;
    startTime: number;
    endTime: number;
    platform: MeetingPlatform;
    error?: string;
}

/**
 * Transcription segment from Whisper API
 */
export interface TranscriptionSegment {
    id: number;
    start: number;
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
}

/**
 * Full transcription result
 */
export interface TranscriptionResult {
    success: boolean;
    transcriptionId: string;
    segments: TranscriptionSegment[];
    fullText: string;
    language: string;
    duration: number;
    wordCount: number;
    error?: string;
}

/**
 * Meeting transcription data for storage
 */
export interface MeetingTranscription {
    id: string;
    entryId: string;
    platform: MeetingPlatform;
    meetingTitle: string | null;
    startTime: number;
    endTime: number;
    duration: number;
    transcription: TranscriptionResult;
    summary?: string;
    keyTopics?: string[];
    actionItems?: string[];
    createdAt: number;
}

/**
 * Meeting recording settings (user preferences)
 */
export interface MeetingRecordingSettings {
    /** Master toggle for meeting recording */
    enabled: boolean;
    /** Minimum meeting duration before recording starts (seconds) */
    minimumDuration: number;
    /** Apps to exclude from recording */
    excludedApps: string[];
    /** Whether to auto-start recording when meeting detected */
    autoRecord: boolean;
    /** Whether to show recording indicator */
    showIndicator: boolean;
    /** Maximum recording duration (seconds) */
    maxDuration: number;
}

/**
 * Default meeting recording settings
 */
export const DEFAULT_MEETING_SETTINGS: MeetingRecordingSettings = {
    enabled: false,
    minimumDuration: 30,
    excludedApps: [],
    autoRecord: true,
    showIndicator: true,
    maxDuration: 7200, // 2 hours
};

/**
 * IPC channel names for meeting-related communication
 */
export const MEETING_IPC_CHANNELS = {
    GET_STATUS: 'meeting:get-status',
    START_RECORDING: 'meeting:start-recording',
    STOP_RECORDING: 'meeting:stop-recording',
    GET_RECORDING_STATUS: 'meeting:get-recording-status',
    CHECK_MICROPHONE_PERMISSION: 'meeting:check-microphone-permission',
    REQUEST_MICROPHONE_PERMISSION: 'meeting:request-microphone-permission',
    GET_TRANSCRIPTION: 'meeting:get-transcription',
    GET_TRANSCRIPTIONS_FOR_ENTRY: 'meeting:get-transcriptions-for-entry',
    SET_ACTIVE_ENTRY: 'meeting:set-active-entry',
    GET_MEDIA_STATUS: 'meeting:get-media-status',
    SET_AUTO_RECORD_ENABLED: 'meeting:set-auto-record-enabled',
    // Audio capture and transcription
    SAVE_AUDIO_AND_TRANSCRIBE: 'meeting:save-audio-and-transcribe',
    GET_TRANSCRIPTION_USAGE: 'meeting:get-transcription-usage',
    // Events from main to renderer (push notifications)
    EVENT_RECORDING_SHOULD_START: 'meeting:event-recording-should-start',
    EVENT_RECORDING_SHOULD_STOP: 'meeting:event-recording-should-stop',
} as const;

/**
 * Events emitted by meeting services
 */
export const MEETING_EVENTS = {
    MEETING_STARTED: 'meeting-started',
    MEETING_ENDED: 'meeting-ended',
    RECORDING_STARTED: 'recording-started',
    RECORDING_STOPPED: 'recording-stopped',
    TRANSCRIPTION_COMPLETE: 'transcription-complete',
    TRANSCRIPTION_ERROR: 'transcription-error',
    MEDIA_STARTED: 'media-started',
    MEDIA_STOPPED: 'media-stopped',
} as const;

/**
 * Media status returned by the native monitor
 */
export interface MediaStatus {
    micInUse: boolean;
    cameraInUse: boolean;
    isRecording: boolean;
}
