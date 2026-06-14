-- ============================================================
-- Migration 057: Vessels as first-class records (P3 — step 1, schema)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Enriches the existing `vessels` table (migration 029) and links jobs + cargo
-- voyages to it via a NULLABLE vessel_id. The free-text vessel_name stays as a
-- historical SNAPSHOT (old PDFs / finalized reports keep their name even if a
-- vessel is later renamed). All additive + nullable → nothing breaks; linking is
-- filled in over time via the picker, and unmatched rows stay unlinked.
-- ============================================================

-- Identity fields on the vessel record.
ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS imo             TEXT;
ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS official_number TEXT;
ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS is_active       BOOLEAN NOT NULL DEFAULT true;

-- Link jobs + cargo voyages to the directory. ON DELETE SET NULL keeps the row
-- (and its vessel_name snapshot) if a vessel is ever removed — but prefer
-- is_active = false (archive) over deleting.
ALTER TABLE public.jobs          ADD COLUMN IF NOT EXISTS vessel_id UUID REFERENCES public.vessels(id) ON DELETE SET NULL;
ALTER TABLE public.cargo_voyages ADD COLUMN IF NOT EXISTS vessel_id UUID REFERENCES public.vessels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_vessel_id          ON public.jobs (vessel_id);
CREATE INDEX IF NOT EXISTS idx_cargo_voyages_vessel_id ON public.cargo_voyages (vessel_id);

-- Conservative one-time backfill: link only where the job's free-text vessel_name
-- matches a vessel name EXACTLY (case-insensitive, trimmed). Ambiguous or blank
-- names are left unlinked for manual resolution in the Vessels UI.
UPDATE public.jobs j
  SET vessel_id = v.id
  FROM public.vessels v
  WHERE j.vessel_id IS NULL
    AND NULLIF(trim(j.vessel_name), '') IS NOT NULL
    AND lower(trim(j.vessel_name)) = lower(trim(v.name));

-- (Cargo voyages are device-authored; they'll link via the picker going forward.)

-- Sanity check after running:
--   SELECT count(*) FILTER (WHERE vessel_id IS NOT NULL) AS linked,
--          count(*) FILTER (WHERE vessel_id IS NULL)     AS unlinked
--   FROM public.jobs;
