-- ============================================================
-- Taylor Engineering Checklist Platform
-- Migration 005: Production Hardening
-- ============================================================

-- ============================================================
-- 1. Super admin by email (safe for fresh installs, idempotent)
--    Migration 003 used a hardcoded UUID which only works for
--    the original Supabase project.
-- ============================================================

UPDATE profiles
SET is_super_admin = true, is_active = true, role = 'admin'
WHERE email = 'andrew.taylor@tayeng.com';

-- ============================================================
-- 2. is_super_admin() helper (SECURITY DEFINER bypasses RLS)
-- ============================================================

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 3. Tighten admin profile update policy
--    Regular admins must not touch admin accounts or elevate privileges.
--    USING clause (existing row): regular admins cannot select admin rows.
--    WITH CHECK clause (new row): regular admins cannot set role=admin or is_super_admin=true.
-- ============================================================

DROP POLICY IF EXISTS "Admins can update any profile" ON profiles;

DO $$ BEGIN
  CREATE POLICY "Admins can update profiles"
    ON profiles FOR UPDATE
    USING (
      is_admin() AND (
        is_super_admin()          -- super admin can update anyone
        OR role != 'admin'        -- regular admin: target must not currently be admin
      )
    )
    WITH CHECK (
      is_admin() AND (
        is_super_admin()          -- super admin: no restrictions on result
        OR (
          role != 'admin'         -- regular admin: result must not be admin role
          AND is_super_admin = false  -- and must not set super_admin flag
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 4. Profile delete policy (for admin rejection of pending users)
--    Regular admins can only delete non-admin profiles.
-- ============================================================

DO $$ BEGIN
  CREATE POLICY "Admins can delete non-admin profiles"
    ON profiles FOR DELETE
    USING (
      is_admin() AND (
        is_super_admin()    -- super admin can delete anyone
        OR role != 'admin'  -- regular admin: only delete non-admin users
      )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
