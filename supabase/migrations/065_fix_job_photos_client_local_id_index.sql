-- ============================================================
-- Migration 065: Make job_photos.client_local_id usable for ON CONFLICT upsert
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- Migration 023 created a PARTIAL unique index:
--     CREATE UNIQUE INDEX ... ON job_photos (client_local_id) WHERE client_local_id IS NOT NULL;
-- Postgres will NOT infer a partial index as the arbiter for
--     INSERT ... ON CONFLICT (client_local_id) ...
-- unless the statement repeats the index predicate — which supabase-js / PostgREST
-- (onConflict: 'client_local_id') does not. So the offline photo sync upsert
-- (src/lib/cargo offline sync) failed with "42P10: no unique or exclusion
-- constraint matching the ON CONFLICT specification", which in turn could strand a
-- queued checklist submit (the submit runs through the same sync).
--
-- A PLAIN unique index allows multiple NULLs too (Postgres treats NULLs as distinct
-- in a unique index by default), so online photos — which have client_local_id NULL
-- — are unaffected, while offline photos stay deduplicated by their client id. The
-- plain index IS a valid ON CONFLICT arbiter.
--
-- Safe to run now: client_local_id is all-NULL (no offline photo has synced yet,
-- because the upsert was failing), so creating the unique index cannot conflict.
-- ============================================================

DROP INDEX IF EXISTS public.idx_job_photos_client_local_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_photos_client_local_id
  ON public.job_photos (client_local_id);
