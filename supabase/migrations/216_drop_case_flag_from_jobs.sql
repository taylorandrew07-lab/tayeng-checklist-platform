-- ============================================================
-- Migration 216: remove the case flag, and everything that hung off it
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- SAFE ONLY BECAUSE 215 ALREADY RAN AND ITS SMOKE PASSED. A function body is a quoted
-- string, so Postgres records NO dependency on jobs.is_case: dropping the column against
-- a stale mig-204 body SUCCEEDS and then fails at runtime — a stale
-- enforce_job_admin_columns makes every job UPDATE in the app raise, and
-- metrics_pipeline / metrics_analytics are SECURITY INVOKER, so Finance and Insights
-- break for every caller. Nothing in the database will stop you; only the ordering does.
--
-- It is also why this waited for the app to ship: PostgREST fails the ENTIRE select, not
-- the missing column, so any browser still running a bundle that asks for is_case would
-- have had the surveyor job page, the surveyor list and offline sync's pre-write read all
-- go dark together. That bundle is gone (mig 212/213 and the case rewrite are deployed).
--
-- Verified before writing: no jobs row carries is_case, and job_attendance_billing holds
-- nothing — the one real case and its fee moved to `cases` in 213/214.
-- ============================================================

-- == 1. The insert trigger that derived a case from its job type =============
DROP TRIGGER  IF EXISTS jobs_ac_case_defaults ON public.jobs;
DROP FUNCTION IF EXISTS public.jobs_set_case_defaults();

-- == 2. Per-attendance billing on the JOB time logs ==========================
-- These two columns and their guard existed only for cases. A case now keeps its money
-- on its own tables, where the rate sits directly on the attendance row — which is why
-- no guard is needed there at all, and why the migration-207 class of bug (a BEFORE
-- trigger fighting an ON DELETE SET NULL cascade) cannot recur.
DROP TRIGGER  IF EXISTS jsr_guard_billed ON public.job_surveyor_regular;
DROP TRIGGER  IF EXISTS jso_guard_billed ON public.job_surveyor_overtime;
DROP FUNCTION IF EXISTS public.guard_attendance_billed_stamp();

DROP FUNCTION IF EXISTS public.bill_case_items(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.unbill_case_items(uuid);

DROP INDEX IF EXISTS public.idx_jsr_billed;
DROP INDEX IF EXISTS public.idx_jsr_unbilled;
DROP INDEX IF EXISTS public.idx_jso_billed;
DROP INDEX IF EXISTS public.idx_jso_unbilled;
ALTER TABLE public.job_surveyor_regular  DROP COLUMN IF EXISTS billed_invoice_id;
ALTER TABLE public.job_surveyor_overtime DROP COLUMN IF EXISTS billed_invoice_id;

-- Its RLS policy goes with the table.
DROP TABLE IF EXISTS public.job_attendance_billing;

-- == 3. The flag itself ======================================================
DROP INDEX IF EXISTS public.idx_jobs_live_case;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_case_status_chk;
ALTER TABLE public.jobs
  DROP COLUMN IF EXISTS is_case,
  DROP COLUMN IF EXISTS case_status,
  DROP COLUMN IF EXISTS case_opened_on,
  DROP COLUMN IF EXISTS case_closed_on;

ALTER TABLE public.job_types DROP COLUMN IF EXISTS is_case;

-- The seeded job type has nothing left to mean. Guarded so it can never take a real job
-- with it — if one was ever created of this type, the row stays and someone looks.
DELETE FROM public.job_types
 WHERE name = 'P&I Case'
   AND NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.job_type = 'P&I Case');

-- == 4. The migration scaffolding ============================================
-- legacy_job_id and legacy_entry_id existed so migration 213 was exactly re-runnable.
-- It has run, the jobs it read are gone, and a column whose only purpose has passed is
-- the kind of thing that misleads a reader two years from now.
ALTER TABLE public.cases            DROP COLUMN IF EXISTS legacy_job_id;
ALTER TABLE public.case_attendances DROP COLUMN IF EXISTS legacy_entry_id;

-- Sanity checks after running — then `npm run smoke` and `npm run smoke-cases`:
--   SELECT to_regclass('public.job_attendance_billing');            -- expect NULL
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'jobs' AND column_name LIKE 'case%';        -- expect 0 rows
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('jobs_set_case_defaults','guard_attendance_billed_stamp','bill_case_items','unbill_case_items');
--   -- and the app must still work end to end: edit a job (proves no stale
--   -- enforce_job_admin_columns), open Finance, open the calendar.
