-- Labour window fix: mig 123 attributed EVERYTHING to the job's scheduled date,
-- so a multi-day job starting 27 June put its 02 July OT shifts in June and July
-- showed empty (Shane's case). Overtime must be paid in the month it was worked:
--
--   * Logged OT shifts (job_surveyor_overtime) count on their own start date
--     (entry_date); a shift crossing midnight counts wholly on its start day.
--   * Typed OT (rows with no shift log) still counts on the job's date — there
--     is no finer date to use.
--   * Km trips count on their own trip_date (falling back to the job's date).
--   * Regular hours + regular pay stay on the job's date (no per-day log).
--   * OT pay follows the OT hours: windowed hours × overtime_rate — the same
--     formula as the stored overtime_pay column (mig 043), just windowed.
--
-- Same signature/return shape as mig 123, so plain CREATE OR REPLACE.

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
  pay_by_cur AS (
    SELECT surveyor_id, currency, sum(pay) AS pay
    FROM rowvals GROUP BY surveyor_id, currency HAVING sum(pay) <> 0
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

-- Grants unchanged (mig 123 already set them for this signature), but re-assert
-- for idempotency on fresh environments.
REVOKE EXECUTE ON FUNCTION public.metrics_labour(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_labour(date, date) TO authenticated;

-- Sanity: a 27/06→02/07 job with shifts on 27,29,30/06 + 02/07 must now show the
-- 02/07 shift under July:
--   SELECT * FROM public.metrics_labour('2026-07-01','2026-07-31');
