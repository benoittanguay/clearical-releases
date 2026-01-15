-- Migration: Secure Subscription Fields & Add Trial Tracking
-- Created: 2026-01-14
-- Description:
--   1. Fix RLS policy vulnerability - users can no longer update subscription fields
--   2. Add trial tracking to prevent trial abuse
--   3. Add webhook event logging table for debugging
--
-- CRITICAL SECURITY FIX: The previous "Users can update their own profile" policy
-- allowed users to update ALL fields including subscription_status, giving them
-- the ability to grant themselves premium access.

-- ============================================================================
-- PART 1: Add Trial Tracking Columns
-- ============================================================================

-- Track when trial was started (server-side)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

-- Track if trial has been used (prevent abuse)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS trial_used BOOLEAN DEFAULT FALSE;

-- Track when subscription was first created
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_created_at TIMESTAMPTZ;

-- ============================================================================
-- PART 2: Create Webhook Events Table for Logging
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT UNIQUE NOT NULL,           -- Stripe event ID for idempotency
    event_type TEXT NOT NULL,                -- Event type (e.g., 'checkout.session.completed')
    user_id UUID REFERENCES auth.users(id),  -- Associated user
    processed_at TIMESTAMPTZ DEFAULT NOW(),  -- When we processed it
    data JSONB,                              -- Event data for debugging
    error TEXT                               -- Error message if processing failed
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);

-- Enable RLS on webhook_events
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Only service role can access webhook events (not users)
CREATE POLICY "Service role manages webhook events"
    ON webhook_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Block all user access to webhook events
CREATE POLICY "No user access to webhook events"
    ON webhook_events
    FOR ALL
    TO authenticated
    USING (false);

-- ============================================================================
-- PART 3: Fix RLS Policies - CRITICAL SECURITY FIX
-- ============================================================================

-- Drop the vulnerable policy that allows users to update ANY field
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- Create new policy that only allows updating NON-SUBSCRIPTION fields
-- Users can update: email, display_name, avatar_url, preferences, etc.
-- Users CANNOT update: stripe_*, subscription_*, trial_*
CREATE POLICY "Users can update their own non-subscription profile fields"
    ON profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        -- Note: PostgreSQL RLS WITH CHECK doesn't support OLD references
        -- We enforce field restrictions via a trigger instead
    );

-- Create a trigger function to prevent users from updating subscription fields
CREATE OR REPLACE FUNCTION prevent_subscription_field_updates()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow service_role to update anything
    IF current_setting('role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- For regular users, prevent updating subscription-related fields
    -- by reverting them to their original values
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.stripe_subscription_id := OLD.stripe_subscription_id;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_tier := OLD.subscription_tier;
    NEW.subscription_period_end := OLD.subscription_period_end;
    NEW.trial_started_at := OLD.trial_started_at;
    NEW.trial_used := OLD.trial_used;
    NEW.subscription_created_at := OLD.subscription_created_at;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS enforce_subscription_field_protection ON profiles;

-- Create the trigger
CREATE TRIGGER enforce_subscription_field_protection
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_subscription_field_updates();

-- ============================================================================
-- PART 4: Helper Function to Check Trial Eligibility
-- ============================================================================

-- Function to check if a user can start a trial
CREATE OR REPLACE FUNCTION can_start_trial(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = user_id
        AND trial_used = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_start_trial(UUID) TO authenticated;

-- Function to mark trial as started (only callable by service role)
CREATE OR REPLACE FUNCTION mark_trial_started(user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles
    SET
        trial_started_at = NOW(),
        trial_used = TRUE,
        subscription_status = 'trialing'
    WHERE id = user_id
    AND trial_used = FALSE;  -- Only if trial hasn't been used
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only service role can call this function
REVOKE EXECUTE ON FUNCTION mark_trial_started(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION mark_trial_started(UUID) TO service_role;

-- ============================================================================
-- PART 5: Comments for Documentation
-- ============================================================================

COMMENT ON COLUMN profiles.trial_started_at IS 'Server-side timestamp when trial was started';
COMMENT ON COLUMN profiles.trial_used IS 'Whether user has used their trial (prevents abuse)';
COMMENT ON COLUMN profiles.subscription_created_at IS 'When the first paid subscription was created';
COMMENT ON TABLE webhook_events IS 'Stripe webhook event log for debugging and idempotency';
COMMENT ON FUNCTION prevent_subscription_field_updates() IS 'Trigger function that prevents users from updating subscription-related fields';
COMMENT ON FUNCTION can_start_trial(UUID) IS 'Check if a user is eligible to start a trial';
COMMENT ON FUNCTION mark_trial_started(UUID) IS 'Mark trial as started (service role only)';
