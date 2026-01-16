-- Migration: Allow admin subscription updates from Supabase dashboard
-- Created: 2026-01-15
-- Description: Updates the prevent_subscription_field_updates trigger to allow
--              superusers (postgres) to update subscription fields directly from
--              the Supabase dashboard. This enables manual overrides for friends
--              and family without needing to disable/enable triggers.

-- Update the trigger function to allow superuser access
CREATE OR REPLACE FUNCTION prevent_subscription_field_updates()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow service_role to update anything (webhooks, edge functions)
    IF current_setting('role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Allow superusers to update anything (Supabase dashboard, migrations)
    -- This enables manual subscription overrides for friends & family
    IF current_setting('is_superuser', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Also check if running as postgres user directly
    IF current_user = 'postgres' THEN
        RETURN NEW;
    END IF;

    -- For regular users (authenticated via app), prevent updating subscription fields
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

-- Add comment explaining admin access
COMMENT ON FUNCTION prevent_subscription_field_updates() IS
'Trigger function that prevents regular users from updating subscription fields.
Allows updates from: service_role (webhooks), superusers (dashboard), postgres (migrations).
Use Supabase dashboard SQL editor to manually grant subscriptions to friends & family.';
