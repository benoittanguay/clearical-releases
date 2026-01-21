-- Migration: Transcription Usage Tracking
-- Created: 2026-01-20
-- Description: Create table to track audio transcription usage per user for monthly limits and cost monitoring

-- Create transcription usage tracking table
CREATE TABLE IF NOT EXISTS transcription_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,  -- Reference to the time entry
    duration_seconds INT NOT NULL DEFAULT 0,  -- Audio duration in seconds
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient monthly usage queries (user + date)
CREATE INDEX IF NOT EXISTS idx_transcription_usage_user_month
    ON transcription_usage(user_id, created_at);

-- Index for looking up transcriptions by entry
CREATE INDEX IF NOT EXISTS idx_transcription_usage_entry
    ON transcription_usage(entry_id);

-- Enable RLS
ALTER TABLE transcription_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own usage (not insert - that's done via service role)
CREATE POLICY "Users can view own transcription usage" ON transcription_usage
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Only service role can insert (edge function uses service role)
CREATE POLICY "Service role can insert transcription usage" ON transcription_usage
    FOR INSERT
    WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE transcription_usage IS 'Tracks audio transcription usage per user for monthly limits (10hr/month free, unlimited premium)';
COMMENT ON COLUMN transcription_usage.entry_id IS 'Reference to the time entry this transcription belongs to';
COMMENT ON COLUMN transcription_usage.duration_seconds IS 'Duration of the transcribed audio in seconds';
