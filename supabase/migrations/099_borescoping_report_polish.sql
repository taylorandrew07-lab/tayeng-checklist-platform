-- ============================================================
-- Migration 099: Daily Borescoping report polish
-- Run via the db-migrate runner. Idempotent.
--
-- Report tweaks driven by review of the first real borescoping report:
--   • The template name was the report title — the company identity now lives in the
--     letterhead logo, so the title is just "Daily Borescoping Report".
--   • Gross Tonnes shows its unit ("tons") after the number.
--   • Section descriptions were builder guidance (and outdated) — clear them; the
--     report no longer prints section descriptions anyway.
--   • Move Photos to the LAST field of the entry (#10), after Video Link / Previous
--     Cargo, and renumber those three so the item numbers have no gap.
-- ============================================================

-- Cleaner report title (logo carries the company name).
UPDATE public.checklist_templates
   SET name = 'Daily Borescoping Report'
 WHERE id = 'b0235c09-0000-4000-8000-000000000001';

-- Gross Tonnes unit.
UPDATE public.template_fields
   SET unit = 'tons'
 WHERE id = 'b0235c09-0000-4000-8000-000000000007';

-- Drop the (now outdated) section guidance descriptions.
UPDATE public.template_sections
   SET description = NULL
 WHERE id IN ('b0235c09-0000-4000-8000-000000000002', 'b0235c09-0000-4000-8000-000000000010');

-- Reorder so Photos is the last field of the Cargo Line Inspection Entry.
UPDATE public.template_fields SET order_index = 7, item_number = '8'  WHERE id = 'b0235c09-0000-4000-8000-000000000019'; -- Video Link
UPDATE public.template_fields SET order_index = 8, item_number = '9'  WHERE id = 'b0235c09-0000-4000-8000-00000000001a'; -- Previous Cargo
UPDATE public.template_fields SET order_index = 9, item_number = '10' WHERE id = 'b0235c09-0000-4000-8000-000000000018'; -- Photos
