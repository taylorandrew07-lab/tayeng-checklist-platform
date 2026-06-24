-- ============================================================
-- Migration 085: Link cargo voyages to jobs (make cargo work billable)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- A cargo-monitoring voyage can now be attached to a job, so its monitoring
-- work is invoiced through the normal job/Finance flow and cargo revenue shows
-- up in reconciliation + insights (which are job/invoice based).
--
-- The link is SERVER-SIDE metadata set by staff (admin/office) from the job page.
-- The surveyor device is the source of truth for the voyage document and only
-- PUSHES it; the push upsert never lists job_id, so an admin-set link is
-- preserved across syncs (omitted columns aren't in the ON CONFLICT ... SET).
-- ON DELETE SET NULL: deleting a job just unlinks its voyages, never deletes them.
-- ============================================================

ALTER TABLE public.cargo_voyages
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cargo_voyages_job ON public.cargo_voyages(job_id);

-- No RLS change needed: the existing "Admins full access" and "Owners manage own"
-- policies already cover updating job_id, and the client read policy is unaffected.
