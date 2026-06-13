-- ============================================================
-- Migration 042: Job → report tracker foundation (Phase 1)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Turns "jobs" into the central tracker line. Every job has a TYPE and a
-- REPORT NUMBER. Checklist types (Fuel, Brine, ...) carry a template; report-
-- only types (Draft Survey) do not — but both are one tracked job with a report.
--
-- Phase 1 is ADMIN-DRIVEN (no secretary/office-write layer yet): admins create/
-- manage jobs, approve reports, mark paid/closed; surveyors upload their own
-- preliminary reports + VOS; office stays read-only. Money (invoices, rates,
-- overtime pay), M365 draft-email, and reconciliation are later phases.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Generalize the jobs table
-- ------------------------------------------------------------
ALTER TABLE public.jobs ALTER COLUMN template_id DROP NOT NULL;          -- report-only jobs have no checklist
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS job_type           TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS report_number      TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS workflow_status    TEXT NOT NULL DEFAULT 'new';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS report_approved_at TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS report_approved_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS closed_at          TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS closed_by          UUID REFERENCES public.profiles(id);

-- The ops lifecycle (separate from the checklist `status`).
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_workflow_status_chk;
ALTER TABLE public.jobs ADD  CONSTRAINT jobs_workflow_status_chk
  CHECK (workflow_status IN ('new','assigned','report_uploaded','report_approved','invoiced','sent','paid','closed'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_report_number ON public.jobs (report_number) WHERE report_number IS NOT NULL;

-- Seed sensible workflow_status for pre-existing jobs (one-time; only touches
-- the just-added default 'new').
UPDATE public.jobs SET workflow_status =
  CASE
    WHEN status::text IN ('submitted','completed','client_visible') THEN 'report_uploaded'
    WHEN status::text = 'archived' THEN 'closed'
    ELSE 'new'
  END
WHERE workflow_status = 'new';

-- ------------------------------------------------------------
-- 2. Report numbering — YY/MM/NNN, NNN resets to 001 each Feb 1 (fiscal year).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_counters (
  fiscal_year INTEGER PRIMARY KEY,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic upsert-and-increment → concurrency safe. Fiscal year runs Feb 1–Jan 31.
CREATE OR REPLACE FUNCTION public.next_report_number()
RETURNS TEXT AS $$
DECLARE
  fy  INTEGER;
  seq INTEGER;
BEGIN
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2
             THEN EXTRACT(YEAR FROM NOW())::INT
             ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.report_counters (fiscal_year, last_seq)
  VALUES (fy, 1)
  ON CONFLICT (fiscal_year) DO UPDATE
    SET last_seq = public.report_counters.last_seq + 1, updated_at = NOW()
  RETURNING last_seq INTO seq;
  RETURN to_char(NOW(), 'YY/MM/') || lpad(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Assign a report number on insert when one isn't supplied.
CREATE OR REPLACE FUNCTION public.set_report_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.report_number IS NULL THEN
    NEW.report_number := public.next_report_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS jobs_set_report_number ON public.jobs;
CREATE TRIGGER jobs_set_report_number
  BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_report_number();

-- ------------------------------------------------------------
-- 3. Admin-only guard on paid/closed transitions (defence in depth — even if a
--    surveyor updates their own job, only an admin can mark it paid/closed).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_admin_paid_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_status IN ('paid','closed')
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can mark a job paid or closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS jobs_admin_paid_closed ON public.jobs;
CREATE TRIGGER jobs_admin_paid_closed
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_paid_closed();

-- ------------------------------------------------------------
-- 4. Job types (admin-managed list; report-only types have no template).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_types (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.job_types (name) VALUES
  ('Draft Survey'), ('Bunker Survey'), ('Fuel'), ('Brine')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.job_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read job types" ON public.job_types;
CREATE POLICY "Staff read job types" ON public.job_types
  FOR SELECT USING (public.is_active_staff() OR public.is_office());
DROP POLICY IF EXISTS "Admins manage job types" ON public.job_types;
CREATE POLICY "Admins manage job types" ON public.job_types
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 5. job_surveyors — multiple surveyors per job (each with their own line).
--    Backfilled from the existing single assigned_to so nothing loses access.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_surveyors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id      UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  surveyor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, surveyor_id)
);
CREATE INDEX IF NOT EXISTS idx_job_surveyors_job      ON public.job_surveyors (job_id);
CREATE INDEX IF NOT EXISTS idx_job_surveyors_surveyor ON public.job_surveyors (surveyor_id);

INSERT INTO public.job_surveyors (job_id, surveyor_id)
  SELECT id, assigned_to FROM public.jobs WHERE assigned_to IS NOT NULL
  ON CONFLICT (job_id, surveyor_id) DO NOTHING;

ALTER TABLE public.job_surveyors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read job surveyors" ON public.job_surveyors;
CREATE POLICY "Read job surveyors" ON public.job_surveyors
  FOR SELECT USING (surveyor_id = auth.uid() OR public.is_admin() OR public.has_office_permission('jobs.monitor.view') OR public.has_office_permission('jobs.detail.view'));
DROP POLICY IF EXISTS "Admins manage job surveyors" ON public.job_surveyors;
CREATE POLICY "Admins manage job surveyors" ON public.job_surveyors
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 6. Surveyor job access keyed on membership OR the legacy assigned_to.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Surveyors can view own jobs" ON public.jobs;
CREATE POLICY "Surveyors can view own jobs" ON public.jobs
  FOR SELECT USING (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = auth.uid()
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Surveyors can update own jobs" ON public.jobs;
CREATE POLICY "Surveyors can update own jobs" ON public.jobs
  FOR UPDATE USING (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = auth.uid()
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = auth.uid())
    )
  ) WITH CHECK (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = auth.uid()
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 7. job_attachments — preliminary/final reports, VOS, time pages.
--    Private 'job-files' bucket, path = {job_id}/{file}.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_attachments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('preliminary','final','vos','time_page','other')),
  doc_name     TEXT,
  storage_path TEXT,
  content_type TEXT,
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_attachments_job ON public.job_attachments (job_id);

-- Helper: is the current user a member of (or admin on) a job?
CREATE OR REPLACE FUNCTION public.can_access_job(p_job UUID)
RETURNS BOOLEAN AS $$
  SELECT public.is_admin()
      OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.assigned_to = auth.uid())
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = p_job AND js.surveyor_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

ALTER TABLE public.job_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read job attachments" ON public.job_attachments;
CREATE POLICY "Read job attachments" ON public.job_attachments
  FOR SELECT USING (public.can_access_job(job_id) OR public.has_office_permission('jobs.detail.view'));
DROP POLICY IF EXISTS "Members add job attachments" ON public.job_attachments;
CREATE POLICY "Members add job attachments" ON public.job_attachments
  FOR INSERT WITH CHECK (public.can_access_job(job_id));
DROP POLICY IF EXISTS "Admins manage job attachments" ON public.job_attachments;
CREATE POLICY "Admins manage job attachments" ON public.job_attachments
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO storage.buckets (id, name, public) VALUES ('job-files', 'job-files', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Read job files" ON storage.objects;
CREATE POLICY "Read job files" ON storage.objects
  FOR SELECT USING (bucket_id = 'job-files' AND public.can_access_job(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS "Members upload job files" ON storage.objects;
CREATE POLICY "Members upload job files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'job-files' AND public.can_access_job(((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS "Admins delete job files" ON storage.objects;
CREATE POLICY "Admins delete job files" ON storage.objects
  FOR DELETE USING (bucket_id = 'job-files' AND public.is_admin());

-- ------------------------------------------------------------
-- 8. activity_log — append-only audit of who did what.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity     TEXT NOT NULL,
  entity_id  UUID,
  action     TEXT NOT NULL,
  actor_id   UUID REFERENCES public.profiles(id),
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON public.activity_log (entity, entity_id);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read activity log" ON public.activity_log;
CREATE POLICY "Read activity log" ON public.activity_log
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('jobs.detail.view'));
DROP POLICY IF EXISTS "Staff write activity log" ON public.activity_log;
CREATE POLICY "Staff write activity log" ON public.activity_log
  FOR INSERT WITH CHECK ((public.is_active_staff() OR public.is_office()) AND actor_id = auth.uid());
