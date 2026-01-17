-- Migration: Analytics Events
-- Created: 2026-01-16
-- Description: Create analytics_events table for product usage tracking

-- ============================================================================
-- PART 1: Create Analytics Events Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    session_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    app_version TEXT,
    platform TEXT
);

-- Index for user-specific queries (e.g., rate limiting checks)
CREATE INDEX IF NOT EXISTS idx_analytics_user_date
    ON analytics_events(user_id, created_at);

-- Index for event-based queries (e.g., feature adoption)
CREATE INDEX IF NOT EXISTS idx_analytics_event_name
    ON analytics_events(event_name, created_at);

-- Index for session analysis
CREATE INDEX IF NOT EXISTS idx_analytics_session
    ON analytics_events(session_id);

-- Enable RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can insert their own events
CREATE POLICY "Users can insert own analytics events" ON analytics_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can read all events (for admin analysis)
-- Note: Regular users cannot read analytics data
CREATE POLICY "Service role can read analytics" ON analytics_events
    FOR SELECT
    USING (auth.role() = 'service_role');

-- ============================================================================
-- PART 2: Add analytics_enabled to profiles
-- ============================================================================

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS analytics_enabled BOOLEAN DEFAULT TRUE;

-- Comment on new column
COMMENT ON COLUMN profiles.analytics_enabled IS 'User preference for anonymous usage analytics (opt-out model)';

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE analytics_events IS 'Product usage analytics for feature engagement and workflow patterns';
COMMENT ON COLUMN analytics_events.event_name IS 'Event identifier in category.action format (e.g., settings.opened)';
COMMENT ON COLUMN analytics_events.properties IS 'Event-specific data as JSON';
COMMENT ON COLUMN analytics_events.session_id IS 'Groups events from a single app session';
