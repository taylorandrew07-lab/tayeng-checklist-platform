-- ============================================================
-- Migration 215: give the job machinery its predicates back
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- Migrations 204 and 205 injected case-shaped predicates into eight SHARED functions,
-- because a case was a job. It is not any more (mig 212/213), so every one of them is
-- dead code — and dead code in a security predicate is worse than none: it is a rule
-- nobody can explain that everybody is afraid to touch.
--
-- Each body below was EXTRACTED PROGRAMMATICALLY from the migration that last owned it
-- and asserted to contain no 'is_case', rather than retyped. Retyping is how migration
-- 162 came to hold a stale copy of enforce_job_admin_columns that migration 188 had to
-- correct and migration 209's header had to warn about.
--
-- COLUMN LISTS ARE UNCHANGED, so plain CREATE OR REPLACE is legal throughout and
-- PRESERVES the existing grants — no DROP, and therefore no REVOKE/GRANT to re-issue.
-- Migration 132 does issue explicit grants after get_calendar_jobs that a DROP would
-- destroy.
--
-- *** job_is_open() IS THE DANGEROUS ONE. *** It is called BY NAME from roughly nine RLS
-- policies — job_surveyors, both time logs, job_surveyor_km, job_field_values,
-- job_photos, job_signatures, job_attachments and storage.objects — so replacing it
-- silently re-keys all of them at once, and nothing announces a mistake. Run
-- `npm run smoke` the moment this lands.
--
-- NOTHING IS DROPPED HERE. The case columns and tables go in migration 216, and must
-- not be bundled with this: a function body is a quoted string, so Postgres records NO
-- dependency on jobs.is_case. Dropping the column against a stale body SUCCEEDS and then
-- fails at runtime — a stale enforce_job_admin_columns makes every job UPDATE in the app
-- raise, and metrics_pipeline/metrics_analytics are SECURITY INVOKER, so Finance and
-- Insights break for every caller. 216 is safe only because this ran first and its smoke
-- passed.
-- ============================================================

-- == 1. The write-lock predicate (mig 188 section 3) =========================
-- Loses the live-case exemption mig 204 added. No job needs it now: a case is not a job,
-- so nothing on this table is ever exempt from the freeze that protects payable overtime.

CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job AND j.workflow_status IN ('invoiced', 'closed')
  );
$$;


-- == 2. Admin-only job columns (mig 188 section 5b) =========================
-- Loses the four case columns from the denylist. They are dropped in 216, and a body
-- naming a column that no longer exists raises on every UPDATE.

CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
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
     OR NEW.billed_under_job_id IS DISTINCT FROM OLD.billed_under_job_id THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- == 3. Surveyor-protected job fields (mig 188 section 5c) ==================
-- Loses is_case from the blacklist.

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
       OR NEW.labour_unit IS DISTINCT FROM OLD.labour_unit
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
$$;


-- == 4. Billing jobs onto an invoice (mig 188 section 6) ====================
-- Loses the live-case refusal mig 205 added. With cases off the jobs table no case can
-- ever appear in p_line_job_ids, so the guard can no longer fire.

