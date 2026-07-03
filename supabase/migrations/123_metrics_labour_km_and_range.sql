-- Labour metrics: add per-surveyor kilometres (we pay per km — mig 116 trip log)
-- and an optional date range so Finance can view labour by month / year for the
-- monthly pay run. Everything is attributed by the JOB's effective date
-- (scheduled_date, else created_at in Trinidad time) — hours, pay and km stay
-- consistent with each other and with the analytics month bucketing (mig 107).
--
-- The old zero-arg function must be dropped (not replaced): leaving both a ()
-- and a (date,date DEFAULT NULL) overload would make PostgREST's no-arg
-- .rpc('metrics_labour') call ambiguous. No-arg calls hit the new defaults
-- (NULL/NULL = all time), so existing callers keep working unchanged.

DROP FUNCTION IF EXISTS public.metrics_labour();

CREATE OR REPLACE FUNCTION public.metrics_labour(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  surveyor_id uuid, name text, jobs bigint,
  regular_hours numeric, overtime_hours numeric, km numeric, pay jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH jr AS (
    SELECT id FROM public.jobs
    WHERE (p_from IS NULL OR COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) >= p_from)
      AND (p_to   IS NULL OR COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) <= p_to)
  ),
  base AS (
    SELECT
      js.id AS js_id,
      js.surveyor_id,
      js.job_id,
      COALESCE(js.regular_hours, 0)  AS regular_hours,
      COALESCE(js.overtime_hours, 0) AS overtime_hours,
      COALESCE(js.pay_currency, 'TTD') AS currency,
      COALESCE(js.regular_pay, 0) + COALESCE(js.overtime_pay, 0) AS pay
    FROM public.job_surveyors js
    JOIN jr ON jr.id = js.job_id
  ),
  km_by_s AS (
    SELECT b.surveyor_id, sum(k.km)::numeric AS km
    FROM public.job_surveyor_km k
    JOIN base b ON b.js_id = k.job_surveyor_id
    GROUP BY b.surveyor_id
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
    COALESCE(k.km, 0) AS km,
    COALESCE((SELECT jsonb_object_agg(pc.currency, pc.pay)
              FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id), '{}'::jsonb) AS pay
  FROM agg a
  LEFT JOIN km_by_s k ON k.surveyor_id = a.surveyor_id
  LEFT JOIN public.profiles p ON p.id = a.surveyor_id;
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_labour(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_labour(date, date) TO authenticated;

-- Sanity checks:
--   SELECT * FROM public.metrics_labour();                          -- all time
--   SELECT * FROM public.metrics_labour('2026-07-01', '2026-07-31'); -- one month
