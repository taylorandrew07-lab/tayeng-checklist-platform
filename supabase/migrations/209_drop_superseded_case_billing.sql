-- ============================================================
-- Migration 209: remove the superseded case-billing objects
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- Migration 208 replaced all three of these, and the code that used them shipped
-- before this file — so nothing reads them now. Dead schema is worse than no schema:
-- the next person to look finds two ways to price a case and no way to tell which is
-- live, which is exactly how the stale copy of enforce_job_admin_columns in mig 162
-- came to mislead.
--
--   job_surveyor_billing      keyed job_surveyor_id (one price per surveyor per case).
--                             Wrong key, not a missing column. Replaced by
--                             job_attendance_billing, keyed to the attendance ENTRY.
--                             It never held a row and nothing was ever billed with it.
--   bill_case_attendances     knew only about hours and nothing about currency.
--                             Replaced by bill_case_items, which also bills the case's
--                             fees and stamps only the invoice's own currency.
--   unbill_case_attendances   released hours but not fees, so voiding an invoice would
--                             have stranded a correspondency fee as billed for ever.
--                             Replaced by unbill_case_items.
--
-- SAFETY: verified before writing this — job_surveyor_billing had 0 rows, and no
-- attendance had ever been stamped. Nothing is lost.
-- ============================================================

DROP FUNCTION IF EXISTS public.bill_case_attendances(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.unbill_case_attendances(uuid);

-- CASCADE would take its RLS policy with it; the table has no dependents of its own.
DROP TABLE IF EXISTS public.job_surveyor_billing;

-- Sanity checks after running:
--   -- all three must return 0 rows:
--   SELECT to_regclass('public.job_surveyor_billing');            -- expect NULL
--   SELECT proname FROM pg_proc WHERE proname = 'bill_case_attendances';
--   SELECT proname FROM pg_proc WHERE proname = 'unbill_case_attendances';
--   -- and the replacements must still be there:
--   SELECT proname FROM pg_proc WHERE proname IN ('bill_case_items','unbill_case_items');
