# TimePortal Implementation Plan Review

## Project Overview
**TimePortal** is a desktop time tracking application built with React, TypeScript, Electron, and Tailwind CSS. It tracks time spent on different projects/buckets with automatic window activity monitoring and screenshot capture.

---

## ✅ Completed Features

### 1. Core Timer Functionality
- ✅ Start/Stop timer with visual feedback
- ✅ Real-time elapsed time display (HH:MM:SS format)
- ✅ Timer state persistence (localStorage)
- ✅ Timer state restoration on app restart
- ⚠️ **TODO**: Resume logic when app restarts with timer running (line 36 in `useTimer.ts`)

### 2. Project/Bucket Management
- ✅ Create custom buckets with names and colors
- ✅ Delete buckets
- ✅ Default buckets (Work, Meeting, Break)
- ✅ Bucket selection for time tracking
- ✅ Bucket persistence in localStorage

### 3. Time Entry & History
- ✅ Save time entries with start/end times and duration
- ✅ Associate entries with buckets
- ✅ History view with chronological listing
- ✅ Entry detail view showing:
  - Bucket information
  - Duration
  - Start time
  - Window activity breakdown
- ⚠️ **Planned**: Edit description and reassign bucket (see Planned Features)
- ⚠️ **Planned**: CSV export with Tempo-compatible format (see Planned Features)

### 4. Window Activity Tracking
- ✅ Active window/app detection (macOS via AppleScript)
- ✅ Window title tracking
- ✅ Activity duration calculation
- ✅ Activity logging on window switches
- ✅ Polling interval: 2 seconds
- ✅ Activity displayed in history detail view

### 5. Screenshot Capture
- ✅ Automatic screenshot capture every 5 minutes
- ✅ Screenshot on app/window switch
- ✅ Screenshot storage in user data directory
- ✅ Manual screenshot test button in settings
- ✅ macOS Screen Recording permission handling
- ⚠️ **Note**: Screenshot paths stored but not yet displayed in UI

### 6. Electron Desktop Integration
- ✅ System tray integration
- ✅ Tray icon with click to show/hide window
- ✅ Frameless window design
- ✅ Window positioning relative to tray
- ✅ Auto-hide on blur
- ✅ Custom window controls (close button)
- ✅ macOS-specific permission handling

### 7. Settings & Permissions
- ✅ Settings page
- ✅ Screen Recording permission status check
- ✅ Permission status display (granted/denied/not-determined)
- ✅ Direct link to System Settings for permissions
- ✅ Permission polling (updates every 2 seconds)

### 8. UI/UX
- ✅ Dark theme (gray-900/gray-950)
- ✅ Green accent color scheme
- ✅ Sidebar navigation (Timer, History, Buckets, Settings)
- ✅ Responsive layout
- ✅ Smooth transitions and hover effects
- ✅ Custom drag handles for window movement

### 9. Data Persistence
- ✅ LocalStorage for buckets
- ✅ LocalStorage for time entries
- ✅ LocalStorage for timer state
- ✅ Automatic save on changes

---

## 🚧 Known Issues & TODOs

### High Priority
1. **Timer Resume Logic** (`src/hooks/useTimer.ts:36`)
   - When app restarts with timer running, need to calculate accrued time
   - Currently timer state is restored but time doesn't continue accurately

### Medium Priority
2. **Screenshot Integration**
   - Screenshot paths are captured but not displayed in UI
   - Consider adding screenshot gallery/viewer in history detail
   - Link screenshots to time entries

## 🎯 Planned Features

### App-Grouped History View with Screenshots
**Status**: Planned for Development

**Requirements**:
1. **App-Grouped Activities**
   - Group all history activities by application name
   - Display app icons next to app names in the UI
   - Show aggregated time per app
   - Allow expanding/collapsing app groups

2. **Screenshot Viewer**
   - Display screenshots under each activity
   - Link screenshots to specific time entries and window activities
   - Gallery view for screenshots within an app group
   - Thumbnail preview with full-size view on click
   - Timeline view showing screenshots in chronological order

