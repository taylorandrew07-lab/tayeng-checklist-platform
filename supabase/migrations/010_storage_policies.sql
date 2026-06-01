-- ============================================================
-- Migration 010: Tighten storage object policies
-- Run in Supabase SQL Editor (storage schema is accessible there).
-- ============================================================

-- Remove old broad policies if they exist
DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins and surveyors can read photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth read photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read job photos" ON storage.objects;
DROP POLICY IF EXISTS "Admin or uploader can delete job photos" ON storage.objects;

-- Upload: any authenticated user (RLS on job_photos handles scoping)
CREATE POLICY "Authenticated upload job photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-photos'
    AND auth.role() = 'authenticated'
  );

-- Read: any authenticated user
CREATE POLICY "Authenticated read job photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND auth.role() = 'authenticated'
  );

-- Delete: admin or the user who uploaded (owner)
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
