-- ============================================================
-- Migration 134: Lock surveyor edits on PAID jobs, not just closed. Idempotent.
--
-- Audit finding H1: job_is_open() (mig 117), AND-ed into every surveyor-write
-- policy, returned FALSE only for workflow_status='closed'. But closing is a
-- separate manual step AFTER payment, so a job sits at 'paid' for a real window
-- during which a surveyor could reopen it and edit hours/OT/km — the very numbers
-- already paid. mig 129 already treats 'paid' as a financial-lock state for the
-- jobs row itself; this extends that same lock to the surveyor-editable child
-- data (and to the surveyor billing-mode flip). Admins are unaffected.
--
-- Two CREATE OR REPLACEs; changing job_is_open() re-locks every policy that calls
-- it, so no policy needs rewriting.
-- ============================================================

-- 1. Open = exists and NOT (closed OR paid). Missing job still returns TRUE so
--    brand-new inserts are never wrongly blocked.
CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.workflow_status IN ('closed', 'paid')
  );
$$;

-- 2. Surveyor billing-mode flip: block on paid too (was: closed only). Verbatim
--    copy of the mig-124 function with the one predicate widened.
CREATE OR REPLACE FUNCTION public.enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() = 'surveyor' THEN
    -- A surveyor working an unassigned job becomes its assignee (and name).
    IF OLD.assigned_to IS NULL AND NEW.workflow_status IN ('in_progress', 'report_ready') THEN
      NEW.assigned_to := auth.uid();
      IF NEW.surveyor_name IS NULL THEN
        NEW.surveyor_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
      END IF;
    END IF;
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.client_id  IS DISTINCT FROM OLD.client_id
       OR NEW.job_number IS DISTINCT FROM OLD.job_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Billing mode: only while the job is open (neither closed nor paid), and
    -- never to/from 'fixed'.
    IF (NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
        OR NEW.is_overtime IS DISTINCT FROM OLD.is_overtime) THEN
      IF OLD.workflow_status IN ('closed', 'paid') THEN
        RAISE EXCEPTION 'This job is closed or paid — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
