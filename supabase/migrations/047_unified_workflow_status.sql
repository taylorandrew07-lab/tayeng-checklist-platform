-- ============================================================
-- Migration 047: Unified job status flow (single 9-stage lifecycle)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Collapses the confusing parallel statuses into ONE workflow_status shown
-- across every screen:
--   New → Assigned → In progress → Report ready → Approved
--       → Invoiced → Sent → Paid → Closed
--
-- Renames the old stages (report_uploaded → report_ready, report_approved →
-- approved) and adds "in_progress". Existing rows are migrated in place.
-- ============================================================

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_workflow_status_chk;

UPDATE public.jobs SET workflow_status = 'report_ready' WHERE workflow_status = 'report_uploaded';
UPDATE public.jobs SET workflow_status = 'approved'     WHERE workflow_status = 'report_approved';

ALTER TABLE public.jobs ADD CONSTRAINT jobs_workflow_status_chk
  CHECK (workflow_status IN ('new','assigned','in_progress','report_ready','approved','invoiced','sent','paid','closed'));
