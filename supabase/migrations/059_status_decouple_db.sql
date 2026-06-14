-- ============================================================
-- Migration 059: Move all DB objects off the legacy jobs.status column (P0b-db)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Pairs with the code release that stopped reading/writing jobs.status. This
-- rewrites every DB object that still referenced it onto workflow_status /
-- submitted_at, and removes the status→workflow sync trigger (no longer needed
-- now that code writes workflow_status directly). The status COLUMN is kept for
-- now so you can smoke-test; migration 060 drops it.
-- ============================================================

-- 1. Surveyor update guard — auto-assign keyed on workflow_status; the status
--    forward-only check is dropped (049 already limits surveyors to in_progress/
--    report_ready on workflow_status).
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
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Calendar RPC — colour/source by workflow_status (still returned as `status`
--    so the client shape is unchanged); exclude closed instead of archived.
CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT j.id, j.title, j.job_number, j.workflow_status::text,
         COALESCE(j.scheduled_date, j.created_at::date) AS scheduled_date,
         j.vessel_name, j.surveyor_name, c.name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  WHERE COALESCE(j.scheduled_date, j.created_at::date) BETWEEN p_start AND p_end
    AND j.workflow_status <> 'closed'
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$$;
REVOKE EXECUTE ON FUNCTION public.get_calendar_jobs(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_calendar_jobs(date, date) TO authenticated;

-- 3. Surveyor INSERT policy — gate on workflow_status, not status.
DROP POLICY IF EXISTS "Surveyors can create jobs from approved templates" ON public.jobs;
CREATE POLICY "Surveyors can create jobs from approved templates" ON public.jobs FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND created_by = (select auth.uid())
    AND assigned_to = (select auth.uid())
    AND workflow_status IN ('new', 'assigned', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM public.checklist_templates
      WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
    )
  );

-- 4. Remove the status→workflow sync trigger + helpers (migration 054): code now
--    writes workflow_status directly, so the bridge is obsolete and it's the last
--    thing reading jobs.status.
DROP TRIGGER  IF EXISTS jobs_sync_workflow ON public.jobs;
DROP FUNCTION IF EXISTS public.jobs_sync_workflow_from_status();
DROP FUNCTION IF EXISTS public.workflow_floor_for_status(text);
DROP FUNCTION IF EXISTS public.workflow_rank(text);

-- After this runs, nothing in the DB references jobs.status except the column
-- itself. Smoke-test the app (create/submit/edit a job, calendar, dashboards),
-- then run migration 060 to drop the column.
