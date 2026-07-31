-- 165 — metrics_labour: show the surveyor's NAME, not their job title.
--
-- The Finance → Overview "Labour & overtime" table listed two rows both reading
-- "Cargo Technician" with no way to tell whose pay was whose. The cause is the
-- name expression this function has carried since mig 055 and that every rewrite
-- (123 → 125 → 133 → 148) copied forward unexamined:
--
--   COALESCE(p.display_title, p.full_name, 'Unknown')
--
-- profiles.display_title (mig 041) is a purely cosmetic ROLE LABEL — mig 064 set
-- it to 'Cargo Technician' for everyone previously labelled Super-Cargo — so it
-- is shared by design and is not an identity. Preferring it over full_name means
-- any surveyor who has one is anonymised in the one table that exists to say who
-- gets paid what, and two of them collapse into indistinguishable rows.
--
-- Every other surface already reads the other way round: JobOpsPanel and the New
-- Job pickers show full_name with the title as a secondary qualifier. This makes
-- the labour metrics agree with them. NULLIF(TRIM(...)) so a blank-but-not-null
-- full_name still falls through to the title rather than showing an empty cell.
--
-- Body is otherwise byte-identical to mig 148 §4; the return shape is unchanged,
-- so this is a plain CREATE OR REPLACE (no DROP, no dependent-view churn).
-- Sibling metrics_labour_by_job returns no name column and needs no change.

CREATE OR REPLACE FUNCTION public.metrics_labour(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  surveyor_id uuid, name text, jobs bigint,
  regular_hours numeric, overtime_hours numeric,
  regular_days numeric, overtime_days numeric,
  km numeric, pay jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT
      js.id AS js_id,
      js.surveyor_id,
      js.job_id,
      COALESCE(j.labour_unit, 'hours')  AS unit,
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
    WHERE b.unit = 'hours'
    GROUP BY b.js_id
  ),
  rowvals AS (
    SELECT b.surveyor_id, b.job_id, b.currency, b.unit,
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
      COALESCE(sum(reg_hours) FILTER (WHERE unit = 'hours'), 0) AS regular_hours,
      COALESCE(sum(ot_hours)  FILTER (WHERE unit = 'hours'), 0) AS overtime_hours,
      COALESCE(sum(reg_hours) FILTER (WHERE unit = 'days'), 0)  AS regular_days,
      COALESCE(sum(ot_hours)  FILTER (WHERE unit = 'days'), 0)  AS overtime_days
    FROM rowvals GROUP BY surveyor_id
  )
  SELECT
    a.surveyor_id,
    -- The person, then their title as a fallback for a profile with no name.
    COALESCE(NULLIF(TRIM(p.full_name), ''), p.display_title, 'Unknown') AS name,
    a.jobs, a.regular_hours, a.overtime_hours, a.regular_days, a.overtime_days,
    COALESCE(k.km, 0) AS km,
    COALESCE((SELECT jsonb_object_agg(pc.currency, pc.pay)
              FROM pay_by_cur pc WHERE pc.surveyor_id = a.surveyor_id), '{}'::jsonb) AS pay
  FROM agg a
  LEFT JOIN km_by_s k ON k.surveyor_id = a.surveyor_id
  LEFT JOIN public.profiles p ON p.id = a.surveyor_id;
$$;
REVOKE EXECUTE ON FUNCTION public.metrics_labour(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_labour(date, date) TO authenticated;
