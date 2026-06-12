-- ============================================================
-- Migration 039: Personnel report — let office read ADMIN staff profiles too
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The Personnel report (admins + office with personal_docs.view) pulls
-- credentials for ALL field staff — surveyors AND admins (admins are also
-- surveyors who need port passes). Office could already read every
-- personal_documents row (the "Office view personal documents" policy from 035
-- has no owner-role filter), but the profiles policy only exposed SURVEYOR
-- profiles. Widen it to staff (surveyor + admin) so office can see admin names
-- and vehicle/employee numbers too. Admins already see all profiles via is_admin().
-- ============================================================

DROP POLICY IF EXISTS "Office view surveyor profiles for documents" ON public.profiles;
DROP POLICY IF EXISTS "Office view staff profiles for documents" ON public.profiles;
CREATE POLICY "Office view staff profiles for documents" ON public.profiles
  FOR SELECT USING (
    role::text IN ('surveyor','admin') AND public.has_office_permission('personal_docs.view')
  );
