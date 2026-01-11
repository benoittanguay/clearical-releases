# Changelog

All notable changes to Clearical will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
