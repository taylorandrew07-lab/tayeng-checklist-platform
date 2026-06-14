-- ============================================================
-- Migration 061: Fix "infinite recursion detected in policy for relation profiles"
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The "Users can update safe own profile fields" policy pinned role/is_active/
-- is_super_admin/email/created_at to their current values using INLINE subqueries
-- on `profiles` inside a `profiles` policy. Postgres re-enters profiles' policy
-- stack to evaluate those subqueries and aborts with infinite-recursion — which
-- breaks every UPDATE on profiles, including admin account approvals.
--
-- Fix: read the caller's locked values through a SECURITY DEFINER helper (its
-- internal SELECT bypasses RLS, so there's no policy re-entry). Same protection
-- (a user still can't self-activate / self-promote / change email), no recursion.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_locked_profile()
RETURNS public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.my_locked_profile() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_locked_profile() TO authenticated;

DROP POLICY IF EXISTS "Users can update safe own profile fields" ON public.profiles;
CREATE POLICY "Users can update safe own profile fields" ON public.profiles
  FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK (
    (select auth.uid()) = id
    AND role           = (public.my_locked_profile()).role
    AND is_active      = (public.my_locked_profile()).is_active
    AND is_super_admin = (public.my_locked_profile()).is_super_admin
    AND email          = (public.my_locked_profile()).email
    AND created_at     = (public.my_locked_profile()).created_at
  );