**Technical Considerations**:
- Need to retrieve app icons (macOS: `NSWorkspace.sharedWorkspace.icon(forFile:)` or bundle path lookup)
- Screenshot file management and association with activities
- Image loading and caching for performance
- UI component for app icon display
- Screenshot gallery component with lightbox/modal viewer

**Implementation Areas**:
- New component: `AppGroupedHistory.tsx` or enhanced `HistoryDetail.tsx`
- New component: `ScreenshotGallery.tsx`
- Electron IPC handler: `get-app-icon` for retrieving app icons
- Data structure updates: Link screenshots to window activities
- UI updates: App icon display, grouped list view, screenshot thumbnails

**Detailed Feature Breakdown**:

1. **App Icon Retrieval** (Electron Main Process)
   - Create IPC handler `get-app-icon` that takes app name/bundle ID
   - Use macOS APIs to get app icon (NSWorkspace or bundle path)
   - Return icon as base64 or file path
   - Cache icons to avoid repeated lookups
   - Fallback to default icon if app not found

2. **App-Grouped History View** (React Component)
   - Aggregate all activities from all time entries by app name
   - Calculate total time per app
   - Display as collapsible groups (expand/collapse)
   - Show app icon next to app name
   - List all window activities under each app
   - Show duration for each activity
   - Link to original time entry if needed

3. **Screenshot Association** (Data Layer)
   - Link screenshot files to specific window activities
   - Store screenshot metadata (timestamp, app, window title)
   - Update `WindowActivity` interface to include screenshot paths
   - Update screenshot capture to associate with current activity

4. **Screenshot Gallery** (React Component)
   - Display screenshots in chronological order
   - Thumbnail grid view
   - Click to view full-size in modal/lightbox
   - Show screenshot metadata (time, app, window title)
   - Filter by app or time range
   - Navigate between screenshots

5. **UI Integration**
   - Add new view or enhance existing History view
   - Toggle between chronological and app-grouped views
   - Smooth transitions and animations
   - Responsive layout for different screen sizes

### Jira Tempo Integration
**Status**: ✅ Partially Complete - Direct Jira API Integration Implemented

**✅ Completed**:
- Direct Jira API v3 integration with comprehensive issue discovery
- Unified Jira and Tempo configuration modal
- Pagination support for fetching all Jira objects (not limited to 20 items)
- Fixed deprecated API endpoints (/search → /search/jql)
- Rate limiting and error handling
- Connection testing for both Jira and Tempo APIs
- **Periodic Background Sync** (January 2026)
  - Automatic sync at configurable intervals (15min, 30min, 1hr, 2hr)
  - Smart scheduling with startup delay and periodic refresh
  - Manual "Sync Now" functionality
  - Sync status indicators showing last sync time and next scheduled sync
  - Settings UI for enabling/disabling auto-sync and configuring intervals
  - Prevents concurrent syncs and respects rate limits
  - Integration with existing crawler for incremental issue discovery

**🚧 In Progress - Enhanced Jira Integration Requirements**:

1. **Comprehensive Jira Object Fetching**
   - **Priority**: High - Required for future AI features
   - Implement comprehensive fetching of ALL Jira objects, not just assigned/recent/epics
   - Fetch all projects, issue types, statuses, priorities, components, versions
   - Create comprehensive data context for AI features to use
   - Store complete Jira schema/metadata locally for AI processing
   - Technical areas:
     - Extend JiraService with methods for all object types
     - Add getAllProjects(), getAllIssueTypes(), getAllStatuses(), etc.
     - Create comprehensive data caching system
     - Store Jira schema metadata for AI context

2. **Project/Space Selection in Configuration**
   - **Priority**: High - User control over data scope
   - Add project/space selector in Jira configuration process
   - Allow users to select which Jira projects to fetch data from
   - Improve performance by limiting scope to relevant projects
   - Provide UI for multi-select project configuration
   - Technical areas:
     - Add project selection UI in IntegrationConfigModal
     - Store selected projects in settings context
     - Filter all API calls by selected projects
     - Add project management in configuration flow

