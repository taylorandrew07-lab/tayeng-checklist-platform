-- ============================================================
-- Migration 111: multi-day jobs + per-surveyor overtime time-log. Idempotent.
--
-- For long jobs (e.g. a 7-day methanol cargo loadout) tracked as overtime with many
-- surveyors and NO checklist:
--  - jobs.end_date: the "date to". scheduled_date stays the "date from" (start). A
--    null end_date means a single-day job, unchanged.
--  - job_surveyor_overtime: a time-log per surveyor-on-job — date + start/end + the
--    computed hours. The sum of a surveyor's entries rolls into
--    job_surveyors.overtime_hours (which already bills at the overtime rate), so
--    invoicing is unchanged; this just lets you punch in the times instead of a total.
--  - "Extended Cargo Loadout" job type for categorising these.
-- ============================================================

INSERT INTO public.job_types (name)
  SELECT 'Extended Cargo Loadout'
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types WHERE name = 'Extended Cargo Loadout');

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS end_date DATE;

CREATE TABLE IF NOT EXISTS public.job_surveyor_overtime (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_surveyor_id  UUID NOT NULL REFERENCES public.job_surveyors(id) ON DELETE CASCADE,
  entry_date       DATE,
  start_time       TEXT,          -- 'HH:MM'
  end_time         TEXT,          -- 'HH:MM' (may be earlier than start = crosses midnight)
  hours            NUMERIC NOT NULL DEFAULT 0,
  note             TEXT,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jso_job_surveyor ON public.job_surveyor_overtime(job_surveyor_id);

ALTER TABLE public.job_surveyor_overtime ENABLE ROW LEVEL SECURITY;

-- Read: same visibility as the parent job_surveyors row (the surveyor, admins, or the
-- office permissions that can see jobs).
DROP POLICY IF EXISTS "Read overtime entries" ON public.job_surveyor_overtime;
CREATE POLICY "Read overtime entries" ON public.job_surveyor_overtime
  FOR SELECT USING (
    public.is_admin()
    OR public.has_office_permission('jobs.monitor.view')
    OR public.has_office_permission('jobs.detail.view')
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid())
  );

-- Manage: admins for any, surveyors for their own entries (mirrors "Surveyors update
-- own hours" on job_surveyors).
DROP POLICY IF EXISTS "Admins manage overtime entries" ON public.job_surveyor_overtime;
CREATE POLICY "Admins manage overtime entries" ON public.job_surveyor_overtime
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Surveyors manage own overtime entries" ON public.job_surveyor_overtime;
CREATE POLICY "Surveyors manage own overtime entries" ON public.job_surveyor_overtime
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.id = job_surveyor_id AND js.surveyor_id = auth.uid()));
