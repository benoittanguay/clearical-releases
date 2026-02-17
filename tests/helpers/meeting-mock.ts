import { ElectronApplication } from 'playwright';

/**
 * Options for configuring mock meeting API responses
 */
export interface MeetingMockOptions {
  /** Override the transcription result returned by save-audio-and-transcribe and retry-transcription */
  transcriptionResult?: object;
}

/**
 * Mock all meeting-related IPC handlers in a single evaluate call.
 * Follows the mockAuthentication() pattern from tests/helpers/electron.ts.
 *
 * This enables testing recording UI state without real audio hardware.
 * The renderer's calls to meeting.* IPC channels will succeed with controlled responses.
 */
export async function mockMeetingAPI(
  app: ElectronApplication,
  options: MeetingMockOptions = {}
): Promise<void> {
  const transcriptionResult = options.transcriptionResult ?? {
    success: true,
    transcription: {
      text: 'Mock transcription text for testing.',
      segments: [{ start: 0, end: 5, text: 'Mock transcription text for testing.' }],
      language: 'en',
      duration: 5,
    },
  };

  await app.evaluate(
    ({ ipcMain }, { transcriptionResult }) => {
      // Remove existing handlers to avoid "Already registered" errors
      const channels = [
        'meeting:set-active-entry',
        'meeting:get-media-status',
        'meeting:get-recording-status',
        'meeting:set-auto-record-enabled',
        'meeting:is-mic-capture-available',
        'meeting:start-mic-capture',
        'meeting:stop-mic-capture',
        'meeting:is-system-audio-available',
        'meeting:start-system-audio-capture',
        'meeting:stop-system-audio-capture',
        'meeting:start-file-recording',
        'meeting:stop-file-recording',
        'meeting:merge-audio-files',
        'meeting:save-audio-and-transcribe',
        'meeting:retry-transcription',
        'meeting:get-transcription-usage',
        'meeting:save-pending-transcription',
        'meeting:load-pending-transcriptions',
        'meeting:remove-pending-transcription',
        'get-temp-path',
        // Permission checks — mock as granted so permission modal doesn't block UI
        'check-screen-permission',
        'check-accessibility-permission',
      ];

      for (const channel of channels) {
        ipcMain.removeHandler(channel);
      }

      // Register mock handlers
      ipcMain.handle('meeting:set-active-entry', () => ({ success: true }));
      ipcMain.handle('meeting:get-media-status', () => ({
        micInUse: false,
        cameraInUse: false,
        isRecording: false,
        meetingApp: null,
      }));
      ipcMain.handle('meeting:get-recording-status', () => ({ isRecording: false }));
      ipcMain.handle('meeting:set-auto-record-enabled', () => undefined);
      ipcMain.handle('meeting:is-mic-capture-available', () => true);
      ipcMain.handle('meeting:start-mic-capture', () => ({ success: true }));
      ipcMain.handle('meeting:stop-mic-capture', () => ({ success: true }));
      ipcMain.handle('meeting:is-system-audio-available', () => true);
      ipcMain.handle('meeting:start-system-audio-capture', () => ({ success: true }));
      ipcMain.handle('meeting:stop-system-audio-capture', () => ({ success: true }));
      ipcMain.handle('meeting:start-file-recording', () => ({ success: true }));
      ipcMain.handle('meeting:stop-file-recording', () => ({
        success: true,
        mic: { filePath: '/tmp/test-mic.wav' },
        system: { filePath: '/tmp/test-system.wav' },
      }));
      ipcMain.handle('meeting:merge-audio-files', () => ({
        success: true,
        outputPath: '/tmp/test-merged.webm',
      }));
      ipcMain.handle('meeting:save-audio-and-transcribe', () => transcriptionResult);
      ipcMain.handle('meeting:retry-transcription', () => transcriptionResult);
      ipcMain.handle('meeting:get-transcription-usage', () => ({ used: 0, limit: 100 }));
      ipcMain.handle('meeting:save-pending-transcription', () => ({ success: true }));
      ipcMain.handle('meeting:load-pending-transcriptions', () => ({
        success: true,
        transcriptions: {},
      }));
      ipcMain.handle('meeting:remove-pending-transcription', () => ({ success: true }));
      ipcMain.handle('get-temp-path', () => '/tmp');

      // Permission checks — return granted so timer start doesn't show permission modal
      ipcMain.handle('check-screen-permission', () => 'granted');
      ipcMain.handle('check-accessibility-permission', () => 'granted');
    },
    { transcriptionResult }
  );
}
