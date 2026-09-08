-- ============================================================
-- Migration 204: long-running P&I cases
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- A P&I case is a job that never ends. It is opened once, attended dozens or
-- hundreds of times over months or years, and tracked by WHO attended, for how
-- long, and what happened. Everything that needs already exists on a job: the
-- regular and overtime time logs (migs 111/115/157) each carry entry_date,
-- start/end times, hours, location AND a free-text note. So a case is a FLAG on a
-- job -- not a new entity, and emphatically not a new attendance table.
--
-- WHAT A CASE IS NOT: a sixth workflow_status. jobs_workflow_status_chk would
-- reject it outright, and normalize_workflow_status() silently folds anything it
-- does not recognise -- migs 145/188 call that THE LANDMINE. A case therefore sits
-- at 'in_progress' for its whole life and carries its own life-cycle in
-- case_status (open / on_hold / concluded).
--
-- SAFETY: is_case defaults to false on every existing row, so section 5's
-- job_is_open() exemption reduces to NOT (false AND ...) -- today's predicate,
-- exactly. This file cannot change the behaviour of a single existing job.
-- Run `npm run smoke` anyway: section 5 re-keys every surveyor-write policy in
-- the app at once, and nothing announces it if it is wrong.
-- ============================================================

-- == 1. Job types can be marked as case types ================================
ALTER TABLE public.job_types ADD COLUMN IF NOT EXISTS is_case BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.job_types.is_case IS
  'Jobs of this type are long-running P&I cases: they never close, never take a report number, and stay writable for their whole life. Admin-only (see job_types_guard_reminder_default).';

-- Body from mig 162 section 1b, with is_case added for the SAME reason the column
-- it already guards exists: mig 150 lets ANY active staff member INSERT a job
-- type, and RLS cannot gate a COLUMN. Without this line a surveyor could mint a
-- job type with is_case = true, create a job of it, and section 5 would then
-- exempt that job from the invoicing write-lock for good -- the precise
-- escalation mig 117 exists to prevent.
CREATE OR REPLACE FUNCTION public.job_types_guard_reminder_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    NEW.reminder_hours := CASE WHEN TG_OP = 'UPDATE' THEN OLD.reminder_hours ELSE NULL END;
    NEW.is_case        := CASE WHEN TG_OP = 'UPDATE' THEN OLD.is_case        ELSE false END;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Seed the type. The guard above keys on is_admin(), which reads auth.uid() --
-- NULL on the db-migrate runner's direct connection, so the guard would strip
-- is_case from this very INSERT. Disable it for the seed rather than weakening
-- its rule, and put it straight back.
-- Both ALTERs tolerate the trigger being absent. If it is, there is nothing to
-- strip the flag and the seed works unguarded anyway -- but an unhandled
-- undefined_object here would roll back this entire migration.
DO $seed$ BEGIN
  ALTER TABLE public.job_types DISABLE TRIGGER job_types_guard_reminder;
EXCEPTION WHEN undefined_object THEN NULL; END $seed$;

INSERT INTO public.job_types (name, is_case)
  SELECT v.name, true FROM (VALUES ('P&I Case')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types jt WHERE jt.name = v.name);

-- Repairs the flag if the row already existed from an earlier hand-run.
UPDATE public.job_types SET is_case = true WHERE name = 'P&I Case' AND NOT is_case;

DO $seed$ BEGIN
  ALTER TABLE public.job_types ENABLE TRIGGER job_types_guard_reminder;
EXCEPTION WHEN undefined_object THEN NULL; END $seed$;

-- NOTE on report reminders (mig 162): nothing further is needed. jobs.reminder_hours
-- is seeded from job_types.reminder_hours at creation, and the 'P&I Case' row above
-- leaves it NULL -- so reminder_due_at computes to NULL and a case can never arm a
-- report reminder. If someone later gives the case type a reminder_hours value,
-- revisit jobs_set_reminder_due().

-- == 2. The case columns on jobs =============================================
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS is_case        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS case_status    TEXT,
  ADD COLUMN IF NOT EXISTS case_opened_on DATE,
  ADD COLUMN IF NOT EXISTS case_closed_on DATE;

COMMENT ON COLUMN public.jobs.is_case     IS 'This job is a long-running P&I case. Derived from job_types.is_case at creation; admin-only thereafter.';
COMMENT ON COLUMN public.jobs.case_status IS 'Life-cycle of a case: open | on_hold | concluded. NULL on every ordinary job. Deliberately NOT a workflow_status -- see this migration header.';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_case_status_chk;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_case_status_chk
  CHECK (case_status IS NULL OR case_status IN ('open', 'on_hold', 'concluded'));

