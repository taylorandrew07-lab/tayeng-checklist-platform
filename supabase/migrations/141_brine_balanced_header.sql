-- ============================================================
-- Migration 141: even 3/3 report header for Brine, and its real delivery methods.
--
-- The report header has always split job-record rows (Vessel / Client / Date / Surveyor)
-- into the left column and checklist-derived rows (Port / Method of Delivery / Bunker
-- Vessel Name) into the right. With Brine's six header rows that reads 4 and 2.
--
-- pdf_balanced_header spreads the rows evenly instead — 3 and 3 here. It defaults to
-- false, so every other template keeps the historic split byte-for-byte.
--
-- Also corrects the Method of Delivery options: brine arrives from a shore tank, a road
-- tanker wagon, or another vessel.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_balanced_header BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.pdf_balanced_header IS
  'Spread the report header rows evenly across both columns instead of the default job-rows-left / checklist-rows-right split.';

UPDATE public.checklist_templates
   SET pdf_balanced_header = true
 WHERE id = 'b21e0000-0000-4000-8000-000000000001';

UPDATE public.template_fields
   SET options = '[{"value":"shore_tank","label":"Shore Tank"},{"value":"road_tanker_wagon","label":"Road Tanker Wagon"},{"value":"vessel","label":"Vessel"}]'::jsonb
 WHERE id = 'b21e0000-0000-4000-8000-000000000212';
