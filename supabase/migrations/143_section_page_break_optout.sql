-- ============================================================
-- Migration 143: let a repeatable section opt out of starting on a new page.
--
-- JobPDF forces every repeatable section onto a fresh page. That was written for Daily
-- Borescoping, where each inspection entry is followed by a full page of its photos, so
-- starting mid-page reads badly.
--
-- Brine's hourly log is the opposite case: one question (item 25) in the middle of the
-- checklist. The forced break left most of a page blank between item 24B and item 25, and
-- pushed the Final section onto a third page for no reason.
--
-- Defaults to true, so every existing report keeps its current pagination. Brine's hourly
-- section opts out and now flows straight on from item 24B.
--
-- The PDF route selects template_sections with *, so no route change is needed, and the
-- renderer treats a missing column as true — the code is safe to deploy either side of
-- this migration.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.template_sections
  ADD COLUMN IF NOT EXISTS pdf_page_break BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.template_sections.pdf_page_break IS
  'Repeatable sections start on a fresh page in the report. Set false to let the section flow on from the previous question instead.';

UPDATE public.template_sections
   SET pdf_page_break = false
 WHERE id = 'b21e0000-0000-4000-8000-000000000014';
