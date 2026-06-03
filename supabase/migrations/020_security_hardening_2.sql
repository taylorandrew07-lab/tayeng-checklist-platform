-- ============================================================
-- Migration 020: Security hardening, round 2 (RLS + trigger)
-- Run in Supabase SQL Editor. Idempotent.
--
-- Addresses a second audit:
--   H1  Surveyors could change protected job columns / set any status
--   H2  Clients couldn't read template_sections -> empty checklist/PDF
--   M3  client_job_permissions readable even when can_view_status = false
--   M4  Storage photo delete was owner-based, not job-scoped
-- ============================================================


-- ============================================================
-- H1  Restrict surveyor UPDATEs on jobs to safe columns/status.
--     RLS can't do column-level UPDATE rules, so use a trigger that
--     only constrains the 'surveyor' role (admins/service unaffected).
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() = 'surveyor' THEN
    -- Surveyors may not re-template, reassign, re-client, or rewrite identity columns.
    IF NEW.template_id  IS DISTINCT FROM OLD.template_id
       OR NEW.client_id   IS DISTINCT FROM OLD.client_id
       OR NEW.job_number  IS DISTINCT FROM OLD.job_number
       OR NEW.created_by  IS DISTINCT FROM OLD.created_by
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Surveyors may only move a job forward to in_progress or submitted.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('in_progress', 'submitted') THEN
      RAISE EXCEPTION 'Surveyors may not set job status to %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_surveyor_job_update ON jobs;
CREATE TRIGGER trg_enforce_surveyor_job_update
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION enforce_surveyor_job_update();


-- ============================================================
-- H2  Clients must be able to read template_sections for permitted jobs
--     (mirrors the existing template_fields client policy), otherwise the
--     checklist detail view and PDF render empty.
-- ============================================================
DROP POLICY IF EXISTS "Clients can view template sections for permitted jobs" ON template_sections;

CREATE POLICY "Clients can view template sections for permitted jobs"
  ON template_sections FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM jobs j
      JOIN client_job_permissions cjp ON cjp.job_id = j.id
      WHERE j.template_id = template_sections.template_id
        AND cjp.client_id = get_my_client_id()
        AND cjp.can_view_status = true
        AND cjp.can_view_checklist_details = true
    )
  );


-- ============================================================
-- M3  Hide permission rows entirely when can_view_status is off, so a
--     client can't enumerate job IDs / flags via direct REST.
-- ============================================================
DROP POLICY IF EXISTS "Clients can view own permissions" ON client_job_permissions;

CREATE POLICY "Clients can view own permissions"
  ON client_job_permissions FOR SELECT
  USING (
    get_my_role() = 'client'
    AND client_id = get_my_client_id()
    AND can_view_status = true
  );


-- ============================================================
-- M4  Scope photo deletes to the job folder (mirror the upload/read
--     policies): active admins any job; active surveyors only jobs they
--     own/are assigned. Replaces the broad owner-based delete.
-- ============================================================
DROP POLICY IF EXISTS "Admin or uploader can delete job photos" ON storage.objects;

CREATE POLICY "Admin or uploader can delete job photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'job-photos'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin' AND is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id::text = split_part(name, '/', 1)
          AND (j.assigned_to = auth.uid() OR j.created_by = auth.uid())
          AND p.role = 'surveyor'
          AND p.is_active = true
      )
    )
  );
