-- ============================================================
-- Migration 096: reusable response sets ("Global Response Sets")
-- Run via the db-migrate runner. Idempotent.
--
-- A response set is a named, reusable list of multiple-choice / dropdown options
-- (e.g. the 12 cargo conditions, or Initial / Interim / Final). In the template
-- builder you can apply a saved set to a choice field (copies its options in) or
-- save a field's options as a new set — so the same options aren't re-typed across
-- templates. Options are COPIED into the field (template_fields.options) on apply,
-- so a template never breaks if a set is later edited or deleted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.response_sets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  options    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.response_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage response sets" ON public.response_sets;
CREATE POLICY "Admins manage response sets" ON public.response_sets
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Authenticated read response sets" ON public.response_sets;
CREATE POLICY "Authenticated read response sets" ON public.response_sets
  FOR SELECT USING (auth.role() = 'authenticated');

-- Seed common sets (fixed ids so re-runs are no-ops). The cargo conditions match the
-- Daily Borescoping template.
INSERT INTO public.response_sets (id, name, options) VALUES
  ('5e700001-0000-4000-8000-000000000001', 'Cargo Line Conditions',
   '[{"value":"cargo_present","label":"Cargo Present"},{"value":"minor_cargo_present","label":"Minor Cargo Present"},{"value":"residue_present","label":"Residue Present"},{"value":"minor_residue_present","label":"Minor Residue Present"},{"value":"water_present","label":"Water Present"},{"value":"minor_water_present","label":"Minor Water Present"},{"value":"traces_of_water_present","label":"Traces of Water Present"},{"value":"rust_present","label":"Rust Present"},{"value":"minor_rust_present","label":"Minor Rust Present"},{"value":"not_accessible","label":"Not Accessible"},{"value":"clean","label":"Clean"},{"value":"dry","label":"Dry"}]'::jsonb),
  ('5e700001-0000-4000-8000-000000000002', 'Inspection Type (Initial / Interim / Final)',
   '[{"value":"initial","label":"Initial"},{"value":"interim","label":"Interim"},{"value":"final","label":"Final"}]'::jsonb),
  ('5e700001-0000-4000-8000-000000000003', 'Good / Fair / Poor / N/A',
   '[{"value":"good","label":"Good","color":"green"},{"value":"fair","label":"Fair","color":"amber"},{"value":"poor","label":"Poor","color":"red"},{"value":"na","label":"N/A","color":"gray"}]'::jsonb),
  ('5e700001-0000-4000-8000-000000000004', 'Compliant / Non-Compliant / N/A',
   '[{"value":"compliant","label":"Compliant","color":"green"},{"value":"non_compliant","label":"Non-Compliant","color":"red"},{"value":"na","label":"N/A","color":"gray"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;
