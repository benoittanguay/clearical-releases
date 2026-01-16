-- Migration: Fix existing users with inactive status
-- Created: 2026-01-15
-- Description: Fixes users who signed up but didn't receive their trial due to
--              the prevent_subscription_field_updates trigger blocking the update
--              in migration 005.

-- Disable the trigger temporarily to allow subscription field updates
ALTER TABLE profiles DISABLE TRIGGER enforce_subscription_field_protection;

-- Update users who were created with 'inactive' status and have never had
-- an active subscription (no stripe_subscription_id) to start a 14-day trial.
UPDATE profiles
SET
    subscription_status = 'trialing',
    subscription_tier = 'premium',
    subscription_period_end = NOW() + INTERVAL '14 days',
    trial_started_at = NOW(),
    trial_used = TRUE,
    updated_at = NOW()
WHERE
    subscription_status = 'inactive'
    AND subscription_tier = 'free'
    AND stripe_subscription_id IS NULL
    AND created_at > NOW() - INTERVAL '30 days';

-- Re-enable the trigger
ALTER TABLE profiles ENABLE TRIGGER enforce_subscription_field_protection;