3. **Debug UI Cleanup**
   - **Priority**: Medium - Code quality and user experience
   - Remove all console.log statements from production code
   - Clean up debug UI elements (red debug bars, etc.)
   - Keep only essential logging for error tracking
   - Improve user-facing error messages
   - Technical areas:
     - Remove debug console.log statements throughout codebase
     - Remove debug UI elements (red debug sections in JiraIssuesSection)
     - Replace console.log with proper logging framework if needed
     - Clean up development-only UI components

**Remaining Original Requirements**:
1. **Tempo API Authentication**
   - Personal API token configuration in settings
   - Secure storage of API token (encrypted or keychain)
   - Jira instance URL configuration
   - Token validation and connection testing

2. **Bucket Mapping**
   - Map TimePortal buckets to Tempo worklogs
   - List available buckets from Tempo API
   - Display bucket mapping interface
   - Allow users to create/select buckets in Tempo
   - Store mapping configuration (TimePortal bucket → Tempo worklog bucket)

3. **Worklog Synchronization**
   - Push time entries to Tempo worklogs
   - Support bulk upload of multiple entries
   - Handle date/time formatting for Tempo API
   - Map bucket IDs to Tempo worklog attributes
   - Show sync status and errors
   - Prevent duplicate submissions

4. **UI Components**
   - Settings section for Tempo configuration
   - API token input (masked/password field)
   - Bucket mapping interface
   - Sync button/action in history view
   - Sync status indicators
   - Error messages and retry options

**Technical Considerations**:
- Tempo REST API v3 or v4 (check latest version)
- API endpoints:
  - `GET /worklogs` - List worklogs
  - `POST /worklogs` - Create worklog
  - `GET /work-attributes` - Get work attributes (for bucket mapping)
- Authentication: Bearer token in Authorization header
- Rate limiting: Handle API rate limits gracefully
- Error handling: Network errors, authentication failures, validation errors
- Data format: Convert milliseconds to Tempo time format (seconds or ISO duration)
- Date/time: Ensure proper timezone handling

**Implementation Areas**:
- New service: `tempoService.ts` - API client for Tempo
- New component: `TempoSettings.tsx` - Configuration UI
- New component: `TempoSync.tsx` - Sync interface and status
- Settings integration: Add Tempo section to Settings page
- Data layer: Store Tempo configuration and mappings
- Electron IPC: Secure token storage (if using keychain)

**Detailed Feature Breakdown**:

1. **Tempo API Client** (Service Layer)
   - Create `tempoService.ts` with API methods
   - Implement authentication with Bearer token
   - Handle API requests/responses
   - Error handling and retry logic
   - Rate limiting awareness
   - Methods:
     - `validateToken()` - Test API connection
     - `getWorkAttributes()` - List available work attributes/buckets
     - `createWorklog(worklog)` - Push single worklog
     - `createWorklogs(worklogs[])` - Bulk upload (if supported)

2. **Configuration Management** (Data Layer)
   - Store Tempo API token securely
   - Store Jira instance URL
   - Store bucket mappings (TimePortal bucket ID → Tempo work attribute)
   - Add to Settings context or separate config storage
   - Encryption for sensitive data

3. **Bucket Mapping UI** (React Component)
   - Display TimePortal buckets
   - Fetch and display Tempo work attributes
   - Allow user to map buckets
   - Save mapping configuration
   - Validation: ensure all buckets mapped before sync

4. **Worklog Sync Logic** (Service Layer)
   - Convert TimeEntry to Tempo worklog format
   - Map bucket to Tempo work attribute
   - Format duration (ms → seconds or ISO 8601 duration)
   - Format dates (ISO 8601 timestamps)
   - Batch processing for multiple entries
   - Track sync status per entry (synced, pending, error)

5. **Sync UI** (React Component)
   - Sync button in History view
   - Show sync status per entry (icon/indicator)
   - Bulk sync option
   - Progress indicator during sync
   - Error display with retry option
   - Success confirmation

6. **Settings Integration**
   - Add Tempo section to Settings page
   - API token input (with show/hide toggle)
   - Jira instance URL input
   - Test connection button
   - Bucket mapping interface
   - Save/cancel buttons

