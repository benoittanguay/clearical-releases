-- Migration: Create profiles table
-- Run this BEFORE 001_add_subscription_columns.sql if profiles table doesn't exist
-- Created: 2026-01-12
-- Description: Creates the base profiles table linked to auth.users

-- ============================================================================
-- Create Profiles Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT
);

-- Comment on the table
COMMENT ON TABLE public.profiles IS 'User profile data linked to Supabase auth.users';
COMMENT ON COLUMN public.profiles.id IS 'References auth.users.id';
COMMENT ON COLUMN public.profiles.email IS 'User email (denormalized from auth.users for convenience)';
