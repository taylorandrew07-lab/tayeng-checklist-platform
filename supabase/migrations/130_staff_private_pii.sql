-- ============================================================
-- Migration 130: move genuine-PII identity numbers off profiles. Idempotent.
-- Run in Supabase SQL Editor (paste the WHOLE file).
--
-- Audit finding (MEDIUM): "Surveyors can view surveyor profiles" (mig 002)
-- grants every surveyor a ROW-level SELECT on all admin+surveyor profile rows.
-- Postgres RLS cannot hide columns, so the identity numbers added to profiles in
-- mig 035 (passport_number / id_card_number / drivers_permit_number) were
-- readable by any surveyor via the normal client.
--
-- These three columns are NOT referenced by any app code (credentials live in
-- personal_documents), so we relocate them to an admin/office/owner-only table
-- and drop them from profiles. Mirrors the mig-077 client_billing split.
--
-- Scope note: employee_number / vehicle_number / phone / email stay on profiles
-- — they are low-sensitivity operational identifiers used across ~40 call sites
-- and are needed by surveyors for coordination; moving them is high-churn for
-- little gain. Revisit separately if desired.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_private (
  profile_id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  passport_number       TEXT,
  id_card_number        TEXT,
  drivers_permit_number TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_staff_private_updated_at ON public.staff_private;
CREATE TRIGGER update_staff_private_updated_at BEFORE UPDATE ON public.staff_private
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.staff_private ENABLE ROW LEVEL SECURITY;

-- Admin: full access. Office with personal-docs permission: read. Owner: read own.
DROP POLICY IF EXISTS "Admins manage staff_private" ON public.staff_private;
CREATE POLICY "Admins manage staff_private" ON public.staff_private
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Office read staff_private" ON public.staff_private;
CREATE POLICY "Office read staff_private" ON public.staff_private
  FOR SELECT USING (public.has_office_permission('personal_docs.view'));

DROP POLICY IF EXISTS "Owner read own staff_private" ON public.staff_private;
CREATE POLICY "Owner read own staff_private" ON public.staff_private
  FOR SELECT USING (profile_id = auth.uid());

-- Carry existing data across, then drop the columns. Guarded so a re-run after
-- the columns are already gone is a no-op instead of an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'passport_number'
  ) THEN
    INSERT INTO public.staff_private (profile_id, passport_number, id_card_number, drivers_permit_number)
      SELECT id, passport_number, id_card_number, drivers_permit_number
      FROM public.profiles
      WHERE passport_number IS NOT NULL
         OR id_card_number IS NOT NULL
         OR drivers_permit_number IS NOT NULL
    ON CONFLICT (profile_id) DO UPDATE
      SET passport_number       = EXCLUDED.passport_number,
          id_card_number        = EXCLUDED.id_card_number,
          drivers_permit_number = EXCLUDED.drivers_permit_number;

    ALTER TABLE public.profiles DROP COLUMN IF EXISTS passport_number;
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS id_card_number;
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS drivers_permit_number;
  END IF;
END $$;
