-- ============================================================
-- Migration 027: Cargo voyage cloud sync + client read access
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Surveyors work offline (IndexedDB). When online, their device PUSHES each
-- voyage here: the whole voyage document as JSONB + assigned photos to Storage.
-- Clients get READ-ONLY access to voyages whose client_id is their client, and
-- can view/download while monitoring is still in progress (reports are stamped
-- "NOT FINALISED" until the surveyor publishes). Mirrors the checklist RLS
-- helpers from migrations 002 (is_admin / get_my_role / get_my_client_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cargo_voyages (
  id           TEXT PRIMARY KEY,                 -- local voyage id from the device
  owner_id     UUID NOT NULL REFERENCES public.profiles(id),
  client_id    UUID REFERENCES public.clients(id),
  vessel_name  TEXT,
  voyage_number TEXT,
  status       TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finalized')),
  doc          JSONB NOT NULL DEFAULT '{}'::jsonb, -- full voyage document (no photo blobs)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cargo_voyages_owner ON public.cargo_voyages(owner_id);
CREATE INDEX IF NOT EXISTS idx_cargo_voyages_client ON public.cargo_voyages(client_id);

CREATE TABLE IF NOT EXISTS public.cargo_voyage_photos (
  id           TEXT PRIMARY KEY,                 -- local photo id from the device
  voyage_id    TEXT NOT NULL REFERENCES public.cargo_voyages(id) ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES public.profiles(id),
  storage_path TEXT NOT NULL,
  date_iso     TEXT,
  period       TEXT,
  hold_number  INTEGER,
  camera       TEXT,
  actual_time  TEXT,
  filename     TEXT,
  ordinal      INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cargo_voyage_photos_voyage ON public.cargo_voyage_photos(voyage_id);

DROP TRIGGER IF EXISTS update_cargo_voyages_updated_at ON public.cargo_voyages;
CREATE TRIGGER update_cargo_voyages_updated_at
  BEFORE UPDATE ON public.cargo_voyages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.cargo_voyages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_voyage_photos ENABLE ROW LEVEL SECURITY;

-- cargo_voyages
DROP POLICY IF EXISTS "Admins full access to cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Admins full access to cargo_voyages" ON public.cargo_voyages
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Owners manage own cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Owners manage own cargo_voyages" ON public.cargo_voyages
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Clients read their cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Clients read their cargo_voyages" ON public.cargo_voyages
  FOR SELECT USING (public.get_my_role() = 'client' AND client_id = public.get_my_client_id());

-- cargo_voyage_photos
DROP POLICY IF EXISTS "Admins full access to cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Admins full access to cargo_voyage_photos" ON public.cargo_voyage_photos
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Clients read their cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Clients read their cargo_voyage_photos" ON public.cargo_voyage_photos
  FOR SELECT USING (
    public.get_my_role() = 'client' AND EXISTS (
      SELECT 1 FROM public.cargo_voyages v
      WHERE v.id = cargo_voyage_photos.voyage_id AND v.client_id = public.get_my_client_id()
    )
  );

-- ------------------------------------------------------------
-- Storage: private 'cargo-photos' bucket. Staff upload; any authenticated user
-- (incl. clients viewing their own voyages) may read. Paths use unguessable
-- random ids, matching the existing job-photos posture.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('cargo-photos', 'cargo-photos', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated upload cargo photos" ON storage.objects;
CREATE POLICY "Authenticated upload cargo photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'cargo-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated update cargo photos" ON storage.objects;
CREATE POLICY "Authenticated update cargo photos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'cargo-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated read cargo photos" ON storage.objects;
CREATE POLICY "Authenticated read cargo photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'cargo-photos' AND auth.role() = 'authenticated');
