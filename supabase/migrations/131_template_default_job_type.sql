-- ============================================================
-- Migration 131: default job type on a checklist template
-- Run via the db-migrate runner. Idempotent.
--
-- Lets a template carry a default job type so routine jobs (e.g. a Fuel Loadout
-- checklist ⇒ "Fuel Loadout" type) auto-fill the Jobs page type instead of being
-- set by hand every time. Plain text (mirrors jobs.job_type) so it stays
-- model-agnostic and matches the value stored on the job. Picked in the template
-- builder from the same job_types list the New Job form uses.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS default_job_type TEXT;
