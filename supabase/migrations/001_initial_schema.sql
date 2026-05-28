-- ============================================================
-- Taylor Engineering Checklist Platform
-- Initial Schema Migration
-- ============================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'surveyor', 'client');

CREATE TYPE template_status AS ENUM ('draft', 'active', 'archived');

CREATE TYPE field_type AS ENUM (
  'text',
  'number',
  'date',
  'time',
  'dropdown',
  'yes_no',
  'multiple_choice',
  'textarea',
  'calculated',
  'photo',
  'signature',
  'heading',
  'divider'
);

CREATE TYPE job_status AS ENUM (
  'draft',
  'assigned',
  'in_progress',
  'submitted',
  'completed',
  'client_visible',
  'archived'
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'surveyor',
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLIENTS
-- ============================================================

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Client users linking table (for client-role users linked to a client)
CREATE TABLE client_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_id, client_id)
);

-- ============================================================
-- CHECKLIST TEMPLATES
-- ============================================================

CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status template_status NOT NULL DEFAULT 'draft',
  allow_surveyor_start BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES profiles(id),
  duplicated_from UUID REFERENCES checklist_templates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Template sections
CREATE TABLE template_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  -- Conditional logic: JSON defining when this section is visible
  -- Example: {"operator": "and", "conditions": [{"field_id": "...", "operator": "equals", "value": "yes"}]}
  conditional_logic JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Template fields within sections
CREATE TABLE template_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES template_sections(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type field_type NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  -- For dropdown/multiple_choice: [{"value": "...", "label": "..."}]
  options JSONB,
  -- Validation rules: {"min": 0, "max": 100, "regex": "..."}
  validation JSONB,
  -- For calculated fields: formula referencing other field IDs
  -- Example: "{field_id_1} + {field_id_2}"
  calculation_formula TEXT,
  -- Conditional display logic
  conditional_logic JSONB,
  placeholder TEXT,
  help_text TEXT,
  -- For number fields: unit label (kg, L, m, etc.)
  unit TEXT,
  -- Default value
  default_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- JOBS
-- ============================================================

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_number TEXT UNIQUE,
  title TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES checklist_templates(id),
  client_id UUID REFERENCES clients(id),
  assigned_to UUID REFERENCES profiles(id),
  status job_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES profiles(id),
  scheduled_date DATE,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  internal_notes TEXT,
  pdf_storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-generate job number sequence
CREATE SEQUENCE job_number_seq START 1000;

-- Function to auto-generate job numbers
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_number IS NULL THEN
    NEW.job_number := 'TE-' || LPAD(nextval('job_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION generate_job_number();

-- Job field values (answers to template fields)
CREATE TABLE job_field_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES template_fields(id) ON DELETE CASCADE,
  value TEXT,
  -- For multiple_choice: store as JSON array
  value_array JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, field_id)
);

-- Job photos
CREATE TABLE job_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  field_id UUID REFERENCES template_fields(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  caption TEXT,
  include_in_pdf BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Job signatures
CREATE TABLE job_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES template_fields(id) ON DELETE CASCADE,
  signature_data TEXT NOT NULL,
  signed_by_name TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, field_id)
);

-- ============================================================
-- CLIENT JOB PERMISSIONS
-- ============================================================

CREATE TABLE client_job_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  can_view_status BOOLEAN NOT NULL DEFAULT true,
  can_view_pdf BOOLEAN NOT NULL DEFAULT false,
  can_view_checklist_details BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, job_id)
);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON checklist_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_sections_updated_at BEFORE UPDATE ON template_sections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_fields_updated_at BEFORE UPDATE ON template_fields FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_job_values_updated_at BEFORE UPDATE ON job_field_values FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON client_job_permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PROFILE AUTO-CREATE TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'surveyor')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
