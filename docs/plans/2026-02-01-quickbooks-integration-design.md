# QuickBooks Online Integration Design

## Overview

Add QuickBooks Online integration to Clearical, enabling users to:
1. Categorize work based on QuickBooks Customers
2. Log time entries as QuickBooks Time Activities
3. Choose between Tempo and QuickBooks when logging time

## Decisions Made

| Decision | Choice |
|----------|--------|
| QuickBooks product | QuickBooks Online (not Desktop) |
| Data to pull | Customers + Service Items |
| Sync direction | Manual export (user-initiated) |
| Destination selection | Choose each time via modal |
| Data mapping | Mirror Tempo pattern (bucket → Customer, account → Service Item) |
| Linkage approach | Pre-link in bucket settings (required before logging) |
| Authentication | OAuth 2.0 via custom URL scheme (`clearical://`) |
| Backend | None - fully client-side |

## Authentication & Settings

### QuickBooks Connection Flow
1. User clicks "Connect to QuickBooks" in Settings
2. System browser opens QuickBooks authorization page
3. User logs in and authorizes Clearical
4. QuickBooks redirects to `clearical://oauth/quickbooks?code=...`
5. App intercepts URL, exchanges code for access + refresh tokens
6. Tokens stored securely in electron-store

### Token Management
- Access tokens: ~1 hour expiry, refresh automatically before API calls
- Refresh tokens: 100 days inactivity expiry, prompt re-auth if expired
- Handle refresh transparently - user should rarely see auth errors

### App Registration Requirements
- Register Clearical in Intuit Developer Portal
- Configure redirect URI: `clearical://oauth/quickbooks`
- Obtain Client ID and Client Secret
- Request scopes: `com.intuit.quickbooks.accounting` (for Time Activities, Customers, Items)

## Data Model

### New Types

```typescript
interface QuickBooksCustomer {
  id: string;
  displayName: string;
  companyName?: string;
  active: boolean;
}

interface QuickBooksServiceItem {
  id: string;
  name: string;
  description?: string;
  unitPrice?: number; // hourly rate
  active: boolean;
}

interface QuickBooksTimeActivity {
  id: string;
  txnDate: string;
  hours: number;
  minutes: number;
  description?: string;
  customerId: string;
  serviceItemId: string;
  billableStatus: 'Billable' | 'NotBillable';
}
```

### TimeBucket Extension

```typescript
interface TimeBucket {
  // ... existing fields
  quickbooks?: {
    customerId: string;
    customerName: string;
    serviceItemId: string;
    serviceItemName: string;
  };
}
```

### TimeEntry Extension

```typescript
interface TimeEntry {
  // ... existing fields
  loggedToQuickBooks?: {
    timeActivityId: string;
    loggedAt: number;
    customerId: string;
    serviceItemId: string;
  };
}
```

## Data Sync

### What Gets Synced
- **Customers**: ID, display name, company name, active status
- **Service Items**: ID, name, description, hourly rate (where Type=Service)

### Sync Triggers (Mirror Jira Pattern)
- **On app launch**: Background sync
- **Periodic refresh**: Every ~15 minutes while app running
- **On bucket edit**: Fresh fetch when opening bucket settings
- **On log attempt**: Validate linked customer/item still exists
- **Manual refresh**: Available in Settings (rarely needed)

### Local Storage
- Cache in SQLite alongside existing Tempo account cache
- Store last sync timestamp for staleness checks

## User Interface

### Settings - QuickBooks Section

```
┌─────────────────────────────────────────┐
│ QuickBooks                              │
├─────────────────────────────────────────┤
│ ✓ Connected to "Acme Consulting LLC"   │
│                                         │
│ Last synced: 2 minutes ago              │
│ • 24 customers                          │
│ • 12 service items                      │
│                                         │
│ [Refresh Data]  [Disconnect]            │
└─────────────────────────────────────────┘
```

Or when not connected:

```
┌─────────────────────────────────────────┐
│ QuickBooks                              │
├─────────────────────────────────────────┤
│ Connect to QuickBooks to log time       │
│ entries and track billable work.        │
│                                         │
│ [Connect to QuickBooks]                 │
└─────────────────────────────────────────┘
```

### Bucket Edit - QuickBooks Linking

Only shown when QuickBooks is connected:

