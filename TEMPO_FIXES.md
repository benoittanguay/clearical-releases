# Tempo Integration Fixes

## Summary
Fixed critical bugs in the Tempo integration that were preventing time logging from working correctly. The issues involved JSON encoding, API request handling, and validation.

---

## Issues Fixed

### 1. **Double JSON Stringify in JiraService** (CRITICAL BUG)
**File**: `src/services/jiraService.ts`

**Problem**:
- The `makeRequest` method was calling `JSON.stringify(body)` before sending to IPC
- The IPC handler in `electron/main.ts` was calling `JSON.stringify()` again
- This resulted in double-encoded JSON being sent to Jira API (e.g., `"{\"field\":\"value\"}"` instead of `{"field":"value"}`)

**Fix**:
```typescript
// Before (WRONG - double encoding):
body: body && (method === 'POST' || method === 'PUT') ? JSON.stringify(body) : undefined,

// After (CORRECT):
body: body, // Send raw body object - IPC handler will stringify it
```

**Impact**: Jira API calls would fail with 400 Bad Request due to malformed JSON

---

### 2. **Missing Body Stringification in IPC Handlers**
**File**: `electron/main.ts`

**Problem**:
- Both `tempo-api-request` and `jira-api-request` IPC handlers were inconsistently handling body encoding
- No check for whether body was already a string vs an object

**Fix**:
```typescript
// Robust body handling that supports both string and object input:
body: body && (method === 'POST' || method === 'PUT')
    ? (typeof body === 'string' ? body : JSON.stringify(body))
    : undefined,
```

**Impact**: Ensures proper JSON encoding regardless of input format

---

### 3. **Missing Validation in App.tsx Bulk Logging**
**File**: `src/App.tsx`

**Problem**:
- Bulk "Log to Tempo" feature wasn't checking if Tempo was configured
- Would fail with cryptic errors if settings were incomplete

**Fix**:
```typescript
// Added comprehensive validation checks:
if (!settings.tempo?.enabled || !settings.tempo?.apiToken || !settings.tempo?.baseUrl) {
    alert('Please configure Tempo settings first in Settings.');
    setCurrentView('settings');
    return;
}

if (!settings.jira?.enabled || !settings.jira?.apiToken || !settings.jira?.baseUrl || !settings.jira?.email) {
    alert('Please configure Jira settings first. Jira credentials are required to log time to Tempo.');
    setCurrentView('settings');
    return;
}

if (!settings.tempo.defaultIssueKey) {
    alert('Please set a default Jira issue key in Tempo settings.');
    setCurrentView('settings');
    return;
}
```

**Impact**: Users get clear error messages and are directed to settings when configuration is incomplete

---

### 4. **Issue ID Validation**
**Files**: `src/components/TempoValidationModal.tsx`, `src/App.tsx`

**Problem**:
- No validation that the Jira issue ID returned was actually a valid number
- Could result in NaN being sent to Tempo API

**Fix**:
```typescript
const numericIssueId = parseInt(issueId, 10);
if (isNaN(numericIssueId) || numericIssueId <= 0) {
    throw new Error(`Invalid issue ID received from Jira: ${issueId}`);
}
```

**Impact**: Catches invalid issue IDs early with clear error messages

---

### 5. **Enhanced Logging in IPC Handlers**
**File**: `electron/main.ts`

**Problem**:
- Difficult to debug API issues due to insufficient logging
- No visibility into request body encoding

**Fix**:
```typescript
if (body) {
    console.log('[Main] API request body type:', typeof body);
    console.log('[Main] API request body preview:', JSON.stringify(body).substring(0, 200));
}

const requestBody = body && (method === 'POST' || method === 'PUT')
    ? (typeof body === 'string' ? body : JSON.stringify(body))
    : undefined;

if (requestBody) {
    console.log('[Main] API final request body length:', requestBody.length);
}
```

**Impact**: Better debugging information in console logs

---

## Testing Checklist

To verify these fixes work correctly:

