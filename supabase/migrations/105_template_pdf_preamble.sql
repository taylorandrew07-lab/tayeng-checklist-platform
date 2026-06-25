-- ============================================================
-- Migration 105: per-template PDF preamble (intro paragraph)
-- Run via the db-migrate runner. Idempotent.
--
-- A short intro printed below the Job Details on page 1 (fills the space before the
-- inspections, which now start on a fresh page). Per-template + editable in the
-- builder; null prints nothing. Seeded for the Daily Borescoping report.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_preamble TEXT;

UPDATE public.checklist_templates
   SET pdf_preamble = 'Taylor Engineering Agencies Limited attended the above vessel to carry out a daily borescope inspection of the cargo lines. The condition of each cargo line inspected is detailed below, together with the inspection particulars and supporting photographs.'
 WHERE id = 'b0235c09-0000-4000-8000-000000000001'
   AND pdf_preamble IS NULL;
