# Changelog

All notable changes to Clearical will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3] - 2026-01-11

### Improved
- **FastVLM Screenshot Analysis**: Context-aware prompts for better narrative descriptions
- Prompt now includes app name and window title for more relevant analysis
- Descriptions focus on user intent and specific tasks rather than generic app usage
- Output style: "Debugging FastVLM inference code" instead of "User is using VS Code"

### Technical
- Updated inference.py with new structured prompt template
- Extended API to accept app_name and window_title parameters
- Main process parses screenshot filename to extract app context

---

## [0.3.2] - 2026-01-11

### Added
- **Permission Request Modal**: New user-friendly modal when starting Chrono without required permissions
- Pre-flight permission check before starting timer
- Real-time permission status indicators with auto-refresh
- Direct buttons to open System Preferences to correct pane
- **Stale Permission Detection**: App now detects when macOS permissions are granted but don't actually work
- User-friendly "Permission Needs Reset" warning with step-by-step fix instructions
- Orange "NEEDS RESET" status badge in Settings when stale permission detected

### Fixed
- **Chrono Stop Navigation**: Fixed issue where stopping Chrono didn't navigate to Activity details
- Added loading overlay during activity finalization
- Fixed state race condition in addEntry using functional updates
- **FastVLM Analysis**: Fixed AI screenshot analysis not producing proper descriptions
- Corrected mlx_vlm parameter order (prompt before image)
- Added trust_remote_code=True for nanoLLaVA model loading
- Added chat template formatting for better results
- **UI Gap at Top**: Removed space between content and window top
- Changed title bar from 32px to 0px height
- Made page headers draggable for window movement
- **macOS Permission Recognition**: Fixed permissions becoming "stale" after app updates

### Technical
- Added `testScreenRecordingWorks()` function to verify permissions actually work
- New PermissionRequestModal component with auto-close on permission grant
- Enhanced permission checking in useTimer hook
- Rebuilt FastVLM server with fixed inference code

---

## [0.3.1] - 2026-01-11

### Changed
- **On-Demand FastVLM Server**: AI server now starts only when screenshots need analysis
- Server automatically shuts down after 60 seconds of inactivity to save resources
- First analysis after idle period takes ~30-60s (model loading), subsequent analyses are fast

### Technical
- Added `ensureRunning()` method for on-demand server startup
- Added idle timer with 60s timeout for auto-shutdown
- Removed auto-start at app launch
- Health monitoring only restarts on crashes, not intentional shutdowns

---

## [0.3.0] - 2026-01-11

### Added
- **Bundled FastVLM AI Analysis**: On-device vision-language model for screenshot analysis
- nanoLLaVA model (~1GB) bundled directly in the app - no setup required
- PyInstaller-based standalone server with all dependencies included
- **Loading State UI**: Visual indicator when screenshots are being analyzed
- Real-time "Analyzing..." badge in screenshot gallery
- Global analysis count shown in history detail view
- Animated progress indicators with shimmer effect

### Changed
- FastVLM server is now a bundled executable (no Python installation needed)
- Increased server startup timeout to 60s for model loading
- App size increased to ~700MB-1GB due to bundled AI model

### Technical
- PyInstaller build system for creating standalone FastVLM server
- Model download script for first-time build setup
- ScreenshotAnalysisContext for tracking analysis progress across the app
- IPC events for screenshot-analysis-start/complete/error

---

## [0.2.17] - 2026-01-11

### Added
- **FastVLM Screenshot Analysis**: New AI-powered screenshot analysis using on-device vision-language model
- Python-based FastVLM server running nanoLLaVA model via MLX framework
- FastAPI backend for screenshot analysis on localhost:5123
- Automatic fallback to Swift Vision Framework if FastVLM server is unavailable

### Technical
- FastVLM server auto-starts with the app
- Model cached in memory for fast inference
- Health monitoring with automatic restart on failure
- Graceful shutdown on app exit

---

## [0.2.16] - 2026-01-10

### Added
- **Release Script**: New `scripts/release.sh` for proper macOS builds with ad-hoc signing

### Changed
- **App Blacklist**: Removed bundle ID labels under app names for cleaner UI
- **Crawler Progress**: Now spans full app width, removed dismiss button
- **Page Layout**: Removed top padding/gaps above all pages
- **Buckets Page**: Removed "Tempo Connected" status label from header

