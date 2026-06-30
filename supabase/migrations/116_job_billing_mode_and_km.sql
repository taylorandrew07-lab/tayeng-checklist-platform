-- ============================================================
-- Migration 116: per-job billing mode + per-surveyor kilometre log + per-km rate.
-- Idempotent.
--
--  - jobs.billing_mode: how the job is billed — 'overtime' | 'regular' | 'fixed'.
--    Becomes the source of truth for which hours UI shows; is_overtime is kept in
--    lockstep (= mode 'overtime') so the jobs-list OT filter/badge/CSV and analytics
--    keep working untouched. Backfilled once from is_overtime.
--  - job_surveyor_km: a trip log per surveyor-on-job (date + km + note). Surveyors
--    drive to every job; each trip is 10–140 km, whole numbers. Mirrors the
--    job_surveyor_overtime time-log (mig 111) — same RLS shape.
--  - client_rates.rate_type gains 'per_km' so a client can carry a mileage rate; the
--    invoice builder auto-adds a "Mileage — N km" line from the job's total km.
-- ============================================================

-- 1. Job billing mode -----------------------------------------------------------
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'regular'
  CHECK (billing_mode IN ('overtime','regular','fixed'));

-- Backfill once: existing overtime jobs → 'overtime', everything else stays 'regular'.
-- Guarded so a re-run doesn't clobber modes set since (only touches untouched rows).
UPDATE public.jobs SET billing_mode = 'overtime'
  WHERE is_overtime = true AND billing_mode = 'regular';

-- 2. Per-surveyor kilometre trip log -------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_surveyor_km (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_surveyor_id  UUID NOT NULL REFERENCES public.job_surveyors(id) ON DELETE CASCADE,
  trip_date        DATE,
  km               INTEGER NOT NULL CHECK (km BETWEEN 10 AND 140),
  note             TEXT,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jskm_job_surveyor ON public.job_surveyor_km(job_surveyor_id);

ALTER TABLE public.job_surveyor_km ENABLE ROW LEVEL SECURITY;

-- Read: same visibility as the parent job_surveyors row (the surveyor, admins, or the
-- office permissions that can see jobs). Mirrors job_surveyor_overtime (mig 111).
DROP POLICY IF EXISTS "Read km entries" ON public.job_surveyor_km;
CREATE POLICY "Read km entries" ON public.job_surveyor_km
  FOR SELECT USING (
    public.is_admin()
    OR public.has_office_permission('jobs.monitor.view')
    OR public.has_office_permission('jobs.detail.view')
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid())
  );

-- Manage: admins for any, surveyors for their own entries.
DROP POLICY IF EXISTS "Admins manage km entries" ON public.job_surveyor_km;
CREATE POLICY "Admins manage km entries" ON public.job_surveyor_km
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Surveyors manage own km entries" ON public.job_surveyor_km;
CREATE POLICY "Surveyors manage own km entries" ON public.job_surveyor_km
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid()));

-- 3. Per-km client rate ---------------------------------------------------------
ALTER TABLE public.client_rates DROP CONSTRAINT IF EXISTS client_rates_rate_type_check;
ALTER TABLE public.client_rates ADD CONSTRAINT client_rates_rate_type_check
  CHECK (rate_type IN ('fixed','hourly','per_unit','per_km'));
