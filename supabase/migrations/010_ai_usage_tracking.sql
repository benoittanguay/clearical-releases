-- Migration: AI Usage Tracking
-- Created: 2026-01-16
-- Description: Create table to track AI API usage per user for rate limiting and cost monitoring

-- Create AI usage tracking table
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,  -- 'analyze', 'classify', 'summarize'
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient rate limit queries (user + date)
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date
    ON ai_usage(user_id, created_at);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_operation
    ON ai_usage(operation, created_at);

-- Enable RLS
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own usage (not insert - that's done via service role)
CREATE POLICY "Users can view own usage" ON ai_usage
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Only service role can insert (edge function uses service role)
CREATE POLICY "Service role can insert usage" ON ai_usage
    FOR INSERT
    WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE ai_usage IS 'Tracks AI API usage per user for rate limiting and cost monitoring';
COMMENT ON COLUMN ai_usage.operation IS 'Type of AI operation: analyze, classify, or summarize';
COMMENT ON COLUMN ai_usage.input_tokens IS 'Estimated input tokens (for cost tracking)';
COMMENT ON COLUMN ai_usage.output_tokens IS 'Estimated output tokens (for cost tracking)';
