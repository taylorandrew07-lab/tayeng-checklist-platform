-- ============================================================
-- Migration 054: Keep workflow_status authoritative — sync from legacy `status`
--                + one-time backfill  (P0a of the status unification)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- WHY: the app shows TWO statuses today — the unified `workflow_status`
-- (migration 047) and the legacy checklist `status`. They drift: an offline-
-- created job writes status='in_progress' but leaves workflow_status='new', so
-- the tracker/header show "New" for a job that's actually being worked.
--
-- This migration makes `workflow_status` follow `status` MONOTONICALLY (only ever
-- forward, never backward) via a trigger, and backfills existing drifted rows.
--
-- SAFETY: purely additive. It does NOT drop/rename anything, does not touch RLS,
-- and can only ADVANCE workflow_status. It is safe to run on production at any
-- time and is independent of the app deploy. The legacy `status` column is
-- removed later, in P0b, once all app code reads workflow_status (see
-- docs/p0-status-migration.md).
-- ============================================================

-- Minimum workflow stage implied by a legacy checklist status. draft/assigned/
-- archived imply no advance (NULL). 'approved'+ are admin decisions, never
-- derived from the checklist, so they're not produced here.
CREATE OR REPLACE FUNCTION public.workflow_floor_for_status(p_status TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'in_progress'    THEN 'in_progress'
    WHEN 'submitted'      THEN 'report_ready'
    WHEN 'completed'      THEN 'report_ready'
    WHEN 'client_visible' THEN 'report_ready'
    ELSE NULL
  END;
$$;

-- Position of a stage in the 9-step lifecycle, for monotonic comparison.
CREATE OR REPLACE FUNCTION public.workflow_rank(p TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_position(
    ARRAY['new','assigned','in_progress','report_ready','approved',
          'invoiced','sent','paid','closed'], p), 0);
$$;

-- Trigger: on every insert/update, pull workflow_status up to at least the floor
-- implied by status — but never push it backward (so an admin who has already
-- advanced to approved/invoiced/… is never dragged back to report_ready).
CREATE OR REPLACE FUNCTION public.jobs_sync_workflow_from_status()
RETURNS TRIGGER AS $$
DECLARE floor_stage TEXT;
BEGIN
  -- `status` is the job_status enum — cast to text for the helper.
  floor_stage := public.workflow_floor_for_status(NEW.status::text);
  IF floor_stage IS NOT NULL
     AND public.workflow_rank(floor_stage)
         > public.workflow_rank(COALESCE(NEW.workflow_status, 'new')) THEN
    NEW.workflow_status := floor_stage;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fires AFTER enforce_job_admin_columns alphabetically ('jobs_admin_columns' <
-- 'jobs_sync_workflow'); the only values it can set are in_progress/report_ready,
-- both already permitted to surveyors by that trigger (migration 049), so there
-- is no policy conflict.
DROP TRIGGER IF EXISTS jobs_sync_workflow ON public.jobs;
CREATE TRIGGER jobs_sync_workflow
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_sync_workflow_from_status();

-- One-time backfill of existing drifted rows (monotonic; never moves backward).
UPDATE public.jobs
SET workflow_status = public.workflow_floor_for_status(status::text)
WHERE public.workflow_floor_for_status(status::text) IS NOT NULL
  AND public.workflow_rank(public.workflow_floor_for_status(status::text))
      > public.workflow_rank(COALESCE(workflow_status, 'new'));

-- Sanity check (optional): rows where the two still disagree downward — expected
-- to be only admin-advanced jobs (approved+), which is correct.
-- SELECT id, status, workflow_status FROM public.jobs
--   WHERE workflow_status IS DISTINCT FROM COALESCE(workflow_floor_for_status(status::text), workflow_status);
