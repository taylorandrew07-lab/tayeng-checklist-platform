-- ============================================================
-- Migration 107: server-side Analytics aggregation (performance)
-- Run via the db-migrate runner. Idempotent.
--
-- WHY: getAnalytics() fetched ALL jobs + ALL invoices into the browser and
-- aggregated in JS (grows unbounded). This pushes the job-side aggregates into
-- Postgres. Billing + pipeline already have proven RPCs (migration 055) which the
-- client keeps using; labour stays on metrics_labour. So this only adds the job
-- KPIs / by-type / by-month / top-clients (with per-client revenue).
--
-- PARITY with the old JS (see lib/jobs/analytics.ts):
--   jobDate           = scheduled_date else created_at (here read in the company's
--                       local TZ so month bucketing matches what staff see; the old
--                       JS parsed a date-only scheduled_date as UTC, which mis-placed
--                       the 1st of a month — this version uses the calendar date).
--   totalJobs/openJobs/thisMonth/otJobs = counts over all jobs.
--   awaitingInvoice   = workflow_status 'approved' AND no invoice rows.job_id = job.
--   overdueCount      = invoices status 'overdue' OR (sent AND due_date < today).
--   byType            = count per job_type ('' / null → 'Unspecified').
--   topClients        = job count per client + non-void invoice revenue per currency.
--
-- SECURITY INVOKER (RLS still applies); EXECUTE to authenticated only.
-- ============================================================

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
    'openJobs',        count(*) FILTER (WHERE workflow_status NOT IN ('paid','closed')),
    'thisMonth',       count(*) FILTER (WHERE date_trunc('month', eff_date)::date = (SELECT m FROM cur)),
    'awaitingInvoice', count(*) FILTER (WHERE workflow_status = 'approved'
                          AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.job_id = j.id)),
    'otJobs',          count(*) FILTER (WHERE is_overtime),
    'overdueCount',    (SELECT count(*) FROM public.invoices i
                          WHERE i.status = 'overdue' OR (i.status = 'sent' AND i.due_date < current_date))
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

REVOKE EXECUTE ON FUNCTION public.metrics_analytics(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_analytics(int) TO authenticated;