---

## [0.2.15] - 2026-01-10

### Fixed
- **AI Screenshot Analysis**: Fixed analysis failing on encrypted screenshots
- Screenshots are now decrypted to temp file before passing to Vision Framework analyzer

### Improved
- **AI Descriptions**: Enhanced two-stage interpretation of screenshots
- Stage 1: Vision Framework extracts text, headings, labels, values, files, identifiers
- Stage 2: Swift interprets extracted data into detailed contextual descriptions
- Descriptions now include: headings being viewed, text content visible, UI elements, data/metrics, files referenced, issue IDs
- Activity statements always include window title for meaningful context

---

## [0.2.14] - 2026-01-10

### Fixed
- **AI Screenshot Analysis**: Initial fix attempt (superseded by 0.2.15)

---

## [0.2.13] - 2026-01-10

### Fixed
- **macOS Gatekeeper**: Added ad-hoc signing and installation instructions

---

## [0.2.12] - 2026-01-10

### Fixed
- **macOS Gatekeeper**: Attempted fix by disabling `hardenedRuntime` (insufficient)

---

## [0.2.11] - 2026-01-10

### Fixed
- **AI Screenshot Analysis**: Fixed filename parsing for multi-word app names (e.g., "Google Chrome")
- Changed delimiter from `_` to `|||` to preserve spaces in app names and window titles
- Backward compatible with existing screenshots

### Changed
- **Auto-updater**: Replaced complex download/install with simple "Download Update" button
- Button opens direct DMG download URL in browser: `https://github.com/benoittanguay/clearical-releases/releases/latest/download/Clearical-arm64.dmg`
- Added "Download Latest" button in Settings alongside "Check for Updates"
- Removed auto-install functionality (requires code signing)

---

## [0.2.10] - 2026-01-10

### Fixed
- **Integration Credentials**: Fixed credentials being wiped on updates - loading from secure storage was disabled, now enabled
- **Jira Data Persistence**: Fixed issues disappearing on restart - increased cache TTL from 5 minutes to 24 hours
- **Jira Data Persistence**: Added stale-while-revalidate pattern - cached data shows instantly while fresh data loads in background

### Improved
- **Startup Performance**: Jira issues now display immediately from cache instead of waiting for API
- **Offline Support**: App can display cached Jira data even when offline

---

## [0.2.9] - 2026-01-10

### Fixed
- **App Blacklist**: Fixed app icons not displaying - added loading states, error handling, and fallback icons
- **App Blacklist**: Enhanced icon discovery logging for debugging
- **Build artifacts**: DMG and ZIP files no longer include version number in filename

---

## [0.2.8] - 2026-01-10

### Fixed
- **AI screenshot analysis**: Added robust filename-based fallback when Swift analyzer returns empty description
- Description now always shows meaningful text like "Viewing Claude in Claude." instead of generic "Screenshot captured"
- Fallback works even if Vision Framework fails completely

### Added
- **Jira integration**: Now includes Epics alongside regular issues
- **Jira UI**: Epics are visually distinguished with purple styling
- **Jira fields**: Added Epic-specific custom fields (Epic Name, Epic Link, Epic Color)

---

## [0.2.7] - 2026-01-10

### Fixed
- **Auto-updater**: Fixed "Restart & Install" button error handling for unsigned builds
- **Auto-updater**: Added code signing error detection with user-friendly message
- **Auto-updater**: Added "Download Manually" button linking to releases page when auto-install fails

### Note
- Auto-update download works, but installation requires code signing (Apple Developer certificate)
- Until the app is signed, users will see a link to manually download updates from GitHub releases

---

## [0.2.6] - 2026-01-10

### Added
- **Settings**: Version number display showing current app version
- **Settings**: "Check for Updates" button for manual update checks
- **Auto-updater**: Update status indicator in Settings when updates are available

### Fixed
- **Integration Config**: Fixed Jira background sync interfering with Tempo checkbox selection
- **Window positioning**: Window now always appears below tray icon from start (no more flash in lower-left corner)
- **Window positioning**: Added retry logic for reliable positioning on slower systems

