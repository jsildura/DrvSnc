-- Migration: 0003_preferences_columns.sql
-- Description: Ensure filename_pattern column exists on preferences table

-- Note: In SQLite, if column already exists this may error on fresh installs where 0001 created it.
-- We use a no-op migration for tracking schema versions.
