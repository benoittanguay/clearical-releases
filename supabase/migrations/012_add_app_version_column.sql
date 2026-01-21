-- Add app_version column to track which version each user is running
-- This column is updated on login and app startup

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS app_version TEXT;

-- Add comment for documentation
COMMENT ON COLUMN profiles.app_version IS 'The app version the user is currently running (e.g., 1.6.2)';
