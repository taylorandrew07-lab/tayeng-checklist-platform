-- Migration 151: let surveyors create report-only jobs (no checklist template)
-- Run in the Supabase SQL Editor (paste the whole file). Idempotent.
--
-- Why: the surveyor "New Job" form was template-first, so surveyors could only
-- start job types that HAVE a surveyor-startable checklist. Report-only types
-- (Draught Survey, Hatch Testing, plain Cargo Loading/Discharging, etc.) have no
-- checklist and so never appeared on the phone. The form is being rebuilt to be
-- job-type-first with an OPTIONAL template (matching the admin form); this policy
-- is the DB half — without it, a template-less surveyor insert is still rejected.
--
-- Security: unchanged except that template_id may now be NULL. created_by and
-- assigned_to are still pinned to the caller, workflow_status is still bounded,
-- and a NON-null template must still be an active, surveyor-startable one — a
-- surveyor still can't attach a template they aren't allowed to start.

DROP POLICY IF EXISTS "Surveyors can create jobs from approved templates" ON public.jobs;

CREATE POLICY "Surveyors can create jobs from approved templates" ON public.jobs FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND created_by = (select auth.uid())
    AND assigned_to = (select auth.uid())
    AND workflow_status IN ('in_progress', 'report_ready')
    AND (
      -- Report-only job: no checklist at all.
      template_id IS NULL
      -- Or a genuine checklist the surveyor is allowed to start (unchanged rule).
      OR EXISTS (
        SELECT 1 FROM public.checklist_templates
        WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
      )
    )
  );
