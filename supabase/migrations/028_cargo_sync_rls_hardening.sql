-- ============================================================
-- Migration 028: Harden cargo sync authorization (supersedes 027 policies)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Fixes from security review of 027:
--  1. Storage policies were "any authenticated user" — a client could read/over-
--     write any cargo photo. Replace with path-scoped policies: the first path
--     segment is the voyage id, so access is tied to that voyage's owner/client.
--  2. Voyage/photo owner policies only checked owner_id = auth.uid(), so any
--     authenticated user (client/office/inactive) could create their own rows.
--     Require an ACTIVE staff (admin/surveyor) account.
-- ============================================================

-- True only for an active admin/surveyor. (Clients/office/inactive excluded.)
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = true AND role::text IN ('admin', 'surveyor')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ------------------------------------------------------------
-- Tighten owner policies to active staff.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Owners manage own cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Owners manage own cargo_voyages" ON public.cargo_voyages
  FOR ALL
  USING (owner_id = auth.uid() AND public.is_active_staff())
  WITH CHECK (owner_id = auth.uid() AND public.is_active_staff());

DROP POLICY IF EXISTS "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos
  FOR ALL
  USING (owner_id = auth.uid() AND public.is_active_staff())
  WITH CHECK (
    owner_id = auth.uid() AND public.is_active_staff()
    AND EXISTS (SELECT 1 FROM public.cargo_voyages v WHERE v.id = voyage_id AND v.owner_id = auth.uid())
  );

-- ------------------------------------------------------------
-- Replace broad storage policies with path-scoped, role-aware ones.
-- Path layout is `{voyageId}/{photoId}.jpg`, so (storage.foldername(name))[1]
-- is the voyage id. The app upserts the voyage row BEFORE uploading photos.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated upload cargo photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update cargo photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read cargo photos" ON storage.objects;

CREATE POLICY "Staff upload own cargo photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'cargo-photos' AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = (storage.foldername(name))[1]
        AND (public.is_admin() OR (v.owner_id = auth.uid() AND public.is_active_staff()))
    )
  );

CREATE POLICY "Staff update own cargo photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'cargo-photos' AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = (storage.foldername(name))[1]
        AND (public.is_admin() OR (v.owner_id = auth.uid() AND public.is_active_staff()))
    )
  );

CREATE POLICY "Staff delete own cargo photos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'cargo-photos' AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = (storage.foldername(name))[1]
        AND (public.is_admin() OR (v.owner_id = auth.uid() AND public.is_active_staff()))
    )
  );

CREATE POLICY "Scoped read cargo photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'cargo-photos' AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = (storage.foldername(name))[1]
        AND (
          public.is_admin()
          OR v.owner_id = auth.uid()
          OR (public.get_my_role()::text = 'client' AND v.client_id = public.get_my_client_id())
        )
    )
  );
