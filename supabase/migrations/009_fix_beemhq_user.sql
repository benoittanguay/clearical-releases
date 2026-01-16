-- Migration: Fix benoit.tanguay@beemhq.com user
-- Created: 2026-01-15
-- Description: Manually fix the specific user who is still showing as inactive

-- Disable the trigger to allow subscription field updates
ALTER TABLE profiles DISABLE TRIGGER enforce_subscription_field_protection;

-- Update the specific user to trialing status
UPDATE profiles
SET
    subscription_status = 'trialing',
    subscription_tier = 'premium',
    subscription_period_end = NOW() + INTERVAL '14 days',
    trial_started_at = NOW(),
    trial_used = TRUE,
    updated_at = NOW()
WHERE
    email = 'benoit.tanguay@beemhq.com';

-- Re-enable the trigger
ALTER TABLE profiles ENABLE TRIGGER enforce_subscription_field_protection;
