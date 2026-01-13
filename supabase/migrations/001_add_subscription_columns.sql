-- Migration: Add subscription management columns to profiles table
-- Created: 2026-01-10
-- Description: Adds Stripe subscription tracking and management columns to the profiles table
--              with appropriate indexes and Row Level Security policies

-- ============================================================================
-- Add Subscription Columns to Profiles Table
-- ============================================================================

-- Add Stripe customer ID for linking to Stripe's customer records
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Add Stripe subscription ID for tracking active subscriptions
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Add subscription status (active, canceled, past_due, trialing, etc.)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive' NOT NULL;

-- Add subscription tier (free, pro, enterprise, etc.)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free' NOT NULL;

-- Add subscription period end timestamp for managing renewals and expiration
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ;

-- Add created_at and updated_at if they don't exist (best practice for tracking changes)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL;

-- ============================================================================
-- Create Indexes for Performance
-- ============================================================================

-- Index on stripe_customer_id for fast lookups when processing webhooks
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
ON profiles(stripe_customer_id)
WHERE stripe_customer_id IS NOT NULL;

-- Index on stripe_subscription_id for subscription status checks
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id
ON profiles(stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- Index on subscription_status for filtering active/inactive users
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status
ON profiles(subscription_status);

-- Index on subscription_tier for feature access checks
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier
ON profiles(subscription_tier);

-- Composite index for subscription status queries with expiration checks
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_active
ON profiles(subscription_status, subscription_period_end)
WHERE subscription_status = 'active';

-- ============================================================================
-- Add Updated At Trigger
-- ============================================================================

-- Create or replace function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists to avoid conflicts
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;

-- Create trigger to automatically update updated_at on row modification
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on profiles table if not already enabled
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent migration)
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;

-- Policy: Users can view their own profile
-- Allows authenticated users to read their own profile data
CREATE POLICY "Users can view their own profile"
    ON profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

-- Policy: Users can update their own profile
-- Allows authenticated users to update their own profile
-- Note: Stripe-related fields should ideally only be updated via backend/webhooks
-- Consider restricting these fields in application logic
CREATE POLICY "Users can update their own profile"
    ON profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Policy: Users can insert their own profile
-- Allows authenticated users to create their profile on first login
CREATE POLICY "Users can insert their own profile"
    ON profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

-- ============================================================================
-- Service Role Policies (for backend operations)
-- ============================================================================

-- Drop existing service role policies if they exist
DROP POLICY IF EXISTS "Service role can manage all profiles" ON profiles;

-- Policy: Allow service role full access for webhook processing
-- This enables backend services to update subscription data via Stripe webhooks
CREATE POLICY "Service role can manage all profiles"
    ON profiles
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON COLUMN profiles.stripe_customer_id IS 'Stripe customer ID for linking to Stripe customer records';
COMMENT ON COLUMN profiles.stripe_subscription_id IS 'Stripe subscription ID for the active subscription';
COMMENT ON COLUMN profiles.subscription_status IS 'Current subscription status: active, canceled, past_due, trialing, inactive';
COMMENT ON COLUMN profiles.subscription_tier IS 'Subscription tier: free, pro, enterprise, etc.';
COMMENT ON COLUMN profiles.subscription_period_end IS 'Timestamp when the current subscription period ends';
COMMENT ON COLUMN profiles.created_at IS 'Timestamp when the profile was created';
COMMENT ON COLUMN profiles.updated_at IS 'Timestamp when the profile was last updated';

-- ============================================================================
-- Validation Constraints (Optional but Recommended)
-- ============================================================================

-- Add check constraint to ensure subscription_status has valid values
ALTER TABLE profiles
ADD CONSTRAINT check_subscription_status
CHECK (subscription_status IN ('active', 'canceled', 'canceling', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'inactive', 'payment_failed'));

-- Add check constraint to ensure subscription_tier has valid values
-- Adjust these values based on your specific tier structure
ALTER TABLE profiles
ADD CONSTRAINT check_subscription_tier
CHECK (subscription_tier IN ('free', 'premium', 'pro', 'enterprise'));

-- ============================================================================
-- Helper Function for Checking Active Subscription
-- ============================================================================

-- Create a helper function to check if a user has an active subscription
CREATE OR REPLACE FUNCTION has_active_subscription(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = user_id
        AND subscription_status = 'active'
        AND (subscription_period_end IS NULL OR subscription_period_end > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION has_active_subscription(UUID) TO authenticated;

-- Comment on the helper function
COMMENT ON FUNCTION has_active_subscription(UUID) IS 'Checks if a user has an active subscription with valid period end date';

-- ============================================================================
-- Auto-Create Profile on User Signup
-- ============================================================================

-- Function to create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, subscription_status, subscription_tier)
    VALUES (
        NEW.id,
        NEW.email,
        'inactive',
        'free'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger to auto-create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Comment on the function
COMMENT ON FUNCTION public.handle_new_user() IS 'Creates a profile row when a new user signs up via Supabase Auth';
