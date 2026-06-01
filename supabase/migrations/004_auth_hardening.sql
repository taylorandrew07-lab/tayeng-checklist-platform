-- ============================================================
-- Taylor Engineering Checklist Platform
-- Migration 004: Auth & Approval Flow Hardening
-- ============================================================

-- ============================================================
-- 1. Fix handle_new_user: always is_active = false
--    Admin create-user route activates profiles via service role.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _role user_role;
BEGIN
  _role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'client' THEN 'client'::user_role
    WHEN NEW.raw_user_meta_data->>'role' = 'admin'  THEN 'admin'::user_role
    ELSE 'surveyor'::user_role
  END;

  INSERT INTO profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    _role,
    false  -- always pending; admin create-user route activates immediately via service role
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent: admin routes may pre-create the profile

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Tighten profiles RLS
--    Users may update only full_name and phone.
--    role, is_active, is_super_admin, email are admin-only.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

DO $$ BEGIN
  CREATE POLICY "Users can update safe own profile fields"
    ON profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
      auth.uid() = id
      AND role          = (SELECT role          FROM profiles WHERE id = auth.uid())
      AND is_active     = (SELECT is_active     FROM profiles WHERE id = auth.uid())
      AND is_super_admin = (SELECT is_super_admin FROM profiles WHERE id = auth.uid())
      AND email         = (SELECT email         FROM profiles WHERE id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
