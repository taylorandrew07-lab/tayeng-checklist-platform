-- ============================================================
-- Migration 021: Performance indexes on foreign-key columns
-- Run in Supabase SQL Editor. Idempotent.
--
-- Postgres does not auto-index foreign keys. These speed up template
-- loads/saves, the removed-field answer guard, and job data loading.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_template_sections_template_id
  ON template_sections (template_id);

CREATE INDEX IF NOT EXISTS idx_template_fields_template_id
  ON template_fields (template_id);

CREATE INDEX IF NOT EXISTS idx_template_fields_section_id
  ON template_fields (section_id);

CREATE INDEX IF NOT EXISTS idx_job_field_values_job_id
  ON job_field_values (job_id);

CREATE INDEX IF NOT EXISTS idx_job_field_values_field_id
  ON job_field_values (field_id);

CREATE INDEX IF NOT EXISTS idx_job_signatures_job_id
  ON job_signatures (job_id);

CREATE INDEX IF NOT EXISTS idx_job_photos_job_id
  ON job_photos (job_id);

CREATE INDEX IF NOT EXISTS idx_client_job_permissions_job_id
  ON client_job_permissions (job_id);

CREATE INDEX IF NOT EXISTS idx_client_job_permissions_client_id
  ON client_job_permissions (client_id);
