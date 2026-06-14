-- ============================================================
-- Migration 053: RLS init-plan optimization (advisor: auth_rls_initplan)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Recreates the 33 flagged policies with auth.uid()/auth.role() wrapped as
-- (select ...). The LOGIC is byte-for-byte identical — wrapping only makes the
-- auth call evaluate once per query (an init-plan) instead of once per row, which
-- is the perf win at scale. Helper functions (is_admin(), get_my_role(), …) are
-- query-constant and weren't flagged, so they're left as-is.
--
-- (The "multiple permissive policies" advisor items are intentional admin-ALL +
-- role-read overlaps; consolidating them risks correctness for negligible gain,
-- so they're deliberately left alone.)
-- ============================================================

BEGIN;  -- atomic: no window where a policy is dropped-but-not-recreated

-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update safe own profile fields" ON public.profiles;
CREATE POLICY "Users can update safe own profile fields" ON public.profiles FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK (
    (select auth.uid()) = id
    AND role           = (SELECT role           FROM public.profiles WHERE id = (select auth.uid()))
    AND is_active      = (SELECT is_active      FROM public.profiles WHERE id = (select auth.uid()))
    AND is_super_admin = (SELECT is_super_admin FROM public.profiles WHERE id = (select auth.uid()))
    AND email          = (SELECT email          FROM public.profiles WHERE id = (select auth.uid()))
    AND created_at     = (SELECT created_at     FROM public.profiles WHERE id = (select auth.uid()))
  );

-- client_users
DROP POLICY IF EXISTS "Users can view own client_user links" ON public.client_users;
CREATE POLICY "Users can view own client_user links" ON public.client_users FOR SELECT
  USING (profile_id = (select auth.uid()));

-- surveyor_names
DROP POLICY IF EXISTS "Authenticated users can read surveyor names" ON public.surveyor_names;
CREATE POLICY "Authenticated users can read surveyor names" ON public.surveyor_names FOR SELECT
  USING ((select auth.role()) = 'authenticated');

-- client_requests
DROP POLICY IF EXISTS "Users can read client requests" ON public.client_requests;
CREATE POLICY "Users can read client requests" ON public.client_requests FOR SELECT
  USING (requested_by = (select auth.uid()) OR is_admin());

DROP POLICY IF EXISTS "Users can create client requests" ON public.client_requests;
CREATE POLICY "Users can create client requests" ON public.client_requests FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL AND requested_by = (select auth.uid()));

-- calendar_events
DROP POLICY IF EXISTS "Read calendar events by visibility" ON public.calendar_events;
CREATE POLICY "Read calendar events by visibility" ON public.calendar_events FOR SELECT
  USING (
    public.is_admin()
    OR owner_id = (select auth.uid())
    OR (event_type = 'general' AND (
         visibility = 'everyone'
         OR (visibility = 'roles' AND public.get_my_role()::text = ANY(visible_roles))
         OR (visibility = 'users' AND (select auth.uid()) = ANY(visible_user_ids))
       ))
  );

DROP POLICY IF EXISTS "Create calendar events" ON public.calendar_events;
CREATE POLICY "Create calendar events" ON public.calendar_events FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      event_type = 'leave' AND status = 'pending'
      AND owner_id = (select auth.uid()) AND created_by = (select auth.uid())
      AND public.is_active_staff()
    )
  );

DROP POLICY IF EXISTS "Owners update own pending leave" ON public.calendar_events;
CREATE POLICY "Owners update own pending leave" ON public.calendar_events FOR UPDATE
  USING (owner_id = (select auth.uid()) AND event_type = 'leave' AND status = 'pending')
  WITH CHECK (owner_id = (select auth.uid()) AND event_type = 'leave' AND status = 'pending');

DROP POLICY IF EXISTS "Delete calendar events" ON public.calendar_events;
CREATE POLICY "Delete calendar events" ON public.calendar_events FOR DELETE
  USING (
    public.is_admin()
    OR (owner_id = (select auth.uid()) AND event_type = 'leave' AND status = 'pending')
  );

