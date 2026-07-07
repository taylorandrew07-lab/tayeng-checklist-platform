-- ============================================================
-- Migration 135: Labour-ledger integrity — OT-log sync + change tracking. Idempotent.
--
-- Audit L2: job_surveyors.overtime_hours was kept in sync with the OT shift log
-- (job_surveyor_overtime) only by client code, so an out-of-band edit made Finance
-- and the Team hub disagree. A DB trigger now recomputes it from the log itself.
--
-- Audit L1 (infra): job_surveyors had no updated_at, so nothing could tell whether
-- a billed job's labour was edited AFTER it was invoiced. Add updated_at (seeded to
-- created_at so historical rows don't look "changed") + a bump trigger; the
-- Reconcile tab uses it. The OT-sync trigger also touches job_surveyors, so OT-log
-- edits bump updated_at too.
-- ============================================================

-- 1. Keep overtime_hours = sum(OT shift log) whenever the log changes (L2). ------
-- Backfill first (before the updated_at bump trigger exists, so it doesn't move
-- updated_at): reconcile any rows that HAVE a log — the log is the source of truth
-- there; rows with no log keep their typed value.
UPDATE public.job_surveyors js
  SET overtime_hours = COALESCE(
    (SELECT sum(o.hours) FROM public.job_surveyor_overtime o WHERE o.job_surveyor_id = js.id), 0)
  WHERE EXISTS (SELECT 1 FROM public.job_surveyor_overtime o WHERE o.job_surveyor_id = js.id);

CREATE OR REPLACE FUNCTION public.sync_overtime_hours()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_js uuid;
BEGIN
  v_js := COALESCE(NEW.job_surveyor_id, OLD.job_surveyor_id);
  UPDATE public.job_surveyors
    SET overtime_hours = COALESCE(
      (SELECT sum(o.hours) FROM public.job_surveyor_overtime o WHERE o.job_surveyor_id = v_js), 0)
    WHERE id = v_js;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_overtime_hours ON public.job_surveyor_overtime;
CREATE TRIGGER trg_sync_overtime_hours
  AFTER INSERT OR UPDATE OR DELETE ON public.job_surveyor_overtime
  FOR EACH ROW EXECUTE FUNCTION public.sync_overtime_hours();

-- 2. job_surveyors.updated_at for change tracking (L1). ------------------------
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
-- Seed existing rows to created_at so already-billed jobs aren't all flagged as
-- "edited after invoicing" the moment this ships.
UPDATE public.job_surveyors SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE public.job_surveyors ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE public.job_surveyors ALTER COLUMN updated_at SET NOT NULL;

DROP TRIGGER IF EXISTS job_surveyors_updated_at ON public.job_surveyors;
CREATE TRIGGER job_surveyors_updated_at
  BEFORE UPDATE ON public.job_surveyors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