-- Partial index: the cases list is "live cases, newest first", and that is the
-- only query that ever scans on this flag. Ordinary jobs (the overwhelming
-- majority) are excluded from the index entirely.
CREATE INDEX IF NOT EXISTS idx_jobs_live_case ON public.jobs (case_opened_on DESC)
  WHERE is_case AND COALESCE(case_status, 'open') <> 'concluded';

-- == 3. Seed the case fields at INSERT =======================================
-- TRIGGER NAME IS LOAD-BEARING. BEFORE-row triggers fire in NAME order (mig 162
-- documents this). 'jobs_ac_' sorts after jobs_aa_normalize_workflow and
-- jobs_ab_reminder_due, and before jobs_admin_columns and jobs_set_report_number
-- ('c' < 'd', 'a' < 's') -- so set_report_number sees the report_not_required set
-- below and a case never burns a number off the single global series (mig 158).
--
-- INSERT-only on purpose: an admin who later unticks the flag is not overridden.
CREATE OR REPLACE FUNCTION public.jobs_set_case_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- A non-admin may not ASSERT is_case on insert. enforce_job_admin_columns only
  -- fires BEFORE UPDATE, so without this a surveyor could simply insert a job
  -- with is_case = true and hand themselves a permanently unlockable job.
  -- The one legitimate route stays open: the derivation below, from a job type
  -- only an admin can mark (section 1).
  IF NOT public.is_admin() THEN
    NEW.is_case := false;
  END IF;

  IF NOT NEW.is_case AND NEW.job_type IS NOT NULL THEN
    NEW.is_case := COALESCE(
      (SELECT t.is_case FROM public.job_types t WHERE t.name = NEW.job_type LIMIT 1), false);
  END IF;

  IF NEW.is_case THEN
    NEW.case_status    := COALESCE(NEW.case_status, 'open');
    NEW.case_opened_on := COALESCE(NEW.case_opened_on, NEW.scheduled_date, CURRENT_DATE);
    -- A case links to the report that opened it; it does not carry one itself.
    NEW.report_not_required := true;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS jobs_ac_case_defaults ON public.jobs;
CREATE TRIGGER jobs_ac_case_defaults
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_set_case_defaults();

-- == 4. The case fields are admin-only on UPDATE =============================
-- Body from mig 188 section 5b (NOT mig 162's copy, which is stale), with the
-- four case columns appended to the denylist.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $fn$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- A non-admin may not move a job out of the locked financial state.
  IF OLD.workflow_status IN ('invoiced', 'closed')
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a billed job';
  END IF;

  IF NEW.report_number         IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by
     OR NEW.labour_unit        IS DISTINCT FROM OLD.labour_unit
     OR NEW.reminder_hours     IS DISTINCT FROM OLD.reminder_hours
     OR NEW.invoice_id         IS DISTINCT FROM OLD.invoice_id
     OR NEW.billed_under_job_id IS DISTINCT FROM OLD.billed_under_job_id
     OR NEW.is_case            IS DISTINCT FROM OLD.is_case
     OR NEW.case_status        IS DISTINCT FROM OLD.case_status
     OR NEW.case_opened_on     IS DISTINCT FROM OLD.case_opened_on
     OR NEW.case_closed_on     IS DISTINCT FROM OLD.case_closed_on THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Body from mig 188 section 5c, with is_case added to the surveyor blacklist so
-- the refusal names the right thing rather than falling through to the generic
-- admin-columns error above.
CREATE OR REPLACE FUNCTION public.enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
       OR NEW.labour_unit IS DISTINCT FROM OLD.labour_unit
       OR NEW.is_case     IS DISTINCT FROM OLD.is_case
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Billing mode: only while the job is open (not yet invoiced/closed), and
    -- never to/from 'fixed'.
    IF (NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
        OR NEW.is_overtime IS DISTINCT FROM OLD.is_overtime) THEN
      IF OLD.workflow_status IN ('invoiced', 'closed') THEN
        RAISE EXCEPTION 'This job has been invoiced — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
    -- The grouping identity of a billed survey is frozen (mig 186).
    IF (OLD.workflow_status IN ('invoiced', 'closed') OR OLD.billed_under_job_id IS NOT NULL) THEN
      IF NEW.vessel_name    IS DISTINCT FROM OLD.vessel_name
         OR NEW.vessel_id   IS DISTINCT FROM OLD.vessel_id
         OR NEW.job_stage   IS DISTINCT FROM OLD.job_stage
         OR NEW.job_type    IS DISTINCT FROM OLD.job_type
         OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
         OR NEW.end_date    IS DISTINCT FROM OLD.end_date
         OR NEW.voyage_number IS DISTINCT FROM OLD.voyage_number THEN
        RAISE EXCEPTION 'This survey has been billed — its vessel, stage, dates and voyage can no longer be changed';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- == 5. A live case never freezes ============================================
-- Body from mig 188 section 3, with ONE exception folded in.
--
-- The freeze exists to protect payable overtime on FINISHED work: invoicing a job
-- stops surveyors editing its hours, answers and photos. A case has no finished
-- work to protect. Bill three months of a case's attendances and, unamended, this
-- predicate would deny the surveyor's very next attendance -- silently, as 0 rows,
-- on a job that runs another four years.
--
-- The exception is narrow and self-cancelling: the moment case_status becomes
-- 'concluded' the job behaves like every other job again, and if it is invoiced or
-- closed at that point it locks on the spot. A NULL case_status reads as 'open'.
--
-- A missing job still returns TRUE, so brand-new inserts are never wrongly blocked.
--
-- Every policy that AND-s this calls it BY NAME (mig 117: job_surveyors,
-- job_surveyor_overtime, job_surveyor_km, job_field_values, job_photos,
-- job_signatures, job_attachments INSERT, storage.objects INSERT; plus migs 150,
-- 152, 157), so replacing the function re-keys all of them. No policy rewrite
-- needed -- and nothing announces it if this is wrong, hence `npm run smoke`.
CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job
       AND j.workflow_status IN ('invoiced', 'closed')
       AND NOT (j.is_case AND COALESCE(j.case_status, 'open') <> 'concluded')
  );
