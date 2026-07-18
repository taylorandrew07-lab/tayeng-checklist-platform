-- ============================================================
-- Migration 144: let a field drop out of the report when it was left blank.
--
-- An unanswered field prints a "—" placeholder. That is right for a question the surveyor
-- was asked — the dash shows the question existed and went unanswered, which matters on a
-- signed report. It is just noise for a free-text notes field that is usually empty, and
-- inside a repeatable section it costs a wasted row on every entry.
--
-- Brine's "Observations / defects" (one per hourly loading-line entry) opts in. Everything
-- else keeps printing its dash — the column defaults to false, so no existing report
-- changes.
--
-- The PDF route selects template_fields with *, and the renderer treats a missing column
-- as falsy, so the code is safe to deploy either side of this migration.
--
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.template_fields
  ADD COLUMN IF NOT EXISTS pdf_hide_when_empty BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.template_fields.pdf_hide_when_empty IS
  'Omit this field from the report entirely when it has no value, instead of printing a "—" placeholder. For optional free-text notes; leave false for questions where an unanswered dash is meaningful.';

UPDATE public.template_fields
   SET pdf_hide_when_empty = true
 WHERE id = 'b21e0000-0000-4000-8000-000000000172';  -- Observations / defects
