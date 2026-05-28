-- ============================================================
-- Taylor Engineering Checklist Platform
-- Enhancement Migration: Super Admin, Archive Tracking, Surveyor Names, Client Requests
-- ============================================================

-- Add yes_no_na to field_type enum
DO $$ BEGIN
  ALTER TYPE field_type ADD VALUE IF NOT EXISTS 'yes_no_na';
EXCEPTION WHEN others THEN null;
END $$;

-- Add item_number and with_remarks to template_fields (if not already present)
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS item_number TEXT;
ALTER TABLE template_fields ADD COLUMN IF NOT EXISTS with_remarks BOOLEAN NOT NULL DEFAULT false;

-- Add is_super_admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- Add archive tracking columns to checklist_templates
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES profiles(id);
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS restored_by UUID REFERENCES profiles(id);
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

-- Add vessel_name and surveyor_name to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS vessel_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS surveyor_name TEXT;

-- ============================================================
-- SURVEYOR NAMES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS surveyor_names (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE surveyor_names ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read surveyor names"
    ON surveyor_names FOR SELECT
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can manage surveyor names"
    ON surveyor_names FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- SURVEYOR NAME REQUESTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS surveyor_name_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_name TEXT NOT NULL,
  requested_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE surveyor_name_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can create surveyor name requests"
    ON surveyor_name_requests FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read surveyor name requests"
    ON surveyor_name_requests FOR SELECT
    USING (requested_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update surveyor name requests"
    ON surveyor_name_requests FOR UPDATE
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- CLIENT REQUESTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_name TEXT NOT NULL,
  requested_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can create client requests"
    ON client_requests FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can read client requests"
    ON client_requests FOR SELECT
    USING (requested_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can update client requests"
    ON client_requests FOR UPDATE
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Seed surveyor names
INSERT INTO surveyor_names (name, is_active) VALUES
  ('Captain Andrew Taylor', true),
  ('Paul Taylor', true),
  ('Robert Taylor', true),
  ('Anil Rawlin', true),
  ('Ryan Rawlin', true),
  ('Jared Persad', true),
  ('Shane Jagoo', true),
  ('Neil Sookram', true)
ON CONFLICT (name) DO NOTHING;

-- Seed clients
INSERT INTO clients (name, is_active) VALUES
  ('BPTT LLC', true),
  ('ExxonMobil Guyana Limited', true),
  ('Shell Trinidad and Tobago Limited', true),
  ('Ramps Logistics Limited', true)
ON CONFLICT DO NOTHING;

-- Set Andrew Taylor as Super Admin
UPDATE profiles
SET is_super_admin = true
WHERE id = '77fdfdae-f417-4f95-853d-a9fc48bfab8d';
