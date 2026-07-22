-- Migration 150 — let a surveyor assign co-surveyors to their own job, and add a
-- job type, from the (offline-first) surveyor New Job form.
--
-- Until now job_surveyors and job_types were both admin-only to write (mig 042:
-- "Admins manage job surveyors" / "Admins manage job types", each FOR ALL). The
-- surveyor create form now offers a co-surveyor picker and a "+ Add job type"
-- option, so a surveyor needs a scoped INSERT on each. Both new policies are
-- INSERT-only and permissive, so they OR with the existing admin FOR ALL rather
-- than replacing it — admins keep full manage rights, surveyors get just enough.
-- Idempotent (DROP POLICY IF EXISTS before CREATE).

-- 1. Co-surveyors: a surveyor may attach another surveyor ONLY to a job they
--    created and that is still open (job_is_open, mig 117). This is exercised on
--    sync, when createDraftJob upserts the extra job_surveyors rows under the
--    surveyor's own session. Removing/renaming assignments stays admin-only.
DROP POLICY IF EXISTS "Surveyors assign co-surveyors to own open jobs" ON public.job_surveyors;
CREATE POLICY "Surveyors assign co-surveyors to own open jobs" ON public.job_surveyors
  FOR INSERT WITH CHECK (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.created_by = (select auth.uid())
        AND public.job_is_open(j.id)
    )
  );

-- 2. Job types: any active staff member may add a new type (INSERT only). The list
--    is a shared picker, so renaming and deactivating stay admin-only under the
--    existing FOR ALL policy — a surveyor can grow the list but not reshape it.
DROP POLICY IF EXISTS "Staff add job types" ON public.job_types;
CREATE POLICY "Staff add job types" ON public.job_types
  FOR INSERT WITH CHECK (public.is_active_staff());
