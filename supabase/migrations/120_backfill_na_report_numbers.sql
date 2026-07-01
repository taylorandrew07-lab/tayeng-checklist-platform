-- ============================================================
-- Migration 120: convert literal "N/A" report numbers to the report_not_required
-- flag. Idempotent.
--
-- Before migration 119 the only way to say "no report" was to type text into the
-- report number, so some jobs ended up with report_number = 'N/A' (or similar). Those
-- collide on uq_jobs_report_number (the partial unique index) the moment a second job
-- gets the same text. Move them onto the proper flag: set report_not_required and null
-- out the number so nothing hits the unique index.
-- ============================================================

UPDATE public.jobs
SET report_not_required = true,
    report_number = NULL
WHERE report_number IS NOT NULL
  AND regexp_replace(lower(report_number), '[^a-z]', '', 'g')
      IN ('na', 'notapplicable', 'noreport', 'none');
