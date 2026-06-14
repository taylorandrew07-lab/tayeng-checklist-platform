-- ============================================================
-- Migration 052: Index the remaining unindexed foreign keys (advisor cleanup)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Audited every FK column across all migrations against existing indexes. The
-- headline wins: jobs.assigned_to (every surveyor RLS check) and
-- client_users.profile_id (every client access check) were unindexed.
-- ============================================================

-- jobs — the hottest table (RLS by assigned_to; joins/filters by client/template).
CREATE INDEX IF NOT EXISTS idx_jobs_assigned_to ON public.jobs (assigned_to);
CREATE INDEX IF NOT EXISTS idx_jobs_client_id   ON public.jobs (client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_template_id ON public.jobs (template_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_by  ON public.jobs (created_by);

-- client_users — get_my_client_id() and client access checks filter by profile_id.
CREATE INDEX IF NOT EXISTS idx_client_users_profile ON public.client_users (profile_id);
CREATE INDEX IF NOT EXISTS idx_client_users_client  ON public.client_users (client_id);

-- Remaining FK columns flagged for cascade/join performance.
CREATE INDEX IF NOT EXISTS idx_job_photos_field           ON public.job_photos (field_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent            ON public.messages (parent_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON public.calendar_events (created_by);
CREATE INDEX IF NOT EXISTS idx_calendar_events_reviewer   ON public.calendar_events (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_personal_documents_uploaded_by ON public.personal_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_vessel_documents_uploaded_by   ON public.vessel_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_cargo_templates_created_by     ON public.cargo_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_created_by      ON public.checklist_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_duplicated_from ON public.checklist_templates (duplicated_from);
