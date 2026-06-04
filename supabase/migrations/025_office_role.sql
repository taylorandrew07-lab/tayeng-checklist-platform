-- ============================================================
-- Migration 025: Office role + per-user office permission system
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Adds a new `office` user role for office / admin-office staff who monitor
-- jobs and (later) handle invoicing. Office users are NOT admins, surveyors,
-- or clients. They are READ-ONLY and every capability is gated by an explicit
-- per-user permission row, so office duties can expand without touching RLS.
--
-- Source of truth for authorization is RLS + the office_user_permissions
-- table — never user_metadata. Office users get NO write access to jobs,
-- checklists, signatures, photos, templates, or client permissions in this
-- phase.
--
-- IMPORTANT (enum safety): Postgres forbids using a newly added enum value in
-- the same transaction that adds it. The Supabase SQL Editor runs a pasted
-- script as a single implicit transaction, so we COMMIT immediately after the
-- ADD VALUE. The SQL helper functions below also compare role::text = 'office'
-- (a plain text comparison) rather than casting the literal to the enum, which
-- is robust regardless of transaction handling.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Add `office` to the user_role enum, then commit so the rest of the
--    script can reference it safely.
-- ------------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'office';

COMMIT;


-- ------------------------------------------------------------
-- 2. handle_new_user — allow role metadata to map to `office`.
--    Office is intentionally NOT offered in public signup (UI), and a
--    self-signed-up office account is inert anyway: it lands is_active=false
--    with zero permission rows (everything defaults to denied). Authorization
--    never trusts this metadata — it is enforced by RLS + permission rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _role public.user_role;
BEGIN
  _role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'client'  THEN 'client'::public.user_role
    WHEN NEW.raw_user_meta_data->>'role' = 'admin'   THEN 'admin'::public.user_role
    WHEN NEW.raw_user_meta_data->>'role' = 'office'  THEN 'office'::public.user_role
    ELSE 'surveyor'::public.user_role
  END;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    _role,
    false
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ------------------------------------------------------------
-- 3. Flexible per-user office permission system.
--    A catalog of permission keys + a per-user allow table. New office
--    capabilities are added by inserting catalog rows, not by editing RLS.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.office_permission_catalog (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.office_user_permissions (
  profile_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.office_permission_catalog(key) ON DELETE CASCADE,
  allowed        BOOLEAN NOT NULL DEFAULT false,
  updated_by     UUID REFERENCES public.profiles(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, permission_key)
);

-- Index the FK that isn't the leading column of the PK (matches migration 021's
-- FK-index convention) so cascade deletes / lookups stay cheap.
CREATE INDEX IF NOT EXISTS idx_office_user_permissions_permission_key
  ON public.office_user_permissions (permission_key);


-- ------------------------------------------------------------
-- 4. Seed the permission catalog. ON CONFLICT keeps labels/descriptions in
--    sync if this migration is re-run after copy edits.
-- ------------------------------------------------------------
INSERT INTO public.office_permission_catalog (key, label, description, category) VALUES
  ('jobs.monitor.view', 'View job monitor', 'View the read-only job monitor / dashboard.', 'jobs'),
  ('jobs.detail.view',  'View job details',  'View read-only metadata/details for an individual job.', 'jobs'),
  ('clients.view',      'View clients',      'View client names / info needed for office work.', 'clients'),
  ('invoicing.view',    'View invoicing',    'Future invoicing read access (placeholder).', 'invoicing'),
  ('invoicing.manage',  'Manage invoicing',  'Future invoicing management (placeholder).', 'invoicing')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      category = EXCLUDED.category;


-- ------------------------------------------------------------
-- 5. Helper functions. SECURITY DEFINER + STABLE + locked search_path, and
--    role is compared as text so the new enum value is never cast at parse
--    time. Both require an ACTIVE office profile.
-- ------------------------------------------------------------

-- True only for an active user whose role is office.
CREATE OR REPLACE FUNCTION public.is_office()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role::text = 'office'
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- True only when the caller is an active office user AND has an explicit
-- allow row for the given permission key.
CREATE OR REPLACE FUNCTION public.has_office_permission(permission_key TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.office_user_permissions oup
    JOIN public.profiles p ON p.id = oup.profile_id
    WHERE oup.profile_id = auth.uid()
      AND oup.permission_key = has_office_permission.permission_key
      AND oup.allowed = true
      AND p.role::text = 'office'
      AND p.is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;


-- ------------------------------------------------------------
-- 6. RLS.
-- ------------------------------------------------------------
ALTER TABLE public.office_permission_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_user_permissions   ENABLE ROW LEVEL SECURITY;

-- --- office_permission_catalog ---
-- Admins manage the catalog; office users may read it (to render their UI).
DROP POLICY IF EXISTS "Admins manage office permission catalog" ON public.office_permission_catalog;
CREATE POLICY "Admins manage office permission catalog"
  ON public.office_permission_catalog FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Office can read permission catalog" ON public.office_permission_catalog;
CREATE POLICY "Office can read permission catalog"
  ON public.office_permission_catalog FOR SELECT
  USING (is_office());

-- --- office_user_permissions ---
-- Admins manage every row (the only path that may WRITE these rows).
DROP POLICY IF EXISTS "Admins manage office user permissions" ON public.office_user_permissions;
CREATE POLICY "Admins manage office user permissions"
  ON public.office_user_permissions FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Office users may read ONLY their own rows.
DROP POLICY IF EXISTS "Office can read own permissions" ON public.office_user_permissions;
CREATE POLICY "Office can read own permissions"
  ON public.office_user_permissions FOR SELECT
  USING (profile_id = auth.uid() AND is_office());

-- --- jobs ---
-- Office may SELECT jobs only with monitor or detail permission. No
-- INSERT/UPDATE/DELETE policy is added, so writes remain denied by default.
DROP POLICY IF EXISTS "Office can view jobs with permission" ON public.jobs;
CREATE POLICY "Office can view jobs with permission"
  ON public.jobs FOR SELECT
  USING (
    has_office_permission('jobs.monitor.view')
    OR has_office_permission('jobs.detail.view')
  );

-- --- clients ---
-- Office may SELECT clients when allowed to see client info or the monitor
-- (the monitor lists client names alongside jobs).
DROP POLICY IF EXISTS "Office can view clients with permission" ON public.clients;
CREATE POLICY "Office can view clients with permission"
  ON public.clients FOR SELECT
  USING (
    has_office_permission('clients.view')
    OR has_office_permission('jobs.monitor.view')
  );

-- --- checklist_templates ---
-- The monitor shows template names per job, so allow read of templates only
-- for the monitor permission. (No section/field access — names only.)
DROP POLICY IF EXISTS "Office can view templates with permission" ON public.checklist_templates;
CREATE POLICY "Office can view templates with permission"
  ON public.checklist_templates FOR SELECT
  USING (has_office_permission('jobs.monitor.view'));

-- ============================================================
-- NOT GRANTED to office in this phase (intentional — default deny):
--   job_field_values, job_signatures, job_photos, template_sections,
--   template_fields, client_job_permissions, storage.objects (photos/PDFs).
-- Office is NOT added to is_admin() or any admin/surveyor/client policy.
-- ============================================================
