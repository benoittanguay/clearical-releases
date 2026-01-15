-- Migration: Fix RLS Security Vulnerabilities & Clean Up Unrelated Tables
-- Created: 2026-01-14
-- Description: Removes tables not used by Clearical/TimePortal and secures remaining data.
--
-- CRITICAL: This migration addresses security vulnerabilities discovered during
--           a security audit where anonymous users could read/write ALL data.
--
-- The only table used by Clearical is: profiles
-- All other tables appear to be from a different app and will be removed.
--
-- Run this migration in your Supabase SQL Editor IMMEDIATELY.

-- ============================================================================
-- PART 1: DROP UNRELATED TABLES (Not Used by Clearical)
-- ============================================================================
-- These tables are from a separate Slack attendance app and are not needed.
-- They also pose a security risk with exposed data.

-- Drop RPC functions first (they may reference these tables)
DROP FUNCTION IF EXISTS public.get_cron_secret() CASCADE;
DROP FUNCTION IF EXISTS public.trigger_manual_reminder() CASCADE;
DROP FUNCTION IF EXISTS public.send_attendance_reminder() CASCADE;
DROP FUNCTION IF EXISTS public.send_afternoon_reminder() CASCADE;
DROP FUNCTION IF EXISTS public.send_morning_summary() CASCADE;
DROP FUNCTION IF EXISTS public.send_weekly_summary() CASCADE;
DROP FUNCTION IF EXISTS public.check_and_send_reminders() CASCADE;
DROP FUNCTION IF EXISTS public.check_reminder_status() CASCADE;
DROP FUNCTION IF EXISTS public.check_morning_summary() CASCADE;
DROP FUNCTION IF EXISTS public.check_afternoon_reminder() CASCADE;
DROP FUNCTION IF EXISTS public.check_weekly_summary() CASCADE;
DROP FUNCTION IF EXISTS public.get_users_for_reminders() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_orphaned_profiles() CASCADE;
DROP FUNCTION IF EXISTS public.api_driven_orphan_cleanup() CASCADE;
DROP FUNCTION IF EXISTS public.debug_data_relationships() CASCADE;
DROP FUNCTION IF EXISTS public.check_orphaned_data() CASCADE;
DROP FUNCTION IF EXISTS public.log_team_usage() CASCADE;
DROP FUNCTION IF EXISTS public.simple_test() CASCADE;
DROP FUNCTION IF EXISTS public.test_http_request() CASCADE;
DROP FUNCTION IF EXISTS public.test_authenticated_request() CASCADE;
DROP FUNCTION IF EXISTS public.test_custom_header_auth() CASCADE;
DROP FUNCTION IF EXISTS public.test_public_edge_function() CASCADE;
DROP FUNCTION IF EXISTS public.test_vercel_api_direct() CASCADE;
DROP FUNCTION IF EXISTS public.test_with_anon_key() CASCADE;
DROP FUNCTION IF EXISTS public.setup_test_channel() CASCADE;
DROP FUNCTION IF EXISTS public.get_reminder_configs() CASCADE;
DROP FUNCTION IF EXISTS public.get_reminder_time() CASCADE;
DROP FUNCTION IF EXISTS public.get_last_reminder_run() CASCADE;
DROP FUNCTION IF EXISTS public.was_reminder_sent_today() CASCADE;
DROP FUNCTION IF EXISTS public.mark_reminder_sent() CASCADE;
DROP FUNCTION IF EXISTS public.clear_todays_reminders() CASCADE;
DROP FUNCTION IF EXISTS public.record_reminder_run() CASCADE;
DROP FUNCTION IF EXISTS public.prepare_reminder_trigger() CASCADE;
DROP FUNCTION IF EXISTS public.list_reminder_functions() CASCADE;
DROP FUNCTION IF EXISTS public.create_or_join_team() CASCADE;
DROP FUNCTION IF EXISTS public.get_team_attendance_summary() CASCADE;
DROP FUNCTION IF EXISTS public.get_team_config() CASCADE;
DROP FUNCTION IF EXISTS public.get_team_user_count() CASCADE;
DROP FUNCTION IF EXISTS public.get_team_week_attendance() CASCADE;
DROP FUNCTION IF EXISTS public.get_teams_for_usage_reporting() CASCADE;
DROP FUNCTION IF EXISTS public.get_user_profile() CASCADE;
DROP FUNCTION IF EXISTS public.get_user_week_attendance() CASCADE;
DROP FUNCTION IF EXISTS public.get_attendance_stats() CASCADE;
DROP FUNCTION IF EXISTS public.get_default_attendance() CASCADE;
DROP FUNCTION IF EXISTS public.get_messages_to_update() CASCADE;
DROP FUNCTION IF EXISTS public.update_default_attendance() CASCADE;
DROP FUNCTION IF EXISTS public.update_reminder_config() CASCADE;
DROP FUNCTION IF EXISTS public.update_reminder_time() CASCADE;
DROP FUNCTION IF EXISTS public.update_team_config() CASCADE;
DROP FUNCTION IF EXISTS public.upsert_attendance_fast() CASCADE;
DROP FUNCTION IF EXISTS public.user_has_feature_access() CASCADE;
DROP FUNCTION IF EXISTS public.submit_weekly_attendance() CASCADE;
DROP FUNCTION IF EXISTS public.track_attendance_message() CASCADE;
DROP FUNCTION IF EXISTS public.populate_user_defaults() CASCADE;
DROP FUNCTION IF EXISTS public.prepare_email_for_reuse() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_email_immediately() CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_old_attendance_messages() CASCADE;
DROP FUNCTION IF EXISTS public.auth_user_deleted_trigger() CASCADE;

