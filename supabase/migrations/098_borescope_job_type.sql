-- ============================================================
-- Migration 098: add the "Borescope Survey" job type
-- Run via the db-migrate runner. Idempotent.
--
-- So a borescoping job can be created and billed under its own job type (the New Job
-- page also now lets admins add job types inline, and Settings manages them).
-- ============================================================

INSERT INTO public.job_types (name)
  SELECT 'Borescope Survey'
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types WHERE name = 'Borescope Survey');
