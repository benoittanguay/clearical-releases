# Social Login Design

**Date:** 2026-01-17
**Feature:** Account creation and login via Google, Microsoft, and Apple accounts

## Overview

Add social login as an alternative to the existing email OTP authentication flow. Users can choose to sign in with Google, Microsoft, or Apple accounts, with automatic account linking for users who share the same email across providers.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Relationship to email OTP | Alternative (not replacement) |
| Account linking behavior | Auto-link accounts with same email |
| Data from providers | Email only |
| UI placement | Social buttons above email input |
| Provider order | Google → Microsoft → Apple |
| Signup flow | Fully in-app (no external redirects) |

## Authentication Flow

### Current Flow (Email OTP)
```
Email input → Send OTP → Enter code → Authenticated
```

### New Flow (Social + Email OTP)
```
┌─────────────────────────────────────┐
│      Continue with Google           │  ←── Primary options
│      Continue with Microsoft        │
│      Continue with Apple            │
├─────────────────────────────────────┤
│        ─── or ───                   │
├─────────────────────────────────────┤
│   Email: [________________]         │  ←── Existing OTP flow
│   [Continue with email]             │
└─────────────────────────────────────┘
```

### Unified Behavior

- All methods (social + OTP) create/access the same Supabase user
- If user signs in with Google, then later with Apple using the same email → same account
- Supabase handles this via "identity linking" - one user can have multiple auth identities
- Session storage and token refresh remain unchanged (already encrypted + persisted)

### No Changes Needed To

- SQLite database schema (uses Supabase user ID, which stays the same)
- Subscription/Stripe integration (tied to Supabase user ID)
- Calendar, Jira, Tempo integrations (separate credentials)

## Technical Implementation

### Supabase OAuth

Supabase supports all three providers natively. No additional backend needed.

**Provider setup required in Supabase Dashboard:**

| Provider | Console | Credentials Needed |
|----------|---------|-------------------|
| Google | [Google Cloud Console](https://console.cloud.google.com) | Client ID, Client Secret |
| Microsoft | [Azure Portal](https://portal.azure.com) | Application ID, Client Secret |
| Apple | [Apple Developer](https://developer.apple.com) | Services ID, Key ID, Private Key |

### OAuth Redirect Flow

Same pattern as existing Google Calendar OAuth:

```
1. User clicks "Continue with Google"
2. Main process opens system browser → Google login page
3. User authenticates with Google
4. Google redirects to localhost callback (localhost:3848/auth/callback)
5. Main process captures auth code
6. Exchange code for Supabase session via supabase.auth.exchangeCodeForSession()
7. Session encrypted & stored (existing mechanism)
8. User logged in
```

**Key difference from Calendar OAuth:**
- Calendar OAuth stores tokens separately for API access
- Auth OAuth creates a Supabase session (same as current OTP flow)
- After step 7, everything works exactly like current email OTP

## Code Changes

### Main Process (`electron/auth/`)

1. **New file: `oauthServer.ts`** - Local HTTP server for OAuth callbacks
   - Reuse pattern from `googleCalendarProvider.ts`
   - Use port 3848 (to avoid conflict with calendar's 3847)
   - Handle `/auth/callback` route
   - Extract authorization code, exchange for session

2. **Modify: `supabaseAuth.ts`**
   - Add `signInWithOAuth(provider: 'google' | 'azure' | 'apple')` method
   - Generate OAuth URL via `supabase.auth.signInWithOAuth()`
   - Open system browser, wait for callback
   - Call `supabase.auth.exchangeCodeForSession(code)`

3. **Modify: `ipcHandlers.ts`**
   - Add `auth:sign-in-oauth` handler
   - Expose provider selection to renderer

### Renderer (`src/`)

4. **Modify: `LoginScreen.tsx`**
   - Add three social buttons above email input
   - Add "or" divider
   - Remove external signup redirect logic

5. **Modify: `preload.ts`**
   - Expose `signInWithOAuth(provider)` to renderer

### Configuration

6. **Supabase Dashboard**
   - Configure OAuth credentials for each provider
   - No new environment variables needed in Electron app

## UI Design

### Login Screen Layout

```
┌─────────────────────────────────────────────┐
│                                             │
│              [App Logo]                     │
│                                             │
│   ┌─────────────────────────────────────┐   │
│   │  G   Continue with Google           │   │
│   └─────────────────────────────────────┘   │
│   ┌─────────────────────────────────────┐   │
│   │  M   Continue with Microsoft        │   │
│   └─────────────────────────────────────┘   │
│   ┌─────────────────────────────────────┐   │
│   │  A   Continue with Apple            │   │
│   └─────────────────────────────────────┘   │
│                                             │
│            ────── or ──────                 │
│                                             │
│   Email                                     │
│   ┌─────────────────────────────────────┐   │
│   │  email@example.com                  │   │
│   └─────────────────────────────────────┘   │
│   ┌─────────────────────────────────────┐   │
│   │      Continue with email            │   │
│   └─────────────────────────────────────┘   │
│                                             │
│   By continuing, you agree to our           │
│   Terms of Service and Privacy Policy       │
│                                             │
└─────────────────────────────────────────────┘
```

### Button Styling

- Social buttons: Outlined/secondary style with provider brand icons
- Email button: Primary/filled style (existing button style)
- Consistent with current design tokens

## Error Handling

### OAuth Flow Errors

| Scenario | Handling |
|----------|----------|
| User closes browser/cancels OAuth | Show "Sign in cancelled" message, return to login screen |
| OAuth callback timeout (60s) | "Sign in timed out. Please try again." |
| Provider returns error | Display provider's error message (e.g., "Access denied") |
| Network failure during token exchange | "Connection failed. Please check your internet and try again." |

### Account Linking Edge Cases

| Scenario | Behavior |
|----------|----------|
| New email via Google | Create new Supabase user |
| Existing email (from OTP) signs in with Google | Link Google identity to existing user |
| Same email, different provider later | Link additional identity to same user |
| Email changed on provider side | Supabase tracks by provider ID, not email - still works |

### Platform Considerations

- **macOS/Windows/Linux**: All use system browser for OAuth (not embedded webview) - required by Google's security policy
- **Offline**: Social login requires internet; show appropriate error if offline

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `electron/auth/oauthServer.ts` | Create | Local HTTP server for OAuth callbacks |
| `electron/auth/supabaseAuth.ts` | Modify | Add `signInWithOAuth()` method |
| `electron/auth/ipcHandlers.ts` | Modify | Add `auth:sign-in-oauth` handler |
| `electron/preload.ts` | Modify | Expose OAuth method to renderer |
| `src/components/LoginScreen.tsx` | Modify | Add social buttons, remove external redirect |

## External Setup Required

1. **Supabase Dashboard**
   - Enable Google, Microsoft (Azure), and Apple providers
   - Configure OAuth credentials for each

2. **Google Cloud Console**
   - Create OAuth 2.0 credentials
   - Add `http://localhost:3848/auth/callback` to authorized redirect URIs
   - Configure OAuth consent screen

3. **Azure Portal**
   - Register application
   - Configure redirect URI
   - Generate client secret

4. **Apple Developer Portal**
   - Create Services ID
   - Configure Sign in with Apple
   - Generate private key