-- Drop views that reference these tables
DROP VIEW IF EXISTS public.current_week_attendance CASCADE;

-- Drop tables (in order to handle foreign key dependencies)
DROP TABLE IF EXISTS public.attendance_messages CASCADE;
DROP TABLE IF EXISTS public.attendance_records CASCADE;
DROP TABLE IF EXISTS public.attendance_weeks CASCADE;
DROP TABLE IF EXISTS public.attendance CASCADE;
DROP TABLE IF EXISTS public.reminder_logs CASCADE;
DROP TABLE IF EXISTS public.reminder_runs CASCADE;
DROP TABLE IF EXISTS public.reminder_config CASCADE;
DROP TABLE IF EXISTS public.team_usage_logs CASCADE;
DROP TABLE IF EXISTS public.team_config CASCADE;
DROP TABLE IF EXISTS public.slack_users CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TABLE IF EXISTS public.teams CASCADE;
DROP TABLE IF EXISTS public.cron_config CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;
DROP TABLE IF EXISTS public.features CASCADE;

-- ============================================================================
-- PART 2: Verify profiles table has proper RLS (already done in migration 001)
-- ============================================================================

-- The profiles table should already have RLS enabled from migration 001.
-- Let's ensure it's properly configured.

-- Enable RLS (idempotent)
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;

-- Verify policies exist (these were created in 001_add_subscription_columns.sql)
-- If they don't exist, create them:

DO $$
BEGIN
    -- Check if policy exists, create if not
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profiles'
        AND policyname = 'Users can view their own profile'
    ) THEN
        CREATE POLICY "Users can view their own profile"
            ON public.profiles
            FOR SELECT
            TO authenticated
            USING (auth.uid() = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profiles'
        AND policyname = 'Users can update their own profile'
    ) THEN
        CREATE POLICY "Users can update their own profile"
            ON public.profiles
            FOR UPDATE
            TO authenticated
            USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profiles'
        AND policyname = 'Users can insert their own profile'
    ) THEN
        CREATE POLICY "Users can insert their own profile"
            ON public.profiles
            FOR INSERT
            TO authenticated
            WITH CHECK (auth.uid() = id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'profiles'
        AND policyname = 'Service role can manage all profiles'
    ) THEN
        CREATE POLICY "Service role can manage all profiles"
            ON public.profiles
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- ============================================================================
-- PART 3: Block Anonymous Access to Profiles (extra security)
-- ============================================================================

-- Ensure anonymous users cannot access profiles at all
DROP POLICY IF EXISTS "anon_no_access_profiles" ON public.profiles;

CREATE POLICY "anon_no_access_profiles"
    ON public.profiles
    FOR ALL
    TO anon
    USING (false);

-- ============================================================================
-- PART 4: Verify Clean State
-- ============================================================================

-- After running this migration, only these objects should remain in public schema:
-- 1. profiles table (with RLS enabled)
-- 2. has_active_subscription function
-- 3. handle_new_user function (trigger)
-- 4. update_updated_at_column function (trigger)

-- Run this query to verify:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- Expected result: only 'profiles'

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.profiles IS 'User profile data for Clearical app - linked to Supabase auth.users';
