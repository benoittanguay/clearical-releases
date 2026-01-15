-- Migration: Clean up remaining RPC functions from old project
-- Created: 2026-01-14
-- Run this after 002_fix_rls_security.sql if functions still remain

-- Drop all remaining functions that reference deleted tables
-- Using CASCADE to handle any dependencies

DROP FUNCTION IF EXISTS public.api_driven_orphan_cleanup CASCADE;
DROP FUNCTION IF EXISTS public.check_afternoon_reminder CASCADE;
DROP FUNCTION IF EXISTS public.check_morning_summary CASCADE;
DROP FUNCTION IF EXISTS public.check_weekly_summary CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_email_immediately CASCADE;
DROP FUNCTION IF EXISTS public.create_or_join_team CASCADE;
DROP FUNCTION IF EXISTS public.get_attendance_stats CASCADE;
DROP FUNCTION IF EXISTS public.get_messages_to_update CASCADE;
DROP FUNCTION IF EXISTS public.get_team_attendance_summary CASCADE;
DROP FUNCTION IF EXISTS public.get_team_user_count CASCADE;
DROP FUNCTION IF EXISTS public.get_team_week_attendance CASCADE;
DROP FUNCTION IF EXISTS public.get_user_profile CASCADE;
DROP FUNCTION IF EXISTS public.get_user_week_attendance CASCADE;
DROP FUNCTION IF EXISTS public.log_team_usage CASCADE;
DROP FUNCTION IF EXISTS public.mark_reminder_sent CASCADE;
DROP FUNCTION IF EXISTS public.populate_user_defaults CASCADE;
DROP FUNCTION IF EXISTS public.prepare_email_for_reuse CASCADE;
DROP FUNCTION IF EXISTS public.prepare_reminder_trigger CASCADE;
DROP FUNCTION IF EXISTS public.record_reminder_run CASCADE;
DROP FUNCTION IF EXISTS public.send_afternoon_reminder CASCADE;
DROP FUNCTION IF EXISTS public.send_morning_summary CASCADE;
DROP FUNCTION IF EXISTS public.send_weekly_summary CASCADE;
DROP FUNCTION IF EXISTS public.setup_test_channel CASCADE;
DROP FUNCTION IF EXISTS public.submit_weekly_attendance CASCADE;
DROP FUNCTION IF EXISTS public.track_attendance_message CASCADE;
DROP FUNCTION IF EXISTS public.update_default_attendance CASCADE;
DROP FUNCTION IF EXISTS public.update_reminder_config CASCADE;
DROP FUNCTION IF EXISTS public.update_reminder_time CASCADE;
DROP FUNCTION IF EXISTS public.update_team_config CASCADE;
DROP FUNCTION IF EXISTS public.upsert_attendance_fast CASCADE;
DROP FUNCTION IF EXISTS public.user_has_feature_access CASCADE;
DROP FUNCTION IF EXISTS public.was_reminder_sent_today CASCADE;

-- Drop any functions with arguments (different signatures)
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN
        SELECT n.nspname as schema_name, p.proname as function_name,
               pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname IN (
            'api_driven_orphan_cleanup', 'check_afternoon_reminder', 'check_morning_summary',
            'check_weekly_summary', 'cleanup_email_immediately', 'create_or_join_team',
            'get_attendance_stats', 'get_messages_to_update', 'get_team_attendance_summary',
            'get_team_user_count', 'get_team_week_attendance', 'get_user_profile',
            'get_user_week_attendance', 'log_team_usage', 'mark_reminder_sent',
            'populate_user_defaults', 'prepare_email_for_reuse', 'prepare_reminder_trigger',
            'record_reminder_run', 'send_afternoon_reminder', 'send_morning_summary',
            'send_weekly_summary', 'setup_test_channel', 'submit_weekly_attendance',
            'track_attendance_message', 'update_default_attendance', 'update_reminder_config',
            'update_reminder_time', 'update_team_config', 'upsert_attendance_fast',
            'user_has_feature_access', 'was_reminder_sent_today', 'get_cron_secret',
            'trigger_manual_reminder', 'send_attendance_reminder', 'check_and_send_reminders',
            'check_reminder_status', 'get_users_for_reminders', 'cleanup_orphaned_profiles',
            'debug_data_relationships', 'check_orphaned_data', 'simple_test',
            'test_http_request', 'test_authenticated_request', 'test_custom_header_auth',
            'test_public_edge_function', 'test_vercel_api_direct', 'test_with_anon_key',
            'get_reminder_configs', 'get_reminder_time', 'get_last_reminder_run',
            'clear_todays_reminders', 'list_reminder_functions', 'get_default_attendance',
            'auth_user_deleted_trigger', 'cleanup_old_attendance_messages',
            'get_teams_for_usage_reporting'
        )
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
            func_record.schema_name,
            func_record.function_name,
            func_record.args
        );
    END LOOP;
END $$;

-- Verify only Clearical functions remain
-- Expected: has_active_subscription, handle_new_user, update_updated_at_column
