-- ============================================================
-- Migration 056: Let any surveyor complete & submit checklists (+ auto-assign)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- PROBLEM: the surveyor row-policies were scoped to the *assigned* surveyor (or a
-- job_surveyors member). A staff surveyor who completes a checklist they aren't
-- formally assigned to got a silent zero-row update — "checklist done, won't
-- submit". This is an internal staff app, so that's too strict.
--
-- FIX: any surveyor may read/complete/submit a job's checklist. The column &
-- state GUARDS stay in force (triggers below + 049), so a surveyor still cannot
-- set report numbers, approvals, billing, the workflow stage beyond report_ready,
-- or reassign a job to someone else. We also AUTO-ASSIGN the surveyor who works
-- an unassigned job, so "whoever did it" becomes the assignee automatically.
-- ============================================================

-- ── Jobs: any surveyor may view + update ────────────────────────────────────
DROP POLICY IF EXISTS "Surveyors can view own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Surveyors can view jobs"     ON public.jobs;
CREATE POLICY "Surveyors can view jobs" ON public.jobs FOR SELECT
  USING (public.get_my_role() = 'surveyor');

DROP POLICY IF EXISTS "Surveyors can update own jobs" ON public.jobs;
DROP POLICY IF EXISTS "Surveyors can update jobs"     ON public.jobs;
CREATE POLICY "Surveyors can update jobs" ON public.jobs FOR UPDATE
  USING (public.get_my_role() = 'surveyor')
  WITH CHECK (public.get_my_role() = 'surveyor');

-- ── Checklist data: any surveyor may read/write (internal app) ──────────────
DROP POLICY IF EXISTS "Surveyors can manage own job values" ON public.job_field_values;
CREATE POLICY "Surveyors can manage job values" ON public.job_field_values FOR ALL
  USING (public.get_my_role() = 'surveyor') WITH CHECK (public.get_my_role() = 'surveyor');

DROP POLICY IF EXISTS "Surveyors can manage own job photos" ON public.job_photos;
CREATE POLICY "Surveyors can manage job photos" ON public.job_photos FOR ALL
  USING (public.get_my_role() = 'surveyor') WITH CHECK (public.get_my_role() = 'surveyor');

DROP POLICY IF EXISTS "Surveyors can manage own job signatures" ON public.job_signatures;
CREATE POLICY "Surveyors can manage job signatures" ON public.job_signatures FOR ALL
  USING (public.get_my_role() = 'surveyor') WITH CHECK (public.get_my_role() = 'surveyor');

-- ── Auto-pick-up assignment + allow a surveyor to claim an unassigned job ────
-- Replaces the function bound to trg_enforce_surveyor_job_update (migration 020).
CREATE OR REPLACE FUNCTION public.enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() = 'surveyor' THEN
    -- A surveyor working an unassigned job becomes its assignee (and name),
    -- so "whoever did the checklist" is recorded automatically.
    IF OLD.assigned_to IS NULL AND NEW.status IN ('in_progress', 'submitted') THEN
      NEW.assigned_to := auth.uid();
      IF NEW.surveyor_name IS NULL THEN
        NEW.surveyor_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
      END IF;
    END IF;

    -- May not re-template, re-client, renumber, rewrite the creator, or reassign
    -- to someone ELSE (claiming an unassigned job for yourself is allowed above).
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.client_id  IS DISTINCT FROM OLD.client_id
       OR NEW.job_number IS DISTINCT FROM OLD.job_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;

    -- Surveyors may only move status to in_progress / submitted.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('in_progress', 'submitted') THEN
      RAISE EXCEPTION 'Surveyors may not set job status to %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- (trigger trg_enforce_surveyor_job_update from migration 020 already calls this)
