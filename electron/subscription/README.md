# TimePortal Stripe Subscription Architecture

## Overview

This directory contains TimePortal's Stripe-based subscription and billing system, designed for a desktop Electron app with offline capabilities and secure payment processing.

## Architecture Decisions

### User Identity Strategy
**Decision**: Email-based identification with Stripe Customer ID mapping

**Rationale**:
- Most commercially viable approach for SaaS applications
- Natural fit for Stripe's customer model
- Enables cross-device subscription access (future enhancement)
- Familiar to users (standard email for account management)

**Implementation**:
- User enters email when subscribing
- System creates/retrieves Stripe Customer by email
- Customer ID stored locally (encrypted) for subscription checks
- Device fingerprinting for analytics/support (non-blocking)

**Alternative Considered**: Device fingerprint-only identification
- Rejected: Poor UX, doesn't support multi-device, complicated transfers

### Subscription Status Strategy
**Decision**: Hybrid approach with webhooks + periodic polling

**Rationale**:
- Webhooks provide real-time updates (best UX)
- Periodic polling (24h) ensures eventual consistency
- Offline grace period (7 days) handles network issues
- Balances freshness with resilience

**Implementation**:
```
[Stripe] → Webhook → [Local Server:3001] → [Encrypted Storage]
          ↓
[Periodic Check (24h)] → [Stripe API] → [Update Storage]
          ↓
[Offline Grace Period (7 days)] → [Cached Status]
```

**Alternatives Considered**:
- Pure webhook: Rejected (unreliable for desktop apps, requires always-on server)
- Pure polling: Rejected (delayed updates, poor UX, higher API costs)

### Offline Scenario Strategy
**Decision**: 7-day grace period with encrypted local cache

**Rationale**:
- Desktop apps often run offline (travel, poor connectivity)
- 7 days balances user experience with security
- Encrypted cache prevents tampering
- Graceful degradation to free tier after grace period

**Implementation**:
- Subscription data cached locally (encrypted)
- Last validation timestamp tracked
- Grace period calculated from last successful check
- Warning displayed when nearing expiration
- Features disabled after grace period ends

**Alternative Considered**: Require always-online
- Rejected: Poor UX for desktop app, travel scenarios

### Security Strategy
**Decision**: Stripe Customer Portal + encrypted local storage

**Rationale**:
- Customer Portal is PCI-compliant (no payment data in app)
- Encrypted cache prevents local tampering
- Webhook signatures prevent forgery
- No sensitive payment data stored locally

**Implementation**:
- All payment UI → Stripe Checkout (hosted)
- Subscription management → Stripe Customer Portal (hosted)
- Local storage → AES-256 encrypted
- Webhooks → HMAC-SHA256 signature verification
- API keys → Environment variables (never committed)

**Security Measures**:
- ✅ No payment card data in app
- ✅ No Stripe API keys in client code
- ✅ Webhook signature verification
- ✅ Encrypted local cache
- ✅ HTTPS-only API communication
- ✅ Device fingerprinting for fraud detection

## File Structure

```
subscription/
├── types.ts                   # TypeScript types and enums
├── stripeClient.ts            # Stripe API client wrapper
├── subscriptionStorage.ts     # Encrypted local storage
├── subscriptionValidator.ts   # Validation logic
├── webhookServer.ts          # Local webhook HTTP server
├── ipcHandlers.ts            # Electron IPC bridge
├── index.ts                  # Module exports
└── README.md                 # This file
```

## Core Components

### 1. StripeClient (`stripeClient.ts`)
**Purpose**: Wrapper around Stripe API

**Key Methods**:
- `getOrCreateCustomer(email)`: Find or create Stripe customer
- `getCustomerSubscription(customerId)`: Fetch active subscription
- `createCheckoutSession(email, priceId)`: Start subscription flow
- `createCustomerPortalSession(customerId)`: Open management UI
- `transformStripeSubscription()`: Convert Stripe format to app format

**Why Not Use Stripe SDK?**:
- Minimal dependencies (lighter app bundle)
- Custom error handling for Electron environment
- Direct HTTP requests for better control
- Easier to audit and debug

### 2. SubscriptionValidator (`subscriptionValidator.ts`)
**Purpose**: Core validation and feature gating logic

**Validation Modes**:
1. **Online**: Fresh Stripe API check (< 5 min old)
2. **Webhook**: Updated via webhook (most recent)
3. **Cached**: Local storage (< 24h old)
4. **Offline**: Grace period mode (< 7 days old)
5. **Offline Expired**: Grace period ended
6. **Trial**: 14-day trial period
7. **Free**: No subscription

**Key Methods**:
- `validate()`: Main validation entry point
- `hasFeature(featureName)`: Check specific feature access
- `getTrialDaysRemaining()`: Calculate trial time left