**API Requirements**:
- Tempo REST API documentation reference
- Required fields for worklog creation:
  - `issueKey` (Jira issue key) - may need user input or mapping
  - `timeSpentSeconds` - duration in seconds
  - `startDate` - worklog date
  - `startTime` - optional, time of day
  - Work attributes (for bucket mapping)
  - `authorAccountId` - user account ID
  - `description` - optional, could include activity summary

**Security Considerations**:
- Never log or expose API tokens
- Use secure storage (keychain on macOS, encrypted storage)
- Validate token format before storing
- Clear token on logout/uninstall option
- Handle token expiration gracefully

### History Item Editing
**Status**: Planned for Development

**Requirements**:
1. **Description Field**
   - Add description field to time entries
   - Allow editing description in history detail view
   - Support multi-line text input
   - Save description with time entry
   - Display description in history list and detail views
   - Optional field (can be empty)

2. **Bucket Assignment/Reassignment**
   - Allow changing bucket assignment for existing time entries
   - Display current bucket in history detail view
   - Provide bucket selector dropdown in edit mode
   - Update bucket assignment and save changes
   - Show visual feedback when bucket is changed
   - Update history list view to reflect bucket changes

3. **Edit Interface**
   - Edit button/mode in history detail view
   - Inline editing or modal dialog
   - Save and cancel buttons
   - Validation (ensure bucket is selected)
   - Auto-save option (optional)

**Technical Considerations**:
- Update `TimeEntry` interface to include `description?: string`
- Update `StorageContext` to support editing entries (not just adding)
- Add `updateEntry` method to storage context
- Persist changes to localStorage
- UI should handle editing state gracefully
- Consider undo/redo functionality (future enhancement)

**Implementation Areas**:
- Data model: Add `description` field to `TimeEntry` interface
- Storage context: Add `updateEntry(id, updates)` method
- UI component: Enhance `HistoryDetail.tsx` with edit mode
- UI component: Add description textarea/input field
- UI component: Add bucket selector in edit mode
- UI updates: Show description in history list (optional, truncated)
- UI updates: Edit button/icon in history detail view

**Detailed Feature Breakdown**:

1. **Data Model Updates** (Storage Layer)
   - Add `description?: string` to `TimeEntry` interface
   - Ensure backward compatibility (existing entries without description)
   - Update TypeScript types

2. **Storage Context Enhancement** (Data Layer)
   - Add `updateEntry(id: string, updates: Partial<TimeEntry>)` method
   - Update localStorage when entry is modified
   - Maintain entry order and relationships
   - Emit updates to trigger UI re-renders

3. **History Detail Edit Mode** (React Component)
   - Add edit/save/cancel buttons or toggle
   - Edit mode state management
   - Form fields:
     - Description textarea (multi-line, optional)
     - Bucket selector dropdown
   - Validation before save
   - Loading state during save
   - Success/error feedback

4. **Description Display** (React Component)
   - Show description in history detail view
   - Truncate long descriptions with "read more" option
   - Empty state when no description
   - Optional: Show description preview in history list

5. **Bucket Reassignment UI** (React Component)
   - Current bucket display (read-only mode)
   - Bucket selector dropdown (edit mode)
   - Visual indicator when bucket is changed
   - Validation: ensure valid bucket is selected

6. **UI/UX Enhancements**
   - Smooth transition between view/edit modes
   - Auto-focus on description field when entering edit mode
   - Keyboard shortcuts (Cmd+S to save, Esc to cancel)
   - Confirmation dialog if unsaved changes when navigating away
   - Visual distinction between view and edit modes

**User Flow**:
1. User views history entry in detail view
2. User clicks "Edit" button
3. UI switches to edit mode:
   - Description field becomes editable
   - Bucket selector becomes active
   - Save/Cancel buttons appear
4. User edits description and/or changes bucket
5. User clicks "Save"
6. Changes are persisted and UI returns to view mode
7. Updated information is reflected in history list

**Edge Cases**:
- Editing entry while timer is running (should be allowed)
- Bucket deleted while entry is assigned to it (show "Unknown" or allow reassignment)
- Very long descriptions (truncation, scrolling)
- Concurrent edits (if multiple windows - not applicable for single-window app)

