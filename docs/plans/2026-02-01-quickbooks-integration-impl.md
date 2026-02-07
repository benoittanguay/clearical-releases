# QuickBooks Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add QuickBooks Online integration to Clearical, enabling users to categorize work by QB customers and log time entries as QB Time Activities.

**Architecture:** OAuth 2.0 via custom URL scheme (clearical://oauth/quickbooks), bucket-level linking to QB Customer + Service Item, destination picker modal replacing "Log to Tempo" button.

**Tech Stack:** Electron, React, TypeScript, QuickBooks Online API v3, electron-store for token storage

---

## Task 1: QuickBooks Types and Data Model

**Files:**
- Modify: `src/types/shared.ts`

**Step 1: Add QuickBooks types to shared.ts**

Add after the `TempoAccount` related types (around line 143):

```typescript
// QuickBooks Integration Types
export interface QuickBooksCustomer {
  id: string;
  displayName: string;
  companyName?: string;
  active: boolean;
}

export interface QuickBooksServiceItem {
  id: string;
  name: string;
  description?: string;
  unitPrice?: number;
  active: boolean;
}

export interface QuickBooksLinkage {
  customerId: string;
  customerName: string;
  serviceItemId: string;
  serviceItemName: string;
}

export interface QuickBooksLogRecord {
  timeActivityId: string;
  loggedAt: number;
  customerId: string;
  serviceItemId: string;
}
```

**Step 2: Extend TimeBucket interface**

Find the `TimeBucket` interface and add QuickBooks linkage:

```typescript
export interface TimeBucket {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
  isFolder?: boolean;
  linkedIssue?: LinkedJiraIssue;
  quickbooks?: QuickBooksLinkage;  // ADD THIS LINE
}
```

**Step 3: Extend TimeEntry interface**

Find the `TimeEntry` interface and add QuickBooks log record:

```typescript
export interface TimeEntry {
  // ... existing fields ...
  loggedToQuickBooks?: QuickBooksLogRecord;  // ADD THIS LINE
}
```

**Step 4: Commit**

```bash
git add src/types/shared.ts
git commit -m "feat(quickbooks): add QuickBooks types and extend TimeBucket/TimeEntry"
```

---

## Task 2: QuickBooks Service - API Client

**Files:**
- Create: `src/services/quickbooksService.ts`

**Step 1: Create the QuickBooks API service**

```typescript
import type { QuickBooksCustomer, QuickBooksServiceItem } from '../types/shared';

export interface QuickBooksCompanyInfo {
  id: string;
  companyName: string;
}

export interface QuickBooksTimeActivity {
  Id?: string;
  TxnDate: string;
  NameOf: 'Vendor' | 'Employee';
  Hours: number;
  Minutes: number;
  Description?: string;
  CustomerRef?: { value: string; name?: string };
  ItemRef?: { value: string; name?: string };
  HourlyRate?: number;
  BillableStatus: 'Billable' | 'NotBillable';
}

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  realmId: string;
}

export class QuickBooksService {
  private baseUrl = 'https://quickbooks.api.intuit.com';
  private realmId: string;
  private getAccessToken: () => Promise<string>;

  constructor(realmId: string, getAccessToken: () => Promise<string>) {
    this.realmId = realmId;
    this.getAccessToken = getAccessToken;
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
  ): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = `${this.baseUrl}/v3/company/${this.realmId}${endpoint}`;

    // Use IPC to avoid CORS issues
    const result = await window.electron.ipcRenderer.quickbooksApiRequest({
      url,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!result.success) {
      throw new Error(result.error || 'QuickBooks API request failed');
    }

    return result.data;
  }

  async getCompanyInfo(): Promise<QuickBooksCompanyInfo> {
    const response = await this.makeRequest<any>(
      `/companyinfo/${this.realmId}`
    );
    return {
      id: response.CompanyInfo.Id,
      companyName: response.CompanyInfo.CompanyName,
    };
  }

  async getCustomers(): Promise<QuickBooksCustomer[]> {
    const query = encodeURIComponent("SELECT * FROM Customer WHERE Active = true MAXRESULTS 1000");
    const response = await this.makeRequest<any>(`/query?query=${query}`);

    const customers = response.QueryResponse?.Customer || [];
    return customers.map((c: any) => ({
      id: c.Id,
      displayName: c.DisplayName,
      companyName: c.CompanyName,
      active: c.Active,
    }));
  }

  async getServiceItems(): Promise<QuickBooksServiceItem[]> {
    const query = encodeURIComponent("SELECT * FROM Item WHERE Type = 'Service' AND Active = true MAXRESULTS 1000");
    const response = await this.makeRequest<any>(`/query?query=${query}`);

    const items = response.QueryResponse?.Item || [];
    return items.map((i: any) => ({
      id: i.Id,
      name: i.Name,
      description: i.Description,
      unitPrice: i.UnitPrice,
      active: i.Active,
    }));
  }

  async createTimeActivity(activity: QuickBooksTimeActivity): Promise<{ id: string }> {
    const response = await this.makeRequest<any>('/timeactivity', 'POST', activity);
    return { id: response.TimeActivity.Id };
  }

  static formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString().split('T')[0];
  }

  static msToHoursMinutes(ms: number): { hours: number; minutes: number } {
    const totalMinutes = Math.round(ms / 60000);
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/services/quickbooksService.ts
git commit -m "feat(quickbooks): add QuickBooks API service client"
```

---

## Task 3: QuickBooks OAuth Handler (Electron Main)

**Files:**
- Create: `electron/quickbooks/quickbooksAuth.ts`
- Modify: `electron/main.ts`

**Step 1: Create OAuth handler**

```typescript
import { shell, BrowserWindow } from 'electron';
import { storeCredential, getCredential, deleteCredential } from '../credentialStorage.js';

// QuickBooks OAuth configuration
const QB_CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID || '';
const QB_CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET || '';
const QB_REDIRECT_URI = 'clearical://oauth/quickbooks';
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

const CREDENTIAL_KEYS = {
  ACCESS_TOKEN: 'quickbooks_access_token',
  REFRESH_TOKEN: 'quickbooks_refresh_token',
  EXPIRES_AT: 'quickbooks_expires_at',
  REALM_ID: 'quickbooks_realm_id',
  COMPANY_NAME: 'quickbooks_company_name',
};

export interface QuickBooksConnectionStatus {
  connected: boolean;
  companyName?: string;
  realmId?: string;
}

export async function initiateOAuthFlow(): Promise<void> {
  const scope = 'com.intuit.quickbooks.accounting';
  const state = Math.random().toString(36).substring(7);

  const authUrl = new URL(QB_AUTH_URL);
  authUrl.searchParams.set('client_id', QB_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', QB_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  await shell.openExternal(authUrl.toString());
}

export async function handleOAuthCallback(url: string, win: BrowserWindow | null): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const realmId = parsed.searchParams.get('realmId');
    const error = parsed.searchParams.get('error');

    if (error) {
      console.error('[QuickBooks] OAuth error:', error);
      return false;
    }

    if (!code || !realmId) {
      console.error('[QuickBooks] Missing code or realmId');
      return false;
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Store tokens securely
    await storeCredential(CREDENTIAL_KEYS.ACCESS_TOKEN, tokens.access_token);
    await storeCredential(CREDENTIAL_KEYS.REFRESH_TOKEN, tokens.refresh_token);
    await storeCredential(CREDENTIAL_KEYS.EXPIRES_AT, String(Date.now() + tokens.expires_in * 1000));
    await storeCredential(CREDENTIAL_KEYS.REALM_ID, realmId);

    // Notify renderer
    if (win) {
      win.webContents.send('quickbooks:connected', { realmId });
    }

    return true;
  } catch (error) {
    console.error('[QuickBooks] OAuth callback error:', error);
    return false;
  }
}

async function exchangeCodeForTokens(code: string): Promise<any> {
  const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return response.json();
}

export async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getCredential(CREDENTIAL_KEYS.REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const basicAuth = Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const tokens = await response.json();

  await storeCredential(CREDENTIAL_KEYS.ACCESS_TOKEN, tokens.access_token);
  await storeCredential(CREDENTIAL_KEYS.REFRESH_TOKEN, tokens.refresh_token);
  await storeCredential(CREDENTIAL_KEYS.EXPIRES_AT, String(Date.now() + tokens.expires_in * 1000));

  return tokens.access_token;
}

export async function getValidAccessToken(): Promise<string> {
  const expiresAtStr = await getCredential(CREDENTIAL_KEYS.EXPIRES_AT);
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;

  // Refresh if expires in less than 5 minutes
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    return refreshAccessToken();
  }

  const accessToken = await getCredential(CREDENTIAL_KEYS.ACCESS_TOKEN);
  if (!accessToken) {
    throw new Error('No access token available');
  }

  return accessToken;
}

export async function getConnectionStatus(): Promise<QuickBooksConnectionStatus> {
  const realmId = await getCredential(CREDENTIAL_KEYS.REALM_ID);
  const companyName = await getCredential(CREDENTIAL_KEYS.COMPANY_NAME);

  if (!realmId) {
    return { connected: false };
  }

  return {
    connected: true,
    realmId,
    companyName: companyName || undefined,
  };
}

export async function getRealmId(): Promise<string | null> {
  return getCredential(CREDENTIAL_KEYS.REALM_ID);
}

export async function setCompanyName(name: string): Promise<void> {
  await storeCredential(CREDENTIAL_KEYS.COMPANY_NAME, name);
}

export async function disconnect(): Promise<void> {
  await deleteCredential(CREDENTIAL_KEYS.ACCESS_TOKEN);
  await deleteCredential(CREDENTIAL_KEYS.REFRESH_TOKEN);
  await deleteCredential(CREDENTIAL_KEYS.EXPIRES_AT);
  await deleteCredential(CREDENTIAL_KEYS.REALM_ID);
  await deleteCredential(CREDENTIAL_KEYS.COMPANY_NAME);
}
```

**Step 2: Commit**

```bash
git add electron/quickbooks/quickbooksAuth.ts
git commit -m "feat(quickbooks): add OAuth authentication handler"
```

---

## Task 4: QuickBooks IPC Handlers

**Files:**
- Create: `electron/quickbooks/ipcHandlers.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.cts`

**Step 1: Create IPC handlers**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import {
  initiateOAuthFlow,
  handleOAuthCallback,
  getConnectionStatus,
  getValidAccessToken,
  getRealmId,
  setCompanyName,
  disconnect,
} from './quickbooksAuth.js';

let mainWindow: BrowserWindow | null = null;

export function initializeQuickBooksIPC(win: BrowserWindow) {
  mainWindow = win;

  // Connect to QuickBooks (initiate OAuth)
  ipcMain.handle('quickbooks:connect', async () => {
    try {
      await initiateOAuthFlow();
      return { success: true };
    } catch (error) {
      console.error('[QuickBooks IPC] Connect error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Disconnect from QuickBooks
  ipcMain.handle('quickbooks:disconnect', async () => {
    try {
      await disconnect();
      return { success: true };
    } catch (error) {
      console.error('[QuickBooks IPC] Disconnect error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get connection status
  ipcMain.handle('quickbooks:get-status', async () => {
    try {
      const status = await getConnectionStatus();
      return { success: true, ...status };
    } catch (error) {
      console.error('[QuickBooks IPC] Get status error:', error);
      return { success: false, connected: false, error: String(error) };
    }
  });

  // Get realm ID
  ipcMain.handle('quickbooks:get-realm-id', async () => {
    try {
      const realmId = await getRealmId();
      return { success: true, realmId };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Set company name (after fetching from API)
  ipcMain.handle('quickbooks:set-company-name', async (_event, name: string) => {
    try {
      await setCompanyName(name);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // API request proxy (to avoid CORS)
  ipcMain.handle('quickbooks:api-request', async (_event, params: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
  }) => {
    try {
      const response = await fetch(params.url, {
        method: params.method,
        headers: params.headers,
        body: params.body ? JSON.stringify(params.body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: data.Fault?.Error?.[0]?.Message || 'API request failed',
          data,
        };
      }

      return { success: true, data };
    } catch (error) {
      console.error('[QuickBooks IPC] API request error:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get valid access token (with auto-refresh)
  ipcMain.handle('quickbooks:get-access-token', async () => {
    try {
      const token = await getValidAccessToken();
      return { success: true, token };
    } catch (error) {
      console.error('[QuickBooks IPC] Get token error:', error);
      return { success: false, error: String(error) };
    }
  });
}

export function handleQuickBooksDeepLink(url: string, win: BrowserWindow | null): boolean {
  if (url.startsWith('clearical://oauth/quickbooks')) {
    handleOAuthCallback(url, win);
    return true;
  }
  return false;
}

export function cleanupQuickBooksIPC() {
  ipcMain.removeHandler('quickbooks:connect');
  ipcMain.removeHandler('quickbooks:disconnect');
  ipcMain.removeHandler('quickbooks:get-status');
  ipcMain.removeHandler('quickbooks:get-realm-id');
  ipcMain.removeHandler('quickbooks:set-company-name');
  ipcMain.removeHandler('quickbooks:api-request');
  ipcMain.removeHandler('quickbooks:get-access-token');
}
```

**Step 2: Add to preload.cts**

Find the `contextBridge.exposeInMainWorld` section and add after the calendar section:

```typescript
// QuickBooks operations
quickbooks: {
    connect: () => ipcRenderer.invoke('quickbooks:connect'),
    disconnect: () => ipcRenderer.invoke('quickbooks:disconnect'),
    getStatus: () => ipcRenderer.invoke('quickbooks:get-status'),
    getRealmId: () => ipcRenderer.invoke('quickbooks:get-realm-id'),
    setCompanyName: (name: string) => ipcRenderer.invoke('quickbooks:set-company-name', name),
    getAccessToken: () => ipcRenderer.invoke('quickbooks:get-access-token'),
    onConnected: (callback: (data: { realmId: string }) => void) => {
        const subscription = (_event: any, data: any) => callback(data);
        ipcRenderer.on('quickbooks:connected', subscription);
        return () => ipcRenderer.removeListener('quickbooks:connected', subscription);
    },
},
quickbooksApiRequest: (params: { url: string; method: string; headers: Record<string, string>; body?: any }) =>
    ipcRenderer.invoke('quickbooks:api-request', params),
```

**Step 3: Update main.ts**

Import and initialize QuickBooks IPC handlers. In `handleDeepLink` function, add QuickBooks handling:

```typescript
// At imports section
import { initializeQuickBooksIPC, handleQuickBooksDeepLink, cleanupQuickBooksIPC } from './quickbooks/ipcHandlers.js';

// In handleDeepLink function, add:
if (handleQuickBooksDeepLink(url, win)) {
    return;
}

// In app.whenReady(), after window creation:
initializeQuickBooksIPC(win);

// In cleanup/quit handler:
cleanupQuickBooksIPC();
```

**Step 4: Update TypeScript declarations**

Add to `src/types/electron.d.ts`:

```typescript
quickbooks: {
    connect: () => Promise<{ success: boolean; error?: string }>;
    disconnect: () => Promise<{ success: boolean; error?: string }>;
    getStatus: () => Promise<{ success: boolean; connected: boolean; companyName?: string; realmId?: string; error?: string }>;
    getRealmId: () => Promise<{ success: boolean; realmId?: string | null; error?: string }>;
    setCompanyName: (name: string) => Promise<{ success: boolean; error?: string }>;
    getAccessToken: () => Promise<{ success: boolean; token?: string; error?: string }>;
    onConnected: (callback: (data: { realmId: string }) => void) => () => void;
};
quickbooksApiRequest: (params: { url: string; method: string; headers: Record<string, string>; body?: any }) =>
    Promise<{ success: boolean; data?: any; error?: string; status?: number }>;
```

**Step 5: Commit**

```bash
git add electron/quickbooks/ipcHandlers.ts electron/main.ts electron/preload.cts src/types/electron.d.ts
git commit -m "feat(quickbooks): add IPC handlers and preload bridge"
```

---

## Task 5: QuickBooks Cache Service

**Files:**
- Create: `src/services/quickbooksCache.ts`

**Step 1: Create cache service**

```typescript
import type { QuickBooksCustomer, QuickBooksServiceItem } from '../types/shared';
import { QuickBooksService } from './quickbooksService';

interface QuickBooksCacheState {
  customers: QuickBooksCustomer[];
  serviceItems: QuickBooksServiceItem[];
  lastSync: number | null;
  companyName: string | null;
  realmId: string | null;
}

class QuickBooksCacheService {
  private state: QuickBooksCacheState = {
    customers: [],
    serviceItems: [],
    lastSync: null,
    companyName: null,
    realmId: null,
  };
  private syncInterval: NodeJS.Timeout | null = null;
  private service: QuickBooksService | null = null;
  private listeners: Set<() => void> = new Set();

  async initialize(): Promise<void> {
    const status = await window.electron.ipcRenderer.quickbooks.getStatus();
    if (status.connected && status.realmId) {
      this.state.realmId = status.realmId;
      this.state.companyName = status.companyName || null;
      await this.initService();
      await this.sync();
      this.startAutoSync();
    }
  }

  private async initService(): Promise<void> {
    if (!this.state.realmId) return;

    this.service = new QuickBooksService(
      this.state.realmId,
      async () => {
        const result = await window.electron.ipcRenderer.quickbooks.getAccessToken();
        if (!result.success || !result.token) {
          throw new Error(result.error || 'Failed to get access token');
        }
        return result.token;
      }
    );
  }

  async sync(): Promise<void> {
    if (!this.service) return;

    try {
      console.log('[QuickBooksCache] Syncing...');

      const [customers, serviceItems, companyInfo] = await Promise.all([
        this.service.getCustomers(),
        this.service.getServiceItems(),
        this.service.getCompanyInfo(),
      ]);

      this.state.customers = customers;
      this.state.serviceItems = serviceItems;
      this.state.companyName = companyInfo.companyName;
      this.state.lastSync = Date.now();

      // Store company name in secure storage
      await window.electron.ipcRenderer.quickbooks.setCompanyName(companyInfo.companyName);

      console.log('[QuickBooksCache] Synced:', {
        customers: customers.length,
        serviceItems: serviceItems.length,
      });

      this.notifyListeners();
    } catch (error) {
      console.error('[QuickBooksCache] Sync failed:', error);
      throw error;
    }
  }

  private startAutoSync(): void {
    // Sync every 15 minutes
    this.syncInterval = setInterval(() => {
      this.sync().catch(console.error);
    }, 15 * 60 * 1000);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopAutoSync();
    this.service = null;
    this.state = {
      customers: [],
      serviceItems: [],
      lastSync: null,
      companyName: null,
      realmId: null,
    };
    await window.electron.ipcRenderer.quickbooks.disconnect();
    this.notifyListeners();
  }

  async onConnected(realmId: string): Promise<void> {
    this.state.realmId = realmId;
    await this.initService();
    await this.sync();
    this.startAutoSync();
  }

  getCustomers(): QuickBooksCustomer[] {
    return this.state.customers;
  }

  getServiceItems(): QuickBooksServiceItem[] {
    return this.state.serviceItems;
  }

  getCompanyName(): string | null {
    return this.state.companyName;
  }

  getLastSync(): number | null {
    return this.state.lastSync;
  }

  isConnected(): boolean {
    return this.state.realmId !== null;
  }

  getService(): QuickBooksService | null {
    return this.service;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const quickbooksCache = new QuickBooksCacheService();
```

**Step 2: Commit**

```bash
git add src/services/quickbooksCache.ts
git commit -m "feat(quickbooks): add cache service with auto-sync"
```

---

## Task 6: QuickBooks Settings UI

**Files:**
- Create: `src/components/QuickBooksConfigSection.tsx`
- Modify: `src/components/Settings.tsx`

**Step 1: Create QuickBooks config section component**

```typescript
import { useState, useEffect } from 'react';
import { quickbooksCache } from '../services/quickbooksCache';
import { analytics } from '../services/analytics';

export function QuickBooksConfigSection() {
  const [connected, setConnected] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [customerCount, setCustomerCount] = useState(0);
  const [serviceItemCount, setServiceItemCount] = useState(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const updateState = () => {
      setConnected(quickbooksCache.isConnected());
      setCompanyName(quickbooksCache.getCompanyName());
      setCustomerCount(quickbooksCache.getCustomers().length);
      setServiceItemCount(quickbooksCache.getServiceItems().length);
      setLastSync(quickbooksCache.getLastSync());
    };

    updateState();
    const unsubscribe = quickbooksCache.subscribe(updateState);

    // Listen for OAuth completion
    const unsubscribeConnected = window.electron.ipcRenderer.quickbooks.onConnected(async (data) => {
      setIsConnecting(false);
      await quickbooksCache.onConnected(data.realmId);
      analytics.track('quickbooks.connected');
    });

    return () => {
      unsubscribe();
      unsubscribeConnected();
    };
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    analytics.track('quickbooks.connect_initiated');
    await window.electron.ipcRenderer.quickbooks.connect();
    // OAuth flow opens in browser, completion handled by onConnected listener
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect from QuickBooks?')) return;
    analytics.track('quickbooks.disconnect');
    await quickbooksCache.disconnect();
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await quickbooksCache.sync();
      analytics.track('quickbooks.manual_sync');
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const formatLastSync = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
    return `${Math.floor(diff / 3600000)} hours ago`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          QuickBooks
        </h3>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--color-success)]">
            <span className="w-2 h-2 bg-[var(--color-success)] rounded-full" />
            Connected
          </span>
        )}
      </div>

      {connected ? (
        <div className="space-y-3 p-4 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border-primary)]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-body)' }}>
              {companyName || 'QuickBooks Company'}
            </span>
          </div>

          <div className="text-xs text-[var(--color-text-tertiary)] space-y-1" style={{ fontFamily: 'var(--font-body)' }}>
            <div>Last synced: {formatLastSync(lastSync)}</div>
            <div>{customerCount} customers, {serviceItemCount} service items</div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border-primary)] rounded-lg transition-all hover:bg-[var(--color-bg-ghost-hover)] disabled:opacity-50"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              {isSyncing ? 'Syncing...' : 'Refresh Data'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 text-xs text-[var(--color-error)] hover:text-[var(--color-error)] border border-[var(--color-border-primary)] rounded-lg transition-all hover:bg-[var(--color-error)]/10"
              style={{ fontFamily: 'var(--font-body)' }}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 p-4 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border-primary)]">
          <p className="text-sm text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
            Connect to QuickBooks to log time entries and track billable work.
          </p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="px-4 py-2 bg-[#2CA01C] hover:bg-[#248017] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {isConnecting ? 'Connecting...' : 'Connect to QuickBooks'}
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add to Settings.tsx**

Import and add the component in the integrations section:

```typescript
import { QuickBooksConfigSection } from './QuickBooksConfigSection';

// In the JSX, after the Tempo section:
<QuickBooksConfigSection />
```

**Step 3: Commit**

```bash
git add src/components/QuickBooksConfigSection.tsx src/components/Settings.tsx
git commit -m "feat(quickbooks): add settings UI for QuickBooks connection"
```

---

## Task 7: QuickBooks Bucket Linking UI

**Files:**
- Create: `src/components/QuickBooksLinkingSection.tsx`
- Modify: `src/components/CreateBucketModal.tsx` (or create EditBucketModal if needed)
- Modify: `src/context/StorageContext.tsx`

**Step 1: Create linking section component**

```typescript
import { useState, useMemo } from 'react';
import { quickbooksCache } from '../services/quickbooksCache';
import type { QuickBooksLinkage, QuickBooksCustomer, QuickBooksServiceItem } from '../types/shared';

interface QuickBooksLinkingSectionProps {
  currentLinkage?: QuickBooksLinkage;
  onLinkageChange: (linkage: QuickBooksLinkage | undefined) => void;
}

export function QuickBooksLinkingSection({ currentLinkage, onLinkageChange }: QuickBooksLinkingSectionProps) {
  const [customerSearch, setCustomerSearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<QuickBooksCustomer | null>(
    currentLinkage ? { id: currentLinkage.customerId, displayName: currentLinkage.customerName, active: true } : null
  );
  const [selectedService, setSelectedService] = useState<QuickBooksServiceItem | null>(
    currentLinkage ? { id: currentLinkage.serviceItemId, name: currentLinkage.serviceItemName, active: true } : null
  );

  const isConnected = quickbooksCache.isConnected();
  const customers = quickbooksCache.getCustomers();
  const serviceItems = quickbooksCache.getServiceItems();

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 10);
    const search = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.displayName.toLowerCase().includes(search) ||
      c.companyName?.toLowerCase().includes(search)
    ).slice(0, 10);
  }, [customers, customerSearch]);

  const filteredServices = useMemo(() => {
    if (!serviceSearch) return serviceItems.slice(0, 10);
    const search = serviceSearch.toLowerCase();
    return serviceItems.filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.description?.toLowerCase().includes(search)
    ).slice(0, 10);
  }, [serviceItems, serviceSearch]);

  const handleCustomerSelect = (customer: QuickBooksCustomer) => {
    setSelectedCustomer(customer);
    setCustomerSearch('');
    updateLinkage(customer, selectedService);
  };

  const handleServiceSelect = (service: QuickBooksServiceItem) => {
    setSelectedService(service);
    setServiceSearch('');
    updateLinkage(selectedCustomer, service);
  };

  const updateLinkage = (customer: QuickBooksCustomer | null, service: QuickBooksServiceItem | null) => {
    if (customer && service) {
      onLinkageChange({
        customerId: customer.id,
        customerName: customer.displayName,
        serviceItemId: service.id,
        serviceItemName: service.name,
      });
    } else {
      onLinkageChange(undefined);
    }
  };

  const handleClear = () => {
    setSelectedCustomer(null);
    setSelectedService(null);
    onLinkageChange(undefined);
  };

  if (!isConnected) return null;

  const isLinked = selectedCustomer && selectedService;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider" style={{ fontFamily: 'var(--font-display)' }}>
          QuickBooks Linking
        </label>
        {isLinked && (
          <button
            onClick={handleClear}
            className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Customer Selection */}
      <div>
        <label className="block text-xs text-[var(--color-text-tertiary)] mb-1" style={{ fontFamily: 'var(--font-body)' }}>
          Customer
        </label>
        {selectedCustomer ? (
          <div className="flex items-center justify-between p-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg">
            <span className="text-sm text-[var(--color-text-primary)]">{selectedCustomer.displayName}</span>
            <button onClick={() => { setSelectedCustomer(null); updateLinkage(null, selectedService); }} className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search customers..."
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            {(customerSearch || filteredCustomers.length > 0) && (
              <div className="absolute z-10 w-full mt-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredCustomers.map(customer => (
                  <button
                    key={customer.id}
                    onClick={() => handleCustomerSelect(customer)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-primary)]"
                  >
                    {customer.displayName}
                    {customer.companyName && <span className="text-[var(--color-text-tertiary)] ml-2">({customer.companyName})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Service Item Selection */}
      <div>
        <label className="block text-xs text-[var(--color-text-tertiary)] mb-1" style={{ fontFamily: 'var(--font-body)' }}>
          Service Item
        </label>
        {selectedService ? (
          <div className="flex items-center justify-between p-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] rounded-lg">
            <span className="text-sm text-[var(--color-text-primary)]">
              {selectedService.name}
              {selectedService.unitPrice && <span className="text-[var(--color-text-tertiary)] ml-2">${selectedService.unitPrice}/hr</span>}
            </span>
            <button onClick={() => { setSelectedService(null); updateLinkage(selectedCustomer, null); }} className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={serviceSearch}
              onChange={(e) => setServiceSearch(e.target.value)}
              placeholder="Search service items..."
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            {(serviceSearch || filteredServices.length > 0) && (
              <div className="absolute z-10 w-full mt-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-primary)] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {filteredServices.map(service => (
                  <button
                    key={service.id}
                    onClick={() => handleServiceSelect(service)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-bg-ghost-hover)] text-[var(--color-text-primary)]"
                  >
                    {service.name}
                    {service.unitPrice && <span className="text-[var(--color-text-tertiary)] ml-2">${service.unitPrice}/hr</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status indicator */}
      {isLinked && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-success)]">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Linked to QuickBooks
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add linkQuickBooksToBucket to StorageContext.tsx**

```typescript
// Add to interface StorageContextType:
linkQuickBooksToBucket: (bucketId: string, linkage: QuickBooksLinkage | undefined) => void;

// Add implementation:
const linkQuickBooksToBucket = async (bucketId: string, linkage: QuickBooksLinkage | undefined) => {
    const result = await window.electron.ipcRenderer.db.updateBucket(bucketId, { quickbooks: linkage });
    if (result.success) {
        setBuckets(buckets.map(bucket =>
            bucket.id === bucketId
                ? { ...bucket, quickbooks: linkage }
                : bucket
        ));
    } else {
        console.error('[StorageContext] Failed to link QuickBooks to bucket:', result.error);
    }
};

// Add to provider value
```

**Step 3: Commit**

```bash
git add src/components/QuickBooksLinkingSection.tsx src/context/StorageContext.tsx
git commit -m "feat(quickbooks): add bucket linking UI and storage context method"
```

---

## Task 8: Log Destination Modal

**Files:**
- Create: `src/components/LogDestinationModal.tsx`

**Step 1: Create the destination picker modal**

```typescript
import type { TimeEntry, TimeBucket } from '../types/shared';
import { quickbooksCache } from '../services/quickbooksCache';

interface LogDestinationModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: TimeEntry;
  bucket?: TimeBucket;
  tempoEnabled: boolean;
  onSelectTempo: () => void;
  onSelectQuickBooks: () => void;
}

export function LogDestinationModal({
  isOpen,
  onClose,
  entry,
  bucket,
  tempoEnabled,
  onSelectTempo,
  onSelectQuickBooks,
}: LogDestinationModalProps) {
  if (!isOpen) return null;

  const quickbooksConnected = quickbooksCache.isConnected();
  const quickbooksLinkage = bucket?.quickbooks;
  const tempoLinkage = entry.assignment?.type === 'jira' ? entry.assignment.jiraIssue : bucket?.linkedIssue;
  const tempoAccount = entry.tempoAccount;

  const canLogToTempo = tempoEnabled && tempoLinkage;
  const canLogToQuickBooks = quickbooksConnected && quickbooksLinkage;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 pb-4">
          <h3 className="text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
            Log Time
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[#FAF5EE] transition-all active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-3">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4" style={{ fontFamily: 'var(--font-body)' }}>
            Where do you want to log this entry?
          </p>

          {/* Tempo Option */}
          <button
            onClick={() => { onSelectTempo(); onClose(); }}
            disabled={!canLogToTempo}
            className={`w-full p-4 rounded-xl border transition-all duration-200 text-left ${
              canLogToTempo
                ? 'bg-[var(--color-bg-primary)] border-[var(--color-border-primary)] hover:border-[var(--color-accent)] hover:shadow-md cursor-pointer'
                : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border-primary)] opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                  Tempo (Jira)
                </div>
                {canLogToTempo ? (
                  <div className="text-xs text-[var(--color-text-tertiary)] mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                    → {tempoLinkage?.key} {tempoAccount && `• ${tempoAccount.name}`}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-tertiary)] mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                    {!tempoEnabled ? 'Set up in Settings' : 'Link bucket to Jira issue first'}
                  </div>
                )}
              </div>
            </div>
          </button>

          {/* QuickBooks Option */}
          <button
            onClick={() => { onSelectQuickBooks(); onClose(); }}
            disabled={!canLogToQuickBooks}
            className={`w-full p-4 rounded-xl border transition-all duration-200 text-left ${
              canLogToQuickBooks
                ? 'bg-[var(--color-bg-primary)] border-[var(--color-border-primary)] hover:border-[#2CA01C] hover:shadow-md cursor-pointer'
                : 'bg-[var(--color-bg-tertiary)] border-[var(--color-border-primary)] opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#2CA01C">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                  QuickBooks
                </div>
                {canLogToQuickBooks ? (
                  <div className="text-xs text-[var(--color-text-tertiary)] mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                    → {quickbooksLinkage?.customerName} • {quickbooksLinkage?.serviceItemName}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-tertiary)] mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                    {!quickbooksConnected ? 'Set up in Settings' : 'Link bucket to QuickBooks first'}
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 pt-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/LogDestinationModal.tsx
git commit -m "feat(quickbooks): add log destination picker modal"
```

---

## Task 9: QuickBooks Time Activity Logging

**Files:**
- Create: `src/components/QuickBooksLogConfirmModal.tsx`
- Modify: `src/context/StorageContext.tsx`

**Step 1: Create confirmation modal**

```typescript
import { useState } from 'react';
import type { TimeEntry, TimeBucket } from '../types/shared';
import { quickbooksCache } from '../services/quickbooksCache';
import { QuickBooksService } from '../services/quickbooksService';
import { analytics } from '../services/analytics';

interface QuickBooksLogConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: TimeEntry;
  bucket: TimeBucket;
  onSuccess: (timeActivityId: string) => void;
}

export function QuickBooksLogConfirmModal({
  isOpen,
  onClose,
  entry,
  bucket,
  onSuccess,
}: QuickBooksLogConfirmModalProps) {
  const [isLogging, setIsLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !bucket.quickbooks) return null;

  const { hours, minutes } = QuickBooksService.msToHoursMinutes(entry.duration);
  const linkage = bucket.quickbooks;

  const handleLog = async () => {
    setIsLogging(true);
    setError(null);

    try {
      const service = quickbooksCache.getService();
      if (!service) {
        throw new Error('QuickBooks service not available');
      }

      const result = await service.createTimeActivity({
        TxnDate: QuickBooksService.formatDate(entry.startTime),
        NameOf: 'Vendor',
        Hours: hours,
        Minutes: minutes,
        Description: entry.description || `Time tracked via Clearical`,
        CustomerRef: { value: linkage.customerId, name: linkage.customerName },
        ItemRef: { value: linkage.serviceItemId, name: linkage.serviceItemName },
        BillableStatus: 'Billable',
      });

      analytics.track('quickbooks.time_logged', {
        duration: entry.duration,
        customerId: linkage.customerId,
      });

      onSuccess(result.id);
      onClose();
    } catch (err) {
      console.error('[QuickBooks] Log failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to log time');
      analytics.track('quickbooks.time_log_failed', { error: String(err) });
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-secondary)] rounded-[12px] w-full max-w-md mx-4 border border-[var(--color-border-primary)] shadow-2xl animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#2CA01C">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            <h3 className="text-xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
              Log to QuickBooks
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[#FAF5EE] transition-all active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-4">
          {/* Entry details */}
          <div className="p-4 bg-[var(--color-bg-primary)] rounded-lg border border-[var(--color-border-primary)]">
            <div className="space-y-2 text-sm" style={{ fontFamily: 'var(--font-body)' }}>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-tertiary)]">Duration</span>
                <span className="text-[var(--color-text-primary)] font-mono">{hours}h {minutes}m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-tertiary)]">Date</span>
                <span className="text-[var(--color-text-primary)]">
                  {new Date(entry.startTime).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-tertiary)]">Customer</span>
                <span className="text-[var(--color-text-primary)]">{linkage.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-tertiary)]">Service</span>
                <span className="text-[var(--color-text-primary)]">{linkage.serviceItemName}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg text-sm text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 pt-0">
          <button
            onClick={onClose}
            disabled={isLogging}
            className="px-5 py-2.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm font-medium transition-all disabled:opacity-50"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleLog}
            disabled={isLogging}
            className="px-6 py-2.5 bg-[#2CA01C] hover:bg-[#248017] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white text-sm font-semibold rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg disabled:shadow-none"
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {isLogging ? 'Logging...' : 'Log Time'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add setEntryQuickBooksLog to StorageContext.tsx**

```typescript
// Add to interface StorageContextType:
setEntryQuickBooksLog: (entryId: string, log: QuickBooksLogRecord | undefined) => void;

// Add implementation:
const setEntryQuickBooksLog = async (entryId: string, log: QuickBooksLogRecord | undefined) => {
    const result = await window.electron.ipcRenderer.db.updateEntry(entryId, { loggedToQuickBooks: log });
    if (result.success) {
        setEntries(entries.map(entry =>
            entry.id === entryId
                ? { ...entry, loggedToQuickBooks: log }
                : entry
        ));
    } else {
        console.error('[StorageContext] Failed to set QuickBooks log:', result.error);
    }
};

// Add to provider value
```

**Step 3: Commit**

```bash
git add src/components/QuickBooksLogConfirmModal.tsx src/context/StorageContext.tsx
git commit -m "feat(quickbooks): add time activity logging modal and storage method"
```

---

## Task 10: Update WorklogEntryList with Log Time Button

**Files:**
- Modify: `src/components/WorklogEntryList.tsx`

**Step 1: Replace "Log to Tempo" button with "Log Time" button**

Find the button that says "Log to Tempo" and replace with a generic "Log Time" button that opens the destination modal:

```typescript
// Change the button from:
<button onClick={() => onBulkLogToTempo(dateKey)}>Log to Tempo</button>

// To:
<button onClick={() => onLogTime(dateKey)}>Log Time</button>
```

Update the props interface:

```typescript
interface WorklogEntryListProps {
    // ... existing props
    onBulkLogToTempo?: (dateKey: string) => void;  // Keep for backwards compatibility
    onLogTime?: (dateKey: string) => void;  // New generic handler
    tempoEnabled?: boolean;
    quickbooksEnabled?: boolean;
}
```

The parent component (App.tsx) will handle showing the LogDestinationModal.

**Step 2: Commit**

```bash
git add src/components/WorklogEntryList.tsx
git commit -m "feat(quickbooks): update WorklogEntryList with generic Log Time button"
```

---

## Task 11: Integration in App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add state and handlers for the log flow**

```typescript
// Add imports
import { LogDestinationModal } from './components/LogDestinationModal';
import { QuickBooksLogConfirmModal } from './components/QuickBooksLogConfirmModal';
import { quickbooksCache } from './services/quickbooksCache';

// Add state
const [logDestinationEntry, setLogDestinationEntry] = useState<TimeEntry | null>(null);
const [quickbooksLogEntry, setQuickbooksLogEntry] = useState<TimeEntry | null>(null);

// Initialize QuickBooks cache on mount
useEffect(() => {
    quickbooksCache.initialize().catch(console.error);
}, []);

// Add handlers
const handleLogTime = (entry: TimeEntry) => {
    setLogDestinationEntry(entry);
};

const handleSelectTempo = () => {
    if (logDestinationEntry) {
        // Existing Tempo flow
        handleOpenTempoValidation(logDestinationEntry);
    }
};

const handleSelectQuickBooks = () => {
    if (logDestinationEntry) {
        setQuickbooksLogEntry(logDestinationEntry);
    }
};

const handleQuickBooksLogSuccess = (timeActivityId: string) => {
    if (quickbooksLogEntry) {
        setEntryQuickBooksLog(quickbooksLogEntry.id, {
            timeActivityId,
            loggedAt: Date.now(),
            customerId: bucket?.quickbooks?.customerId || '',
            serviceItemId: bucket?.quickbooks?.serviceItemId || '',
        });
        // Show success toast
        showToast('Logged to QuickBooks', 'success');
    }
    setQuickbooksLogEntry(null);
};

// Add modals to JSX
<LogDestinationModal
    isOpen={!!logDestinationEntry}
    onClose={() => setLogDestinationEntry(null)}
    entry={logDestinationEntry!}
    bucket={getBucketForEntry(logDestinationEntry)}
    tempoEnabled={settings.tempo.enabled}
    onSelectTempo={handleSelectTempo}
    onSelectQuickBooks={handleSelectQuickBooks}
/>

<QuickBooksLogConfirmModal
    isOpen={!!quickbooksLogEntry}
    onClose={() => setQuickbooksLogEntry(null)}
    entry={quickbooksLogEntry!}
    bucket={getBucketForEntry(quickbooksLogEntry)!}
    onSuccess={handleQuickBooksLogSuccess}
/>
```

**Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(quickbooks): integrate log destination flow in App.tsx"
```

---

## Task 12: Success Toast Matching App Aesthetic

**Files:**
- Verify toast component exists or create one that matches the app style

**Step 1: Ensure toast shows with app styling**

The app likely already has a toast/notification system. Verify it exists and use it for QuickBooks success messages. The toast should:
- Use the app's color palette (`var(--color-success)`, etc.)
- Use the app's fonts (`var(--font-display)`, `var(--font-body)`)
- Auto-dismiss after 3 seconds
- Show "Logged to QuickBooks" with customer name

**Step 2: Commit**

```bash
git add -A
git commit -m "feat(quickbooks): ensure success toast matches app aesthetic"
```

---

## Task 13: Environment Variables and Configuration

**Files:**
- Modify: `.env.local.example` (or create)
- Update: `README.md` or docs if needed

**Step 1: Document required environment variables**

```bash
# QuickBooks OAuth Configuration
QUICKBOOKS_CLIENT_ID=your_client_id_here
QUICKBOOKS_CLIENT_SECRET=your_client_secret_here
```

**Step 2: Commit**

```bash
git add .env.local.example
git commit -m "docs(quickbooks): add environment variable documentation"
```

---

## Task 14: Final Integration Test

**Step 1: Manual testing checklist**

1. [ ] QuickBooks OAuth flow completes successfully
2. [ ] Customers and Service Items sync after connection
3. [ ] Bucket linking UI shows and saves correctly
4. [ ] "Log Time" button appears in WorklogEntryList
5. [ ] Destination modal shows correct states for each destination
6. [ ] QuickBooks logging creates Time Activity
7. [ ] Success toast appears with correct styling
8. [ ] Entry marked as logged, preventing double-logging

**Step 2: Final commit**

```bash
git add -A
git commit -m "feat(quickbooks): complete QuickBooks Online integration"
```

---

## Summary

This plan implements QuickBooks Online integration in 14 tasks:

1. **Types** - Data model extensions
2. **Service** - API client
3. **OAuth** - Authentication handler
4. **IPC** - Electron main/renderer bridge
5. **Cache** - Auto-syncing cache service
6. **Settings UI** - Connection management
7. **Bucket Linking** - Customer/Service selection
8. **Destination Modal** - Log target picker
9. **Log Confirm** - Time Activity creation
10. **Entry List** - Button update
11. **App Integration** - Wire everything together
12. **Toast** - Success feedback
13. **Config** - Environment variables
14. **Testing** - Manual verification
