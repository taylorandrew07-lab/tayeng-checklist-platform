-- ============================================================
-- Migration 128: content tweaks to the "BPTT LLC - Fuel Transfer Checklist" template.
-- Run via the db-migrate runner. Idempotent (re-running matches nothing / is a no-op).
--
-- 1. Section C Q7 reworded: "COQ provided by bunker suppliers to vessel"
--    -> "COQ provided by Fuel Supplier to vessel" (also drops the "bunker" wording
--    that previously collided with the report's header heuristic; the code fix in the
--    prior commit already prevents that class of bug regardless).
-- 2. Section A item numbers drop the "A " prefix ("A 1" -> "1"), matching every other
--    section which numbers plainly.
-- Scoped to the BPTT template only — the generic "Fuel Transfer Checklist" already
-- numbers Section A plainly and keeps its own wording.
-- ============================================================

-- 1. Reword Section C Q7.
UPDATE public.template_fields
SET label = 'COQ provided by Fuel Supplier to vessel'
WHERE label = 'COQ provided by bunker suppliers to vessel'
  AND section_id IN (
    SELECT s.id FROM public.template_sections s
    JOIN public.checklist_templates t ON t.id = s.template_id
    WHERE t.name = 'BPTT LLC - Fuel Transfer Checklist'
  );

-- 2. Strip the leading "A " (or "A") from Section A item numbers: "A 1" -> "1".
UPDATE public.template_fields
SET item_number = regexp_replace(item_number, '^A\s*', '')
WHERE item_number ~ '^A\s*\d'
  AND section_id IN (
    SELECT s.id FROM public.template_sections s
    JOIN public.checklist_templates t ON t.id = s.template_id
    WHERE t.name = 'BPTT LLC - Fuel Transfer Checklist'
      AND s.title ILIKE 'Section A%'
  );
