-- ============================================================
-- Migration 029: Vessel document library
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- A searchable repository of reference documents (sounding/hydrostatic tables,
-- Excel sheets, etc.) organised into managed folders, one per vessel. Internal:
-- active staff (admin/surveyor) only — reuses is_active_staff() from migration 028.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vessels (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vessels_name ON public.vessels (lower(name));

CREATE TABLE IF NOT EXISTS public.vessel_documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id    UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,            -- display name / original filename
  category     TEXT,                     -- e.g. Sounding Tables, Hydrostatic Tables
  storage_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vessel_documents_vessel ON public.vessel_documents (vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_documents_name ON public.vessel_documents (lower(name));

DROP TRIGGER IF EXISTS update_vessels_updated_at ON public.vessels;
CREATE TRIGGER update_vessels_updated_at
  BEFORE UPDATE ON public.vessels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- RLS — active staff only (clients/office excluded).
-- ------------------------------------------------------------
ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage vessels" ON public.vessels;
CREATE POLICY "Staff manage vessels" ON public.vessels
  FOR ALL USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());

DROP POLICY IF EXISTS "Staff manage vessel_documents" ON public.vessel_documents;
CREATE POLICY "Staff manage vessel_documents" ON public.vessel_documents
  FOR ALL USING (public.is_active_staff()) WITH CHECK (public.is_active_staff());

-- ------------------------------------------------------------
-- Storage: private 'vessel-documents' bucket, active staff only.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('vessel-documents', 'vessel-documents', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Staff read vessel documents" ON storage.objects;
CREATE POLICY "Staff read vessel documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'vessel-documents' AND public.is_active_staff());

DROP POLICY IF EXISTS "Staff upload vessel documents" ON storage.objects;
CREATE POLICY "Staff upload vessel documents" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vessel-documents' AND public.is_active_staff());

DROP POLICY IF EXISTS "Staff update vessel documents" ON storage.objects;
CREATE POLICY "Staff update vessel documents" ON storage.objects
  FOR UPDATE USING (bucket_id = 'vessel-documents' AND public.is_active_staff());

DROP POLICY IF EXISTS "Staff delete vessel documents" ON storage.objects;
CREATE POLICY "Staff delete vessel documents" ON storage.objects
  FOR DELETE USING (bucket_id = 'vessel-documents' AND public.is_active_staff());
