-- ============================================================
-- Migration 133: Per-kilometre surveyor PAY rate
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- km is already logged per surveyor (job_surveyor_km) and can be BILLED to the
-- client (per_km invoice line). This adds the missing other side: what we PAY the
-- surveyor for travel. One company rate + currency on app_settings (admin-write,
-- staff-read — existing RLS), folded into the labour-pay RPCs so the Finance
-- Overview "Pay" column starts including travel automatically.
--
-- Travel pays on EVERY job regardless of billing_mode (regular/overtime/fixed) —
-- a surveyor drives the same distance however the job is billed.
--
-- Same signatures/return shapes as mig 125/126, so plain CREATE OR REPLACE.
-- ============================================================

-- 1. The rate lives on the single-row settings table ---------------------------
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS surveyor_km_rate     NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surveyor_km_currency TEXT    NOT NULL DEFAULT 'TTD';

DO $$ BEGIN
  ALTER TABLE public.app_settings
    ADD CONSTRAINT app_settings_km_currency_check CHECK (surveyor_km_currency IN ('USD','TTD','EUR','GBP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. metrics_labour — fold km × rate into the per-currency pay map --------------
CREATE OR REPLACE FUNCTION public.metrics_labour(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  surveyor_id uuid, name text, jobs bigint,
  regular_hours numeric, overtime_hours numeric, km numeric, pay jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT
      js.id AS js_id,
      js.surveyor_id,
      js.job_id,
      COALESCE(js.regular_hours, 0)  AS reg_hours,
      COALESCE(js.overtime_hours, 0) AS ot_typed,
      COALESCE(js.pay_currency, 'TTD') AS currency,
      COALESCE(js.regular_pay, 0)    AS reg_pay,
      COALESCE(js.overtime_pay, 0)   AS ot_pay_all,
      COALESCE(js.overtime_rate, 0)  AS ot_rate,
      COALESCE(j.scheduled_date, (j.created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS job_date
    FROM public.job_surveyors js
    JOIN public.jobs j ON j.id = js.job_id
  ),
  ot_log AS (
    SELECT b.js_id,
      COALESCE(sum(o.hours) FILTER (
        WHERE (p_from IS NULL OR COALESCE(o.entry_date, b.job_date) >= p_from)
          AND (p_to   IS NULL OR COALESCE(o.entry_date, b.job_date) <= p_to)
      ), 0) AS hours_in
    FROM public.job_surveyor_overtime o
    JOIN base b ON b.js_id = o.job_surveyor_id
    GROUP BY b.js_id
  ),
  rowvals AS (
    SELECT b.surveyor_id, b.job_id, b.currency,
      ((p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)) AS job_in_win,
      CASE WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.reg_hours ELSE 0 END AS reg_hours,
      CASE WHEN ol.js_id IS NOT NULL THEN ol.hours_in
           WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.ot_typed ELSE 0 END AS ot_hours,
      CASE WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.reg_pay ELSE 0 END
      + CASE WHEN ol.js_id IS NOT NULL THEN ol.hours_in * b.ot_rate
             WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
             THEN b.ot_pay_all ELSE 0 END AS pay
    FROM base b
    LEFT JOIN ot_log ol ON ol.js_id = b.js_id
  ),
  km_by_s AS (
    SELECT b.surveyor_id, sum(k.km)::numeric AS km
    FROM public.job_surveyor_km k
    JOIN base b ON b.js_id = k.job_surveyor_id
    WHERE (p_from IS NULL OR COALESCE(k.trip_date, b.job_date) >= p_from)
      AND (p_to   IS NULL OR COALESCE(k.trip_date, b.job_date) <= p_to)
    GROUP BY b.surveyor_id
  ),
  -- The single company travel rate + currency (defaults if the row is missing).
  km_rate AS (
    SELECT COALESCE((SELECT surveyor_km_rate     FROM public.app_settings LIMIT 1), 0)     AS rate,
           COALESCE((SELECT surveyor_km_currency FROM public.app_settings LIMIT 1), 'TTD') AS cur
  ),
  -- Travel pay = in-window km × rate, in the configured currency. billing_mode-agnostic.
  km_pay AS (
    SELECT k.surveyor_id, r.cur AS currency, k.km * r.rate AS pay
    FROM km_by_s k CROSS JOIN km_rate r
    WHERE k.km * r.rate <> 0
  ),
  -- Labour pay + travel pay, summed per currency.
  pay_by_cur AS (
    SELECT surveyor_id, currency, sum(pay) AS pay
    FROM (
      SELECT surveyor_id, currency, pay FROM rowvals
      UNION ALL
      SELECT surveyor_id, currency, pay FROM km_pay
    ) u
    GROUP BY surveyor_id, currency HAVING sum(pay) <> 0
  ),
  agg AS (
    SELECT surveyor_id,
      count(DISTINCT job_id) FILTER (WHERE job_in_win)::bigint AS jobs,
      sum(reg_hours) AS regular_hours,
      sum(ot_hours)  AS overtime_hours
    FROM rowvals GROUP BY surveyor_id
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

-- 3. metrics_labour_by_job — same km-pay fold, at (surveyor, job) grain ---------
-- Keeps the sum-to-parent invariant: km_by_sj sums to km_by_s, so by-job travel
-- pay sums to the surveyor total.
CREATE OR REPLACE FUNCTION public.metrics_labour_by_job(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  surveyor_id uuid, job_id uuid,
  job_title text, vessel_name text, report_number text, job_date date,
  regular_hours numeric, overtime_hours numeric, km numeric, pay jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT
      js.id AS js_id,
      js.surveyor_id,
      js.job_id,
      j.title        AS job_title,
      j.vessel_name  AS vessel_name,
      j.report_number AS report_number,
      COALESCE(js.regular_hours, 0)  AS reg_hours,
      COALESCE(js.overtime_hours, 0) AS ot_typed,
      COALESCE(js.pay_currency, 'TTD') AS currency,
      COALESCE(js.regular_pay, 0)    AS reg_pay,
      COALESCE(js.overtime_pay, 0)   AS ot_pay_all,
      COALESCE(js.overtime_rate, 0)  AS ot_rate,
      COALESCE(j.scheduled_date, (j.created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS job_date
    FROM public.job_surveyors js
    JOIN public.jobs j ON j.id = js.job_id
  ),
  ot_log AS (
    SELECT b.js_id,
      COALESCE(sum(o.hours) FILTER (
        WHERE (p_from IS NULL OR COALESCE(o.entry_date, b.job_date) >= p_from)
          AND (p_to   IS NULL OR COALESCE(o.entry_date, b.job_date) <= p_to)
      ), 0) AS hours_in
    FROM public.job_surveyor_overtime o
    JOIN base b ON b.js_id = o.job_surveyor_id
    GROUP BY b.js_id
  ),
  rowvals AS (
    SELECT b.surveyor_id, b.job_id, b.job_title, b.vessel_name, b.report_number, b.job_date, b.currency,
      ((p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)) AS job_in_win,
      CASE WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.reg_hours ELSE 0 END AS reg_hours,
      CASE WHEN ol.js_id IS NOT NULL THEN ol.hours_in
           WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.ot_typed ELSE 0 END AS ot_hours,
      CASE WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
           THEN b.reg_pay ELSE 0 END
      + CASE WHEN ol.js_id IS NOT NULL THEN ol.hours_in * b.ot_rate
             WHEN (p_from IS NULL OR b.job_date >= p_from) AND (p_to IS NULL OR b.job_date <= p_to)
             THEN b.ot_pay_all ELSE 0 END AS pay
    FROM base b
    LEFT JOIN ot_log ol ON ol.js_id = b.js_id
  ),
  km_by_sj AS (
    SELECT b.surveyor_id, b.job_id, sum(k.km)::numeric AS km
    FROM public.job_surveyor_km k
    JOIN base b ON b.js_id = k.job_surveyor_id
    WHERE (p_from IS NULL OR COALESCE(k.trip_date, b.job_date) >= p_from)
      AND (p_to   IS NULL OR COALESCE(k.trip_date, b.job_date) <= p_to)
    GROUP BY b.surveyor_id, b.job_id
  ),
  km_rate AS (
    SELECT COALESCE((SELECT surveyor_km_rate     FROM public.app_settings LIMIT 1), 0)     AS rate,
           COALESCE((SELECT surveyor_km_currency FROM public.app_settings LIMIT 1), 'TTD') AS cur
  ),
  km_pay AS (
    SELECT k.surveyor_id, k.job_id, r.cur AS currency, k.km * r.rate AS pay
    FROM km_by_sj k CROSS JOIN km_rate r
    WHERE k.km * r.rate <> 0
  ),
  pay_by_cur AS (
    SELECT surveyor_id, job_id, currency, sum(pay) AS pay
    FROM (
      SELECT surveyor_id, job_id, currency, pay FROM rowvals
      UNION ALL
      SELECT surveyor_id, job_id, currency, pay FROM km_pay
    ) u
    GROUP BY surveyor_id, job_id, currency HAVING sum(pay) <> 0
  ),
  agg AS (
    SELECT surveyor_id, job_id,
      max(job_title) AS job_title, max(vessel_name) AS vessel_name,
      max(report_number) AS report_number, max(job_date) AS job_date,
      sum(reg_hours) AS regular_hours,
      sum(ot_hours)  AS overtime_hours
    FROM rowvals
    GROUP BY surveyor_id, job_id
  )
  SELECT
    a.surveyor_id, a.job_id,
    a.job_title, a.vessel_name, a.report_number, a.job_date,
    a.regular_hours, a.overtime_hours,
    COALESCE(k.km, 0) AS km,
    COALESCE((SELECT jsonb_object_agg(pc.currency, pc.pay)
              FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id AND pc.job_id = a.job_id), '{}'::jsonb) AS pay
  FROM agg a
  LEFT JOIN km_by_sj k ON k.surveyor_id = a.surveyor_id AND k.job_id = a.job_id
  WHERE a.regular_hours <> 0 OR a.overtime_hours <> 0 OR COALESCE(k.km, 0) <> 0
     OR EXISTS (SELECT 1 FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id AND pc.job_id = a.job_id);
$$;
REVOKE EXECUTE ON FUNCTION public.metrics_labour_by_job(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_labour_by_job(date, date) TO authenticated;
