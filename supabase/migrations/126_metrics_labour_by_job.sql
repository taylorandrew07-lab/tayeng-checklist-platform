-- Per-job labour breakdown, to expand a surveyor row in Finance -> Overview.
--
-- This is metrics_labour (mig 125) at JOB grain instead of surveyor grain: it
-- reuses the SAME base / ot_log / rowvals CTEs and the SAME day-worked windowing
-- predicates, then groups by (surveyor_id, job_id) and joins the job metadata.
-- Because the windowing is identical, the by-job rows for a surveyor SUM EXACTLY
-- to that surveyor's metrics_labour(from,to) totals — one source of truth, no drift:
--
--   * Logged OT shifts count on their own entry_date (a shift crossing midnight
--     counts wholly on its start day); typed OT falls back to the job's date.
--   * Km trips count on their own trip_date (falling back to the job's date).
--   * Regular hours + regular pay stay on the job's date.
--   * OT pay = windowed hours x overtime_rate (same as mig 125).
--
-- Additive + read-only: creates a new function, touches no data, leaves
-- metrics_labour untouched.

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
  -- Logged OT per ledger row: total in-window hours + whether a log exists at all.
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
  -- Km at (surveyor, job) grain on the trip's own date.
  km_by_sj AS (
    SELECT b.surveyor_id, b.job_id, sum(k.km)::numeric AS km
    FROM public.job_surveyor_km k
    JOIN base b ON b.js_id = k.job_surveyor_id
    WHERE (p_from IS NULL OR COALESCE(k.trip_date, b.job_date) >= p_from)
      AND (p_to   IS NULL OR COALESCE(k.trip_date, b.job_date) <= p_to)
    GROUP BY b.surveyor_id, b.job_id
  ),
  -- Pay per (surveyor, job, currency), matching metrics_labour's pay jsonb shape.
  pay_by_cur AS (
    SELECT surveyor_id, job_id, currency, sum(pay) AS pay
    FROM rowvals GROUP BY surveyor_id, job_id, currency HAVING sum(pay) <> 0
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
  -- A (surveyor, job) row is worth showing if it contributed any hours, km, or pay
  -- inside the window (mirrors the parent's non-zero contribution).
  WHERE a.regular_hours <> 0 OR a.overtime_hours <> 0 OR COALESCE(k.km, 0) <> 0
     OR EXISTS (SELECT 1 FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id AND pc.job_id = a.job_id);
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_labour_by_job(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_labour_by_job(date, date) TO authenticated;

-- Sanity: for any surveyor and window, SUM of these by-job rows must equal that
-- surveyor's metrics_labour(from,to) row (reg, OT, km, pay):
--   SELECT surveyor_id, sum(regular_hours), sum(overtime_hours), sum(km)
--   FROM public.metrics_labour_by_job('2026-07-01','2026-07-31') GROUP BY surveyor_id;