**Validation Flow**:
```
1. Check local cache
2. If stale (>24h), attempt online refresh
3. If online fails, enter offline mode
4. If offline grace period exceeded, revert to free tier
5. Return validation result with subscription data
```

### 3. SubscriptionStorage (`subscriptionStorage.ts`)
**Purpose**: Encrypted local subscription cache

**Storage Location**:
- macOS: `~/Library/Application Support/time-portal/subscription.dat`

**Security**:
- AES-256 encryption via `electron/encryption.ts`
- Machine-specific encryption key
- JSON serialization with encryption wrapper

**Key Methods**:
- `saveSubscription()`: Encrypt and save
- `getSubscription()`: Decrypt and load
- `updateDevice()`: Update device info
- `deleteSubscription()`: Remove cache

### 4. WebhookServer (`webhookServer.ts`)
**Purpose**: Local HTTP server for Stripe webhooks

**Architecture**:
- Runs on `localhost:3001` (configurable)
- Single endpoint: `POST /webhook`
- Signature verification for all events
- Event processing and cache updates

**Webhook Events Handled**:
- `customer.subscription.created`: New subscription
- `customer.subscription.updated`: Status changes
- `customer.subscription.deleted`: Cancellation
- `customer.subscription.trial_will_end`: Trial expiring
- `invoice.payment_succeeded`: Payment received
- `invoice.payment_failed`: Payment issue

**Production Setup**:
- Requires public HTTPS endpoint
- Use ngrok (development) or Cloudflare Tunnel (production)
- See `STRIPE_SETUP.md` for configuration

### 5. IPC Handlers (`ipcHandlers.ts`)
**Purpose**: Bridge main ↔ renderer process communication

**Exposed IPC Channels**:
- `subscription:validate`: Validate subscription
- `subscription:get-info`: Get full subscription object
- `subscription:get-status`: Get simplified status
- `subscription:has-feature`: Check feature access
- `subscription:get-trial-info`: Get trial details
- `subscription:create-checkout`: Start subscription flow
- `subscription:open-portal`: Open Stripe portal
- `subscription:subscribe`: Subscribe with email
- `subscription:cancel`: Cancel subscription

## Subscription Tiers

### Free Tier
**Features**:
- ✅ Basic time tracking
- ✅ Local buckets
- ✅ Screenshot capture
- ❌ Jira integration
- ❌ Tempo integration
- ❌ AI analysis
- ❌ Advanced reporting

**Status**: `none`
**Plan**: `free`

### Workplace Plan
**Features**:
- ✅ All Free Tier features
- ✅ Jira integration
- ✅ Tempo integration
- ✅ AI analysis
- ✅ Advanced reporting

**Status**: `trial`, `active`, `past_due` (grace period)
**Plan**: `workplace_monthly` or `workplace_yearly`

## Subscription States

| Status | Access | Description | UI Display |
|--------|--------|-------------|------------|
| `trial` | ✅ Full | 14-day trial | "X days left in trial" |
| `active` | ✅ Full | Paid subscription | "Workplace Plan - Active" |
| `past_due` | ✅ Full* | Payment failed, grace period | "Payment issue - update card" |
| `canceled` | ❌ Free | User canceled | "Subscription canceled" |
| `unpaid` | ❌ Free | Payment failed, grace ended | "Resubscribe to continue" |
| `incomplete` | ❌ Free | Payment pending | "Complete payment" |
| `paused` | ❌ Free | Subscription paused | "Subscription paused" |
| `none` | ❌ Free | No subscription | "Free Tier" |

*`past_due` maintains full access during Stripe's grace period (default: 7 days)

## Feature Flags

Features are controlled by the `SubscriptionFeatures` interface:

```typescript
interface SubscriptionFeatures {
  // Always available
  basicTimeTracking: boolean;    // true for all
  localBuckets: boolean;          // true for all
  screenshotCapture: boolean;     // true for all

  // Premium only
  jiraIntegration: boolean;       // true if workplace plan
  tempoIntegration: boolean;      // true if workplace plan
  aiAnalysis: boolean;            // true if workplace plan
  advancedReporting: boolean;     // true if workplace plan

  // Future
  cloudSync: boolean;             // false (not implemented)
  teamFeatures: boolean;          // false (not implemented)
}
```

### Checking Features

**In Main Process**:
```typescript
const validator = getSubscriptionValidator();
const hasJira = await validator.hasFeature('jiraIntegration');
```

**In Renderer Process**:
```typescript
const result = await window.electron.subscriptionHasFeature('jiraIntegration');
if (result.success && result.hasFeature) {
  // Show feature
}
```

## Trial Period

