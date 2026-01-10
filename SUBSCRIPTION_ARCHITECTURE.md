# TimePortal Stripe Subscription Architecture

## Executive Summary

This document outlines the Stripe-based subscription and billing architecture implemented for TimePortal, a desktop Electron app with offline capabilities and premium feature gating.

**Key Decision**: Email-based user identification with Stripe Customer Portal for all payment operations, hybrid webhook + polling for subscription updates, and 7-day offline grace period.

---

## Critical Decisions

### 1. User Identity: Email-Based with Stripe Customer ID

**Decision**: Users are identified by email address, mapped to Stripe Customer IDs

**Rationale**:
- Industry standard for SaaS applications
- Natural fit for Stripe's customer model
- Enables future multi-device support
- Familiar user experience (email = account)
- Supports subscription recovery and transfers

**Implementation**:
```typescript
// User subscribes with email
const customer = await stripeClient.getOrCreateCustomer(email, deviceInfo);
// Customer ID stored locally (encrypted)
// All future operations use customer ID
```

**Alternative Rejected**: Device fingerprint-only
- Poor UX (can't transfer subscription to new device)
- Complicated support scenarios
- Doesn't support multi-device plans

---

### 2. Subscription Status: Hybrid Webhooks + Polling

**Decision**: Real-time webhooks for updates, with 24-hour polling as fallback

**Rationale**:
- **Webhooks**: Best UX, immediate updates, but unreliable for desktop apps
- **Polling**: Guaranteed to work, but delayed updates and API costs
- **Hybrid**: Combines benefits, provides redundancy

**Architecture**:
```
┌─────────────┐
│   Stripe    │
└──────┬──────┘
       │
       ├─────webhook─────► ┌──────────────────┐
       │                   │  Webhook Server  │
       │                   │  (localhost:3001)│
       │                   └────────┬─────────┘
       │                            │
       └──periodic poll (24h)───────┤
                                    ▼
                          ┌───────────────────┐
                          │ Encrypted Storage │
                          │  (subscription.dat)│
                          └───────────────────┘
```

**Webhook Events Processed**:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

**Polling Interval**: 24 hours (configurable)

**Alternative Rejected**: Webhooks-only
- Requires always-on server (impractical for Electron)
- Unreliable (firewall issues, network changes)
- Complicated deployment

**Alternative Rejected**: Polling-only
- Poor UX (delayed subscription activation)
- Higher Stripe API costs
- No real-time payment failure notifications

---

### 3. Offline Scenarios: 7-Day Grace Period

**Decision**: Allow offline usage for 7 days before reverting to free tier

**Rationale**:
- Desktop apps are often offline (travel, poor connectivity, network issues)
- 7 days balances user experience with security/revenue protection
- Matches industry standard (Google Workspace, Adobe, etc.)
- Encrypted local cache prevents tampering

**Offline Flow**:
```
Online Validation Success
  ↓
Cache subscription (encrypted)
  ↓
24 hours pass → Try online validation
  ↓
Network unavailable
  ↓
Enter offline mode (use cache)
  ↓
7 days pass
  ↓
Offline grace period expired
  ↓
Revert to free tier
```

**Grace Period Warnings**:
- Day 5: "Connection required soon"
- Day 6: "1 day remaining"
- Day 7: "Features will be disabled"

**Alternative Rejected**: Always-online requirement
- Poor UX for desktop app
- Blocks legitimate use cases (travel, temporary network issues)
- Negative customer feedback risk

**Alternative Rejected**: No grace period (instant offline lock)
- Too aggressive, frustrates users
- Support burden from connectivity issues
- Risk of false positives

---

### 4. Security: Stripe-Hosted UI + Encrypted Cache

**Decision**: All payment UI through Stripe Checkout and Customer Portal

**Rationale**:
- **PCI Compliance**: Stripe handles all card data (Level 1 PCI DSS)
- **Security**: No payment data in app = minimal security surface
- **Maintenance**: Stripe maintains compliance, updates security
- **Trust**: Users recognize Stripe UI = higher conversion

**Payment Flows**:
1. **Subscribe**: Open Stripe Checkout in browser
2. **Manage**: Open Stripe Customer Portal in browser
3. **Update Payment**: Handled in Customer Portal
4. **Cancel**: Handled in Customer Portal

**Local Security**:
- Subscription cache → AES-256 encrypted
- Stripe API keys → Environment variables (never in code)
- Webhook signatures → HMAC-SHA256 verified
- Device fingerprint → Hashed (irreversible)

**What's Stored Locally**:
```typescript
{
  stripeCustomerId: "cus_xxx",  // Not sensitive
  email: "user@example.com",    // Encrypted
  status: "active",             // Encrypted
  plan: "workplace_monthly",    // Encrypted
  currentPeriodEnd: 1234567890, // Encrypted
  features: {...}               // Encrypted
}
```

**What's NOT Stored**:
- Payment methods
- Card numbers
- Billing addresses
- Payment history (available in Customer Portal)

**Alternative Rejected**: Custom payment UI in app
- Requires PCI compliance certification
- Liability for payment data breaches
- Development/maintenance burden
- Lower user trust

---

## Architecture Components

### File Structure
```
electron/subscription/
├── types.ts                   # TypeScript interfaces
├── stripeClient.ts            # Stripe API wrapper
├── subscriptionStorage.ts     # Encrypted local cache
├── subscriptionValidator.ts   # Validation logic
├── webhookServer.ts          # HTTP server for webhooks
├── ipcHandlers.ts            # Electron IPC bridge
└── index.ts                  # Module exports
```

### Component Responsibilities

**StripeClient** (`stripeClient.ts`)
- Wrapper around Stripe API
- Customer creation/retrieval
- Subscription fetching
- Checkout session creation
- Customer Portal session creation
- HTTP request handling with error recovery

**SubscriptionValidator** (`subscriptionValidator.ts`)
- Core validation logic
- Feature gating decisions
- Trial period management
- Offline mode handling
- Cache validation

**SubscriptionStorage** (`subscriptionStorage.ts`)
- Encrypted file I/O
- Device info management
- Cache invalidation
- Corruption recovery

**WebhookServer** (`webhookServer.ts`)
- HTTP server on localhost:3001
- Signature verification
- Event processing
- Cache updates

**IPC Handlers** (`ipcHandlers.ts`)
- Renderer ↔ Main bridge
- API for React components
- Feature flag queries

---

## Subscription Tiers

### Free Tier
**Price**: $0
**Features**:
- ✅ Basic time tracking
- ✅ Local buckets
- ✅ Screenshot capture
- ✅ Activity tracking
- ❌ Jira integration
- ❌ Tempo integration
- ❌ AI analysis
- ❌ Advanced reporting

**Target Audience**: Individual users, evaluation, basic needs

### Workplace Plan
**Price**: $[TBD]/month or $[TBD]/year
**Features**:
- ✅ All Free Tier features
- ✅ Jira integration
- ✅ Tempo Timesheets sync
- ✅ AI-powered screenshot analysis
- ✅ Advanced reporting & exports
- ✅ Premium support

**Target Audience**: Professional developers, consultants, teams

**Trial**: 14 days, full features, no credit card required

---

## Subscription States

| Status | Access | Description | UI Message |
|--------|--------|-------------|------------|
| `trial` | Full | 14-day trial period | "14 days left in trial" |
| `active` | Full | Paid subscription | "Workplace Plan" |
| `past_due` | Full* | Payment failed, Stripe grace period | "Payment issue - update card" |
| `canceled` | Free | User canceled subscription | "Subscription canceled on [date]" |
| `unpaid` | Free | Payment failed, grace period ended | "Resubscribe to continue premium features" |
| `incomplete` | Free | Initial payment pending | "Complete payment to activate" |
| `none` | Free | No subscription | "Free Tier" |

*`past_due` maintains full access during Stripe's internal grace period (default: 7 days configurable in Stripe Dashboard)

---

## Feature Flags Implementation

### Checking Features

**In Renderer (React)**:
```typescript
const { data } = await window.electron.subscriptionHasFeature('jiraIntegration');
if (data?.hasFeature) {
  // Show Jira settings
} else {
  // Show upgrade prompt
}
```

**In Main Process**:
```typescript
const validator = getSubscriptionValidator();
const hasFeature = await validator.hasFeature('jiraIntegration');
```

### Feature Matrix
```typescript
interface SubscriptionFeatures {
  // Free tier (always true)
  basicTimeTracking: boolean;
  localBuckets: boolean;
  screenshotCapture: boolean;

  // Workplace Plan only
  jiraIntegration: boolean;
  tempoIntegration: boolean;
  aiAnalysis: boolean;
  advancedReporting: boolean;

  // Future
  cloudSync: boolean;
  teamFeatures: boolean;
}
```

---

## Webhook Setup for Production

### Option 1: Cloudflare Tunnel (Recommended for Electron)
**Pros**:
- Free
- Reliable
- No port forwarding
- Automatic SSL
- Works behind NAT/firewall

**Setup**:
```bash
# Install
brew install cloudflare/cloudflare/cloudflared

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create timeportal

# Configure as system service (runs on boot)
# Point Stripe webhook to: https://your-tunnel.cloudflareaccess.com/webhook
```

### Option 2: Cloud Function (Alternative)
**Pros**:
- No local server required
- Scales automatically
- Built-in monitoring

**Cons**:
- Monthly cost (~$5-20)
- Additional deployment complexity

**Setup**:
- Deploy webhook handler to AWS Lambda/Google Cloud Functions
- Point Stripe webhook to cloud function URL
- Cloud function updates subscription via Stripe API
- App polls for updates

### Option 3: VPS Server (Traditional)
**Pros**:
- Full control
- Predictable costs

**Cons**:
- Requires server maintenance
- Higher complexity
- Monthly hosting cost

---

## Testing Checklist

### Development
- [ ] Stripe test mode configured
- [ ] ngrok/Cloudflare tunnel running
- [ ] Webhook endpoint added to Stripe Dashboard
- [ ] Environment variables set (.env file)

### Test Scenarios
- [ ] 1. First launch → Trial starts
- [ ] 2. Subscribe with test card (4242 4242 4242 4242)
- [ ] 3. Webhook received → Subscription activates
- [ ] 4. Premium features unlock
- [ ] 5. Offline mode → Features still work
- [ ] 6. Grace period warning appears (simulate 6 days offline)
- [ ] 7. Grace period expires → Revert to free tier
- [ ] 8. Open Customer Portal → Manage subscription
- [ ] 9. Cancel subscription → Revert to free tier
- [ ] 10. Payment fails → `past_due` status, grace period

### Production Pre-Launch
- [ ] Switch to production Stripe keys
- [ ] Production webhook endpoint configured
- [ ] Customer Portal branding configured
- [ ] Real payment test successful
- [ ] Webhook delivery verified in production
- [ ] Monitoring/alerting set up
- [ ] Support procedures documented

---

## Cost Analysis

### Stripe Fees
- **Credit Card**: 2.9% + $0.30 per transaction
- **International**: +1.5%
- **Currency Conversion**: +1%

### Example
Monthly subscription at $20:
- Stripe fee: $0.88
- Your revenue: $19.12 (95.6%)

### Webhooks
- First 100,000/month: Free
- Additional: $0.0000025 per event

### Typical Monthly Costs (1,000 customers)
- Subscriptions: $0 (billed per transaction)
- Webhooks: $0 (under 100k events)
- Customer Portal: $0
- **Total Platform Fees**: ~$880 (from transaction fees)

---

## Error Handling

### Network Failures
- **Webhook doesn't arrive**: Polling catches it within 24h
- **API call fails**: Use cached subscription (offline mode)
- **Webhook server down**: Stripe retries 3x with exponential backoff

### Payment Failures
- **First failure**: Stripe sends `invoice.payment_failed` → Show warning
- **Retry attempts**: Stripe retries 3x over 7 days (configurable)
- **Final failure**: Status → `unpaid`, features disabled

### Corruption/Tampering
- **Encrypted cache corrupted**: Delete file, force online validation
- **Webhook signature invalid**: Reject event, log security incident
- **Subscription modified locally**: Encryption prevents this

---

## Troubleshooting Guide

### Subscription Not Updating

**Symptoms**: Payment succeeded but features not unlocked

**Diagnosis**:
```bash
# 1. Check webhook logs
[WebhookServer] Processing event: customer.subscription.updated

# 2. Check Stripe Dashboard
Developers → Webhooks → Recent Events

# 3. Force refresh
await window.electron.subscriptionValidate();
```

### Webhook Not Received

**Symptoms**: Events in Stripe Dashboard but not in app

**Diagnosis**:
```bash
# 1. Test server
curl http://localhost:3001/webhook -X POST
# Should return signature error (not connection refused)

# 2. Test tunnel
curl https://your-tunnel.com/webhook -X POST

# 3. Check webhook config
# - Correct URL
# - HTTPS enabled
# - Events selected

# 4. Verify webhook secret
echo $STRIPE_WEBHOOK_SECRET
# Should match Stripe Dashboard value
```

### Offline Mode Issues

**Symptoms**: Features disabled despite recent payment

**Diagnosis**:
```bash
# Check cache
cat ~/Library/Application\ Support/time-portal/subscription.dat
# Should contain encrypted data

# Check last validation
# In app console:
const sub = await window.electron.subscriptionGetInfo();
console.log(new Date(sub.data.subscription.lastValidated));

# Force online validation
await window.electron.subscriptionValidate();
```

---

## Future Enhancements

### Planned (Next 6 Months)
- [ ] Multi-device subscription sync
- [ ] Team/Organization plans
- [ ] Usage analytics dashboard
- [ ] Promotional codes/coupons
- [ ] Annual discount automation

### Considered (Next 12 Months)
- [ ] Volume pricing tiers
- [ ] Educational/Non-profit discounts
- [ ] Cryptocurrency payments (Stripe supports)
- [ ] Alternative payment methods (ACH, SEPA)
- [ ] Referral program

---

## Compliance & Legal

### PCI Compliance
- ✅ Stripe is Level 1 PCI DSS compliant
- ✅ No card data stored or processed in app
- ✅ All payment UI → Stripe Checkout
- ✅ No PCI compliance required for app

### Data Privacy (GDPR/CCPA)
- ✅ Stripe GDPR compliant
- ✅ Customer Portal provides data export
- ✅ Subscription data encrypted locally
- ✅ Email addresses stored (with consent)

**User Rights**:
- Access: Customer Portal
- Export: Customer Portal → Invoice history
- Deletion: Contact support (manual process)
- Rectification: Customer Portal → Update billing info

### Terms of Service Requirements
```
Required disclosures:
- Subscription automatically renews
- Cancel anytime through Customer Portal
- Refund policy (define based on your terms)
- Data retention policy
- Subscription cancellation takes effect at period end
```

---

## Support & Resources

### Documentation
- [Stripe Subscriptions Guide](https://stripe.com/docs/billing/subscriptions/overview)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)
- [Customer Portal Setup](https://stripe.com/docs/billing/subscriptions/customer-portal)
- [Testing Checklist](https://stripe.com/docs/testing)

### Internal
- Setup guide: `/STRIPE_SETUP.md`
- Architecture details: `/electron/subscription/README.md`
- Environment variables: `/.env.example`

### Support Channels
- Stripe Support: support@stripe.com
- Stripe Dashboard: dashboard.stripe.com
- TimePortal issues: Internal ticketing system

---

## Migration from Paddle (Legacy)

The previous Paddle-based licensing system is being phased out. Both systems run in parallel during transition:

**Migration Path**:
1. New users → Stripe only
2. Existing Paddle users → Continue until renewal
3. Renewal → Migrate to Stripe (with discount code)
4. Grace period → 90 days to migrate
5. After grace → Paddle deprecated, Stripe required

**Code Cleanup** (after migration complete):
- Remove `/electron/licensing/` directory
- Remove Paddle IPC handlers
- Remove Paddle environment variables
- Update documentation

---

## Key Takeaways

1. **Email-based identity** provides the best user experience and supports future growth
2. **Hybrid webhooks + polling** combines real-time updates with guaranteed delivery
3. **7-day offline grace period** balances UX with revenue protection
4. **Stripe-hosted UI** eliminates PCI compliance burden and increases trust
5. **Encrypted local cache** prevents tampering while enabling offline access

This architecture prioritizes:
- ✅ User experience (trial, offline support, familiar checkout)
- ✅ Security (PCI compliance, encryption, signature verification)
- ✅ Reliability (hybrid validation, offline grace period)
- ✅ Commercial viability (conversion optimization, churn reduction)
- ✅ Maintainability (minimal custom code, Stripe handles complexity)
