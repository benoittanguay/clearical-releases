import { ElectronApplication } from 'playwright';

/**
 * Simulate a recording start event from the main process.
 * Mirrors what RecordingManager.sendToRenderer() does when media detection
 * triggers a recording start.
 *
 * Sends 'meeting:event-recording-should-start' to the renderer via
 * BrowserWindow.getAllWindows()[0].webContents.send().
 */
export async function simulateRecordingStart(
  app: ElectronApplication,
  entryId: string
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { entryId, timestamp }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('meeting:event-recording-should-start', {
          entryId,
          timestamp,
        });
      }
    },
    { entryId, timestamp: Date.now() }
  );
}

/**
 * Simulate a recording stop event from the main process.
 * Mirrors what RecordingManager.sendToRenderer() does when media detection
 * triggers a recording stop.
 *
 * Sends 'meeting:event-recording-should-stop' to the renderer via
 * BrowserWindow.getAllWindows()[0].webContents.send().
 */
export async function simulateRecordingStop(
  app: ElectronApplication,
  entryId: string,
  duration: number = 5000
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { entryId, duration }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].webContents.send('meeting:event-recording-should-stop', {
          entryId,
          duration,
        });
      }
    },
    { entryId, duration }
  );
}