**Duration**: 14 days
**Features**: Full Workplace Plan access
**Conversion**: Automatic prompt 2 days before expiry
**Expiry**: Graceful degradation to Free Tier

**Trial Lifecycle**:
1. App first launch → Generate trial subscription
2. Trial subscription saved locally (encrypted)
3. 14-day countdown begins
4. Day 12: Show "2 days left" prompt
5. Day 14: Trial expires, revert to free tier
6. User can subscribe anytime during trial

## Error Handling

### Network Errors
```typescript
try {
  const result = await validator.validate();
} catch (error) {
  // Falls back to offline mode automatically
  // Grace period allows continued access
}
```

### Stripe API Errors
```typescript
// Handled gracefully in stripeClient.ts
- API down → Use cached subscription
- Rate limit → Exponential backoff
- Invalid key → Log error, use free tier
```

### Webhook Failures
```typescript
// Stripe automatically retries failed webhooks
- Failed delivery → Retry 3 times (exponential backoff)
- Continued failure → Manual intervention required
- Check Stripe Dashboard → Webhooks → Recent Events
```

## Testing

### Local Testing

1. **Start webhook server**:
```bash
npm run dev:electron
```

2. **Expose webhook endpoint**:
```bash
ngrok http 3001
```

3. **Configure Stripe webhook**:
- Dashboard → Developers → Webhooks
- Add endpoint: `https://your-ngrok-url.com/webhook`

4. **Test subscription flow**:
```typescript
// In renderer console
await window.electron.subscriptionSubscribe('test@example.com', 'workplace_monthly');
```

### Test Cards
```
Success:        4242 4242 4242 4242
Decline:        4000 0000 0000 0002
Auth Required:  4000 0027 6000 3184
```

### Test Scenarios
1. ✅ Trial creation on first launch
2. ✅ Subscribe with test card
3. ✅ Webhook received and processed
4. ✅ Subscription status updates
5. ✅ Offline mode (disconnect internet)
6. ✅ Grace period warning
7. ✅ Grace period expiry
8. ✅ Resubscribe flow
9. ✅ Cancel and revert to free tier
10. ✅ Customer Portal management

## Deployment Checklist

### Pre-Launch
- [ ] Switch to production Stripe keys
- [ ] Set up permanent webhook endpoint (Cloudflare Tunnel recommended)
- [ ] Configure Customer Portal branding
- [ ] Test real payment processing
- [ ] Verify webhook delivery in production
- [ ] Set up Stripe monitoring/alerts
- [ ] Document support procedures

### Post-Launch
- [ ] Monitor subscription creation rate
- [ ] Track trial conversion rate
- [ ] Monitor webhook health
- [ ] Review failed payment handling
- [ ] Analyze churn patterns
- [ ] Collect user feedback

## Troubleshooting

### Subscription Not Updating
```bash
# 1. Check webhook server logs
# Look for: [WebhookServer] Processing event: customer.subscription.updated

# 2. Check Stripe webhook logs
# Dashboard → Developers → Webhooks → Recent Events

# 3. Force refresh
await window.electron.subscriptionValidate();

# 4. Clear cache and revalidate
rm ~/Library/Application\ Support/time-portal/subscription.dat
# Restart app
```

### Webhook Not Received
```bash
# 1. Verify server is running
curl http://localhost:3001/webhook -X POST
# Should return signature error (not connection refused)

# 2. Verify tunnel is active
curl https://your-tunnel.com/webhook -X POST

# 3. Check Stripe webhook config
# Correct URL, HTTPS enabled, events selected

# 4. Check webhook secret
# .env file matches Stripe Dashboard value
```

### Payment Declined
```bash
# 1. Check Stripe Dashboard → Payments
# 2. View decline reason
# 3. Customer Portal → Update payment method
# 4. Retry payment automatically (Stripe)
```

## Future Enhancements

### Planned
- [ ] Multi-device subscription sync
- [ ] Team/Organization plans
- [ ] Usage-based billing (seats)
- [ ] Promotional codes/coupons
- [ ] Annual discount automation
- [ ] Referral program

### Considered
- [ ] Cryptocurrency payments (Stripe supports)
- [ ] Alternative payment methods (ACH, SEPA)
- [ ] Volume pricing tiers
- [ ] Educational/Non-profit discounts
- [ ] Free trial extension for support cases

## Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Subscriptions](https://stripe.com/docs/billing/subscriptions/overview)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe Customer Portal](https://stripe.com/docs/billing/subscriptions/customer-portal)
- [Stripe Testing](https://stripe.com/docs/testing)

## Support

For issues with the subscription system:
1. Check logs: `DEBUG=subscription:* npm run dev:electron`
2. Review Stripe Dashboard events
3. Test with Stripe test mode first
4. See `/STRIPE_SETUP.md` for configuration help
