# Stripe Subscription Setup Guide

## Overview

TimePortal uses Stripe for subscription management with a two-tier pricing model:
- **Free Tier**: Basic time tracking with local buckets
- **Workplace Plan**: Premium features including Jira/Tempo integrations and AI analysis

## Architecture

### User Identity
- **Email-based identification**: Users are identified by their email address
- **Stripe Customer ID**: Mapped to email for subscription tracking
- **Device Fingerprinting**: Tracks which devices are using the subscription (for analytics/support)

### Subscription Status
- **Hybrid Approach**:
  - Stripe webhooks for real-time updates
  - Periodic API polling (every 24 hours) for verification
  - Offline grace period (7 days) for network issues

### Offline Scenarios
- Cached subscription data stored locally (encrypted)
- 7-day offline grace period for continued premium access
- After grace period, features revert to free tier until online verification

### Security
- **Stripe Customer Portal**: Users manage subscriptions through Stripe's hosted UI
- **Encrypted Local Storage**: Subscription cache stored with AES-256 encryption
- **Webhook Signature Verification**: All webhook events are cryptographically verified
- **No Payment Data**: All payment information handled by Stripe

## Setup Steps

### 1. Create Stripe Account

1. Sign up at [stripe.com](https://stripe.com)
2. Complete business verification
3. Enable test mode for development

### 2. Configure Products and Prices

#### In Stripe Dashboard:

1. Go to **Products** → **Add Product**

2. Create "TimePortal Workplace Plan" product:
   - Name: `TimePortal Workplace Plan`
   - Description: `Premium time tracking with Jira/Tempo integration`

3. Add two prices:
   - **Monthly**: $[YOUR_PRICE]/month
   - **Yearly**: $[YOUR_PRICE]/year (typically 20% discount)

4. Note the Price IDs (format: `price_xxxxxxxxxxxxx`)

### 3. Set Up Environment Variables

Create or update your `.env` file:

```bash
# Stripe API Keys (from Dashboard → Developers → API Keys)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx

# Stripe Webhook Secret (from Dashboard → Developers → Webhooks)
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx

# Stripe Price IDs (from Dashboard → Products)
STRIPE_PRICE_WORKPLACE_MONTHLY=price_xxxxxxxxxxxxx
STRIPE_PRICE_WORKPLACE_YEARLY=price_xxxxxxxxxxxxx
```

### 4. Configure Webhooks

#### Development (Using ngrok or Cloudflare Tunnel)

**Option A: ngrok (Quick Start)**
```bash
# Install ngrok
brew install ngrok

# Start TimePortal (webhook server runs on port 3001)
npm run dev:electron

# In another terminal, expose webhook endpoint
ngrok http 3001

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

**Option B: Cloudflare Tunnel (Recommended for Production)**
```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create timeportal

# Start tunnel
cloudflared tunnel --url http://localhost:3001

# Copy the HTTPS URL
```

#### Add Webhook in Stripe Dashboard

1. Go to **Developers** → **Webhooks** → **Add Endpoint**
2. Endpoint URL: `https://your-tunnel-url.com/webhook`
3. Select events to listen to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy the webhook signing secret to your `.env` file

### 5. Configure Customer Portal

1. Go to **Settings** → **Billing** → **Customer Portal**
2. Enable the Customer Portal
3. Configure:
   - ✅ Allow customers to update subscriptions
   - ✅ Allow customers to cancel subscriptions
   - ✅ Show invoice history
   - Return URL: `timeportal://subscription/portal-return`

### 6. Testing

#### Test Credit Cards
Use Stripe's test cards for development:
- **Success**: `4242 4242 4242 4242` (any future expiry, any CVC)
- **Decline**: `4000 0000 0000 0002`
- **Requires authentication**: `4000 0027 6000 3184`

#### Test Subscription Flow

1. **Start Trial**:
   ```bash
   npm run dev:electron
   ```
   - App should show 14-day trial on first launch

2. **Subscribe**:
   - Click "Upgrade to Workplace Plan"
   - Enter email and test card
   - Complete checkout
   - Verify webhook received in logs

3. **Manage Subscription**:
   - Click "Manage Subscription"
   - Opens Stripe Customer Portal
   - Test cancellation/reactivation

4. **Offline Mode**:
   - Disconnect from internet
   - Verify premium features still work
   - Check grace period warning

## Production Deployment

### 1. Switch to Production Keys

Update `.env` with production keys:
```bash
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx
```

### 2. Webhook Endpoint

For production, you need a permanent webhook endpoint. Options:

**Option A: Cloud Function (Recommended)**
- Deploy webhook handler to AWS Lambda/Google Cloud Functions
- Point Stripe webhook to cloud function URL
- Cloud function updates subscription via Stripe API

**Option B: Dedicated Server**
- Set up small VPS to run webhook server
- Use reverse proxy (nginx) with SSL
- Point Stripe webhook to server URL

**Option C: Cloudflare Tunnel (Easiest)**
- Set up permanent Cloudflare Tunnel
- Configure tunnel to run as system service
- Most reliable option for Electron apps

### 3. Testing Before Launch

1. **Payment Processing**:
   - Test real credit card charges
   - Verify funds appear in Stripe account
   - Test refunds

2. **Webhook Reliability**:
   - Test network interruptions
   - Verify retry mechanism works
   - Check webhook logs in Stripe Dashboard

3. **Subscription Lifecycle**:
   - Test trial → paid conversion
   - Test subscription renewal
   - Test payment failure handling
   - Test cancellation flow

## Feature Flags

Premium features are controlled by subscription status:

```typescript
// Free Tier (always available)
- basicTimeTracking: true
- localBuckets: true
- screenshotCapture: true

// Workplace Plan (subscription required)
- jiraIntegration: true
- tempoIntegration: true
- aiAnalysis: true
- advancedReporting: true
```

### Checking Features in Code

```typescript
// In renderer process
const hasJira = await window.electron.subscriptionHasFeature('jiraIntegration');

if (hasJira) {
  // Show Jira UI
} else {
  // Show upgrade prompt
}
```

## Subscription States

| Status | Premium Access | UI Display |
|--------|---------------|------------|
| `trial` | ✅ Yes | "14 days left in trial" |
| `active` | ✅ Yes | "Workplace Plan - Active" |
| `past_due` | ✅ Yes (grace) | "Payment issue - please update" |
| `canceled` | ❌ No | "Subscription canceled" |
| `unpaid` | ❌ No | "Payment failed - resubscribe" |
| `none` | ❌ No | "Free Tier" |

## Troubleshooting

### Webhook Not Received

1. Check webhook server is running:
   ```bash
   curl http://localhost:3001/webhook -X POST
   # Should return 404 or signature error (not connection refused)
   ```

2. Check tunnel is active:
   ```bash
   curl https://your-tunnel.com/webhook -X POST
   # Should reach local server
   ```

3. Check Stripe webhook logs:
   - Dashboard → Developers → Webhooks → [Your endpoint]
   - View recent deliveries and errors

### Subscription Not Updating

1. Check subscription storage:
   - macOS: `~/Library/Application Support/time-portal/subscription.dat`
   - Delete file to reset (will require re-validation)

2. Force online validation:
   ```typescript
   await window.electron.subscriptionValidate();
   ```

3. Check logs:
   ```bash
   # Enable debug logging
   DEBUG=subscription:* npm run dev:electron
   ```

### Payment Issues

1. Check Stripe Dashboard → Payments
2. View customer portal → Payment methods
3. Test with different card
4. Check webhook for `invoice.payment_failed` events

## Cost Analysis

### Stripe Fees
- **Standard**: 2.9% + $0.30 per transaction
- **International cards**: +1.5%
- **Currency conversion**: +1%

### Example Pricing
If you charge $20/month:
- Stripe fee: $0.88
- Your revenue: $19.12 (95.6%)

### Webhooks
- First 100,000 events/month: **Free**
- Additional: $0.0000025 per event

## Compliance

### PCI Compliance
- ✅ Stripe handles all card data (Level 1 PCI DSS compliant)
- ✅ No card data stored in your app
- ✅ Use Stripe.js for checkout (no PCI requirements)

### Data Privacy
- Customer emails stored locally (encrypted)
- Stripe Customer ID stored (not sensitive)
- No payment methods stored locally

### GDPR/Privacy
- Stripe is GDPR compliant
- Users can export data via Customer Portal
- Provide data deletion flow if required

## Support

### Stripe Support
- Email: support@stripe.com
- Dashboard → Help
- [Stripe Documentation](https://stripe.com/docs)

### TimePortal Subscription System
- Located in: `/electron/subscription/`
- Main validator: `subscriptionValidator.ts`
- IPC handlers: `ipcHandlers.ts`
- Webhook server: `webhookServer.ts`

## Next Steps

After setting up Stripe:

1. **Create Marketing Pages**:
   - Pricing page
   - Feature comparison (Free vs Workplace)
   - Upgrade prompts in app

2. **Analytics**:
   - Track trial conversions
   - Monitor churn rate
   - A/B test pricing

3. **Customer Success**:
   - Email onboarding sequence
   - In-app tutorial for premium features
   - Proactive support for payment issues

4. **Expansion**:
   - Add team plans
   - Volume pricing
   - Annual discounts
   - Promotional codes
