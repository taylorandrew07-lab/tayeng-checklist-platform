-- ============================================================
-- Migration 019: Security hardening (RLS)
-- Run in Supabase SQL Editor. Idempotent (drops + recreates policies).
--
-- Addresses a security review:
--   #2  Surveyor job INSERT — pin created_by/assigned_to/status to the caller
--   #3  Client visibility   — "View status" off hides the job AND its data
--   #4  Request/helper tables — enforce requested_by = caller; active admins
--   #5  Storage upload       — scope job-photos inserts to the job path
-- ============================================================


-- ============================================================
-- #2  Surveyors may only create jobs as themselves
--     (the app sets created_by = assigned_to = self, status 'in_progress')
-- ============================================================
DROP POLICY IF EXISTS "Surveyors can create jobs from approved templates" ON jobs;

CREATE POLICY "Surveyors can create jobs from approved templates"
  ON jobs FOR INSERT
  WITH CHECK (
    get_my_role() = 'surveyor'
    AND created_by = auth.uid()
    AND assigned_to = auth.uid()
    AND status IN ('draft', 'assigned', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
    )
  );


-- ============================================================
-- #3  "View status" is the master client-visibility flag.
--     When it is off, the job and all of its data are hidden.
-- ============================================================

-- Job rows
DROP POLICY IF EXISTS "Clients can view permitted jobs" ON jobs;

CREATE POLICY "Clients can view permitted jobs"
  ON jobs FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = jobs.id
        AND client_id = get_my_client_id()
        AND can_view_status = true
    )
  );

-- Field values (also still gated by can_view_checklist_details)
DROP POLICY IF EXISTS "Clients can view field values for permitted jobs" ON job_field_values;

CREATE POLICY "Clients can view field values for permitted jobs"
  ON job_field_values FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = job_field_values.job_id
        AND client_id = get_my_client_id()
        AND can_view_status = true
        AND can_view_checklist_details = true
    )
  );

-- Signatures
DROP POLICY IF EXISTS "Clients can view signatures for permitted jobs" ON job_signatures;

CREATE POLICY "Clients can view signatures for permitted jobs"
  ON job_signatures FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = job_signatures.job_id
        AND client_id = get_my_client_id()
        AND can_view_status = true
        AND can_view_checklist_details = true
    )
  );

-- Template fields (for permitted jobs)
DROP POLICY IF EXISTS "Clients can view template fields for permitted jobs" ON template_fields;

CREATE POLICY "Clients can view template fields for permitted jobs"
  ON template_fields FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM jobs j
      JOIN client_job_permissions cjp ON cjp.job_id = j.id
      WHERE j.template_id = template_fields.template_id
        AND cjp.client_id = get_my_client_id()
        AND cjp.can_view_status = true
        AND cjp.can_view_checklist_details = true
    )
  );

-- Photos in storage
DROP POLICY IF EXISTS "Client reads permitted job photos" ON storage.objects;

CREATE POLICY "Client reads permitted job photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1
      FROM public.client_users cu
      JOIN public.client_job_permissions cjp ON cjp.client_id = cu.client_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE cu.profile_id = auth.uid()
        AND cjp.job_id::text = split_part(name, '/', 1)
        AND cjp.can_view_status = true
        AND cjp.can_view_checklist_details = true
        AND p.role = 'client'
        AND p.is_active = true
    )
  );


-- ============================================================
-- #4  Request / helper tables: enforce requester identity and
--     restrict admin management to *active* admins (is_admin()).
--     The app already sets requested_by = auth.uid() on insert.
-- ============================================================

-- surveyor_names: admin management only
DROP POLICY IF EXISTS "Admins can manage surveyor names" ON surveyor_names;

CREATE POLICY "Admins can manage surveyor names"
  ON surveyor_names FOR ALL
  USING (is_admin());

-- surveyor_name_requests
DROP POLICY IF EXISTS "Users can create surveyor name requests" ON surveyor_name_requests;

CREATE POLICY "Users can create surveyor name requests"
  ON surveyor_name_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND requested_by = auth.uid());

DROP POLICY IF EXISTS "Users can read surveyor name requests" ON surveyor_name_requests;

CREATE POLICY "Users can read surveyor name requests"
  ON surveyor_name_requests FOR SELECT
  USING (requested_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admins can update surveyor name requests" ON surveyor_name_requests;

CREATE POLICY "Admins can update surveyor name requests"
  ON surveyor_name_requests FOR UPDATE
  USING (is_admin());

-- client_requests
DROP POLICY IF EXISTS "Users can create client requests" ON client_requests;

CREATE POLICY "Users can create client requests"
  ON client_requests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND requested_by = auth.uid());

DROP POLICY IF EXISTS "Users can read client requests" ON client_requests;

CREATE POLICY "Users can read client requests"
  ON client_requests FOR SELECT
  USING (requested_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admins can update client requests" ON client_requests;

CREATE POLICY "Admins can update client requests"
  ON client_requests FOR UPDATE
  USING (is_admin());


-- ============================================================
-- #5  Scope job-photo uploads to the job folder, mirroring the
--     read policy (path = '<jobId>/...'). Active admins may upload
--     to any job; active surveyors only to jobs they own/are assigned.
--
--     NOTE: file size + MIME-type limits are bucket-level settings —
--     set them on the 'job-photos' bucket in the Supabase dashboard
--     (Storage > job-photos > Configuration): restrict allowed MIME
--     types to image/* and set a max file size.
-- ============================================================
DROP POLICY IF EXISTS "Admin or surveyor can upload job photos" ON storage.objects;

CREATE POLICY "Admin or surveyor can upload job photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin' AND is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        JOIN public.profiles p ON p.id = auth.uid()
        WHERE j.id::text = split_part(name, '/', 1)
          AND (j.assigned_to = auth.uid() OR j.created_by = auth.uid())
          AND p.role = 'surveyor'
          AND p.is_active = true
      )
    )
  );
