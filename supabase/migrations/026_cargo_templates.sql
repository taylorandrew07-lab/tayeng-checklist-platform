-- ============================================================
-- Migration 026: Cargo Monitoring templates
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Adds reusable Cargo Hold Monitoring templates, managed by admins in the
-- Templates area and consumed by surveyors when starting a voyage. A template is
-- CONFIG ONLY — the set of reading types (units, applies-to-holds, include flags)
-- plus a default hold count. Vessel, ports, dates and all collected data live on
-- the offline voyage record (IndexedDB), not here.
--
-- Surveyors read active templates (cached locally for offline voyage creation);
-- only admins write them. Mirrors the checklist_templates RLS pattern from
-- migration 002, reusing is_admin() / get_my_role() / update_updated_at().
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cargo_templates (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               TEXT NOT NULL,
  description        TEXT,
  default_hold_count INTEGER NOT NULL DEFAULT 5
                       CHECK (default_hold_count BETWEEN 1 AND 10),
  -- ReadingType[] snapshot: [{ id, name, unit, description?, appliesTo, includeInTables, includeInCharts, includeInPdf, builtIn? }]
  reading_types      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Plain TEXT (not the template_status enum) so this migration has no enum/search_path
  -- dependency; the app only ever reads status as a string.
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('draft', 'active', 'archived')),
  created_by         UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep updated_at fresh (reuses the shared trigger function from migration 001).
DROP TRIGGER IF EXISTS update_cargo_templates_updated_at ON public.cargo_templates;
CREATE TRIGGER update_cargo_templates_updated_at
  BEFORE UPDATE ON public.cargo_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.cargo_templates ENABLE ROW LEVEL SECURITY;

-- Admins manage everything.
DROP POLICY IF EXISTS "Admins full access to cargo_templates" ON public.cargo_templates;
CREATE POLICY "Admins full access to cargo_templates"
  ON public.cargo_templates FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can read active templates (to start voyages; cached for offline use).
DROP POLICY IF EXISTS "Surveyors can view active cargo_templates" ON public.cargo_templates;
CREATE POLICY "Surveyors can view active cargo_templates"
  ON public.cargo_templates FOR SELECT
  USING (get_my_role() = 'surveyor' AND status = 'active');
