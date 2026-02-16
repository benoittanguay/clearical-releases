# Apple Review Reply — v1.7.40 Permission Justifications

**Date:** February 14, 2026
**Version:** 1.7.40
**Guidelines:** 2.1 (Accessibility, Screen Recording, Microphone)

---

Dear App Review Team,

Thank you for taking the time to review Clearical. I appreciate the feedback and am happy to explain how each permission is used.

Clearical is a time-tracking app that automatically describes what the user is working on, so they don't have to type every entry manually. Each permission serves this single purpose.

**Accessibility (reading window titles)**

When the timer is running, Clearical reads the frontmost application's name, bundle identifier, and window title via AppleScript (`tell application "System Events"` → `title of front window` / `AXTitle` attribute). This produces time entry descriptions like "Working in Excel — Budget Q3.xlsx". No keystrokes are injected, no UI automation is performed, and no content inside windows is read — only the title bar text. All data stays in a local SQLite database on-device. Users can blacklist specific apps from tracking. Without this permission, users would need to type every description manually, which is the app's core value proposition.

**Screen Recording (window screenshots)**

Clearical periodically captures a screenshot of the single active window (not the full screen) using `CGWindowListCreateImage()` targeted by window ID. Screenshots are stored locally in the app's sandboxed data directory, encrypted at rest. Optionally, premium users can send screenshots to Google Gemini API for AI-generated activity descriptions (e.g., "Editing a login form component in VS Code"). Images are processed transiently and not retained server-side. Clearical does not record video, does not stream screen content, and does not capture when the timer is stopped or for blacklisted apps.

**Microphone (meeting transcription)**

When the user is in a video call (Zoom, Teams, Google Meet, etc.), Clearical can optionally record audio via the native `AVAudioEngine` microphone input to generate a meeting transcription. Audio is transcribed on-device using Apple's `SFSpeechRecognizer` framework, and the resulting text is attached to the time entry as meeting notes. Audio files are stored locally in the app's sandboxed directory. This feature is opt-in — the user must explicitly enable auto-recording in settings. No audio is streamed or stored externally.

All captured data — window titles, screenshots, and audio — is stored locally, encrypted at rest, and under the user's full control. We hope this clarifies how each permission directly supports the time-tracking experience. Please don't hesitate to reach out if you have any further questions — we're happy to provide additional detail.

Best regards,
Benoit Tanguay
Clearical Developer
