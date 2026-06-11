-- ============================================================
-- Migration 036: Structured credentials on personal_documents
-- Run in Supabase SQL Editor AFTER 035 (paste the WHOLE file). Idempotent.
--
-- Turns personal_documents into the single source of truth for a person's
-- credentials: each known credential (driver's permit, ID card, passport,
-- insurance, CoC) is ONE row carrying its number + expiry + file together, so
-- the structured "Employee details" fields and the uploaded document are the
-- same record (fill once, shows everywhere; latest upload overrides previous).
--
--   credential_key   NULL = a free-form "other" document; otherwise one of
--                    drivers_permit | id_card | passport | insurance | coc
--   doc_number       the credential's ID / policy / permit number
--   insurance_*      only used when credential_key = 'insurance'
--   coc_stage        only used when credential_key = 'coc': 'receipt' | 'full'
--                    (uploading the full certificate auto-removes the receipt —
--                     handled in the app)
--
-- A partial UNIQUE index keeps at most one row per credential per person
-- (CoC excepted: one 'receipt' + one 'full' may briefly co-exist).
--
-- NOTE: the vehicle number + employee number stay as simple text columns on
-- profiles (no expiry / no file) — added in 035, still used. The other three
-- 035 columns (drivers_permit_number / id_card_number / passport_number) are
-- now superseded by credential rows; they're left in place (harmless, unused).
-- ============================================================

ALTER TABLE public.personal_documents ADD COLUMN IF NOT EXISTS credential_key    TEXT;
ALTER TABLE public.personal_documents ADD COLUMN IF NOT EXISTS doc_number        TEXT;
ALTER TABLE public.personal_documents ADD COLUMN IF NOT EXISTS insurance_company TEXT;
ALTER TABLE public.personal_documents ADD COLUMN IF NOT EXISTS insurance_type    TEXT;
ALTER TABLE public.personal_documents ADD COLUMN IF NOT EXISTS coc_stage         TEXT;

-- Guard the small enumerations.
ALTER TABLE public.personal_documents DROP CONSTRAINT IF EXISTS personal_documents_credential_key_chk;
ALTER TABLE public.personal_documents ADD  CONSTRAINT personal_documents_credential_key_chk
  CHECK (credential_key IS NULL OR credential_key IN ('drivers_permit','id_card','passport','insurance','coc'));

ALTER TABLE public.personal_documents DROP CONSTRAINT IF EXISTS personal_documents_coc_stage_chk;
ALTER TABLE public.personal_documents ADD  CONSTRAINT personal_documents_coc_stage_chk
  CHECK (coc_stage IS NULL OR coc_stage IN ('receipt','full'));

-- One row per (person, credential[, CoC stage]); free-form docs are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_documents_credential
  ON public.personal_documents (profile_id, credential_key, (COALESCE(coc_stage, '')))
  WHERE credential_key IS NOT NULL;
