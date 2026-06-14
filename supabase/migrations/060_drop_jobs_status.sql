-- ============================================================
-- Migration 060: Drop the legacy jobs.status column (P0b — final, DESTRUCTIVE)
-- Run in Supabase SQL Editor ONLY AFTER:
--   1. The code release that reads/writes workflow_status + submitted_at is live.
--   2. Migration 059 has run (all DB objects moved off status).
--   3. You've smoke-tested: create a job, surveyor submits it, admin edits it,
--      the calendar + all dashboards load, the client/office views load.
--   4. (Recommended) a backup / PITR is in place — this is irreversible.
--
-- workflow_status (+ submitted_at) is now the single source of truth. The
-- legacy job_status enum type is left in place (harmless) in case anything
-- external still references it.
-- ============================================================

ALTER TABLE public.jobs DROP COLUMN IF EXISTS status;

-- Optional, only if you want to fully remove the now-unused enum type:
--   DROP TYPE IF EXISTS job_status;