-- profile_change_requests
DROP POLICY IF EXISTS "Users insert own change requests" ON public.profile_change_requests;
CREATE POLICY "Users insert own change requests" ON public.profile_change_requests FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users read own change requests" ON public.profile_change_requests;
CREATE POLICY "Users read own change requests" ON public.profile_change_requests FOR SELECT
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users cancel own pending requests" ON public.profile_change_requests;
CREATE POLICY "Users cancel own pending requests" ON public.profile_change_requests FOR DELETE
  USING (user_id = (select auth.uid()) AND status = 'pending');

-- activity_log
DROP POLICY IF EXISTS "Staff write activity log" ON public.activity_log;
CREATE POLICY "Staff write activity log" ON public.activity_log FOR INSERT
  WITH CHECK ((public.is_active_staff() OR public.is_office()) AND actor_id = (select auth.uid()));

-- job_surveyors
DROP POLICY IF EXISTS "Surveyors update own hours" ON public.job_surveyors;
CREATE POLICY "Surveyors update own hours" ON public.job_surveyors FOR UPDATE
  USING (surveyor_id = (select auth.uid())) WITH CHECK (surveyor_id = (select auth.uid()));

DROP POLICY IF EXISTS "Read job surveyors" ON public.job_surveyors;
CREATE POLICY "Read job surveyors" ON public.job_surveyors FOR SELECT
  USING (surveyor_id = (select auth.uid()) OR public.is_admin() OR public.has_office_permission('jobs.monitor.view') OR public.has_office_permission('jobs.detail.view'));

-- job_numbering_config
DROP POLICY IF EXISTS "Super admins can update job numbering config" ON public.job_numbering_config;
CREATE POLICY "Super admins can update job numbering config" ON public.job_numbering_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND is_super_admin = true AND is_active = true
    )
  );

-- jobs
DROP POLICY IF EXISTS "Surveyors can create jobs from approved templates" ON public.jobs;
CREATE POLICY "Surveyors can create jobs from approved templates" ON public.jobs FOR INSERT
  WITH CHECK (
    get_my_role() = 'surveyor'
    AND created_by = (select auth.uid())
    AND assigned_to = (select auth.uid())
    AND status IN ('draft', 'assigned', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
    )
  );

DROP POLICY IF EXISTS "Surveyors can view own jobs" ON public.jobs;
CREATE POLICY "Surveyors can view own jobs" ON public.jobs FOR SELECT
  USING (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = (select auth.uid())
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Surveyors can update own jobs" ON public.jobs;
CREATE POLICY "Surveyors can update own jobs" ON public.jobs FOR UPDATE
  USING (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = (select auth.uid())
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = (select auth.uid()))
    )
  ) WITH CHECK (
    public.get_my_role() = 'surveyor' AND (
      assigned_to = (select auth.uid())
      OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = jobs.id AND js.surveyor_id = (select auth.uid()))
    )
  );

-- message_recipients
DROP POLICY IF EXISTS "Read own recipient rows" ON public.message_recipients;
CREATE POLICY "Read own recipient rows" ON public.message_recipients FOR SELECT
  USING (recipient_id = (select auth.uid()) OR public.is_admin());

DROP POLICY IF EXISTS "Update own recipient rows" ON public.message_recipients;
CREATE POLICY "Update own recipient rows" ON public.message_recipients FOR UPDATE
  USING (recipient_id = (select auth.uid())) WITH CHECK (recipient_id = (select auth.uid()));

-- surveyor_name_requests
DROP POLICY IF EXISTS "Users can create surveyor name requests" ON public.surveyor_name_requests;
CREATE POLICY "Users can create surveyor name requests" ON public.surveyor_name_requests FOR INSERT
  WITH CHECK ((select auth.uid()) IS NOT NULL AND requested_by = (select auth.uid()));

