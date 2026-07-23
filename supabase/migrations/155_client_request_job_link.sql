-- ============================================================
-- Migration 155: link a new-client request back to the job that raised it, so
-- approving the request auto-fills that job's client. Idempotent.
--
-- Background: the New Job form lets an admin/surveyor request a brand-new client;
-- the job is created with client_id = NULL and a row is inserted into client_requests.
-- When the admin later approves the request the client was created but the JOB was
-- never updated with it. Capturing the job id on the request lets the approval step
-- set jobs.client_id automatically.
--
-- ON DELETE SET NULL: if the job is deleted before approval the request simply loses
-- its link (approval then just creates the client, as before). Admin-only UPDATE RLS
-- already covers writing job_id; the requester INSERT policy only checks requested_by,
-- so no policy change is needed.
-- ============================================================

ALTER TABLE public.client_requests
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_requests_job_id ON public.client_requests(job_id);
