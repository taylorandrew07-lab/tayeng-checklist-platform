-- ============================================================
-- Migration 035: Surveyor employee fields + personal documents
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- 1. Adds employee/pass fields to profiles. NOTE on self-update: the live policy
--    "Users can update safe own profile fields" (migrations 032/034) is a
--    DENY-LIST — it pins only role/email/is_active/is_super_admin/created_at and
--    leaves every other column self-editable. So these new TEXT columns are
--    automatically self-editable by their owner; NO policy change is needed (and
--    the privileged columns stay locked). Admins edit anyone via the admin policy.
-- 2. personal_documents: a surveyor's own credential docs (port pass, licence,
--    passport, COC, medical, etc.) with issue/expiry dates + reminder settings.
-- 3. Private 'personal-documents' storage bucket, path-scoped to the owner.
-- 4. Two new office permission keys (view docs / receive expiry reminders).
--
-- After running: in Storage → personal-documents, optionally set a per-file size
-- limit (e.g. 25 MB) and allowed MIME types (pdf, images, office docs).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Employee / pass fields on profiles (nullable; self-editable by owner).
-- ------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_number        TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS drivers_permit_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_card_number        TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS passport_number       TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_number       TEXT;

-- ------------------------------------------------------------
-- 2. personal_documents table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.personal_documents (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_name           TEXT NOT NULL,
  doc_type           TEXT,
  issue_date         DATE,
  expiry_date        DATE,
  storage_path       TEXT,
  content_type       TEXT,
  size_bytes         BIGINT,
  notes              TEXT,
  reminder_lead_days INTEGER NOT NULL DEFAULT 60,
  last_reminded_at   TIMESTAMPTZ,
  uploaded_by        UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_personal_documents_profile ON public.personal_documents (profile_id);
CREATE INDEX IF NOT EXISTS idx_personal_documents_expiry  ON public.personal_documents (expiry_date);

DROP TRIGGER IF EXISTS update_personal_documents_updated_at ON public.personal_documents;
CREATE TRIGGER update_personal_documents_updated_at
  BEFORE UPDATE ON public.personal_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 3. RLS — owner manages own; admins manage all; office reads with permission.
-- ------------------------------------------------------------
ALTER TABLE public.personal_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own personal documents" ON public.personal_documents;
CREATE POLICY "Owners manage own personal documents" ON public.personal_documents
  FOR ALL
  USING (profile_id = auth.uid() AND public.is_active_staff())
  WITH CHECK (profile_id = auth.uid() AND public.is_active_staff());

DROP POLICY IF EXISTS "Admins manage all personal documents" ON public.personal_documents;
CREATE POLICY "Admins manage all personal documents" ON public.personal_documents
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Office view personal documents" ON public.personal_documents;
CREATE POLICY "Office view personal documents" ON public.personal_documents
  FOR SELECT USING (public.has_office_permission('personal_docs.view'));

-- Office (with the docs permission) may read surveyor profiles to get the
-- pass-ready fields (name, vehicle/permit/ID/passport/employee numbers).
DROP POLICY IF EXISTS "Office view surveyor profiles for documents" ON public.profiles;
CREATE POLICY "Office view surveyor profiles for documents" ON public.profiles
  FOR SELECT USING (role = 'surveyor' AND public.has_office_permission('personal_docs.view'));

-- ------------------------------------------------------------
-- 4. Storage: private 'personal-documents' bucket. Path = {owner_id}/{file}.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('personal-documents', 'personal-documents', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Read personal documents" ON storage.objects;
CREATE POLICY "Read personal documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'personal-documents' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
      OR public.has_office_permission('personal_docs.view')
    )
  );

DROP POLICY IF EXISTS "Owner/admin upload personal documents" ON storage.objects;
CREATE POLICY "Owner/admin upload personal documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'personal-documents' AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.is_active_staff())
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Owner/admin update personal documents" ON storage.objects;
CREATE POLICY "Owner/admin update personal documents" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'personal-documents' AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.is_active_staff())
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Owner/admin delete personal documents" ON storage.objects;
CREATE POLICY "Owner/admin delete personal documents" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'personal-documents' AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.is_active_staff())
      OR public.is_admin()
    )
  );

-- ------------------------------------------------------------
-- 5. New office permission keys (catalog upsert).
-- ------------------------------------------------------------
INSERT INTO public.office_permission_catalog (key, label, description, category) VALUES
  ('personal_docs.view',          'View surveyor documents',          'View and download surveyor credential documents (to produce port passes).', 'documents'),
  ('personal_docs.expiry.notify', 'Receive document expiry reminders', 'Receive the email reminders when surveyor documents are nearing expiry.',    'documents')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;