---

## [0.2.5] - 2026-01-10

### Fixed
- **AI screenshot analysis**: Fixed empty narrative bug - now always generates meaningful description using app name and window title when Vision Framework returns minimal text
- Screenshots of graphical apps (like Finder) now show proper descriptions like "Viewing Applications in Finder."

---

## [0.2.4] - 2026-01-10

### Changed
- **Auto-updater**: Moved releases to dedicated public repo (`clearical-releases`) for proper update detection
- Source code remains private in `timeportal` repo

---

## [0.2.3] - 2026-01-10

### Fixed
- **Activity recording**: Fixed timing bug where `setInterval` didn't call pollWindow immediately, causing 1-second delay before any activity detection
- Window polling now starts immediately when recording begins, not after the first interval
- Added better error logging for IPC bridge issues

---

## [0.2.2] - 2026-01-10

### Fixed
- **Activity recording**: Fixed wrong API path for blacklist check that broke all activity/screenshot capture
- Added error handling to prevent silent failures in recording loop

---

## [0.2.1] - 2026-01-10

### Fixed
- **Auto-updater**: Fixed GitHub repo name in publish config (`Clearical` → `timeportal`)
- **Activity recording**: Fixed conditional check that prevented recording from capturing data
- **Jira/Tempo config button**: Fixed duplicate modal conflict - button now works correctly

---

## [0.2.0] - 2026-01-10

### Added
- **Auto-updater test modal**: Shows "Auto-Updater Worked!" message after successful update
- Modal displays current version and only shows once per version update

---

## [0.1.7] - 2026-01-10

### Fixed
- **Fixed corrupted display**: Keep `dist/**/*` unpacked from asar (packing caused unresolvable loading issues)
- Added node_modules exclusions to offset size: test dirs, docs, examples, markdown files

---

## [0.1.6] - 2026-01-10

### Fixed
- **Fixed corrupted display**: Use `loadFile()` instead of `loadURL()` for asar support
- Root cause: `file://` protocol doesn't support asar; `loadFile()` has native asar handling

---

## [0.1.5] - 2026-01-10

### Fixed
- **Fixed corrupted display**: Use `app.getAppPath()` for absolute path resolution in packaged app
- Root cause: relative path `dist` was resolving against CWD instead of asar archive

---

## [0.1.4] - 2026-01-10

### Fixed
- Fixed corrupted text display caused by asar packing
- Use `pathToFileURL` for proper loading of frontend assets from asar archive

---

## [0.1.3] - 2026-01-10

### Fixed
- **Reduced build size by ~80%**: Removed duplicate Electron bundles from asarUnpack
- Unpacked resources reduced from 800MB to 13MB

---

## [0.1.2] - 2026-01-10

### Fixed
- Window now automatically appears below tray icon on app launch
- Users no longer see a blank screen - the app is immediately visible and usable
- Proper menu bar app behavior: window positioned below tray, hides on blur

---

## [0.1.1] - 2026-01-10

### Fixed
- Testing Mode banner no longer appears in production builds
- Integration modal no longer auto-opens on first launch
- Clean first-run experience: only onboarding modal appears for new users
- **14-day trial now works correctly**: All new users automatically get full access to all features for 14 days

---

## [0.1.0-beta.1] - 2026-01-10

### Added
- **Core Time Tracking**
  - Activity recording with automatic window detection
  - Screenshot capture during activities
  - AI-powered activity descriptions and summaries
  - Manual time entry support

- **Time Buckets**
  - Create custom buckets to categorize work
  - Folder organization for buckets
  - Rename and manage buckets

- **Jira Integration**
  - Link activities to Jira issues
  - Project-based issue filtering
  - Issue caching for offline access

- **Tempo Integration**
  - Log time entries to Tempo
  - AI-assisted Tempo account selection
  - Validation before submission

- **App Blacklist**
  - Exclude specific applications from recording
  - Category-based app grouping (Productivity, Music, etc.)
  - Scan installed macOS applications

- **Inline Time Editing**
  - Click to edit elapsed time directly in Activity Details
  - Support for multiple time formats (1:30, 90m, 1h 30m)
  - Time rounding to configurable increments (default 15 min)