### CSV Export for Timesheets
**Status**: Planned for Development

**Requirements**:
1. **Export Functionality**
   - Export time entries to CSV format
   - CSV structure matching Tempo worklog import format
   - Support filtering by date range
   - Support filtering by bucket
   - Support selecting specific entries
   - File save dialog for export location
   - Progress indicator for large exports

2. **CSV Format (Tempo-Compatible)**
   - Column structure matching Tempo worklog requirements
   - Proper date/time formatting
   - Duration conversion (milliseconds → seconds)
   - UTF-8 encoding
   - Header row with column names
   - Proper CSV escaping (commas, quotes, newlines)

3. **Data Mapping**
   - Map TimePortal entries to Tempo worklog format
   - Handle optional fields (description, issueKey, etc.)
   - Map buckets to work attributes (if configured)
   - Include user account information (if available)

**Technical Considerations**:
- CSV generation library or manual CSV construction
- Date formatting: ISO 8601 dates (YYYY-MM-DD)
- Time formatting: ISO 8601 time (HH:mm:ss) or seconds
- Duration: Convert from milliseconds to seconds
- File system access via Electron (save dialog)
- Large dataset handling (streaming or chunking)
- Error handling for file write operations

**Implementation Areas**:
- New service: `exportService.ts` - CSV generation and export logic
- New component: `ExportDialog.tsx` - Export options UI
- Electron IPC: File save dialog handler
- Data transformation: Convert TimeEntry to Tempo worklog format
- UI integration: Export button in History view

**Detailed Feature Breakdown**:

1. **CSV Generation Service** (Service Layer)
   - Create `exportService.ts` with export methods
   - Convert TimeEntry array to CSV format
   - Map fields to Tempo worklog structure:
     - `issueKey` - Optional, user can configure or leave empty
     - `timeSpentSeconds` - Convert from milliseconds
     - `startDate` - Format as YYYY-MM-DD
     - `startTime` - Format as HH:mm:ss (optional)
     - `description` - From entry description field
     - `authorAccountId` - User account (if available)
     - Work attributes - From bucket mapping
   - Handle CSV escaping and formatting
   - Methods:
     - `generateCSV(entries: TimeEntry[], options: ExportOptions): string`
     - `exportToFile(csvContent: string, filename: string): Promise<void>`

2. **Export Options UI** (React Component)
   - Date range picker (from/to dates)
   - Bucket filter (multi-select)
   - Entry selection (checkboxes or select all)
   - Format options (if multiple formats supported in future)
   - Preview of export (entry count, date range)
   - Export button with loading state

3. **File Save Dialog** (Electron IPC)
   - IPC handler: `show-save-dialog`
   - Default filename: `timesheet-YYYY-MM-DD.csv`
   - File type filter: CSV files
   - Return selected file path
   - Handle user cancellation

4. **Data Transformation** (Service Layer)
   - Convert TimeEntry to Tempo worklog row
   - Format dates: `new Date(entry.startTime).toISOString().split('T')[0]`
   - Format time: `new Date(entry.startTime).toTimeString().split(' ')[0]`
   - Convert duration: `Math.floor(entry.duration / 1000)` (ms → seconds)
   - Map bucket to work attribute (if Tempo integration configured)
   - Handle missing/optional fields gracefully

5. **Export Integration** (UI Components)
   - Export button in History view
   - Export option in context menu (right-click on entries)
   - Bulk export for selected entries
   - Export all entries option
   - Success/error notifications

6. **CSV Format Specification**:
   ```csv
   issueKey,timeSpentSeconds,startDate,startTime,description,authorAccountId,workAttribute1,workAttribute2
   PROJ-123,3600,2024-01-15,09:00:00,Work session,user@example.com,BucketName,
   PROJ-456,1800,2024-01-15,10:30:00,Meeting notes,user@example.com,Meeting,
   ```
   - Headers: Match Tempo worklog import format
   - Encoding: UTF-8 with BOM (optional, for Excel compatibility)
   - Line endings: CRLF (Windows) or LF (Unix)
   - Quoting: Quote fields containing commas, quotes, or newlines

