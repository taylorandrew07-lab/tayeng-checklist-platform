-- ============================================================
-- Migration 068: Self-signup can never create admin/office profiles
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- handle_new_user (the auth.users INSERT trigger) read raw_user_meta_data->>'role'
-- and honoured 'admin' and 'office'. raw_user_meta_data is attacker-controlled at
-- signup, so anyone could create a PENDING admin/office row (is_active=false) just
-- by posting role:'admin' to /auth/signup — and a careless approval would activate
-- it. This clamps self-signup to the only self-serviceable roles (client /
-- surveyor). Admin and office accounts must be created via /api/admin/create-user
-- (service role), which sets the role server-side after an authorization check.
--
-- Pending rows always start is_active=false and still require admin approval; this
-- just removes the privileged roles from the self-signup path entirely.
--
-- ROLLBACK: re-apply migration 025's handle_new_user (the CASE that also mapped
-- 'admin'/'office').
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _role public.user_role;
BEGIN
  -- Only 'client' is honoured from metadata; everything else (incl. any 'admin' or
  -- 'office' value) falls back to 'surveyor'. Privileged roles come from create-user.
  _role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'client' THEN 'client'::public.user_role
    ELSE 'surveyor'::public.user_role
  END;

  INSERT INTO public.profiles (id, email, full_name, role, is_active, display_title)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    _role,
    false,
    -- Keep the cosmetic Cargo Technician title (surveyor sub-label); ignore any
    -- attempt to smuggle a privileged label.
    NULLIF(NEW.raw_user_meta_data->>'display_title', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
