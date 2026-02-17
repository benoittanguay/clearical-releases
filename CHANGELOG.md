# Changelog

All notable changes to Clearical will be documented in this file.

## [1.7.44] - 2026-02-16

### Tests
- **Audio Recording**: Added 13 E2E tests covering recording controls UI, main process event sync, race condition regressions, and transcription flow

---

## [1.7.43] - 2026-02-16

### Bug Fixes
- **Auto-Update**: Fixed "Install & Restart" doing nothing — before-quit handler was blocking electron-updater's quit flow, preventing the update from being applied

---

## [1.7.41] - 2026-02-15

### Features
- **Audio Recording**: Persist pending transcriptions to disk — recordings now survive app crashes and reloads
- **Audio Recording**: Event-driven transcription attachment replaces timeout — no more data loss on long recordings
- **Audio Recording**: Parallel chunk transcription (batches of 3) — ~3x faster for long meetings
- **Audio Recording**: Audio compression before upload (WAV→Opus 32kbps) — ~95% smaller uploads
- **Audio Recording**: Automatic token refresh on 401 — fixes transcription failures on 2+ hour recordings
- **Audio Recording**: Bundled ffmpeg with the app — no manual installation required
- **Reports**: Jira issue and epic assignments now included in report breakdowns

### Bug Fixes
- **Installer**: Disabled autoInstallOnAppQuit to prevent macOS password prompt
- **TypeScript**: Resolved spread error in useTimer consolidation
- **TypeScript**: Resolved narrowing errors in main.ts

### Improvements
- **UI**: Aligned BucketDetail and JiraDetail views with Worklog page patterns (Export button, headers)

---

## [1.7.37] - 2026-02-06

### Bug Fixes
- **Subscription**: Fixed premium features (Tempo, Jira, AI) remaining accessible after trial period ends
- **Subscription**: Backend API guards now correctly block expired trial requests
- **Settings**: Account section now correctly shows "Free Plan" with Upgrade button when trial expires
- **Security**: Added premium guards to 5 AI handlers that were previously unprotected

---

## [1.7.36] - 2026-02-06

### Bug Fixes
- **Update Modal**: Fixed release notes not appearing in "What's New" modal after update (regex was matching sub-headings as stop points)
- **Worklog List**: Fixed gap between sticky day headers and week headers

### Improvements
- **Browser Profiles**: Different browser profiles (e.g., Chrome "Work" vs "Personal") now appear as separate activity groups in time entry detail
- **Worklog Calendar**: Days with logged hours use a subtle background tint to better distinguish them

---

## [1.7.35] - 2026-02-06

### Bug Fixes
- **Sign In with Apple**: Fixed EPERM errors showing native crash dialog when OAuth callback server can't bind port
- **OAuth Server**: Added retry logic (3 attempts) for transient port conflicts during sign-in
- **OAuth Server**: Moved error handler before listen() to prevent uncaught exceptions
- **OAuth Server**: User-friendly error messages for firewall/permission and port-busy errors
- **Security**: Fixed XSS vulnerability in OAuth callback error page (HTML-escaped error descriptions)
- **Security**: Added settled guard to prevent promise double-resolution race condition
- **OAuth Cleanup**: Server now properly closed in all error paths (prevents port leak on token exchange failure)

### Improvements
- **DMG Installer**: DMG now includes Applications shortcut and drag-arrow background for proper install UX
- **Update Notification**: Restyled to match app's light cream aesthetic with design system tokens
- **Toast Notifications**: Restyled from dark theme to light cream theme with proper accent colors

---

## [1.7.34] - 2026-02-02

### Features
- **Screenshot Settings**: Added configurable screenshot cooldown per app/site (default 2 minutes)
- **Browser Profiles**: Different browser profiles (e.g., Chrome "Work" vs "Personal") are now tracked separately for screenshot cooldowns
- **Arc Browser**: Added support for Arc browser in activity tracking

### Bug Fixes
- **Worklog List**: Fixed spacing issue where "Today" header had extra gap from week header
- **Worklog Calendar**: Added padding above calendar to prevent it from sitting against the header

---

## [1.7.32] - 2025-02-01

### Bug Fixes
- **Audio Diagnostics**: Added debug logging to native module to diagnose why sample rate detection isn't working

---

## [1.7.31] - 2025-02-01

### Improvements
- **Audio Diagnostics**: Enhanced logging to show detected sample rate, rate detection status, and resampling state in renderer console for debugging audio quality issues

---

## [1.7.30] - 2025-01-31

### Bug Fixes
- **Audio Recording Quality**: Fixed chipmunk audio effect caused by macOS reporting incorrect sample rates
  - Added timing-based sample rate detection that measures actual callback rate
  - Automatically resamples when detected rate differs from reported rate
  - Fixes issue where macOS claims 48kHz but actually delivers audio at ~44.1kHz

---

## [1.7.29] - 2025-01-31

### Bug Fixes
- **Audio Diagnostics**: Added sample rate logging to help diagnose recording quality issues

---

## [1.7.28] - 2025-01-31

### Bug Fixes
- **Audio Recording Quality**: Ensured native audio module with resampling fixes is properly included in release build
- **Recording Widget**: Fixed issue where Chrono tab continued showing recording animation after stopping via widget

---

## [1.7.27] - 2025-01-31

### Bug Fixes
- **Build**: Fixed critical issue where the app was built with the demo page instead of the actual application

---

## [1.7.26] - 2025-01-31