### Single Entry Logging (TempoValidationModal)
1. ✅ Create a time entry with a Jira issue assignment
2. ✅ Click "Log to Tempo" button in HistoryDetail
3. ✅ Verify modal opens with correct information
4. ✅ Click "Confirm & Log"
5. ✅ Check success message shows worklog ID
6. ✅ Verify entry appears in Tempo (check Tempo web UI)

### Bulk Logging (App.tsx)
1. ✅ Create multiple time entries for today
2. ✅ Configure default Jira issue key in Tempo settings
3. ✅ Click bulk "Log to Tempo" button
4. ✅ Verify all entries are logged successfully
5. ✅ Check Tempo web UI for all worklogs

### Error Handling
1. ✅ Try logging without Tempo configured → Should show clear error
2. ✅ Try logging without Jira configured → Should show clear error
3. ✅ Try logging with invalid issue key → Should show meaningful error
4. ✅ Check console logs for proper request/response logging

---

## Architecture Notes

### Request Flow
```
React Component (TempoService/JiraService)
    ↓ (sends raw object via IPC)
Electron IPC Handler (main.ts)
    ↓ (stringifies to JSON)
Tempo/Jira REST API
    ↓ (returns JSON response)
Electron IPC Handler
    ↓ (parses and returns)
React Component
```

### Key Design Decisions

1. **Raw objects in IPC**: Services send raw JavaScript objects to IPC handlers
2. **Single stringify**: IPC handlers perform the single JSON.stringify operation
3. **Type checking**: Handlers check if body is already a string (for flexibility)
4. **Early validation**: Validate issue IDs and settings before making API calls
5. **Clear error messages**: Guide users to fix configuration issues

---

## Related Files

### Core Integration Files
- `src/services/tempoService.ts` - Tempo API client
- `src/services/jiraService.ts` - Jira API client (issue ID lookup)
- `src/components/TempoValidationModal.tsx` - Single entry logging UI
- `src/components/HistoryDetail.tsx` - Entry detail view with Log button
- `src/App.tsx` - Bulk logging feature
- `electron/main.ts` - IPC handlers for API proxying

### Configuration
- `src/context/SettingsContext.tsx` - Settings with API tokens
- Settings are stored in secure storage (macOS Keychain/Windows Credential Manager)

---

## API Documentation References

### Tempo API v4
- Base URL: `https://api.tempo.io` or `https://api.eu.tempo.io`
- Endpoint: `POST /4/worklogs`
- Required fields: `issueId` (numeric), `timeSpentSeconds`, `startDate`, `startTime`
- Authentication: Bearer token in Authorization header

### Jira REST API v3
- Base URL: `https://your-domain.atlassian.net`
- Endpoint: `GET /rest/api/3/issue/{issueKeyOrId}`
- Authentication: Basic auth with email + API token
- Returns: Issue object with numeric `id` field

---

## Future Improvements

1. **Batch API Calls**: Use Tempo bulk worklog endpoint for better performance
2. **Offline Queue**: Queue worklogs when offline and sync when connection restored
3. **Worklog Editing**: Allow editing/deleting existing worklogs
4. **Time Rounding**: Add option to round time to nearest 15min/30min
5. **Description Templates**: Create templates for common work descriptions
6. **Jira Issue Cache**: Cache Jira issue data to reduce API calls

---

## Troubleshooting

### "Network error" when logging
- Check internet connection
- Verify Tempo/Jira base URLs are correct
- Check API tokens are valid (not expired)

### "Invalid issue ID received from Jira"
- Verify issue key exists in Jira
- Check Jira credentials have permission to view the issue
- Ensure issue key format is correct (e.g., "PROJ-123")

### "Authentication failed"
- Regenerate API tokens in Tempo/Jira settings
- Verify email address matches Jira account
- Check that Tempo token has "View worklogs" and "Create worklogs" permissions

### Console shows double-encoded JSON
- This should now be fixed, but if you see it:
- Check that services are sending raw objects (not pre-stringified)
- Verify IPC handlers are only calling JSON.stringify once
