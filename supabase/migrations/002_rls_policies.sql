-- ============================================================
-- Row Level Security Policies
-- Taylor Engineering Checklist Platform
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_job_permissions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get current user's client_id (for client role)
CREATE OR REPLACE FUNCTION get_my_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM client_users WHERE profile_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (is_admin());

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile (limited fields)
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- Admins can update any profile
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  USING (is_admin());

-- Admins can insert profiles
CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (is_admin());

-- Surveyors can view other surveyors (for job assignment display)
CREATE POLICY "Surveyors can view surveyor profiles"
  ON profiles FOR SELECT
  USING (
    get_my_role() = 'surveyor' AND role IN ('admin', 'surveyor')
  );

-- ============================================================
-- CLIENTS POLICIES
-- ============================================================

-- Admins can do everything with clients
CREATE POLICY "Admins full access to clients"
  ON clients FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Client users can view their own client
CREATE POLICY "Client users can view own client"
  ON clients FOR SELECT
  USING (
    id = get_my_client_id()
  );

-- Surveyors can view clients (for job forms)
CREATE POLICY "Surveyors can view clients"
  ON clients FOR SELECT
  USING (get_my_role() = 'surveyor');

-- ============================================================
-- CLIENT_USERS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to client_users"
  ON client_users FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Users can view their own client_user links
CREATE POLICY "Users can view own client_user links"
  ON client_users FOR SELECT
  USING (profile_id = auth.uid());

-- ============================================================
-- CHECKLIST TEMPLATES POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to templates"
  ON checklist_templates FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can view active templates
CREATE POLICY "Surveyors can view active templates"
  ON checklist_templates FOR SELECT
  USING (
    get_my_role() = 'surveyor' AND status = 'active'
  );

-- ============================================================
-- TEMPLATE SECTIONS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to template_sections"
  ON template_sections FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can view sections of active templates
CREATE POLICY "Surveyors can view sections"
  ON template_sections FOR SELECT
  USING (
    get_my_role() = 'surveyor' AND
    EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE id = template_sections.template_id AND status = 'active'
    )
  );

-- ============================================================
-- TEMPLATE FIELDS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to template_fields"
  ON template_fields FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can view fields of active templates
CREATE POLICY "Surveyors can view fields"
  ON template_fields FOR SELECT
  USING (
    get_my_role() = 'surveyor' AND
    EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE id = template_fields.template_id AND status = 'active'
    )
  );

-- Client users can view fields of their accessible jobs (for read-only detail view)
CREATE POLICY "Clients can view template fields for permitted jobs"
  ON template_fields FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM jobs j
      JOIN client_job_permissions cjp ON cjp.job_id = j.id
      WHERE j.template_id = template_fields.template_id
        AND cjp.client_id = get_my_client_id()
        AND cjp.can_view_checklist_details = true
    )
  );

-- ============================================================
-- JOBS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to jobs"
  ON jobs FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can view and update their own assigned jobs
CREATE POLICY "Surveyors can view own jobs"
  ON jobs FOR SELECT
  USING (
    get_my_role() = 'surveyor' AND assigned_to = auth.uid()
  );

CREATE POLICY "Surveyors can update own jobs"
  ON jobs FOR UPDATE
  USING (
    get_my_role() = 'surveyor' AND assigned_to = auth.uid()
  )
  WITH CHECK (
    get_my_role() = 'surveyor' AND assigned_to = auth.uid()
  );

-- Surveyors can insert jobs (if using approved templates)
CREATE POLICY "Surveyors can create jobs from approved templates"
  ON jobs FOR INSERT
  WITH CHECK (
    get_my_role() = 'surveyor' AND
    EXISTS (
      SELECT 1 FROM checklist_templates
      WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
    )
  );

-- Client users can view jobs where they have permission
CREATE POLICY "Clients can view permitted jobs"
  ON jobs FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = jobs.id AND client_id = get_my_client_id()
    )
  );

-- ============================================================
-- JOB FIELD VALUES POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to job_field_values"
  ON job_field_values FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can manage values for their jobs
CREATE POLICY "Surveyors can manage own job values"
  ON job_field_values FOR ALL
  USING (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  )
  WITH CHECK (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  );

-- Clients can view field values for permitted jobs
CREATE POLICY "Clients can view field values for permitted jobs"
  ON job_field_values FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = job_field_values.job_id
        AND client_id = get_my_client_id()
        AND can_view_checklist_details = true
    )
  );

-- ============================================================
-- JOB PHOTOS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to job_photos"
  ON job_photos FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can manage photos for their jobs
CREATE POLICY "Surveyors can manage own job photos"
  ON job_photos FOR ALL
  USING (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  )
  WITH CHECK (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  );

-- ============================================================
-- JOB SIGNATURES POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to job_signatures"
  ON job_signatures FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Surveyors can manage signatures for their jobs
CREATE POLICY "Surveyors can manage own job signatures"
  ON job_signatures FOR ALL
  USING (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  )
  WITH CHECK (
    get_my_role() = 'surveyor' AND
    EXISTS (SELECT 1 FROM jobs WHERE id = job_id AND assigned_to = auth.uid())
  );

-- Clients can view signatures for permitted jobs
CREATE POLICY "Clients can view signatures for permitted jobs"
  ON job_signatures FOR SELECT
  USING (
    get_my_role() = 'client' AND
    EXISTS (
      SELECT 1 FROM client_job_permissions
      WHERE job_id = job_signatures.job_id
        AND client_id = get_my_client_id()
        AND can_view_checklist_details = true
    )
  );

-- ============================================================
-- CLIENT JOB PERMISSIONS POLICIES
-- ============================================================

-- Admins full access
CREATE POLICY "Admins full access to client_job_permissions"
  ON client_job_permissions FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Clients can view their own permissions
CREATE POLICY "Clients can view own permissions"
  ON client_job_permissions FOR SELECT
  USING (
    get_my_role() = 'client' AND client_id = get_my_client_id()
  );

-- ============================================================
-- STORAGE BUCKET POLICIES (run in Supabase dashboard)
-- ============================================================
-- Create buckets: 'job-photos' (private) and 'job-pdfs' (private)
-- These policies are applied via the Supabase dashboard or CLI

-- NOTE: Run these in the Supabase SQL editor after creating the buckets:
/*
INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('job-pdfs', 'job-pdfs', false);

CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Admins and surveyors can read photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'job-photos' AND
    auth.role() = 'authenticated'
  );

CREATE POLICY "Admins can manage PDFs"
  ON storage.objects FOR ALL
  USING (bucket_id = 'job-pdfs' AND is_admin());

CREATE POLICY "Surveyors can read their job PDFs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-pdfs' AND auth.role() = 'authenticated');
*/
