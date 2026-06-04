-- ============================================================
-- Migration 023: Job photo offline metadata
-- Run in Supabase SQL Editor. Idempotent. (Required for offline photo sync.)
--
-- Adds capture metadata + an idempotency key so photos queued offline can be
-- uploaded once and retried safely without duplicating rows.
-- ============================================================

ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS client_local_id TEXT;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS gps_accuracy_m DOUBLE PRECISION;
ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS uploaded_offline BOOLEAN NOT NULL DEFAULT false;

-- One row per client-generated id: makes the offline photo upsert idempotent,
-- so retrying a partially-synced batch never creates duplicate photos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_photos_client_local_id
  ON job_photos (client_local_id)
  WHERE client_local_id IS NOT NULL;
