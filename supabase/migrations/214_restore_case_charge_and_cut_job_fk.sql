-- ============================================================
-- Migration 214: restore the charge migration 213 destroyed, and cut the FK that did it
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- WHAT HAPPENED. Migration 208 declared:
--     job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE
-- Migration 213 then set case_charges.case_id and, a few statements later, deleted the
-- job row. The cascade fired and took the charge with it — the correspondency fee for
-- the 'Collision' case, USD 120, gone in the same transaction that had just re-parented
-- it. Setting the new parent does not save a row from the old parent's cascade.
--
-- The values are recovered from a pre-flight capture taken before 213 ran:
--   kind 'correspondency' · 'Opening of case file' · qty 1 · 120.00 USD · unbilled
-- incurred_on was not captured; the case's opened_on is used, which is what a fee for
-- opening the file must have been dated anyway.
--
-- THE FIX IS TO REMOVE THE COLUMN, not to be careful next time. job_id is dead weight
-- now: case_id is the real parent, and every remaining row is reachable through it. With
-- the column gone the cascade cannot fire again, and case_id becomes NOT NULL so a
-- charge can never again exist without a case.
--
-- This was scheduled for the final drop migration. It is brought forward because the
-- restore cannot happen while job_id is NOT NULL and its job no longer exists.
-- ============================================================

-- == 1. Cut the destructive parent ===========================================
-- Nothing in the running app reads case_charges by job_id any more: its only reader was
-- the old case page, which is already inert — its case list queries jobs WHERE is_case,
-- and migration 213 left none.
DROP INDEX IF EXISTS public.idx_case_charges_job;
DROP INDEX IF EXISTS public.idx_case_charges_unbilled;
ALTER TABLE public.case_charges DROP COLUMN IF EXISTS job_id;

-- billed_invoice_id belonged to the TE-invoice model, which a case no longer uses at
-- all: claims replace it (mig 212). Dropping it now also removes the second FK that
-- could quietly null or delete case money from elsewhere.
ALTER TABLE public.case_charges DROP COLUMN IF EXISTS billed_invoice_id;

-- == 2. Put the fee back ======================================================
-- Guarded on the exact row being absent, so re-running never duplicates it, and scoped
-- by legacy_job_id rather than a hard-coded case id so it stays correct if the case is
-- ever re-migrated.
INSERT INTO public.case_charges (case_id, kind, description, incurred_on, qty, unit_amount, currency, created_by)
SELECT c.id, 'correspondency', 'Opening of case file', c.opened_on, 1, 120, 'USD', c.created_by
  FROM public.cases c
 WHERE c.legacy_job_id = 'e6bf2323-e0ad-40f1-a9c4-4fac19a7ea55'
   AND NOT EXISTS (
     SELECT 1 FROM public.case_charges x
      WHERE x.case_id = c.id AND x.description = 'Opening of case file');

-- == 3. A charge always has a case ===========================================
-- Safe only after step 2: every surviving row now carries a case_id.
DO $fix$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.case_charges WHERE case_id IS NULL) THEN
    ALTER TABLE public.case_charges ALTER COLUMN case_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'case_charges still has rows with no case_id — leaving the column nullable';
  END IF;
END $fix$;

-- Sanity checks after running:
--   SELECT c.title, ch.kind, ch.description, ch.qty, ch.unit_amount, ch.currency, ch.incurred_on
--     FROM public.case_charges ch JOIN public.cases c ON c.id = ch.case_id;
--   -- expect: Collision | correspondency | Opening of case file | 1 | 120 | USD | 2026-09-07
--   SELECT count(*) FROM public.case_charges WHERE case_id IS NULL;   -- expect 0