```
┌─────────────────────────────────────────┐
│ QuickBooks Linking                      │
├─────────────────────────────────────────┤
│ Customer                                │
│ ┌─────────────────────────────────────┐ │
│ │ Acme Corp                        ▼  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Service Item                            │
│ ┌─────────────────────────────────────┐ │
│ │ Consulting - $150/hr             ▼  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ✓ Linked to QuickBooks                  │
└─────────────────────────────────────────┘
```

- Searchable dropdowns (same pattern as Tempo account picker)
- Shows hourly rate on service items for clarity
- Both fields required to enable QuickBooks logging
- Visual indicator when fully linked

### Log Destination Modal

Replaces "Log to Tempo" button with "Log Time" → opens modal:

```
┌─────────────────────────────────────────┐
│ Log Time                            ✕   │
├─────────────────────────────────────────┤
│ Where do you want to log this entry?    │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ ⏱  Tempo (Jira)                     │ │
│ │    → PROJ-123 • Client Account      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📗 QuickBooks                       │ │
│ │    → Acme Corp • Consulting         │ │
│ └─────────────────────────────────────┘ │
│                                         │
│           [Cancel]                      │
└─────────────────────────────────────────┘
```

### Destination States

| State | Appearance |
|-------|------------|
| Ready | Shows linked target, clickable |
| Not configured | Greyed out, "Set up in Settings" link |
| Missing linkage | "Link bucket to Customer first" with link to bucket settings |

### Success Toast

After successful QuickBooks log, show toast matching app aesthetic:
- Subtle animation, positioned consistently with existing toasts
- Shows "Logged to QuickBooks" with customer name
- Auto-dismiss after ~3 seconds

## QuickBooks API Integration

### Time Activity Creation

```typescript
// POST /v3/company/{companyId}/timeactivity
{
  TxnDate: "2026-02-01",
  NameOf: "Vendor",
  Hours: 2,
  Minutes: 30,
  Description: "Entry description from Clearical",
  CustomerRef: { value: "123" },
  ItemRef: { value: "456" },
  HourlyRate: 150,
  BillableStatus: "Billable"
}
```

### API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /v3/company/{id}/query?query=SELECT * FROM Customer` | Fetch customers |
| `GET /v3/company/{id}/query?query=SELECT * FROM Item WHERE Type='Service'` | Fetch service items |
| `POST /v3/company/{id}/timeactivity` | Create time activity |
| `GET /v3/company/{id}/companyinfo/{id}` | Get company name for display |

### Error Handling

- Token expired: Auto-refresh, retry request
- Refresh token expired: Prompt re-authentication
- Customer/Item deleted: Show error, prompt to re-link bucket
- Rate limiting: Exponential backoff (QuickBooks allows 500 req/min)
- Network errors: Retry with backoff, show user-friendly message

## File Structure

### New Files

```
src/services/quickbooksService.ts        # API client
src/services/quickbooksCache.ts          # Local caching
src/components/QuickBooksConfigModal.tsx # Settings connection UI
src/components/QuickBooksCustomerPicker.tsx
src/components/QuickBooksServicePicker.tsx
src/components/LogDestinationModal.tsx   # "Where to log" picker
electron/quickbooksOAuth.ts              # OAuth flow handler
```

### Modified Files

```
src/types/shared.ts                      # Add QB types, extend TimeBucket/TimeEntry
src/components/Settings.tsx              # Add QuickBooks section
src/components/BucketEditModal.tsx       # Add QuickBooks linking section
src/components/WorklogEntryList.tsx      # Replace "Log to Tempo" with "Log Time"
electron/main.ts                         # Register clearical:// URL handler
electron/preload.cjs                     # Expose QB IPC methods
```

## Out of Scope (v1)

- Bulk/batch logging multiple entries at once
- Syncing time activities back from QuickBooks into Clearical
- Invoice generation from logged time
- Per-entry destination routing (all entries in a bucket go to same place)
- QuickBooks Desktop support
- Projects feature (beyond Customers)

## Future Considerations

- **Per-entry routing**: Link individual entries to different destinations based on context
- **Two-way sync**: Pull existing QuickBooks time activities to prevent duplicates
- **Invoicing**: Generate QuickBooks invoices from logged time
- **Projects**: Support QuickBooks Projects feature for more granular tracking
