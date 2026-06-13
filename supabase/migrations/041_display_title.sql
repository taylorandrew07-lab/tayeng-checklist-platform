-- ============================================================
-- Migration 041: Cosmetic display title (e.g. "Super-Cargo")
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Some staff (e.g. Super-Cargos) are functionally surveyors but carry a
-- different job title. Rather than a whole new role (which would mean mirroring
-- every RLS policy and risking access bugs), we keep role = 'surveyor' and add
-- an optional, purely-cosmetic display_title that the UI shows wherever the
-- role label appears. It grants NO permissions — authorization stays driven by
-- `role` only. NULL display_title means "just show the role" as before.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_title TEXT;

-- Teach the signup trigger to persist a display_title passed in auth metadata.
-- (Mirrors migration 025's handle_new_user, plus the new column.)
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

  INSERT INTO public.profiles (id, email, full_name, role, is_active, display_title)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    _role,
    false,
    NULLIF(NEW.raw_user_meta_data->>'display_title', '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