DROP POLICY IF EXISTS "Users can read surveyor name requests" ON public.surveyor_name_requests;
CREATE POLICY "Users can read surveyor name requests" ON public.surveyor_name_requests FOR SELECT
  USING (requested_by = (select auth.uid()) OR is_admin());

-- office_user_permissions
DROP POLICY IF EXISTS "Office can read own permissions" ON public.office_user_permissions;
CREATE POLICY "Office can read own permissions" ON public.office_user_permissions FOR SELECT
  USING (profile_id = (select auth.uid()) AND is_office());

-- cargo_voyages
DROP POLICY IF EXISTS "Owners manage own cargo_voyages" ON public.cargo_voyages;
CREATE POLICY "Owners manage own cargo_voyages" ON public.cargo_voyages FOR ALL
  USING (owner_id = (select auth.uid()) AND public.is_active_staff())
  WITH CHECK (owner_id = (select auth.uid()) AND public.is_active_staff());

-- cargo_voyage_photos
DROP POLICY IF EXISTS "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos;
CREATE POLICY "Owners manage own cargo_voyage_photos" ON public.cargo_voyage_photos FOR ALL
  USING (owner_id = (select auth.uid()) AND public.is_active_staff())
  WITH CHECK (
    owner_id = (select auth.uid()) AND public.is_active_staff()
    AND EXISTS (SELECT 1 FROM public.cargo_voyages v WHERE v.id = voyage_id AND v.owner_id = (select auth.uid()))
  );

-- client_job_permissions
DROP POLICY IF EXISTS "Surveyors grant client access to own jobs" ON public.client_job_permissions;
CREATE POLICY "Surveyors grant client access to own jobs" ON public.client_job_permissions FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND can_view_pdf = false
    AND can_view_checklist_details = false
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.created_by = (select auth.uid())
        AND j.assigned_to = (select auth.uid())
        AND j.client_id = client_job_permissions.client_id
    )
  );

-- personal_documents
DROP POLICY IF EXISTS "Owners manage own personal documents" ON public.personal_documents;
CREATE POLICY "Owners manage own personal documents" ON public.personal_documents FOR ALL
  USING (profile_id = (select auth.uid()) AND public.is_active_staff())
  WITH CHECK (profile_id = (select auth.uid()) AND public.is_active_staff());

-- messages
DROP POLICY IF EXISTS "Read messages you sent or received" ON public.messages;
CREATE POLICY "Read messages you sent or received" ON public.messages FOR SELECT
  USING (
    sender_id = (select auth.uid())
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.message_recipients mr
      WHERE mr.message_id = messages.id AND mr.recipient_id = (select auth.uid())
    )
  );

-- job_field_values
DROP POLICY IF EXISTS "Surveyors can manage own job values" ON public.job_field_values;
CREATE POLICY "Surveyors can manage own job values" ON public.job_field_values FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_field_values.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_field_values.job_id AND js.surveyor_id = (select auth.uid()))))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_field_values.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_field_values.job_id AND js.surveyor_id = (select auth.uid()))));

-- job_photos
DROP POLICY IF EXISTS "Surveyors can manage own job photos" ON public.job_photos;
CREATE POLICY "Surveyors can manage own job photos" ON public.job_photos FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_photos.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_photos.job_id AND js.surveyor_id = (select auth.uid()))))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_photos.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_photos.job_id AND js.surveyor_id = (select auth.uid()))));

-- job_signatures
DROP POLICY IF EXISTS "Surveyors can manage own job signatures" ON public.job_signatures;
CREATE POLICY "Surveyors can manage own job signatures" ON public.job_signatures FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_signatures.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_signatures.job_id AND js.surveyor_id = (select auth.uid()))))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_signatures.job_id AND j.assigned_to = (select auth.uid()))
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_signatures.job_id AND js.surveyor_id = (select auth.uid()))));

COMMIT;
