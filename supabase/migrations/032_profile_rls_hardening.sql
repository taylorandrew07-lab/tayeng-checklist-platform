-- ============================================================
-- Migration 032: CRITICAL profile-update authorization hardening
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The hardening that migrations 004/005/006 intended is NOT live in production
-- (verified: pg_policies on `profiles` still shows the weak 002 policies, so any
-- ACTIVE user could `update profiles set is_super_admin = true` on their own row
-- and self-promote). This migration applies that hardening directly and is
-- self-contained — it deliberately does NOT touch handle_new_user, so the live
-- office-role logic from migration 025 is preserved.
-- ============================================================

-- 1. Authorization helpers require an ACTIVE account; locked search_path.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 2. Users may update only their OWN safe fields (full_name / phone). The
--    privileged columns are pinned to their current values, so a user can never
--    self-activate, self-promote, or change their login email here.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update safe own profile fields" ON public.profiles;
CREATE POLICY "Users can update safe own profile fields" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role           = (SELECT role           FROM public.profiles WHERE id = auth.uid())
    AND is_active      = (SELECT is_active      FROM public.profiles WHERE id = auth.uid())
    AND is_super_admin = (SELECT is_super_admin FROM public.profiles WHERE id = auth.uid())
    AND email          = (SELECT email          FROM public.profiles WHERE id = auth.uid())
  );

-- 3. Admin updates: a super-admin may update anyone; a regular admin may not
--    touch admin accounts and may not elevate (set role=admin / is_super_admin).
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles
  FOR UPDATE
  USING (
    public.is_admin() AND ( public.is_super_admin() OR role != 'admin' )
  )
  WITH CHECK (
    public.is_admin() AND (
      public.is_super_admin()
      OR ( role != 'admin' AND is_super_admin = false )
    )
  );

-- 4. Delete: a regular admin may only delete non-admin profiles (rejecting pending
--    users); super-admin may delete anyone.
DROP POLICY IF EXISTS "Admins can delete non-admin profiles" ON public.profiles;
CREATE POLICY "Admins can delete non-admin profiles" ON public.profiles
  FOR DELETE
  USING (
    public.is_admin() AND ( public.is_super_admin() OR role != 'admin' )
  );
