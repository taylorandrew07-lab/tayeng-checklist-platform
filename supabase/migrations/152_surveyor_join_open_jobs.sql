-- Migration 152: let a surveyor add THEMSELVES to any open job.
-- Run in the Supabase SQL Editor (paste the whole file). Idempotent.
--
-- Why: multi-surveyor jobs (a 7-day cargo loadout, etc.) are often set up by the
-- office or one surveyor, but every surveyor who actually worked it needs to be on
-- it to log their own hours / OT / km for pay. Surveyors can already SEE every job
-- (mig 056, internal-app decision) and can already edit their OWN job_surveyors row
-- and OT/km entries (mig 117) — the one missing grant is putting that row there in
-- the first place when they didn't create the job.
--
-- Scope: self only (surveyor_id = caller), and only while the job is OPEN
-- (job_is_open, mig 117). This is INSERT-only and permissive, so it ORs with the
-- admin "Admins manage job surveyors" (mig 042) and the mig-150 co-surveyor policy
-- rather than replacing either. Removing/renaming assignments stays admin-only, and
-- a closed job can't be joined — protecting the numbers an admin is paying against.

DROP POLICY IF EXISTS "Surveyors join open jobs" ON public.job_surveyors;
CREATE POLICY "Surveyors join open jobs" ON public.job_surveyors
  FOR INSERT WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND surveyor_id = (select auth.uid())
    AND public.job_is_open(job_id)
  );
