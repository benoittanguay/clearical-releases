# Supabase Edge Functions

These Edge Functions handle Stripe operations securely on the server side.
The Stripe secret key is stored in Supabase secrets, never exposed to the client.

## Functions

- **stripe-checkout** - Creates Stripe Checkout sessions for subscriptions
- **stripe-portal** - Creates Stripe Customer Portal sessions for subscription management
- **stripe-webhook** - Handles Stripe webhook events for subscription status updates

## Deployment

### Prerequisites

1. Install Supabase CLI: `npm install -g supabase`
2. Login to Supabase: `supabase login`
3. Link your project: `supabase link --project-ref jiuxhwrgmexhhpoaazbj`

### Set Required Secrets

```bash
# Stripe Secret Key (from Stripe Dashboard > Developers > API keys)
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx

# Stripe Webhook Secret (from Stripe Dashboard > Developers > Webhooks)
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx

# Stripe Price IDs (from Stripe Dashboard > Products)
supabase secrets set STRIPE_PRICE_MONTHLY=price_xxx
supabase secrets set STRIPE_PRICE_YEARLY=price_xxx
```

### Deploy Functions

```bash
# Deploy all functions
supabase functions deploy stripe-checkout
supabase functions deploy stripe-portal
supabase functions deploy stripe-webhook

# Or deploy all at once
supabase functions deploy
```

## Stripe Webhook Setup

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://jiuxhwrgmexhhpoaazbj.supabase.co/functions/v1/stripe-webhook`
3. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the webhook signing secret and set it in Supabase secrets

## Database Schema

Ensure your `profiles` table has these columns:

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;
```

## Testing

Use Stripe CLI for local webhook testing:

```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
```
