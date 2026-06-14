-- ============================================================
-- Migration 051: Index foreign keys flagged by the Supabase advisor
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Covers the unindexed FK columns on the recent job-tracker / invoicing tables.
-- (Older tables' FKs are addressed once you export the full advisor list.)
-- Unindexed FKs slow parent deletes (cascade checks) and FK-filtered joins.
-- ============================================================

-- invoices: client_id is queried by the analytics/billing-per-client views.
CREATE INDEX IF NOT EXISTS idx_invoices_client      ON public.invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by  ON public.invoices (created_by);

-- job_surveyors / job_attachments creator columns.
CREATE INDEX IF NOT EXISTS idx_job_surveyors_created_by   ON public.job_surveyors (created_by);
CREATE INDEX IF NOT EXISTS idx_job_attachments_uploaded_by ON public.job_attachments (uploaded_by);

-- jobs: approval / close identity FKs.
CREATE INDEX IF NOT EXISTS idx_jobs_report_approved_by ON public.jobs (report_approved_by);
CREATE INDEX IF NOT EXISTS idx_jobs_closed_by          ON public.jobs (closed_by);

-- activity_log: actor FK (entity/entity_id is already indexed).
CREATE INDEX IF NOT EXISTS idx_activity_log_actor ON public.activity_log (actor_id);
