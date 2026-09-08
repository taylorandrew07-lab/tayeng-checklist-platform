-- ============================================================
-- Migration 205: corrections to migration 204 (P&I cases)
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- Migration 204 was built on a wrong premise: that a case links OUT to a report
-- rather than carrying one, and that a case is never billed. Both are wrong. A P&I
-- case frequently DOES carry a report number, and it is billed repeatedly over its
-- life -- periodically closing off the outstanding attendances while the case runs on.
--
-- This file undoes the two hard rules 204 imposed and closes the door 204 left ajar.
-- The billing mechanism itself is migration 206: money on a case is tracked per
-- ATTENDANCE, not per job, so nothing here touches the job-level invoicing path.
--
-- SAFETY: there are no case rows yet, so every change below is inert on current data.
-- Run `npm run smoke` regardless -- section 4 rewrites the RPC that bills every job
-- in the app.
-- ============================================================

-- == 1. A case MAY carry a report number =====================================
-- Mig 204 section 3 ended with `NEW.report_not_required := true`. That is a hard
-- assignment, not a default: an admin who deliberately unticked "No report required"
-- on the New Job form still got an N/A job, with no error and no way back. The
-- trigger fires before jobs_set_report_number, so it silently suppressed allocation.
--
-- The N/A DEFAULT is still right and still applies -- it now lives where a default
-- belongs, in the creation seam (lib/jobs/reportPolicy.ts), where an explicit choice
-- by the caller wins. Everything else about this trigger is unchanged.
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
  -- only an admin can mark (mig 204 section 1).
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
  END IF;

  RETURN NEW;
END;
$fn$;

-- == 2. Cases count as open jobs once they are past in_progress ==============
-- Mig 204 hid EVERY case from the pipeline metric. The reason given was sound for a
-- case parked at 'in_progress' forever -- but a case that has reached report_ready or
-- invoice_ready is real outstanding work, and hiding it removes it from the Finance
-- overview with nothing to say it is missing.
CREATE OR REPLACE FUNCTION public.metrics_pipeline()
RETURNS TABLE (workflow_status text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  SELECT j.workflow_status::text, count(*)::bigint
  FROM public.jobs j
  WHERE NOT (j.is_case AND j.workflow_status = 'in_progress')
  GROUP BY j.workflow_status;
$fn$;

-- == 3. The OTHER open-jobs count, which mig 204 missed entirely =============
-- metrics_analytics powers Insights and counts every non-closed job as open. Mig 204
-- patched metrics_pipeline and left this one alone, so the two would have disagreed
-- the moment a case existed. Body verbatim from mig 146 with two edits: is_case added
-- to the j CTE, and the openJobs filter excluding cases (which are never "open jobs"
-- in the sense this KPI means -- they are their own list).
CREATE OR REPLACE FUNCTION public.metrics_analytics(p_months_back int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH
j AS (
  SELECT id, job_type, client_id, workflow_status, is_overtime, is_case,
         COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS eff_date
  FROM public.jobs
),
cur AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)::date AS m),
kpis AS (
  SELECT jsonb_build_object(
    'totalJobs',       count(*),
    'openJobs',        count(*) FILTER (WHERE workflow_status <> 'closed' AND NOT is_case),
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

-- == 4. A live case is never billed as a job line ============================
-- Body from mig 188 section 6 with ONE guard added at the top.
--
-- Mig 204 left this door ajar: listInvoiceableJobs has no is_case filter, so a case
-- was kept out of the money path only by the accident of sitting at 'in_progress' --
-- and the ordinary status dropdown on the job page puts it in the pool in two clicks.
-- Billed, it is trapped: jobs.invoice_id is a scalar, the status becomes 'invoiced',
-- and release_jobs_from_invoice restores only invoice_ready/report_ready, never
-- in_progress. The guard makes the refusal explicit and loud.
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

  -- A LIVE P&I case is never billed as a job line. Its money is tracked per
  -- ATTENDANCE (mig 206): entries are stamped with the invoice that paid for them,
  -- so a case can be billed repeatedly over years while staying open. Billing it
  -- here would stamp invoice_id + 'invoiced' on the case itself, consuming its one
  -- and only invoice slot and freezing a job that must keep accruing work --
  -- and release_jobs_from_invoice cannot restore 'in_progress', so it could never
  -- be undone. Refuse loudly rather than trap the case.
  IF EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = ANY (p_line_job_ids)
       AND j.is_case AND COALESCE(j.case_status, 'open') <> 'concluded'
  ) THEN
    RAISE EXCEPTION 'A live P&I case is billed through its attendances, not as an invoice line';
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

-- Sanity checks after running:
--   -- a case may now be given a report number by the existing admin control:
--   SELECT public.set_job_report_requirement('<case id>', true);
--   SELECT * FROM public.metrics_pipeline();
--   SELECT public.metrics_analytics(12) -> 'kpis';
