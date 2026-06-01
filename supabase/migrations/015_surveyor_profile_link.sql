-- ============================================================
-- Migration 015: Link surveyor display names to real login profiles
-- ============================================================
-- A surveyor_names row is a display name shown on checklists. Optionally it
-- can be linked to a real profile (login user). When linked, jobs created
-- with that surveyor name are ASSIGNED to that profile, so the real person
-- can edit/fill/submit the checklist regardless of their role (admin can be
-- a surveyor too). This is generic — no person is hardcoded.
-- ============================================================

ALTER TABLE public.surveyor_names
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- A profile can be linked to at most one surveyor display name
CREATE UNIQUE INDEX IF NOT EXISTS surveyor_names_profile_id_key
  ON public.surveyor_names (profile_id)
  WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN public.surveyor_names.profile_id IS
  'Optional link to a real login profile. When set, jobs using this surveyor name are assigned to this profile.';
