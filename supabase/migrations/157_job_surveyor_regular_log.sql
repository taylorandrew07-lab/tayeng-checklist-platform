-- ============================================================
-- Migration 157: per-surveyor REGULAR time-log — the twin of the overtime log
-- (mig 111/115/135/148), for multi-day REGULAR-hours jobs. Idempotent.
--
-- Why: a long regular-hours job (e.g. a week-long attendance) had no way to record
-- the individual shifts behind the one regular_hours number — only overtime jobs did.
-- This adds an identical shift log whose total drives job_surveyors.regular_hours,
-- exactly as job_surveyor_overtime drives overtime_hours.
--
-- Design mirrors the OT log deliberately (same columns → the UI reuses shiftHours/
-- fmtSpan):
--   * NEW table (not a 'kind' column on job_surveyor_overtime) so no existing
--     sum(hours) money-seam — sync_overtime_hours + metrics_labour(_by_job) — has to
--     grow a WHERE filter. Fully additive.
--   * sync_regular_hours re-sums the log into job_surveyors.regular_hours, but ONLY on
--     an hours-billed job — the COALESCE(labour_unit,'hours')='hours' guard is the exact
--     analogue of mig-148 for OT, so a day-billed job's hand-typed day count is never
--     overwritten by a sum of logged hours.
--   * RLS = the OT table's, with mig-117's job_is_open() close-lock folded into the
--     surveyor write policy from the start. Self-scoped: a surveyor manages only the
--     entries under their OWN job_surveyors row; admins manage all; office read mirrors
--     job visibility. (No sensitive columns here, so a single table is fine.)
-- No backfill — brand-new table starts empty.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_surveyor_regular (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_surveyor_id  UUID NOT NULL REFERENCES public.job_surveyors(id) ON DELETE CASCADE,
  entry_date       DATE,          -- START date (YYYY-MM-DD)
  start_time       TEXT,          -- START time (HH:MM)
  end_date         DATE,          -- STOP date; may be a later day than entry_date
  end_time         TEXT,          -- STOP time (HH:MM)
  hours            NUMERIC NOT NULL DEFAULT 0,
  location         TEXT,
  note             TEXT,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jsr_job_surveyor ON public.job_surveyor_regular(job_surveyor_id);

-- Summing trigger — keep job_surveyors.regular_hours = sum(log.hours), hours-billed only.
CREATE OR REPLACE FUNCTION public.sync_regular_hours()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_js uuid;
BEGIN
  v_js := COALESCE(NEW.job_surveyor_id, OLD.job_surveyor_id);
  UPDATE public.job_surveyors js
     SET regular_hours = COALESCE(
       (SELECT sum(r.hours) FROM public.job_surveyor_regular r WHERE r.job_surveyor_id = v_js), 0)
   WHERE js.id = v_js
     AND EXISTS (
       SELECT 1 FROM public.jobs j
       WHERE j.id = js.job_id AND COALESCE(j.labour_unit, 'hours') = 'hours'
     );
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_regular_hours ON public.job_surveyor_regular;
CREATE TRIGGER trg_sync_regular_hours
  AFTER INSERT OR UPDATE OR DELETE ON public.job_surveyor_regular
  FOR EACH ROW EXECUTE FUNCTION public.sync_regular_hours();

-- RLS — mirrors job_surveyor_overtime (mig 111) + the mig-117 job_is_open write guard.
ALTER TABLE public.job_surveyor_regular ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read regular entries" ON public.job_surveyor_regular;
CREATE POLICY "Read regular entries" ON public.job_surveyor_regular
  FOR SELECT USING (
    public.is_admin()
    OR public.has_office_permission('jobs.monitor.view')
    OR public.has_office_permission('jobs.detail.view')
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()))
  );

DROP POLICY IF EXISTS "Admins manage regular entries" ON public.job_surveyor_regular;
CREATE POLICY "Admins manage regular entries" ON public.job_surveyor_regular
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Surveyors manage own regular entries" ON public.job_surveyor_regular;
CREATE POLICY "Surveyors manage own regular entries" ON public.job_surveyor_regular
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)));
