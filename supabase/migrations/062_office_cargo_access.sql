-- ============================================================
-- Migration 062: Office read access to synced cargo voyages (for DRI reports)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Lets office staff who hold the new 'cargo.view' permission open synced cargo
-- voyages from the cloud and generate the DRI Production Report (PDF/.docx).
-- Read-only: no INSERT/UPDATE/DELETE policies are granted to office, so they can
-- view and generate but never alter the surveyor's synced document.
--
-- Mirrors the office-permission pattern from migration 025 (has_office_permission)
-- and the cargo RLS from 027/028.
-- ============================================================

-- 1. Catalog entry so it appears on the admin "office permissions" screen.
INSERT INTO public.office_permission_catalog (key, label, description, category) VALUES
  ('cargo.view', 'View cargo reports', 'Open synced cargo voyages and generate the DRI Production Report (PDF/.docx).', 'cargo')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;

-- 2. Office may SELECT cargo voyages + photos when granted 'cargo.view'.
DROP POLICY IF EXISTS "Office read cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Office read cargo_voyages" ON public.cargo_voyages
  FOR SELECT USING (public.has_office_permission('cargo.view'));

DROP POLICY IF EXISTS "Office read cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Office read cargo_voyage_photos" ON public.cargo_voyage_photos
  FOR SELECT USING (public.has_office_permission('cargo.view'));

-- 3. Office may read photo blobs from storage when granted 'cargo.view'.
--    (Extends the scoped-read policy from 028; path segment 1 is the voyage id.)
DROP POLICY IF EXISTS "Office read cargo photos" ON storage.objects;
CREATE POLICY "Office read cargo photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'cargo-photos'
    AND public.has_office_permission('cargo.view')
    AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = (storage.foldername(name))[1]
    )
  );