- **Settings**
  - Time rounding increment configuration (5, 10, 15, 30, 60 min)
  - App exclusion management
  - Integration configuration (Jira, Tempo)

- **Onboarding**
  - Permissions setup (Accessibility, Screen Recording)
  - Guided first-run experience

- **Auto-Update**
  - GitHub releases integration
  - Background update checking
  - User-friendly update notifications (graceful 404 handling)

- **Security**
  - Encrypted credential storage
  - Secure API key management

- **Trial System**
  - 14-day trial for Freelancer tier
  - Trial status banner
  - Subscription management via Stripe

### Technical
- Electron 33.4.11
- React 19
- SQLite database (better-sqlite3)
- Supabase authentication
- Native macOS screenshot analyzer

---

## Version History

| Version       | Date       | Type    | Notes |
|---------------|------------|---------|-------|
| 0.3.3         | 2026-01-11 | Patch   | Context-aware FastVLM prompts for narrative descriptions |
| 0.3.2         | 2026-01-11 | Patch   | Permission UX, Chrono navigation, FastVLM fixes, UI gap removed |
| 0.3.1         | 2026-01-11 | Patch   | On-demand FastVLM server with auto-shutdown |
| 0.3.0         | 2026-01-11 | Minor   | Bundled FastVLM AI with loading UI - no setup required |
| 0.2.17        | 2026-01-11 | Release | FastVLM on-device screenshot analysis with MLX |
| 0.2.16        | 2026-01-10 | Release | UI improvements: cleaner blacklist, full-width crawler, removed gaps |
| 0.2.15        | 2026-01-10 | Release | Enhanced AI descriptions with two-stage interpretation |
| 0.2.14        | 2026-01-10 | Release | Fix AI screenshot analysis on encrypted files |
| 0.2.13        | 2026-01-10 | Release | Add ad-hoc signing and install instructions |
| 0.2.12        | 2026-01-10 | Release | Attempted Gatekeeper fix (insufficient) |
| 0.2.11        | 2026-01-10 | Release | Fix AI narrative parsing, simplify auto-updater to download button |
| 0.2.10        | 2026-01-10 | Release | Fix credentials & Jira data persistence across updates |
| 0.2.9         | 2026-01-10 | Release | Fix app blacklist icons, versionless artifact names |
| 0.2.8         | 2026-01-10 | Release | Robust AI description fallback, Jira Epics support |
| 0.2.7         | 2026-01-10 | Release | Fix auto-update install button for unsigned builds |
| 0.2.6         | 2026-01-10 | Release | Settings version/updates, Tempo checkbox fix, window position fix |
| 0.2.5         | 2026-01-10 | Release | Fix AI screenshot analysis empty narrative |
| 0.2.4         | 2026-01-10 | Release | Move releases to public repo for auto-update |
| 0.2.3         | 2026-01-10 | Release | Fix activity recording (immediate polling) |
| 0.2.2         | 2026-01-10 | Release | Fix activity recording (blacklist API path) |
| 0.2.1         | 2026-01-10 | Release | Fix auto-updater, recording, and config button |
| 0.2.0         | 2026-01-10 | Release | Add auto-updater test modal |
| 0.1.7         | 2026-01-10 | Release | Fix corrupted display (keep dist unpacked) |
| 0.1.6         | 2026-01-10 | Release | Fix corrupted display (loadFile for asar support) |
| 0.1.5         | 2026-01-10 | Release | Fix corrupted display (absolute path resolution) |
| 0.1.4         | 2026-01-10 | Release | Fix corrupted display from asar packing |
| 0.1.3         | 2026-01-10 | Release | Reduce build size by ~80% |
| 0.1.2         | 2026-01-10 | Release | Fix window visibility on launch |
| 0.1.1         | 2026-01-10 | Release | Fix first-launch and trial bugs |
| 0.1.0-beta.1  | 2026-01-10 | Beta    | Initial beta release with full feature set |

---

## Versioning Guide

- **Major (X.0.0)**: Major releases (user dictated)
- **Minor (0.X.0)**: Minor feature updates
- **Patch (0.0.X)**: Bug fixes

### Pre-release Tags
- `-alpha.X`: Internal testing builds
- `-beta.X`: External beta testing
- `-rc.X`: Release candidates
