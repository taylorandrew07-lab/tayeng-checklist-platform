-- ============================================================
-- Migration 094: repeatable sections
-- Run via the db-migrate runner. Idempotent.
--
-- A section can be marked repeatable (a template toggle): the surveyor adds one
-- block per inspection/entry (e.g. one Cargo Line Inspection per borescope line).
-- Each repeated block's answers/photos/signatures are stored against the SAME
-- field ids but a different `instance` index (0, 1, 2, …). instance 0 is the
-- existing data — every current row defaults to 0, so nothing changes for existing
-- jobs or non-repeatable sections.
--
-- The unique keys move from (job_id, field_id) to (job_id, field_id, instance) so
-- the same field can hold a value per instance. The old constraint names are the
-- Postgres defaults for the inline UNIQUE(job_id, field_id) in migration 001.
-- ============================================================

ALTER TABLE public.template_sections
  ADD COLUMN IF NOT EXISTS is_repeatable BOOLEAN NOT NULL DEFAULT false;

-- job_field_values: add instance, move the unique key to include it.
ALTER TABLE public.job_field_values
  ADD COLUMN IF NOT EXISTS instance SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.job_field_values
  DROP CONSTRAINT IF EXISTS job_field_values_job_id_field_id_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_field_values_job_field_instance_key') THEN
    ALTER TABLE public.job_field_values
      ADD CONSTRAINT job_field_values_job_field_instance_key UNIQUE (job_id, field_id, instance);
  END IF;
END $$;

-- job_signatures: same treatment.
ALTER TABLE public.job_signatures
  ADD COLUMN IF NOT EXISTS instance SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.job_signatures
  DROP CONSTRAINT IF EXISTS job_signatures_job_id_field_id_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_signatures_job_field_instance_key') THEN
    ALTER TABLE public.job_signatures
      ADD CONSTRAINT job_signatures_job_field_instance_key UNIQUE (job_id, field_id, instance);
  END IF;
END $$;

-- job_photos has no (job_id, field_id) unique (many photos per field), so it only
-- needs the instance column to tag which repeated block a photo belongs to.
ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS instance SMALLINT NOT NULL DEFAULT 0;

-- Turn the flag on for the Daily Borescoping "Cargo Line Inspection Entry" section
-- (one repeated block per borescope line) so the template works end-to-end. Safe
-- to set here in the same file: this is a column update, not an enum dependency.
UPDATE public.template_sections
   SET is_repeatable = true
 WHERE id = 'b0235c09-0000-4000-8000-000000000010';
