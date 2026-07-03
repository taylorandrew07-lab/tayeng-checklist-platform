-- ============================================================
-- Migration 124: Auto-assign the working surveyor to the labour ledger
-- + let surveyors set Regular/Overtime on their own OPEN jobs. Idempotent.
--
-- PROBLEM (confirmed by audit, 2026-07-02): every surveyor-side job creation
-- (surveyor New Job → offline draft → sync upsert) and the mig 056/059 claim
-- trigger set jobs.assigned_to but never insert a job_surveyors row — and the
-- entire hours/OT/km UI, hours RLS, OT report and labour metrics key off
-- job_surveyors. Result: "No surveyors assigned yet", no hour inputs, on every
-- job a surveyor starts himself. RLS also gave surveyors no INSERT on
-- job_surveyors, so no client-side fix was possible.
--
-- FIX: a SECURITY DEFINER trigger on jobs mirrors assigned_to into
-- job_surveyors (UNIQUE(job_id, surveyor_id) makes it conflict-safe). It covers
-- every path — surveyor create, offline-sync upsert, the auto-claim in
-- enforce_surveyor_job_update (BEFORE trigger sets NEW.assigned_to, this AFTER
-- trigger sees it), and admin assignment (already inserts rows; conflict-safe).
-- Admin "Add a surveyor" for extra surveyors is untouched.
-- ============================================================

-- 1. Mirror jobs.assigned_to → job_surveyors, on insert or (re)assignment.
CREATE OR REPLACE FUNCTION public.auto_add_job_surveyor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    INSERT INTO public.job_surveyors (job_id, surveyor_id, created_by)
    VALUES (NEW.id, NEW.assigned_to, NEW.assigned_to)
    ON CONFLICT (job_id, surveyor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_add_job_surveyor ON public.jobs;
CREATE TRIGGER trg_auto_add_job_surveyor
  AFTER INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.auto_add_job_surveyor();

-- 2. Backfill: every assigned job that never got its ledger row (this is what
--    un-bricks the existing surveyor-created jobs, e.g. Neil's fuel loadout).
INSERT INTO public.job_surveyors (job_id, surveyor_id)
  SELECT id, assigned_to FROM public.jobs WHERE assigned_to IS NOT NULL
  ON CONFLICT (job_id, surveyor_id) DO NOTHING;

-- 3. Surveyors may flip Regular/Overtime on OPEN jobs only. billing_mode /
--    is_overtime were never in the protected-fields list (mig 059), so surveyors
--    could technically always write them — this adds the close-lock the rest of
--    the labour data already has (mig 117), and blocks 'fixed' (a billing
--    construct only admins set). Function is the 059 text + the billing gate.
CREATE OR REPLACE FUNCTION public.enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() = 'surveyor' THEN
    -- A surveyor working an unassigned job becomes its assignee (and name).
    IF OLD.assigned_to IS NULL AND NEW.workflow_status IN ('in_progress', 'report_ready') THEN
      NEW.assigned_to := auth.uid();
      IF NEW.surveyor_name IS NULL THEN
        NEW.surveyor_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
      END IF;
    END IF;
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.client_id  IS DISTINCT FROM OLD.client_id
       OR NEW.job_number IS DISTINCT FROM OLD.job_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Billing mode: only while the job is open, and never to/from 'fixed'.
    IF (NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
        OR NEW.is_overtime IS DISTINCT FROM OLD.is_overtime) THEN
      IF OLD.workflow_status = 'closed' THEN
        RAISE EXCEPTION 'This job is closed — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- (trigger trg_enforce_surveyor_job_update already calls this)

-- Sanity checks:
--   SELECT count(*) FROM jobs j WHERE j.assigned_to IS NOT NULL AND NOT EXISTS
--     (SELECT 1 FROM job_surveyors js WHERE js.job_id = j.id AND js.surveyor_id = j.assigned_to);
--   -- should be 0 after the backfill.
