-- ============================================================
-- Migration 013: Fix search_path on all SECURITY DEFINER functions
-- ============================================================
-- Root cause: SECURITY DEFINER functions execute with a locked search_path
-- that does not include "public", so unqualified table/type references fail.
-- Symptom: new user signups returned 500 "Database error saving new user"
-- (SQLSTATE 25P02) because handle_new_user() could not resolve "profiles".
-- Fix: add SET search_path = public to every SECURITY DEFINER function and
-- fully schema-qualify all table and type references within them.
-- ============================================================

-- 1. handle_new_user — auth.users insert trigger
--    This is the function that was breaking signups.
--    Preserves the defensive CASE block from migration 004 (prevents arbitrary
--    role values being injected via raw_user_meta_data).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _role public.user_role;
BEGIN
  _role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'client' THEN 'client'::public.user_role
    WHEN NEW.raw_user_meta_data->>'role' = 'admin'  THEN 'admin'::public.user_role
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

-- 2. get_my_role — RLS helper (supersedes migrations 002 and 006)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 3. is_admin — RLS helper (supersedes migrations 002 and 006)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 4. get_my_client_id — RLS helper (supersedes migration 002)
CREATE OR REPLACE FUNCTION public.get_my_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM public.client_users WHERE profile_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- 5. is_super_admin — RLS helper (supersedes migrations 005 and 006)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_super_admin = true AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
