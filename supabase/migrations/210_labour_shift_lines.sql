-- ============================================================
-- Migration 210: labour_shift_lines() — the SHIFT-GRAIN twin of metrics_labour.
--
-- Why this exists
-- ---------------
-- Finance → Overview's "Labour & overtime" panel is one row per surveyor for a
-- chosen month, expandable to a per-JOB breakdown (metrics_labour, mig 165 /
-- metrics_labour_by_job, mig 148). Andrew pays monthly off that screen, and the
-- office has to check it line by line — which they cannot do on a phone-sized
-- panel and cannot do at all on paper, because nothing renders the individual
-- shifts behind those totals. This RPC is the missing grain: one row per SHIFT
-- (and per km trip), carrying the day, the vessel, the job/report number, the
-- client, the start and stop times, and the quantity — so a Labour & Overtime
-- report can be printed and ticked off line by line.
--
-- The one hard requirement: IT MUST ADD UP TO THE PANEL ABOVE IT.
-- ---------------------------------------------------------------
-- A pay sheet that quietly disagrees with the screen it was printed from is worse
-- than no pay sheet at all. So every windowing predicate below is copied CHARACTER
-- FOR CHARACTER out of metrics_labour (mig 165, lines 49-82). For any window and
-- any surveyor:
--
--   * regular hours = SUM(reg_lines.qty) + SUM(reg_residual.qty) over unit='hours'
--       = SUM over each in-window job_surveyors row of
--           [ sum(log) + (js.regular_hours - sum(log)) ]
--       = SUM(js.regular_hours)
--       = metrics_labour's `CASE WHEN job_in_win THEN b.reg_hours` branch.
--   * regular days: reg_log is empty on a day-billed job by construction (its
--       `WHERE b.unit = 'hours'` guard, the mig-157 rule), so the residual IS the
--       whole typed day count, attributed to the job date — the same branch again.
--   * overtime hours: a job_surveyors row that HAS an OT log emits exactly its
--       in-window log rows, which sum to ol.hours_in; a row with NO OT log at all
--       emits its typed overtime_hours iff the job date is in window. Both arms of
--       165:65-67, reproduced.
--   * overtime days: ot_log is empty on a day-billed job (same 'hours' guard), so
--       the typed line always fires and the decorative OT log there is emitted by
--       nothing — which is exactly what metrics_labour does with it: ignore it.
--   * km: identical predicate, one row per trip, summing to km_by_s.
--
-- TWO DATE COLUMNS, and why
-- -------------------------
-- attribution_date is the day metrics_labour COUNTS the line on. line_date is the
-- day the office READS. They differ for exactly one shape, and deliberately: a
-- logged REGULAR shift. metrics_labour takes regular quantity from the scalar
-- job_surveyors.regular_hours and windows it on the JOB date (165:63-64) —
-- job_surveyor_regular (mig 157) is read by no metrics function anywhere. So this
-- function windows regular on the job date too (or it would not reconcile) while
-- printing the shift's own entry_date (or the sheet would lie about the day the
-- man worked). Consequence, and it is the SAME rule the panel footnote already
-- states on screen: an August sheet can carry a line dated 02 September when that
-- shift belongs to a job scheduled in August. Re-windowing regular on entry_date
-- instead would move money between months on a screen already used to pay people,
-- and that is not a reporting-ticket change.
--
-- Overtime and km carry their own date in BOTH columns: a logged OT shift counts on
-- its entry_date and a km trip on its trip_date (migs 125/126), and a shift crossing
-- midnight counts wholly on its START day because entry_date IS the start day
-- (mig 115).
--
-- THE SYNTHETIC "no shift log" LINE
-- ---------------------------------
-- reg_residual and ot_typed_lines exist so the report cannot silently under-report.
-- A typed quantity with no shift behind it is a large fraction of the live regular
-- hours; drop it and the printed sheet comes out smaller than the panel it was
-- printed from, with nothing on the page saying so. Those rows come back with
-- has_shift_log = false so the renderer can mark them, and the two rules are
-- deliberately the OPPOSITE way round from each other:
--
--   * REGULAR is typed MINUS logged (a residual). sync_regular_hours (mig 157) keeps
--     the scalar equal to the log sum on an hours job, so the residual is 0 there and
--     nothing is double-counted; on a days job the log is evidence only and never a
--     quantity, so the residual is the whole typed day count.
--   * OVERTIME is an EXISTENCE test, never a subtraction — `ol.js_id IS NULL`. If a
--     row has ANY OT log entry, metrics_labour discards its typed overtime_hours
--     entirely, INCLUDING when every logged shift falls outside the window and the
--     contribution is 0. Computing typed-minus-logged for overtime would invent hours
--     the panel does not show.
--
-- A DAY-BILLED JOB'S SHIFT LOG
-- ----------------------------
-- A job billed by the day still gets shifts logged against it — the job page shows both
-- time logs on a day-billed job and says outright that "shifts here are a record of the
-- hours worked, not the payable quantity". metrics_labour ignores those rows entirely and
-- so must this function's arithmetic, but DROPPING them would leave the shift-by-shift
-- sheet with no dated lines at all for exactly the jobs whose days the office most needs
-- to check, and would print "no shift log" over work that was logged. So they are emitted
-- with evidence_only = true and qty = 0: the date, the times and the vessel print, the
-- totals do not move, and the typed day count still arrives on its own residual line.
--
-- A NEGATIVE regular residual is possible if job_surveyors.regular_hours was
-- hand-edited below its log sum. It is emitted, not clamped: clamping breaks the
-- reconciliation identity silently, which is the exact failure this report exists to
-- catch.
--
-- What this migration deliberately does NOT do
-- --------------------------------------------
--   * NO PAY COLUMN. Not pay_rate, not overtime_rate, not pay_currency, not
--     regular_pay, not overtime_pay, not app_settings.surveyor_km_rate. Absent, not
--     nulled. The "with pay" variant of the printed report takes its money from the
--     metrics_labour call the Finance page ALREADY makes, so this surface adds zero
--     new pay exposure — and therefore needs no is_admin() gate, no SECURITY DEFINER
--     and no new office permission key. A second pay door is a second door to
--     maintain, and RLS cannot hide a column once a row is readable.
--   * SECURITY INVOKER, like both siblings. RLS on job_surveyors /
--     job_surveyor_regular / job_surveyor_overtime / job_surveyor_km scopes the rows:
--     admin sees everyone, office holding jobs.monitor.view or jobs.detail.view sees
--     everyone, a surveyor sees only their own. Row for row the visibility
--     metrics_labour already has — this widens nothing and narrows nothing.
--   * NO ORDER BY. A set-returning function's order is not contractual; the client
--     sorts (date, then regular → overtime → km, then start time).
--   * It does NOT touch metrics_labour or metrics_labour_by_job. metrics_labour is on
--     the mig-165 body, metrics_labour_by_job still on the mig-148 body; rebuilding
--     either alone can drift the "by-job rows sum to the parent" invariant (mig 126)
--     and would change numbers on a screen already in use.
--
-- LANGUAGE sql, not plpgsql — so the mig-191 landmine (RETURNS TABLE output names
-- being plpgsql variables for the whole body, giving 42702 on a bare matching column)
-- cannot apply; every table is aliased anyway. DROP-then-CREATE rather than CREATE OR
-- REPLACE, matching mig 148: a re-run after any change to the RETURNS TABLE shape
-- would otherwise fail 42P13. Creates no table, so there is no check_function_bodies
-- concern. Idempotent and paste-runnable in the Supabase SQL editor.
-- ============================================================