CREATE OR REPLACE FUNCTION public.bill_jobs_onto_invoice(
  p_invoice_id  UUID,
  p_line_job_ids UUID[],
  p_absorbed    JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (billed_job_id UUID) AS $$
DECLARE
  v_expected INT;
  v_actual   INT;
  v_now      TIMESTAMPTZ := now();
  v_uid      UUID := auth.uid();
  v_orphan   UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can bill jobs onto an invoice';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % does not exist', p_invoice_id;
  END IF;

  -- Every absorbed job's parent must itself be a line on this invoice, or the child
  -- would be closed with nothing on the invoice accounting for it.
  SELECT (value #>> '{}')::uuid INTO v_orphan
    FROM jsonb_each(p_absorbed)
   WHERE NOT ((value #>> '{}')::uuid = ANY (p_line_job_ids))
   LIMIT 1;
  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Absorbed survey points at job % which is not a line on this invoice', v_orphan;
  END IF;

  -- 8a. The jobs that own a line.
  v_expected := COALESCE(array_length(p_line_job_ids, 1), 0);
  IF v_expected > 0 THEN
    UPDATE public.jobs
       SET invoice_id = p_invoice_id, workflow_status = 'invoiced'
     WHERE id = ANY (p_line_job_ids)
       AND invoice_id IS NULL
       AND workflow_status IN ('report_ready', 'invoice_ready');
    GET DIAGNOSTICS v_actual = ROW_COUNT;
    IF v_actual <> v_expected THEN
      RAISE EXCEPTION
        'Could not bill every job (% of % eligible). A job is already invoiced, still in progress, or already closed: %',
        v_actual, v_expected,
        (SELECT string_agg(COALESCE(report_number, job_number, id::text), ', ')
           FROM public.jobs
          WHERE id = ANY (p_line_job_ids)
            AND (invoice_id IS NOT NULL OR workflow_status NOT IN ('report_ready', 'invoice_ready')));
    END IF;
  END IF;

  -- 8b. The absorbed legs, stamped with the parent they are billed under.
  v_expected := (SELECT count(*)::int FROM jsonb_each(p_absorbed));
  IF v_expected > 0 THEN
    UPDATE public.jobs j
       SET invoice_id = p_invoice_id, workflow_status = 'closed',
           closed_at = v_now, closed_by = v_uid,
           billed_under_job_id = (a.value #>> '{}')::uuid
      FROM jsonb_each(p_absorbed) AS a
     WHERE j.id = a.key::uuid
       AND j.invoice_id IS NULL
       AND j.workflow_status IN ('report_ready', 'invoice_ready');
    GET DIAGNOSTICS v_actual = ROW_COUNT;
    IF v_actual <> v_expected THEN
      RAISE EXCEPTION
        'Could not absorb every survey on this voyage (% of %). One is already invoiced, still in progress, or already closed.',
        v_actual, v_expected;
    END IF;
  END IF;

  RETURN QUERY
    SELECT id FROM public.jobs WHERE invoice_id = p_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- == 5. The calendar (mig 132 section 3) ====================================
-- Loses AND NOT j.is_case. A case never appears on the job calendar now because it is
-- not in the jobs table at all.

CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  end_date DATE, start_time TIME, end_time TIME,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
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
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$$;


-- == 6. Double-booking (mig 132 section 2) ==================================
-- Loses AND NOT j.is_case.
--
-- WORTH KNOWING, not a defect: case attendance is no longer visible to this check, so a
-- surveyor booked on a job while attending a case will not be flagged. That was already
-- true in practice (the exemption did the same thing) and case time is recorded after
-- the fact rather than scheduled, so there is nothing to clash with.

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
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
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
    AND tsrange(
          j.scheduled_date + COALESCE(j.start_time, time '00:00'),
          COALESCE(j.end_date, j.scheduled_date) + COALESCE(j.end_time, time '23:59'),
          '[]') && probe.r
    AND public.is_active_staff();
$$;


-- == 7. The jobs pipeline count (mig 055) ===================================
-- Loses the whole WHERE clause mig 205 added.

CREATE OR REPLACE FUNCTION public.metrics_pipeline()
RETURNS TABLE (workflow_status text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT j.workflow_status::text, count(*)::bigint
  FROM public.jobs j
  GROUP BY j.workflow_status;
$$;


-- == 8. The OTHER open-jobs count (mig 146) =================================
-- Loses is_case from the j CTE and from the openJobs filter. Both, or the CTE column is
-- unreferenced and the KPI is still wrong.

CREATE OR REPLACE FUNCTION public.metrics_analytics(p_months_back int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH
j AS (
  SELECT id, job_type, client_id, workflow_status, is_overtime,
         COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS eff_date
  FROM public.jobs
),
cur AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)::date AS m),
kpis AS (
  SELECT jsonb_build_object(
    'totalJobs',       count(*),
    'openJobs',        count(*) FILTER (WHERE workflow_status <> 'closed'),
    'thisMonth',       count(*) FILTER (WHERE date_trunc('month', eff_date)::date = (SELECT m FROM cur)),
    'awaitingInvoice', count(*) FILTER (WHERE workflow_status = 'invoice_ready'
                          AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.job_id = j.id)),
    'otJobs',          count(*) FILTER (WHERE is_overtime)
  ) AS data FROM j
),
by_type AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', t, 'count', c) ORDER BY c DESC, t), '[]'::jsonb) AS data
  FROM (SELECT COALESCE(NULLIF(job_type, ''), 'Unspecified') AS t, count(*) AS c FROM j GROUP BY 1) x
),
by_month AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ym', to_char(m, 'YYYY-MM'), 'count', c) ORDER BY m), '[]'::jsonb) AS data
  FROM (
    SELECT date_trunc('month', eff_date)::date AS m, count(*) AS c
    FROM j
    WHERE eff_date >= (date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)
                       - make_interval(months => GREATEST(p_months_back, 1) - 1))::date
    GROUP BY 1
  ) mm
),
jc AS (SELECT client_id, count(*) AS jobs FROM j WHERE client_id IS NOT NULL GROUP BY client_id),
rev AS (SELECT client_id, currency::text AS currency, sum(total) AS amount
        FROM public.invoices WHERE status <> 'void' AND client_id IS NOT NULL GROUP BY client_id, currency),
top_clients AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', jc.client_id,
    'name',      COALESCE(c.name, 'Unknown'),
    'jobs',      jc.jobs,
    'revenue',   COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', r.currency, 'amount', r.amount))
                           FROM rev r WHERE r.client_id = jc.client_id), '[]'::jsonb)
  ) ORDER BY jc.jobs DESC), '[]'::jsonb) AS data
  FROM jc LEFT JOIN public.clients c ON c.id = jc.client_id
)
SELECT jsonb_build_object(
  'kpis',       (SELECT data FROM kpis),
  'byType',     (SELECT data FROM by_type),
  'byMonth',    (SELECT data FROM by_month),
  'topClients', (SELECT data FROM top_clients)
);
$$;


-- == 9. Job-type guard (mig 162 section 1b) =================================
-- Loses the is_case line. The column itself is dropped in 216.

CREATE OR REPLACE FUNCTION public.job_types_guard_reminder_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    NEW.reminder_hours := CASE WHEN TG_OP = 'UPDATE' THEN OLD.reminder_hours ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;


-- Sanity checks after running — and then `npm run smoke`, without exception:
--   SELECT public.job_is_open(id) FROM public.jobs LIMIT 5;
--   SELECT * FROM public.metrics_pipeline();
--   SELECT public.metrics_analytics(12) -> 'kpis';
--   SELECT count(*) FROM public.get_calendar_jobs(CURRENT_DATE - 30, CURRENT_DATE + 30);
