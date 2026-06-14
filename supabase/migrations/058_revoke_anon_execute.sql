-- ============================================================
-- Migration 058: Lock SECURITY DEFINER functions to authenticated users
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The advisor flags SECURITY DEFINER functions that are EXECUTABLE BY ANON
-- (unauthenticated) — they run with elevated/owner rights, so anon should not be
-- able to call them. This revokes EXECUTE from PUBLIC + anon on every
-- SECURITY DEFINER function in `public` and (re)grants it to `authenticated`, so
-- the app keeps working for logged-in users and RLS helpers still evaluate, but
-- the anon role loses access. Trigger-only functions are unaffected in practice
-- (triggers run as the definer regardless of EXECUTE grants).
--
-- Reversible: GRANT EXECUTE ... TO anon would restore it.
-- ============================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true          -- SECURITY DEFINER only
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

-- Verify after running (should list no SECURITY DEFINER fn with anon execute):
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prosecdef
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
