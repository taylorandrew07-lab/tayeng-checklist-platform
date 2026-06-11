-- ============================================================
-- Migration 033: Security hardening (audit follow-ups)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
--  1. Fix a real bug: surveyor-created jobs could not grant their client access
--     (no INSERT policy on client_job_permissions for surveyors), so the create
--     flow's permission insert was silently denied and the client never saw the
--     job. Allow a surveyor to grant access ONLY for a job they created.
--  2. Lock update_updated_at's search_path.
--  3. Cap storage file sizes; restrict client-logos to raster images (no SVG).
-- ============================================================

-- 1. Surveyors may grant a client visibility of a job they themselves created.
DROP POLICY IF EXISTS "Surveyors grant client access to own jobs" ON public.client_job_permissions;
CREATE POLICY "Surveyors grant client access to own jobs" ON public.client_job_permissions
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.created_by = auth.uid())
  );

-- 2. Lock the shared updated_at trigger's search_path.
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 3. Storage limits (bytes). Private evidence/doc buckets get a generous cap; the
--    PUBLIC client-logos bucket is restricted to raster images so an uploaded SVG
--    can't carry script.
UPDATE storage.buckets SET file_size_limit = 26214400  WHERE id IN ('job-photos', 'cargo-photos');   -- 25 MB
UPDATE storage.buckets SET file_size_limit = 52428800  WHERE id IN ('vessel-documents', 'job-pdfs'); -- 50 MB
UPDATE storage.buckets
  SET file_size_limit = 5242880,                                                                      -- 5 MB
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
  WHERE id = 'client-logos';
