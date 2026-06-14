-- ============================================================
-- Migration 055: Server-side metric aggregation (performance)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- WHY: the dashboards (Insights, Finance) and reconciliation fetch WHOLE tables
-- (all jobs / job_surveyors / invoices) into the browser and aggregate in JS.
-- That grows linearly forever. These functions push the same math into Postgres
-- and return only the small aggregated result.
--
-- SECURITY: all are SECURITY INVOKER (the default) — they run as the calling
-- user, so RLS still applies and each caller gets exactly the rows they could
-- already see, just pre-aggregated. EXECUTE is granted to authenticated only.
--
-- Numbers are defined to MATCH the current JS exactly:
--   invoiced  = every non-void invoice (incl. draft)
--   paid      = status 'paid'
--   draft     = status 'draft'
--   outstanding = non-void, non-paid, non-draft  (i.e. sent / overdue)
--   overdue   = status 'overdue'  OR  (status 'sent' AND due_date < today)
-- (isOverdue() in invoicing.ts = sent && due_date < today.)
-- ============================================================

-- ── Jobs pipeline: count per workflow stage ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.metrics_pipeline()
RETURNS TABLE (workflow_status text, count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT j.workflow_status::text, count(*)::bigint
  FROM public.jobs j
  GROUP BY j.workflow_status;
$$;

-- ── Billing per currency ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.metrics_billing()
RETURNS TABLE (
  currency text, invoiced numeric, paid numeric,
  outstanding numeric, overdue numeric, draft numeric, count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    i.currency::text,
    COALESCE(sum(i.total) FILTER (WHERE i.status <> 'void'), 0),
    COALESCE(sum(i.total) FILTER (WHERE i.status = 'paid'), 0),
    COALESCE(sum(i.total) FILTER (WHERE i.status NOT IN ('void','paid','draft')), 0),
    COALESCE(sum(i.total) FILTER (WHERE i.status = 'overdue'
                                     OR (i.status = 'sent' AND i.due_date < current_date)), 0),
    COALESCE(sum(i.total) FILTER (WHERE i.status = 'draft'), 0),
    count(*) FILTER (WHERE i.status <> 'void')::bigint
  FROM public.invoices i
  GROUP BY i.currency;
$$;

-- ── Outstanding per client, per currency (sent/overdue only) ────────────────
CREATE OR REPLACE FUNCTION public.metrics_client_outstanding()
RETURNS TABLE (client_id uuid, name text, currency text, amount numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT i.client_id, COALESCE(c.name, 'Unknown client'), i.currency::text, COALESCE(sum(i.total), 0)
  FROM public.invoices i
  LEFT JOIN public.clients c ON c.id = i.client_id
  WHERE i.client_id IS NOT NULL
    AND i.status NOT IN ('void','paid','draft')
  GROUP BY i.client_id, c.name, i.currency;
$$;

-- ── Labour per surveyor (pay rolled to a {currency: total} json map) ─────────
CREATE OR REPLACE FUNCTION public.metrics_labour()
RETURNS TABLE (
  surveyor_id uuid, name text, jobs bigint,
  regular_hours numeric, overtime_hours numeric, pay jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT
      js.surveyor_id,
      js.job_id,
      COALESCE(js.regular_hours, 0)  AS regular_hours,
      COALESCE(js.overtime_hours, 0) AS overtime_hours,
      COALESCE(js.pay_currency, 'TTD') AS currency,
      COALESCE(js.regular_pay, 0) + COALESCE(js.overtime_pay, 0) AS pay
    FROM public.job_surveyors js
  ),
  pay_by_cur AS (
    SELECT surveyor_id, currency, sum(pay) AS pay
    FROM base GROUP BY surveyor_id, currency HAVING sum(pay) <> 0
  ),
  agg AS (
    SELECT surveyor_id,
      count(DISTINCT job_id)::bigint AS jobs,
      sum(regular_hours)  AS regular_hours,
      sum(overtime_hours) AS overtime_hours
    FROM base GROUP BY surveyor_id
  )
  SELECT
    a.surveyor_id,
    COALESCE(p.display_title, p.full_name, 'Unknown') AS name,
    a.jobs, a.regular_hours, a.overtime_hours,
    COALESCE((SELECT jsonb_object_agg(pc.currency, pc.pay)
              FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id), '{}'::jsonb) AS pay
  FROM agg a
  LEFT JOIN public.profiles p ON p.id = a.surveyor_id;
$$;

-- Expose to logged-in users only (RLS inside still scopes the rows).
REVOKE EXECUTE ON FUNCTION public.metrics_pipeline()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.metrics_billing()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.metrics_client_outstanding()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.metrics_labour()              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_pipeline()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.metrics_billing()             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.metrics_client_outstanding()  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.metrics_labour()              TO authenticated;

-- Sanity check after running (should match the Finance/Insights pages):
--   SELECT * FROM public.metrics_billing();
--   SELECT * FROM public.metrics_pipeline();
--   SELECT * FROM public.metrics_labour();