$fn$;

-- == 6. Keep multi-year cases out of the day-to-day surfaces =================
-- Each of these is the mig-132 / mig-055 body with one predicate added. Column
-- lists are UNCHANGED, so plain CREATE OR REPLACE is legal here and PRESERVES the
-- existing grants -- no DROP, and therefore no REVOKE/GRANT to re-issue.

-- A case spans years. Left in, it would paint every cell of every month.
CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  end_date DATE, start_time TIME, end_time TIME,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $fn$
  SELECT j.id, j.title, j.job_number, j.workflow_status::text,
         COALESCE(j.scheduled_date, j.created_at::date) AS scheduled_date,
         j.end_date, j.start_time, j.end_time,
         j.vessel_name, j.surveyor_name, c.name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  -- A job overlaps the visible window if its span [start, end] intersects it.
  WHERE COALESCE(j.end_date, COALESCE(j.scheduled_date, j.created_at::date)) >= p_start
    AND COALESCE(j.scheduled_date, j.created_at::date) <= p_end
    AND j.workflow_status <> 'closed'
    AND NOT j.is_case
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$fn$;

-- Same reason: an open-ended case would clash with every future booking a
-- surveyor is given, making the double-booking warning meaningless.
CREATE OR REPLACE FUNCTION public.surveyor_job_conflicts(
  p_surveyor    uuid,
  p_date        date,
  p_end_date    date,
  p_start_time  time,
  p_end_time    time,
  p_exclude_job uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, job_number text, vessel_name text,
  scheduled_date date, end_date date, start_time time, end_time time,
  workflow_status text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $fn$
  WITH probe AS (
    SELECT tsrange(
      p_date + COALESCE(p_start_time, time '00:00'),
      COALESCE(p_end_date, p_date) + COALESCE(p_end_time, time '23:59'),
      '[]') AS r
  )
  SELECT j.id, j.title, j.job_number, j.vessel_name,
         j.scheduled_date, j.end_date, j.start_time, j.end_time,
         j.workflow_status::text
  FROM public.jobs j
  JOIN public.job_surveyors js ON js.job_id = j.id AND js.surveyor_id = p_surveyor
  CROSS JOIN probe
  WHERE j.scheduled_date IS NOT NULL
    AND (p_exclude_job IS NULL OR j.id <> p_exclude_job)
    AND j.workflow_status <> 'closed'
    AND NOT j.is_case
    AND tsrange(
          j.scheduled_date + COALESCE(j.start_time, time '00:00'),
          COALESCE(j.end_date, j.scheduled_date) + COALESCE(j.end_time, time '23:59'),
          '[]') && probe.r
    AND public.is_active_staff();
$fn$;

-- Body from mig 055. Every live case sits at 'in_progress' forever, so without
-- this each one permanently inflates the "open jobs" figure on Finance.
CREATE OR REPLACE FUNCTION public.metrics_pipeline()
RETURNS TABLE (workflow_status text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT j.workflow_status::text, count(*)::bigint
  FROM public.jobs j
  WHERE NOT j.is_case
  GROUP BY j.workflow_status;
$fn$;

-- Sanity checks after running:
--   SELECT name, is_case FROM public.job_types WHERE is_case;   -- expect 'P&I Case'
--   SELECT count(*) FROM public.jobs WHERE is_case;             -- expect 0
--   SELECT public.job_is_open(id) FROM public.jobs LIMIT 5;     -- unchanged
