-- ============================================================
-- Migration 117: lock surveyor edits once an admin CLOSES a job. Idempotent.
--
-- Problem: every surveyor-write RLS policy is membership/role-only with NO
-- workflow_status predicate, so after an admin sets jobs.workflow_status='closed'
-- a surveyor could still change their own overtime / km / hours / answers — i.e.
-- alter the very numbers the admin is paying them against. This migration freezes
-- a job's surveyor-editable data the moment it is closed.
--
-- Mechanism: a single helper public.job_is_open(job_id) is AND-ed into each
-- surveyor-write policy. Admin policies (is_admin / "Admins full access …") are
-- left untouched, so an admin can still correct a closed job.
-- ============================================================

-- Open = the job exists and is not closed. A missing job returns TRUE so brand-new
-- inserts are never wrongly blocked; only an explicit 'closed' status locks. SECURITY
-- DEFINER so the check can read jobs.workflow_status regardless of the caller's grants.
CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.workflow_status = 'closed'
  );
$$;

-- 1. Labour hours (job_surveyors) — surveyor edits their own row only while open.
DROP POLICY IF EXISTS "Surveyors update own hours" ON public.job_surveyors;
CREATE POLICY "Surveyors update own hours" ON public.job_surveyors FOR UPDATE
  USING (surveyor_id = (select auth.uid()) AND public.job_is_open(job_id))
  WITH CHECK (surveyor_id = (select auth.uid()) AND public.job_is_open(job_id));

-- 2. Overtime time-log (job_surveyor_overtime) — resolve the job via the parent row.
DROP POLICY IF EXISTS "Surveyors manage own overtime entries" ON public.job_surveyor_overtime;
CREATE POLICY "Surveyors manage own overtime entries" ON public.job_surveyor_overtime
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)));

-- 3. Kilometre log (job_surveyor_km) — same parent-row guard.
DROP POLICY IF EXISTS "Surveyors manage own km entries" ON public.job_surveyor_km;
CREATE POLICY "Surveyors manage own km entries" ON public.job_surveyor_km
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.job_surveyors js
                 WHERE js.id = job_surveyor_id AND js.surveyor_id = (select auth.uid()) AND public.job_is_open(js.job_id)));

-- 4. Checklist answers (job_field_values) — recreate the live 056 policy + open guard.
DROP POLICY IF EXISTS "Surveyors can manage job values" ON public.job_field_values;
CREATE POLICY "Surveyors can manage job values" ON public.job_field_values FOR ALL
  USING (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id))
  WITH CHECK (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id));

-- 5. Photos (job_photos).
DROP POLICY IF EXISTS "Surveyors can manage job photos" ON public.job_photos;
CREATE POLICY "Surveyors can manage job photos" ON public.job_photos FOR ALL
  USING (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id))
  WITH CHECK (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id));

-- 6. Signatures (job_signatures).
DROP POLICY IF EXISTS "Surveyors can manage job signatures" ON public.job_signatures;
CREATE POLICY "Surveyors can manage job signatures" ON public.job_signatures FOR ALL
  USING (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id))
  WITH CHECK (public.get_my_role() = 'surveyor' AND public.job_is_open(job_id));

-- 7. Report / VoS attachment inserts (job_attachments). Admins keep uploading on a
--    closed job (can_access_job is true for them); members only while open.
DROP POLICY IF EXISTS "Members add job attachments" ON public.job_attachments;
CREATE POLICY "Members add job attachments" ON public.job_attachments
  FOR INSERT WITH CHECK (public.can_access_job(job_id) AND (public.is_admin() OR public.job_is_open(job_id)));

-- 8. Storage uploads to the job-files bucket (path = {job_id}/…) — mirror #7 so a
--    direct storage upload can't bypass the lock.
DROP POLICY IF EXISTS "Members upload job files" ON storage.objects;
CREATE POLICY "Members upload job files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'job-files'
    AND public.can_access_job(((storage.foldername(name))[1])::uuid)
    AND (public.is_admin() OR public.job_is_open(((storage.foldername(name))[1])::uuid))
  );
