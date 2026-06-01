-- ============================================================
-- Migration 012: Scope storage upload policy to active admins/surveyors
-- Run in Supabase SQL Editor.
-- ============================================================

-- Remove the broad "any authenticated user can upload" policies
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin or surveyor can upload job photos" ON storage.objects;

-- Only active admins and active surveyors can upload job photos
CREATE POLICY "Admin or surveyor can upload job photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'surveyor')
        AND is_active = true
    )
  );

-- Confirm scoped delete is in place (idempotent; migration 010 may have set this already)
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
      OR owner = auth.uid()
    )
  );