**Export Options**:
- **Date Range**: Filter entries by start date
- **Bucket Filter**: Include only specific buckets
- **Entry Selection**: Select individual entries or all
- **Include Descriptions**: Toggle description field inclusion
- **Include Issue Keys**: If issue keys are configured/mapped
- **Format**: CSV format (future: JSON, Excel)

**User Flow**:
1. User navigates to History view
2. User clicks "Export" button
3. Export dialog opens with options:
   - Date range selector
   - Bucket filter
   - Entry selection
4. User configures export options
5. User clicks "Export to CSV"
6. File save dialog appears
7. User selects save location and filename
8. CSV file is generated and saved
9. Success notification appears

**Edge Cases**:
- No entries to export (show message)
- Very large datasets (progress indicator, chunking)
- File write permissions (error handling)
- Invalid date ranges (validation)
- Special characters in descriptions (proper CSV escaping)
- Missing bucket mappings (handle gracefully)

**Future Enhancements**:
- Export templates (custom CSV formats)
- Scheduled exports
- Export to other formats (JSON, Excel, PDF)
- Direct export to Tempo (via API instead of CSV)
- Export preview before saving

---

3. **TypeScript Type Safety**
   - Multiple `@ts-ignore` comments for `window.electron`
   - Should create proper type definitions for Electron IPC bridge

### Low Priority
4. **Error Handling**
   - Add error handling for permission failures
   - Handle cases where AppleScript fails
   - Graceful degradation when permissions denied

5. **Data Management**
   - ~~No export functionality~~ (Planned - CSV export with Tempo format)
   - No data backup/restore
   - No data deletion/cleanup options

---

## 🔮 Potential Future Features

### Analytics & Reporting
- Daily/weekly/monthly time summaries
- Time breakdown by bucket
- Charts and visualizations
- Export reports (CSV, PDF)

### Enhanced Tracking
- Idle time detection
- Productivity scoring
- App usage statistics
- Website tracking (if browser integration)

### AI Features
**Status**: ✅ **Apple Intelligence Vision Framework Integration - COMPLETED**

**✅ Implemented**:
- **Apple Vision Framework Screenshot Analysis** (January 2026)
  - Native Swift helper using Apple's Vision Framework for on-device AI analysis
  - Text recognition (OCR) to extract visible text from screenshots
  - Object classification to identify UI elements and content types
  - Natural language description generation for screenshot content
  - Automatic integration with TimePortal's screenshot capture workflow
  - Privacy-preserving on-device processing (no cloud AI services)

**Technical Implementation**:
1. **Native Swift Helper** (`/native/screenshot-analyzer/`)
   - Standalone Swift executable leveraging Vision Framework APIs
   - Text recognition using VNRecognizeTextRequest (macOS 10.15+)
   - Image classification using VNClassifyImageRequest
   - Smart categorization of detected objects into work-related categories
   - JSON-based input/output for seamless IPC communication
   - Error handling and graceful degradation

2. **IPC Bridge Integration** (`electron/main.ts`)
   - `analyze-screenshot` IPC handler for Electron ↔ Swift communication
   - Automatic screenshot analysis pipeline during time tracking
   - Fallback handling for non-macOS platforms and analysis failures
   - Secure process spawning and JSON data exchange

3. **Enhanced Data Model** (`src/context/StorageContext.tsx`)
   - Added `screenshotDescriptions` field to `WindowActivity` interface
   - Stores AI-generated descriptions alongside screenshot file paths
   - Maintains backward compatibility with existing screenshot data

4. **Automatic Analysis Integration** (`src/hooks/useTimer.ts`)
   - Screenshots analyzed immediately after capture during time tracking
   - AI descriptions stored with activity data for later retrieval
   - Seamless integration with existing screenshot capture workflow
   - Handles analysis errors gracefully with fallback descriptions

**Generated Description Examples**:
- "Screenshot from VS Code showing code/development containing work-related content about api, database"
- "Screenshot from Figma showing design work with creative content"
- "Screenshot from Slack showing communication content with meeting details"
- "Screenshot from Safari showing web browsing with text content"

