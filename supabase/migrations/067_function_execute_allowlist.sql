-- ============================================================
-- Migration 067: Lock function EXECUTE to an allowlist (least privilege)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. REVIEW FIRST.
--
-- Today every public function is EXECUTE-able by `authenticated` (migration 058
-- granted it broadly). This tightens that to least privilege WITHOUT breaking RLS.
--
-- CRITICAL CORRECTNESS NOTE: RLS policy expressions (e.g. USING is_admin()) are
-- evaluated by the QUERYING role, so that role MUST retain EXECUTE on every helper
-- a policy references — otherwise all those policies fail. Therefore the keep-set is
-- built dynamically as:  (RPC functions the client calls)  ∪  (every function named
-- in any pg_policies qual/with_check).  Everything else — trigger-only functions
-- (handle_new_user, enforce_surveyor_job_update, generate_job_number,
-- update_updated_at, …) and other internals — has `authenticated`/`anon`/PUBLIC
-- EXECUTE revoked. The substring match errs toward OVER-keeping (safe: a kept
-- function just stays callable; only under-keeping would break, and it can't here).
--
-- ROLLBACK: re-grant broadly (restores migration 058's state):
--   DO $$ DECLARE r RECORD; BEGIN
--     FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
--              WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
--     LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END LOOP;
--   END $$;
-- ============================================================

DO $$
DECLARE
  r    RECORD;
  keep TEXT[];
BEGIN
  -- RPC allowlist: functions the browser calls via supabase.rpc(...).
  -- (Verified against the codebase: src/lib/jobs/dashboard.ts, analytics.ts,
  --  calendar/api.ts, cargo/register.ts, admin/settings/page.tsx.)
  keep := ARRAY[
    'metrics_billing', 'metrics_pipeline', 'metrics_labour', 'metrics_client_outstanding',
    'get_calendar_jobs',
    'admin_get_job_numbering_info', 'admin_update_job_numbering_config', 'admin_set_next_job_number',
    'issue_cargo_report_number'
  ];

  -- Add every function referenced in an RLS policy expression so policies keep working.
  SELECT keep || COALESCE(array_agg(DISTINCT p.proname), ARRAY[]::text[])
    INTO keep
  FROM pg_policies pol
  JOIN pg_proc p
    ON p.pronamespace = 'public'::regnamespace
   AND p.prokind = 'f'
   AND position(p.proname IN (COALESCE(pol.qual, '') || ' ' || COALESCE(pol.with_check, ''))) > 0;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    IF r.proname = ANY(keep) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END $$;

-- Sanity check after running — should list ONLY the RPCs + RLS helpers, nothing
-- trigger-only:
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prokind='f'
--     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--   ORDER BY 1;
