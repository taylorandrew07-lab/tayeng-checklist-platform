-- ============================================================
-- Migration 108: broad job types + job Notes + job Stage qualifier
-- Run via the db-migrate runner. Idempotent.
--
-- Build-spec support for the New Job form:
--  - Pre-load the "broad" survey types so they appear in every picker. We keep the
--    existing "Draught Survey" and add the broad ones; the Stage/Direction/Status
--    detail is captured per-job in jobs.job_stage (set by a conditional picker on the
--    form), so we DON'T explode the type list into Initial/Interim/Final etc.
--  - jobs.notes: a free-text note on the job (e.g. "CHACONIA (76)", gang counts).
--  - jobs.job_stage: the broad-type qualifier — Draught {Initial/Interim/Final},
--    Cargo {Loaded/Discharge}, Hire {On/Off}. Plain text so it's model-agnostic.
-- ============================================================

-- Broad survey types (idempotent insert — mirrors migration 072's guard pattern).
INSERT INTO public.job_types (name)
  SELECT v.name FROM (VALUES ('Cargo Survey'), ('Hire Survey'), ('Tank Inspection')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types jt WHERE jt.name = v.name);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS notes     TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS job_stage TEXT;