**User Benefits**:
- **Enhanced Activity Context**: AI-generated descriptions provide semantic understanding of work sessions
- **Better Time Analysis**: Understand what type of work was performed during each activity
- **Privacy-First**: All AI processing happens on-device using Apple's Vision Framework
- **Automatic Operation**: No user intervention required - works transparently with existing workflow
- **Intelligent Categorization**: Automatically identifies work patterns and content types

**Platform Support**:
- **macOS**: Full Apple Vision Framework integration
- **Other Platforms**: Graceful fallback with basic descriptions

**Future AI Enhancement Opportunities**:
- Integration with other Apple Intelligence APIs (Natural Language processing, Core ML)
- Custom model training for work-specific categorization
- Advanced productivity insights based on AI-analyzed activities
- Cross-referencing with Jira issue content for automatic work classification

### UI Enhancements
- ~~Screenshot viewer/gallery~~ (Planned - see Planned Features section)
- App-grouped history view with app icons (Planned - see Planned Features section)
- Timeline view of activities
- Calendar integration
- Dark/light theme toggle

### Data Features
- ~~Jira Tempo integration~~ (Planned - see Planned Features section)
- Cloud sync (optional)
- Data export/import
- Backup/restore functionality
- Data retention policies

### Platform Support
- Windows support (currently macOS-focused)
- Linux support
- Cross-platform window tracking

### Advanced Features
- Pomodoro timer integration
- Goal setting and tracking
- Reminders and notifications
- Team collaboration features

---

## 📋 Technical Architecture

### Frontend Stack
- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Context API** - State management

### Electron Stack
- **Electron 33** - Desktop framework
- **IPC Communication** - Main/renderer bridge
- **System Tray** - Tray integration
- **Desktop Capturer** - Screenshot API
- **AppleScript** - macOS window tracking

### Data Storage
- **localStorage** - Client-side persistence
- **File System** - Screenshot storage

### Key Files
```
src/
├── App.tsx              # Main app component & routing
├── components/
│   ├── Settings.tsx     # Settings page
│   ├── HistoryDetail.tsx # Entry detail view
│   ├── AppGroupedHistory.tsx # (Planned) App-grouped history view
│   ├── ScreenshotGallery.tsx # (Planned) Screenshot viewer component
│   ├── TempoSettings.tsx # (Planned) Tempo configuration UI
│   ├── TempoSync.tsx    # (Planned) Tempo sync interface
│   └── ExportDialog.tsx # (Planned) CSV export options dialog
├── services/
│   ├── tempoService.ts  # (Planned) Tempo API client
│   └── exportService.ts # (Planned) CSV export service
├── context/
│   └── StorageContext.tsx # Data management
│                        # (Planned) updateEntry method for editing
└── hooks/
    └── useTimer.ts      # Timer logic & window tracking

electron/
├── main.ts              # Main process (IPC, tray, window)
│                        # (Planned) get-app-icon IPC handler
│                        # (Planned) secure token storage (keychain)
│                        # (Planned) show-save-dialog IPC handler
└── preload.cts          # IPC bridge setup
```

---

## 🔧 Recent Implementation Requirements & UX Issues

### Bucket vs Jira Issue Assignment UX Unification
**Status**: ⚠️ **CRITICAL UX ISSUE - Requires Immediate Design Review**

**Problem Identified**:
The current implementation creates two separate assignment mechanisms for History items:
1. **Bucket Assignment**: Traditional bucket selection via `bucketId` field
2. **Jira Issue Linking**: New Jira issue association via `linkedJiraIssue` field

This creates a **confusing dual-assignment system** where users can have both a bucket AND a Jira issue linked to the same time entry, leading to:
- Unclear categorization (which takes precedence?)
- Duplicated information in UI
- Confusing user experience during time tracking

**Required UX Design Changes**:

1. **Unified Assignment Model**
   - **Manual Buckets** (Work, Meeting, Break, etc.) and **Jira Issues/Epics** should be treated as the same concept
   - Users should choose EITHER a manual bucket OR a Jira object, not both
   - This unified concept should be called "Work Category" or "Assignment" in the UI

