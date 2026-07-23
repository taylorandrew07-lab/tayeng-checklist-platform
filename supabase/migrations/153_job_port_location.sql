-- Migration 153: add a free-text Port / Location to jobs.
-- Run in the Supabase SQL Editor (paste the whole file). Idempotent.
--
-- Why: report-only jobs (no checklist — Draught Survey, Hatch, plain Cargo, etc.)
-- had nowhere to record WHERE the survey happened. Checklist jobs can capture it in
-- a template field, but a report-only job has no checklist, so the port/location was
-- unrecordable. This is a plain job column so both New Job forms and the job-detail
-- edit form can set it, and it is safe for a surveyor to write: the mig-148
-- enforce_surveyor_job_update trigger only blocks template_id/client_id/job_number/
-- created_by/labour_unit/assigned_to/billing_mode — port_location is not blacklisted.

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS port_location TEXT;

COMMENT ON COLUMN public.jobs.port_location IS 'Free-text port / location of the survey. Optional; mainly for report-only (no-checklist) jobs.';
