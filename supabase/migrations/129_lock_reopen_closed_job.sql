-- ============================================================
-- Migration 129: block surveyors from re-opening a CLOSED/PAID job. Idempotent.
-- Run in Supabase SQL Editor (paste the WHOLE file). Purely a trigger redefine.
--
-- Audit finding (HIGH): the jobs UPDATE policy (056) is role-only and
-- enforce_job_admin_columns (049) validated only the NEW workflow_status value,
-- so a surveyor could move a job 'closed' -> 'in_progress'. That flips
-- public.job_is_open() back to TRUE and re-unlocks every mig-117 close-locked
-- write (hours / overtime / km / answers) — letting a surveyor edit the very
-- numbers an admin closed the job to pay them against.
--
-- Fix: reject any NON-admin transition OUT of a financial-lock state
-- ('closed' or the even-more-final 'paid'). Admins are unaffected (they return
-- early), so an admin can still legitimately re-open a job to correct it.
-- This is the exact 049 function body + one new guard at the top.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- NEW: a non-admin may not move a job out of a locked financial state.
  IF OLD.workflow_status IN ('closed', 'paid')
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a closed or paid job';
  END IF;

  IF NEW.report_number      IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger jobs_admin_columns (mig 049) already calls this function by name; no
-- re-bind needed. Verify:
--   -- as a surveyor, this must now RAISE:
--   -- UPDATE jobs SET workflow_status='in_progress' WHERE id=<a closed job>;
