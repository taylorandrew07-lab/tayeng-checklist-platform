-- ============================================================
-- Migration 156: close the co-surveyor INSERT hole on job_surveyors. Idempotent.
--
-- Background: enforce_job_surveyor_rate_admin (mig 043) blocks a non-admin from
-- changing pay_rate / overtime_rate / pay_currency / surveyor_id — but the trigger
-- was BEFORE UPDATE only. Since mig 150 lets a surveyor INSERT a CO-SURVEYOR row on
-- their own open job (and mig 152 lets them self-join), a crafted INSERT could set
-- another surveyor's hours or author pay rates, bypassing the ownership rule
-- ("Neil edits only Neil's times; nobody but an admin sets rates").
--
-- Fix: make the trigger fire BEFORE INSERT too, with an INSERT branch that (a) forbids
-- any non-admin from authoring pay_rate/overtime_rate, and (b) forces a row created for
-- SOMEONE ELSE (surveyor_id <> the caller) to start with zero hours. The normal app
-- paths are unaffected: the UI only ever inserts {job_id, surveyor_id, created_by}
-- (drafts.ts / joinSelf), and admins + SECURITY DEFINER system triggers (mig 124
-- auto-add) bypass via is_admin()/definer context. The UPDATE branch is the mig-043
-- guard verbatim.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_job_surveyor_rate_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Admins may do anything.
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A non-admin may never author pay rates (currency defaults to TTD, so ignore it).
    IF NEW.pay_rate IS NOT NULL OR NEW.overtime_rate IS NOT NULL THEN
      RAISE EXCEPTION 'Only an administrator can set surveyor pay rates';
    END IF;
    -- Adding a CO-surveyor (someone other than yourself): their row must start empty of
    -- hours — you may add them to the job, not log their time for them.
    IF NEW.surveyor_id IS DISTINCT FROM auth.uid()
       AND (COALESCE(NEW.regular_hours, 0) <> 0 OR COALESCE(NEW.overtime_hours, 0) <> 0) THEN
      RAISE EXCEPTION 'You can add a co-surveyor, but not enter their hours';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE branch — mig 043 guard, unchanged: non-admins can't touch rate/currency or
  -- reassign the row to another surveyor.
  IF NEW.pay_rate IS DISTINCT FROM OLD.pay_rate
     OR NEW.overtime_rate IS DISTINCT FROM OLD.overtime_rate
     OR NEW.pay_currency IS DISTINCT FROM OLD.pay_currency
     OR NEW.surveyor_id IS DISTINCT FROM OLD.surveyor_id THEN
    RAISE EXCEPTION 'Only an administrator can change surveyor pay rates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-point the trigger to fire on INSERT as well as UPDATE.
DROP TRIGGER IF EXISTS job_surveyors_rate_admin ON public.job_surveyors;
CREATE TRIGGER job_surveyors_rate_admin
  BEFORE INSERT OR UPDATE ON public.job_surveyors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_surveyor_rate_admin();
