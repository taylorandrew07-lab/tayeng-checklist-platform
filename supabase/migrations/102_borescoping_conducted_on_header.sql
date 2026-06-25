-- ============================================================
-- Migration 102: show "Conducted On" in the Daily Borescoping report header
-- Run via the db-migrate runner. Idempotent.
--
-- Balances the header at 3×3: left = Vessel, Port of Registry, Gross Tonnes; right =
-- Client, Surveyors, Conducted On. JobPDF places date-type header fields in the right
-- column. The body "Title / Job Details" then shows Time, Port/Location, Inspection
-- Day Number.
-- ============================================================

UPDATE public.template_fields
   SET show_in_header = true
 WHERE id = 'b0235c09-0000-4000-8000-000000000003'; -- Conducted On