DROP FUNCTION IF EXISTS public.labour_shift_lines(date, date);

CREATE FUNCTION public.labour_shift_lines(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  line_id          text,     -- 'reg:<uuid>' | 'regx:<js_id>' | 'ot:<uuid>' | 'otx:<js_id>' | 'km:<uuid>'
  surveyor_id      uuid,
  surveyor_name    text,
  job_surveyor_id  uuid,
  job_id           uuid,
  job_number       text,
  job_title        text,
  report_number    text,
  vessel_name      text,
  vessel_type      text,
  voyage_number    text,
  client_name      text,
  labour_unit      text,     -- 'hours' | 'days'
  kind             text,     -- 'regular' | 'overtime' | 'km'
  line_date        date,     -- the day to PRINT
  attribution_date date,     -- the day metrics_labour counts it on
  start_time       text,
  end_date         date,
  end_time         text,
  location         text,
  note             text,
  has_shift_log    boolean,
  evidence_only    boolean,  -- a day-billed job's logged shift: a record, never the quantity
  qty              numeric,  -- hours OR days, per labour_unit; 0 on a km line
  km               numeric   -- 0 on a regular/overtime line
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  -- Same base as metrics_labour (165:33-48) minus every pay column, plus the display
  -- fields the printed sheet needs. clients is LEFT JOINed because jobs.client_id is
  -- nullable and is the only jobs → clients FK.
  WITH base AS (
    SELECT
      js.id            AS js_id,
      js.surveyor_id   AS surveyor_id,
      js.job_id        AS job_id,
      COALESCE(j.labour_unit, 'hours')  AS unit,
      COALESCE(js.regular_hours, 0)     AS reg_hours,
      COALESCE(js.overtime_hours, 0)    AS ot_typed,
      COALESCE(j.scheduled_date, (j.created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS job_date,
      j.job_number     AS job_number,
      j.title          AS job_title,
      j.report_number  AS report_number,
      j.vessel_name    AS vessel_name,
      j.vessel_type    AS vessel_type,
      j.voyage_number  AS voyage_number,
      c.name           AS client_name
    FROM public.job_surveyors js
    JOIN public.jobs j         ON j.id = js.job_id
    LEFT JOIN public.clients c ON c.id = j.client_id
  ),

  -- Existence + in-window sum of the OT log. Verbatim from metrics_labour 165:49-59,
  -- including the `WHERE b.unit = 'hours'` guard (mig 148): on a day-billed job this
  -- CTE is always empty, which is what makes ot_typed_lines fire there.
  ot_log AS (
    SELECT b.js_id AS js_id,
      COALESCE(sum(o.hours) FILTER (
        WHERE (p_from IS NULL OR COALESCE(o.entry_date, b.job_date) >= p_from)
          AND (p_to   IS NULL OR COALESCE(o.entry_date, b.job_date) <= p_to)
      ), 0) AS hours_in
    FROM public.job_surveyor_overtime o
    JOIN base b ON b.js_id = o.job_surveyor_id
    WHERE b.unit = 'hours'
    GROUP BY b.js_id
  ),

  -- Total logged regular hours per row, UNWINDOWED — used only to size the residual.
  -- Same hours-only guard as sync_regular_hours (mig 157): on a day-billed job the
  -- regular log is evidence, never a quantity.
  reg_log AS (
    SELECT b.js_id AS js_id, COALESCE(sum(r.hours), 0) AS hours_all
    FROM public.job_surveyor_regular r
    JOIN base b ON b.js_id = r.job_surveyor_id
    WHERE b.unit = 'hours'
    GROUP BY b.js_id
  ),

  -- (1) REGULAR — one line per logged shift. Windowed on the JOB date (the 165:63-64
  --     predicate, character for character), printed on the shift's own date.
  reg_lines AS (
    SELECT
      'reg:' || r.id::text AS line_id,
      b.surveyor_id        AS surveyor_id,
      b.js_id              AS job_surveyor_id,
      b.job_id             AS job_id,
      b.job_number         AS job_number,
      b.job_title          AS job_title,
      b.report_number      AS report_number,
      b.vessel_name        AS vessel_name,
      b.vessel_type        AS vessel_type,
      b.voyage_number      AS voyage_number,
      b.client_name        AS client_name,
      b.unit               AS labour_unit,
      'regular'::text      AS kind,
      COALESCE(r.entry_date, b.job_date) AS line_date,
      b.job_date           AS attribution_date,
      r.start_time         AS start_time,
      r.end_date           AS end_date,
      r.end_time           AS end_time,
      r.location           AS location,
      r.note               AS note,
      true                 AS has_shift_log,
      (b.unit <> 'hours')  AS evidence_only,
      -- On a day-billed job the shift log is EVIDENCE, never the payable quantity
      -- (mig 157's own rule, and what the job page tells the surveyor on screen). The
      -- shift still prints — with its date and its times, which is the entire point of a
      -- shift-by-shift sheet — but it carries 0, so every reconciliation identity above
      -- is untouched and the typed day count still arrives as the residual line.
      CASE WHEN b.unit = 'hours' THEN r.hours ELSE 0 END::numeric AS qty,
      0::numeric           AS km
    FROM public.job_surveyor_regular r
    JOIN base b ON b.js_id = r.job_surveyor_id
    WHERE (p_from IS NULL OR b.job_date >= p_from)
      AND (p_to   IS NULL OR b.job_date <= p_to)
  ),

  -- (2) REGULAR residual — the synthetic "no shift log" line. Covers a typed quantity
  --     with no log at all, a day-billed job's typed day count (reg_log is empty there
  --     by construction), and any hand-edited scalar that drifted from its log. Emitted
  --     only when non-zero, so a fully-logged hours row produces nothing at all and
  --     nothing is ever double-counted.
  reg_residual AS (
    SELECT
      'regx:' || b.js_id::text AS line_id,
      b.surveyor_id        AS surveyor_id,
      b.js_id              AS job_surveyor_id,
      b.job_id             AS job_id,
      b.job_number         AS job_number,
      b.job_title          AS job_title,
      b.report_number      AS report_number,
      b.vessel_name        AS vessel_name,
      b.vessel_type        AS vessel_type,
      b.voyage_number      AS voyage_number,
      b.client_name        AS client_name,
      b.unit               AS labour_unit,
      'regular'::text      AS kind,
      b.job_date           AS line_date,
      b.job_date           AS attribution_date,
      NULL::text           AS start_time,
      NULL::date           AS end_date,
      NULL::text           AS end_time,
      NULL::text           AS location,
      NULL::text           AS note,
      false                AS has_shift_log,
      false                AS evidence_only,
      (b.reg_hours - COALESCE(rl.hours_all, 0))::numeric AS qty,
      0::numeric           AS km
    FROM base b
    LEFT JOIN reg_log rl ON rl.js_id = b.js_id
    WHERE (p_from IS NULL OR b.job_date >= p_from)
      AND (p_to   IS NULL OR b.job_date <= p_to)
      AND (b.reg_hours - COALESCE(rl.hours_all, 0)) <> 0
  ),

  -- (3) OVERTIME — one line per logged shift, in window BY ITS OWN entry_date
  --     (165:52-53 verbatim). A shift crossing midnight counts wholly on its start day
  --     because entry_date is the start day (mig 115).
  ot_lines AS (
    SELECT
      'ot:' || o.id::text  AS line_id,
      b.surveyor_id        AS surveyor_id,
      b.js_id              AS job_surveyor_id,
      b.job_id             AS job_id,
      b.job_number         AS job_number,
      b.job_title          AS job_title,
      b.report_number      AS report_number,
      b.vessel_name        AS vessel_name,
      b.vessel_type        AS vessel_type,
      b.voyage_number      AS voyage_number,
      b.client_name        AS client_name,
      b.unit               AS labour_unit,
      'overtime'::text     AS kind,
      COALESCE(o.entry_date, b.job_date) AS line_date,
      -- An hours job's OT shift counts on its own entry_date; a day-billed job's OT log
      -- counts nowhere at all (it carries 0), so it rides the job date to land on the
      -- same sheet as the typed day count it is evidence for.
      CASE WHEN b.unit = 'hours' THEN COALESCE(o.entry_date, b.job_date) ELSE b.job_date END AS attribution_date,
      o.start_time         AS start_time,
      o.end_date           AS end_date,
      o.end_time           AS end_time,
      o.location           AS location,
      o.note               AS note,
      true                 AS has_shift_log,
      (b.unit <> 'hours')  AS evidence_only,
      CASE WHEN b.unit = 'hours' THEN o.hours ELSE 0 END::numeric AS qty,
      0::numeric           AS km
    FROM public.job_surveyor_overtime o
    JOIN base b ON b.js_id = o.job_surveyor_id
    WHERE (
      (b.unit = 'hours'
        AND (p_from IS NULL OR COALESCE(o.entry_date, b.job_date) >= p_from)
        AND (p_to   IS NULL OR COALESCE(o.entry_date, b.job_date) <= p_to))
      OR
      (b.unit <> 'hours'
        AND (p_from IS NULL OR b.job_date >= p_from)
        AND (p_to   IS NULL OR b.job_date <= p_to))
    )
  ),

  -- (4) OVERTIME typed — ONLY where no OT log row exists AT ALL. This reproduces
  --     165:65-67's `CASE WHEN ol.js_id IS NOT NULL`, which is an EXISTENCE test and
  --     not a value test. Never compute typed minus logged for overtime.
  ot_typed_lines AS (
    SELECT
      'otx:' || b.js_id::text AS line_id,
      b.surveyor_id        AS surveyor_id,
      b.js_id              AS job_surveyor_id,
      b.job_id             AS job_id,
      b.job_number         AS job_number,
      b.job_title          AS job_title,
      b.report_number      AS report_number,
      b.vessel_name        AS vessel_name,
      b.vessel_type        AS vessel_type,
      b.voyage_number      AS voyage_number,
      b.client_name        AS client_name,
      b.unit               AS labour_unit,
      'overtime'::text     AS kind,
      b.job_date           AS line_date,
      b.job_date           AS attribution_date,
      NULL::text           AS start_time,
      NULL::date           AS end_date,
      NULL::text           AS end_time,
      NULL::text           AS location,
      NULL::text           AS note,
      false                AS has_shift_log,
      false                AS evidence_only,
      b.ot_typed::numeric  AS qty,
      0::numeric           AS km
    FROM base b
    LEFT JOIN ot_log ol ON ol.js_id = b.js_id
    WHERE ol.js_id IS NULL
      AND (p_from IS NULL OR b.job_date >= p_from)
      AND (p_to   IS NULL OR b.job_date <= p_to)
      AND b.ot_typed <> 0
  ),

  -- (5) KM — one line per trip, on its own trip_date. 165:80-81 verbatim, including the
  --     COALESCE fallback to the job date for a trip that was never dated.
  km_lines AS (
    SELECT
      'km:' || k.id::text  AS line_id,
      b.surveyor_id        AS surveyor_id,
      b.js_id              AS job_surveyor_id,
      b.job_id             AS job_id,
      b.job_number         AS job_number,
      b.job_title          AS job_title,
      b.report_number      AS report_number,
      b.vessel_name        AS vessel_name,
      b.vessel_type        AS vessel_type,
      b.voyage_number      AS voyage_number,
      b.client_name        AS client_name,
      b.unit               AS labour_unit,
      'km'::text           AS kind,
      COALESCE(k.trip_date, b.job_date) AS line_date,
      COALESCE(k.trip_date, b.job_date) AS attribution_date,
      NULL::text           AS start_time,
      NULL::date           AS end_date,
      NULL::text           AS end_time,
      NULL::text           AS location,
      k.note               AS note,
      true                 AS has_shift_log,
      false                AS evidence_only,
      0::numeric           AS qty,
      k.km::numeric        AS km
    FROM public.job_surveyor_km k
    JOIN base b ON b.js_id = k.job_surveyor_id
    WHERE (p_from IS NULL OR COALESCE(k.trip_date, b.job_date) >= p_from)
      AND (p_to   IS NULL OR COALESCE(k.trip_date, b.job_date) <= p_to)
  ),

  -- The branches project the SAME named columns in the SAME order on purpose:
  -- job_surveyor_regular and job_surveyor_overtime do not share a column order on disk
  -- (end_date sits mid-table in one and was appended by mig 115 in the other), so a
  -- positional star over the base tables would type-check and silently swap columns.
  -- The stars below are over these CTEs, whose shapes are written out above.
  all_lines AS (
    SELECT * FROM reg_lines
    UNION ALL SELECT * FROM reg_residual
    UNION ALL SELECT * FROM ot_lines
    UNION ALL SELECT * FROM ot_typed_lines
    UNION ALL SELECT * FROM km_lines
  )
  SELECT
    u.line_id,
    u.surveyor_id,
    -- The person, then their title as a fallback for a profile with no name. Identical
    -- to metrics_labour 165:117 so the two surfaces name people the same way.
    COALESCE(NULLIF(TRIM(p.full_name), ''), p.display_title, 'Unknown') AS surveyor_name,
    u.job_surveyor_id,
    u.job_id,
    u.job_number,
    u.job_title,
    u.report_number,
    u.vessel_name,
    u.vessel_type,
    u.voyage_number,
    u.client_name,
    u.labour_unit,
    u.kind,
    u.line_date,
    u.attribution_date,
    u.start_time,
    u.end_date,
    u.end_time,
    u.location,
    u.note,
    u.has_shift_log,
    u.evidence_only,
    u.qty,
    u.km
  FROM all_lines u
  LEFT JOIN public.profiles p ON p.id = u.surveyor_id;
$$;

COMMENT ON FUNCTION public.labour_shift_lines(date, date) IS
  'Shift-grain twin of metrics_labour (mig 165): one row per logged regular shift, per
   logged overtime shift and per km trip, plus a synthetic has_shift_log=false line for
   any typed quantity with no shift behind it, and evidence_only=true lines carrying qty 0
   for a day-billed job''s logged shifts (a record of the hours worked, never the payable
   quantity). Windowing predicates are copied verbatim
   from metrics_labour so per-surveyor totals reconcile exactly - regular hours, overtime
   hours, regular days, overtime days and km. attribution_date is the day the total counts
   on; line_date is the day to print (they differ only for a logged regular shift, which
   metrics_labour attributes to the job date). Carries NO pay column by design: the pay
   variant of the printed report takes its money from metrics_labour, which is already
   gated. SECURITY INVOKER - RLS scopes the rows exactly as it does for metrics_labour.
   Never sum hours and days: qty is expressed in labour_unit.';

REVOKE EXECUTE ON FUNCTION public.labour_shift_lines(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.labour_shift_lines(date, date) TO authenticated;
