# Changelog

All notable changes to Clearical will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1-beta.1] - 2026-01-10

### Fixed
- Testing Mode banner no longer appears in production builds
- Integration modal no longer auto-opens on first launch
- Clean first-run experience: only onboarding modal appears for new users

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
| 0.1.1-beta.1  | 2026-01-10 | Beta    | Fix first-launch experience bugs |
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