### Bug Fixes
- **Audio Recording Quality**: Fixed severely distorted audio recordings (chipmunk effect and grainy noise)
  - Added proper audio format detection and conversion for non-float sample formats
  - Added sample rate resampling when source audio differs from 48kHz target
  - Both microphone and system audio capture now properly normalize to consistent format
- **Recording Transcription**: Fixed issue where transcription wasn't saved when stopping recording via widget before stopping timer

---

## [1.7.25] - 2025-01-31

### New Features
- **Worklog Calendar View**: Added a new calendar view to visualize time entries in a monthly grid format
  - Toggle between List and Calendar views in the Worklog section
  - Days with logged time are highlighted with accent color
  - Click any day to see detailed entries in a modal
  - View Jira issue summaries directly in the entry list
  - "Log to Tempo" button in day modal for daily bulk logging
  - "Log Month to Tempo" button to log all entries for the entire month
  - Total hours displayed for the current month

---

## [1.7.24] - 2025-01-31

### Bug Fixes
- **Recording Widget**: Fixed issue where clicking "Yes, Start" on meeting detection prompt would start recording but not show the recording widget

---

## [1.7.23] - 2025-01-31

### Bug Fixes
- **Recording Start**: Fixed "Unable to Start Recording" error caused by AudioWorklet failing to load in production builds
- **Performance**: Fixed issue where IPC event listeners were being re-registered hundreds of times per second, causing UI lag

---

## [1.7.22] - 2025-01-31

### Improvements
- **Smarter Assignment Suggestions**: AI now prioritizes matching based on activity content rather than historical patterns, leading to more accurate and varied bucket/issue suggestions
- **Reduced Historical Bias**: Rebalanced scoring weights to favor semantic relevance (keywords, technologies, project context) over past manual selections

---

## [1.7.21] - 2025-01-31

### Bug Fixes
- **Recording Reliability**: Fixed multiple race conditions that could cause recording to fail to start or create duplicate transcriptions
- **Meeting Prompt**: Fixed race condition where clicking "Yes, Start" on meeting detection prompt could fail to start recording properly
- **Widget Stability**: Fixed issue where recording widget could disappear immediately after accepting meeting prompt
- **Silence Detection**: Increased silence threshold from 10 to 20 seconds to reduce false "Is the meeting over?" prompts during presentation pauses
- **Recording State**: Fixed UI showing recording active when main process failed to start capture

### Improvements
- **Error Feedback**: Recording failures now show a user-friendly dialog explaining the issue
- **Memory Management**: Added automatic cleanup of orphaned transcription data after 5 minutes
- **Widget Performance**: Consolidated IPC listeners for more reliable widget behavior

---

## [1.7.20] - 2025-01-31

### Bug Fixes
- **Crash Prevention**: Fixed potential crash during long recording sessions (4+ hours) by switching native audio callbacks from BlockingCall to NonBlockingCall, preventing thread contention and memory pressure
- **Widget Animation**: Fixed issue where the recording widget would linger after exit animation, blocking mouse clicks in that screen area. Widget now properly closes after animation completes

---

## [1.7.18] - 2025-01-29

### Bug Fixes
- **Manual Recording Button**: Fixed issue where clicking the record button in the Chrono tab would show the recording UI but not actually start audio capture. Recording now starts immediately when manually triggered, regardless of mic/camera detection status.

---

## [1.7.17] - 2025-01-29

### Bug Fixes
- **Meeting Detection Prompt**: Fixed issue where clicking "Yes, Start" did nothing when the timer was already running - now correctly starts audio recording
- **IPC Message Order**: Fixed race condition where meeting prompt response wasn't reaching the main window

### Improvements
- **Release Script**: Improved DMG signing and notarization workflow to properly sign, notarize, and staple DMG separately from app bundle

---

## [1.7.16] - 2025-01-29

### Bug Fixes
- **Working Hours Prompt**: Fixed edge case where "Ready to start your day?" prompt would appear even when timer was already running
- **Widget Animation**: Fixed issue where prompt widgets showed recording elements during exit animation instead of keeping the current prompt UI visible throughout
- **Audio Cleanup**: Improved microphone release when stopping recording to help Bluetooth headsets switch back to high-quality codec faster

### Improvements
- **Standardized Widget Buttons**: All widget buttons now have consistent sizing and typography
- **Working Hours Prompt Layout**: Improved text spacing and layout for better readability

---

## [1.7.15] - 2025-01-28

### New Features
- **Working Hours Reminder**: Get a gentle daily prompt at your configured start time asking "Ready to start your day?" with options to start tracking, snooze, or take the day off
- Configure your working hours and days in Settings or during onboarding
- Time-aware greetings that change based on morning, afternoon, or evening

### Bug Fixes
- Fixed recording widget waveform animation speed issue where it appeared to suddenly accelerate after appearing

### Improvements
- Smoother waveform animation with reduced scroll speed for a calmer visual experience

---

## [1.7.8] - 2025-01-26

### Improvements
- Enhanced AI summary generation with smarter context sampling for better accuracy
- Splitting Assistant now auto-prompts for long sessions (45+ minutes) to help organize your work
- Recording controls now display directly below the timer digits for a cleaner layout

---

## [1.7.4] - 2025-01-23

### New Features
- Improved meeting detection with support for more video conferencing apps

### Bug Fixes
- Fixed bulk Tempo logging issues

---

## Template for future releases

When preparing a new release, add a new section at the top following this format:

```
## [X.Y.Z] - YYYY-MM-DD

### New Features
- Description of new feature

### Bug Fixes
- Description of bug fix

### Improvements
- Description of improvement (optional section)
```

Keep descriptions concise and customer-friendly. Avoid technical implementation details.
