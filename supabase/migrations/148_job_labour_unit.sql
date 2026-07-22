-- ============================================================
-- Migration 148: Hours ⇄ days labour unit, per job.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Some jobs are paid and billed by the DAY, not the hour. The unit is per JOB and
-- applies to every surveyor on it. Storage does NOT change: the quantity stays in
-- job_surveyors.regular_hours/.overtime_hours and the rate in .pay_rate/.overtime_rate,
-- so the GENERATED pay columns (quantity × rate, mig 043) stay exactly correct in
-- both units — no money maths anywhere needs touching.
--
-- What DOES need touching, and why:
--   2. the mig-135 OT-log sync trigger would overwrite a hand-typed DAY count with a
--      sum of logged HOURS — server-side, so a client-only fix is bypassed;
--   3. the unit is an admin-only field (RLS cannot gate a column, so it goes in the
--      two BEFORE-UPDATE guards, as billing_mode's carve-out does — mig 124/145);
--   4/5. the labour metrics summed hours and days into one number, and derived a
--      day-billed job's OT from the hours shift log (paying logged hours × the DAY
--      rate). Both are fixed here; quantities now come back split by unit.
-- ============================================================

-- ── 1. The column ────────────────────────────────────────────────────────────
-- Mirrors billing_mode (mig 116). NOT NULL DEFAULT so no backfill UPDATE is needed
-- — a migration-time UPDATE on public.jobs would trip the §3 guards (mig-145 lesson).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS labour_unit TEXT NOT NULL DEFAULT 'hours';

DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_labour_unit_check CHECK (labour_unit IN ('hours','days'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.jobs.labour_unit IS
  'Unit of the labour quantity on this job: hours (default) or days. Per job — applies to every surveyor. In days mode the quantity is typed by hand and the OT shift log is evidence only (migration 148).';

-- ── 2. Keep the OT-log sync off day-billed jobs (guards mig 135) ─────────────
-- On an hours job the shift log IS the overtime hours (audit L2), so the trigger
-- stays. On a day-billed job job_surveyors.overtime_hours holds a hand-typed DAY
-- count and the log is evidence only — recomputing would silently replace days with
-- hours, and that number is what pays the surveyor.
CREATE OR REPLACE FUNCTION public.sync_overtime_hours()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_js uuid;
BEGIN
  v_js := COALESCE(NEW.job_surveyor_id, OLD.job_surveyor_id);
  UPDATE public.job_surveyors js
    SET overtime_hours = COALESCE(
      (SELECT sum(o.hours) FROM public.job_surveyor_overtime o WHERE o.job_surveyor_id = v_js), 0)
    WHERE js.id = v_js
      AND EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = js.job_id AND COALESCE(j.labour_unit, 'hours') = 'hours'
      );
  RETURN NULL;
END;
$$;

-- ── 3. The unit is admin-only ────────────────────────────────────────────────
-- Surveyors may flip Regular/Overtime on their own open jobs (mig 124) but not the
-- unit — it changes what every quantity on the job MEANS. Postgres RLS cannot hide
-- or gate a column, so both existing BEFORE-UPDATE guards carry it: the general
-- non-admin guard (which early-returns for admins) and the surveyor guard, so a
-- surveyor gets the clear "protected job fields" message.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- A non-admin may not move a job out of the locked financial state.
  IF OLD.workflow_status = 'closed'
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a closed job';
  END IF;

  IF NEW.report_number      IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by
     OR NEW.labour_unit        IS DISTINCT FROM OLD.labour_unit THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
      IF OLD.workflow_status = 'closed' THEN
        RAISE EXCEPTION 'This job has been invoiced and closed — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. metrics_labour — quantities split by unit, never summed together ──────
-- Two changes to the mig-133 body:
--   • agg splits the quantity into regular_hours/overtime_hours (hours-billed jobs)
--     and regular_days/overtime_days (day-billed) — 12 h + 3 d must never come back
--     as "15". The pay jsonb is untouched: money is already correct in both units.
--   • the OT-from-shift-log substitution is now hours-only. On a day-billed job the
--     log is evidence in HOURS while the rate is per DAY, so deriving OT from it
--     both reported and PAID logged hours × the day rate. Day-billed OT uses the
--     typed quantity + its generated pay, attributed to the job's date.
-- Return shape changes, so the function must be dropped first (as mig 123 did).
DROP FUNCTION IF EXISTS public.metrics_labour(date, date);
CREATE FUNCTION public.metrics_labour(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
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
    COALESCE(p.display_title, p.full_name, 'Unknown') AS name,
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

-- ── 5. metrics_labour_by_job — one row per (surveyor, job) + its unit ────────
-- The grain is a single job, so its two quantities are always in the SAME unit and
-- nothing mixes inside a row; the row just has to say which unit that is, so the
-- breakdown can label it. Same hours-only OT-log rule as §4, which keeps the mig-126
-- "by-job rows sum to the parent" invariant holding per unit.
DROP FUNCTION IF EXISTS public.metrics_labour_by_job(date, date);
CREATE FUNCTION public.metrics_labour_by_job(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  surveyor_id uuid, job_id uuid,
  job_title text, vessel_name text, report_number text, job_date date,
  labour_unit text,
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
    SELECT b.surveyor_id, b.job_id, b.job_title, b.vessel_name, b.report_number, b.job_date, b.currency, b.unit,
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
      max(unit) AS labour_unit,
      sum(reg_hours) AS regular_hours,
      sum(ot_hours)  AS overtime_hours
    FROM rowvals
    GROUP BY surveyor_id, job_id
  )
  SELECT
    a.surveyor_id, a.job_id,
    a.job_title, a.vessel_name, a.report_number, a.job_date,
    a.labour_unit,
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

-- Sanity (optional): every by-job row states its unit, and a surveyor's by-job rows
-- sum to their metrics_labour totals within that unit.
--   SELECT labour_unit, sum(regular_hours), sum(overtime_hours)
--     FROM public.metrics_labour_by_job(NULL, NULL) GROUP BY labour_unit;
