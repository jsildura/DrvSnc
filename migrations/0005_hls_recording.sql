-- Migration: 0005_hls_recording.sql
-- Description: Record duration cap for HLS (.m3u8) remote uploads.
--
-- A live HLS stream has no end, so a remote job pointed at one records for a fixed length instead
-- of downloading a finite file. NULL means the default applies, or that the source is a VOD
-- playlist and therefore transfers in full regardless.

ALTER TABLE upload_jobs ADD COLUMN hls_duration_seconds INTEGER;
