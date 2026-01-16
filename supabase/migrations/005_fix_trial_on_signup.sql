-- Migration: Fix trial assignment on user signup
-- Created: 2026-01-15
-- Description: Updates the handle_new_user() trigger to create new users with
--              a 14-day trial of the Workplace plan instead of 'inactive' status.
--              Also fixes existing users who were incorrectly created with 'inactive' status.

-- ============================================================================
-- Update handle_new_user() Function
-- ============================================================================

-- Replace the function to create users with trialing status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        subscription_status,
        subscription_tier,
        subscription_period_end
    )
    VALUES (
        NEW.id,
        NEW.email,
        'trialing',
        'premium',
        NOW() + INTERVAL '14 days'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment on the updated function
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a profile row with 14-day Workplace trial when a new user signs up via Supabase Auth';

-- ============================================================================
-- Fix Existing Users with 'inactive' Status
-- ============================================================================

-- IMPORTANT: The prevent_subscription_field_updates trigger blocks updates
-- to subscription fields unless running as service_role. Migrations run as
-- postgres, so we need to temporarily disable the trigger.

-- Disable the trigger temporarily
ALTER TABLE profiles DISABLE TRIGGER enforce_subscription_field_protection;

-- Update users who were created with 'inactive' status and have never had
-- an active subscription (no stripe_subscription_id) to start a 14-day trial.
-- This specifically helps users like benoit.tanguay@beemhq.com who signed up
-- but didn't receive their trial.

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
    AND created_at > NOW() - INTERVAL '30 days';  -- Only fix recent signups

-- Re-enable the trigger
ALTER TABLE profiles ENABLE TRIGGER enforce_subscription_field_protection;