2. **Data Model Restructuring** 
   - Replace the current dual-field approach (`bucketId` + `linkedJiraIssue`)
   - Implement a single assignment field that can hold either bucket or Jira issue data
   - Suggested interface:
     ```typescript
     interface WorkAssignment {
       type: 'bucket' | 'jira';
       bucket?: {
         id: string;
         name: string;
         color: string;
       };
       jiraIssue?: LinkedJiraIssue;
     }
     
     interface TimeEntry {
       // ... existing fields
       assignment?: WorkAssignment; // Replaces bucketId + linkedJiraIssue
     }
     ```

3. **UI/UX Changes Required**:
   - **Timer View**: Single dropdown/selector showing both manual buckets and available Jira issues
   - **History View**: Single assignment display (either bucket or Jira issue, not both)
   - **Assignment Selection**: Unified picker showing:
     - Manual buckets (with colors)
     - Available Jira issues (with project/status info)
     - Clear visual distinction between bucket types
   - **Activity Details**: Single assignment field in description box

4. **Assignment Flow Redesign**:
   - During time tracking: User selects ONE assignment (bucket OR Jira issue)
   - In History view: User can change assignment to ANY other option (bucket OR Jira issue)
   - Visual consistency: Both bucket and Jira assignments should have similar visual treatment

5. **Migration Strategy**:
   - Handle existing data with both `bucketId` and `linkedJiraIssue`
   - Migration priority: If both exist, prefer Jira issue over bucket
   - Graceful fallback to bucket if Jira integration is disabled

**Implementation Files to Modify**:
- `src/context/StorageContext.tsx` - Update TimeEntry interface and data model
- `src/App.tsx` - Unified assignment selection in Timer and History views  
- `src/components/HistoryDetail.tsx` - Single assignment display and editing
- `src/hooks/useTimer.ts` - Update timer to work with unified assignment model
- All components that currently handle bucket selection

**Priority**: **HIGH** - This affects core user experience and should be addressed before releasing the Jira integration feature.

**Technical Scope**: **LARGE** - Requires significant refactoring of assignment-related components and data structures.

---

## 🎯 Next Steps Recommendations

### Immediate (Week 1)
1. ✅ Fix timer resume logic
2. ✅ Add TypeScript types for Electron bridge
3. ✅ Improve error handling for permission failures

### Short-term (Month 1)
1. ✅ **History Item Editing** (NEW)
   - Add description field to time entries
   - Implement edit mode in history detail view
   - Add bucket reassignment functionality
   - Update storage context with edit capabilities
2. ✅ **CSV Export for Timesheets** (NEW)
   - Implement CSV export service with Tempo-compatible format
   - Add export dialog with filtering options
   - Integrate file save dialog via Electron
   - Add export button to History view
3. ✅ **App-Grouped History View with Screenshots**
   - Implement app-grouped history view
   - Add app icon retrieval and display
   - Build screenshot gallery component
   - Link screenshots to activities
4. ✅ **Jira Tempo Integration** (Partially Complete)
   - ✅ Implement direct Jira API client with pagination
   - ✅ Add unified Jira/Tempo settings and configuration UI
   - ✅ Fix deprecated API endpoints
   - 🚧 **Enhanced Jira Integration** (NEW REQUIREMENTS):
     - **Comprehensive Jira Object Fetching** for AI features
     - **Project/Space Selection** in configuration process
     - **Debug UI Cleanup** - remove console.log and debug elements
   - Build bucket mapping interface
   - Implement worklog sync functionality
5. ✅ Improve UI for screenshot management

### Medium-term (Quarter 1)
1. ✅ Analytics dashboard
2. ✅ Data backup/restore
3. ✅ Windows platform support

---

## 📝 Notes

- The app is currently optimized for macOS
- Window tracking uses AppleScript (macOS-specific)
- Screenshot capture requires Screen Recording permission
- All data is stored locally (no cloud sync)
- The app runs in the system tray for minimal intrusion

---

**Last Updated**: Review Date
**Version**: 0.1.0

