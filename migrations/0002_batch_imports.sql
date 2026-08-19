-- Migration: 0002_batch_imports.sql
-- Description: Add upload_batches table and link upload_jobs.batch_id

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS upload_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_folder_id TEXT,
  destination_folder_name TEXT,
  item_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_batches_user_created ON upload_batches(user_id, created_at DESC);

-- Add batch_id to upload_jobs if not already present
-- Note: SQLite ALTER TABLE ADD COLUMN
ALTER TABLE upload_jobs ADD COLUMN batch_id TEXT REFERENCES upload_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON upload_jobs(batch_id);
