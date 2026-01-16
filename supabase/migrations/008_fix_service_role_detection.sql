-- Migration: Fix service role detection in subscription trigger
-- Created: 2026-01-15
-- Description: Updates the prevent_subscription_field_updates trigger to properly
--              detect service_role access via JWT claims (used by Edge Functions).
--              The previous check using current_setting('role') doesn't work for
--              Supabase service_role API access.

CREATE OR REPLACE FUNCTION prevent_subscription_field_updates()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow service_role via JWT claim (Edge Functions with service_role key)
    IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Allow service_role via PostgreSQL role (direct database access)
    IF current_setting('role', true) = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Allow superusers (Supabase dashboard, migrations)
    IF current_setting('is_superuser', true) = 'on' THEN
        RETURN NEW;
    END IF;

    -- Allow postgres user directly
    IF current_user = 'postgres' THEN
        RETURN NEW;
    END IF;

    -- For regular users (authenticated via app), prevent updating subscription fields
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

COMMENT ON FUNCTION prevent_subscription_field_updates() IS
'Trigger function that prevents regular users from updating subscription fields.
Allows updates from: service_role (JWT claim or PostgreSQL role), superusers, postgres.
Edge Functions using service_role key are properly detected via request.jwt.claim.role.';
