-- ============================================================
-- Migration 208: a case's money is priced PER ITEM, not per person
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- WHAT MIGRATION 206 GOT WRONG. job_surveyor_billing is keyed
-- job_surveyor_id PRIMARY KEY — one price per surveyor per case. It was built on the
-- assumption "a surveyor has a price". The rule is "a piece of work has a price": the
-- same surveyor bills a call-out at one rate and expert-witness testimony at another,
-- in a different currency, on the same case, and either can change without touching
-- the other. That is not a missing column, it is the wrong key, so the table is
-- replaced rather than extended. It is dropped in a follow-up once the UI that reads
-- it has been replaced. Nothing has been billed and it holds no rows.
--
-- WHAT 206 GOT RIGHT, AND IS KEPT UNCHANGED:
--   * the billable unit is the ATTENDANCE ENTRY, stamped with billed_invoice_id
--   * the price lives in an ADMIN-ONLY SIBLING table, because RLS cannot hide a
--     column and job_surveyor_regular's SELECT policy lets a surveyor read their own
--     rows — a charge_rate column there would show them the margin on their own hour.
-- This migration moves the key, not the privacy model.
--
-- CURRENCY. invoices.currency is one column, invoice_line_items has none, and there is
-- no FX rate anywhere in this app by deliberate policy (see voyageBilling.ts and
-- ConsolidatedInvoiceBuilder, which both REFUSE to mix rather than convert). So a case
-- whose outstanding work spans TTD and USD produces TWO invoices. bill_case_items
-- enforces that in the database by stamping only the items priced in the invoice's own
-- currency — the rest simply stay outstanding for their own run.
-- ============================================================

-- == 1. The price of one attendance ==========================================
-- Keyed to the LOG ROW, not the person. The two logs have identical shapes (migs
-- 111/115 vs 157), so one sibling table serves both rather than two near-duplicates;
-- exactly one of the two entry columns is set.
--
-- ON DELETE CASCADE: delete the attendance and its price goes with it. There is
-- nothing left to charge for, and a price row pointing at a deleted shift would be
-- counted by nothing and confuse everything.
CREATE TABLE IF NOT EXISTS public.job_attendance_billing (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  regular_entry_id  UUID REFERENCES public.job_surveyor_regular(id)  ON DELETE CASCADE,
  overtime_entry_id UUID REFERENCES public.job_surveyor_overtime(id) ON DELETE CASCADE,
  -- What the work WAS, in the client's words: "Expert witness testimony".
  -- Free text, typed per entry — there is no work-type catalog to maintain.
  description       TEXT,
  charge_rate       NUMERIC,
  charge_currency   TEXT NOT NULL DEFAULT 'TTD',
  updated_by        UUID REFERENCES public.profiles(id),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one parent, never both and never neither.
ALTER TABLE public.job_attendance_billing DROP CONSTRAINT IF EXISTS jab_one_parent_chk;
ALTER TABLE public.job_attendance_billing ADD CONSTRAINT jab_one_parent_chk
  CHECK ((regular_entry_id IS NOT NULL)::int + (overtime_entry_id IS NOT NULL)::int = 1);

ALTER TABLE public.job_attendance_billing DROP CONSTRAINT IF EXISTS jab_ccy_chk;
ALTER TABLE public.job_attendance_billing ADD CONSTRAINT jab_ccy_chk
  CHECK (charge_currency IN ('USD', 'TTD', 'EUR', 'GBP'));
ALTER TABLE public.job_attendance_billing DROP CONSTRAINT IF EXISTS jab_rate_nonneg;
ALTER TABLE public.job_attendance_billing ADD CONSTRAINT jab_rate_nonneg
  CHECK (charge_rate IS NULL OR charge_rate >= 0);

-- One price per entry. Partial uniques because each column is NULL on half the rows.
CREATE UNIQUE INDEX IF NOT EXISTS jab_regular_uidx  ON public.job_attendance_billing (regular_entry_id)  WHERE regular_entry_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS jab_overtime_uidx ON public.job_attendance_billing (overtime_entry_id) WHERE overtime_entry_id IS NOT NULL;

ALTER TABLE public.job_attendance_billing ENABLE ROW LEVEL SECURITY;

-- Admins only, for everything. No surveyor policy of any kind, deliberately: this is
-- what the client pays for an hour, and the person who worked it must not read it.
DROP POLICY IF EXISTS "Admins manage attendance pricing" ON public.job_attendance_billing;
CREATE POLICY "Admins manage attendance pricing" ON public.job_attendance_billing
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- == 2. Money on a case that is not an hour ==================================
-- The correspondency fee at case open and a third-party/contractor cost are the SAME
-- shape: a dated, one-time amount in a currency, optionally with a receipt. One table.
-- billed_invoice_id repeats mig 206's model exactly, so a fee unwinds on invoice delete
-- (ON DELETE SET NULL) the way an attendance does.
CREATE TABLE IF NOT EXISTS public.case_charges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL DEFAULT 'other',
  description       TEXT NOT NULL,
  payee             TEXT,                    -- the contractor, lab, launch service
  incurred_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  qty               NUMERIC NOT NULL DEFAULT 1,
  unit_amount       NUMERIC NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'TTD',
  -- Optional. The 'invoice-receipts' bucket and the is_expense line type already exist
  -- (mig 083), so a contractor cost reuses them rather than inventing a second idea.
  receipt_path      TEXT,
  billed_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by        UUID REFERENCES public.profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.case_charges DROP CONSTRAINT IF EXISTS cc_kind_chk;
ALTER TABLE public.case_charges ADD CONSTRAINT cc_kind_chk
  CHECK (kind IN ('correspondency', 'third_party', 'disbursement', 'other'));
ALTER TABLE public.case_charges DROP CONSTRAINT IF EXISTS cc_ccy_chk;
ALTER TABLE public.case_charges ADD CONSTRAINT cc_ccy_chk
  CHECK (currency IN ('USD', 'TTD', 'EUR', 'GBP'));
-- Mirrors chk_ili_nonneg on invoice_line_items (mig 049).
ALTER TABLE public.case_charges DROP CONSTRAINT IF EXISTS cc_amount_nonneg;
ALTER TABLE public.case_charges ADD CONSTRAINT cc_amount_nonneg
  CHECK (qty >= 0 AND unit_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_case_charges_job ON public.case_charges (job_id);
CREATE INDEX IF NOT EXISTS idx_case_charges_unbilled
  ON public.case_charges (job_id) WHERE billed_invoice_id IS NULL;

ALTER TABLE public.case_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage case charges" ON public.case_charges;
CREATE POLICY "Admins manage case charges" ON public.case_charges
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Read case charges" ON public.case_charges;
CREATE POLICY "Read case charges" ON public.case_charges
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('invoicing.view'));

-- NO billed-stamp guard trigger here, deliberately. Mig 206 needed one because the log
-- tables are surveyor-writable and RLS cannot gate a column; only an admin can write
-- case_charges at all, so there is nothing to defend — and adding one would re-open the
-- mig-207 trap where the guard fought the ON DELETE SET NULL cascade.

-- A case charge only makes sense on a case, and a CHECK cannot read another table.
CREATE OR REPLACE FUNCTION public.case_charge_requires_case()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.is_case) THEN
    RAISE EXCEPTION 'Case charges belong to a P&I case, and job % is not one', NEW.job_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS case_charges_require_case ON public.case_charges;
CREATE TRIGGER case_charges_require_case
  BEFORE INSERT OR UPDATE ON public.case_charges
  FOR EACH ROW EXECUTE FUNCTION public.case_charge_requires_case();

-- == 3. Close off a billing period, in ONE currency ==========================
-- Supersedes bill_case_attendances (mig 206), which knew only about hours and nothing
-- about currency. Both are kept: 206's is left in place so an in-flight client cannot
-- break mid-deploy, and is dropped once nothing calls it.
--
-- CURRENCY IS ENFORCED HERE, not only in the UI. It stamps ONLY the items priced in the
-- invoice's own currency; anything in another currency stays outstanding for its own
-- invoice. So a mixed case bills as two invoices and no code path — present or future —
-- can produce one invoice containing two currencies.
--
-- An attendance with NO price row is NOT billed. A missing rate means nobody has said
-- what it is worth, and billing it would charge the client zero and mark the hours paid.
DROP FUNCTION IF EXISTS public.bill_case_items(uuid, uuid, date);
CREATE OR REPLACE FUNCTION public.bill_case_items(
  p_case    UUID,
  p_invoice UUID,
  p_cutoff  DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ccy TEXT;
  v_reg INT := 0;
  v_ot  INT := 0;
  v_chg INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can bill a case';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_case AND j.is_case) THEN
    RAISE EXCEPTION 'Job % is not a P&I case', p_case;
  END IF;
  SELECT i.currency INTO v_ccy FROM public.invoices i WHERE i.id = p_invoice;
  IF v_ccy IS NULL THEN
    RAISE EXCEPTION 'Invoice % does not exist', p_invoice;
  END IF;

  UPDATE public.job_surveyor_regular r
     SET billed_invoice_id = p_invoice
    FROM public.job_surveyors js, public.job_attendance_billing b
   WHERE js.id = r.job_surveyor_id
     AND js.job_id = p_case
     AND b.regular_entry_id = r.id
     AND b.charge_rate IS NOT NULL
     AND b.charge_currency = v_ccy
     AND r.billed_invoice_id IS NULL
     AND r.entry_date IS NOT NULL
     AND r.entry_date <= p_cutoff;
  GET DIAGNOSTICS v_reg = ROW_COUNT;

  UPDATE public.job_surveyor_overtime o
     SET billed_invoice_id = p_invoice
    FROM public.job_surveyors js, public.job_attendance_billing b
   WHERE js.id = o.job_surveyor_id
     AND js.job_id = p_case
     AND b.overtime_entry_id = o.id
     AND b.charge_rate IS NOT NULL
     AND b.charge_currency = v_ccy
     AND o.billed_invoice_id IS NULL
     AND o.entry_date IS NOT NULL
     AND o.entry_date <= p_cutoff;
  GET DIAGNOSTICS v_ot = ROW_COUNT;

  UPDATE public.case_charges c
     SET billed_invoice_id = p_invoice
   WHERE c.job_id = p_case
     AND c.billed_invoice_id IS NULL
     AND c.currency = v_ccy
     AND c.incurred_on <= p_cutoff;
  GET DIAGNOSTICS v_chg = ROW_COUNT;

  RETURN jsonb_build_object(
    'currency', v_ccy, 'regular', v_reg, 'overtime', v_ot, 'charges', v_chg,
    'total', v_reg + v_ot + v_chg);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.bill_case_items(uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bill_case_items(uuid, uuid, date) TO authenticated;

-- Release everything an invoice paid for — hours AND charges. Extends mig 206's
-- unbill_case_attendances, which knew only about hours; without the charges half,
-- voiding an invoice would strand a correspondency fee as billed for ever.
DROP FUNCTION IF EXISTS public.unbill_case_items(uuid);
CREATE OR REPLACE FUNCTION public.unbill_case_items(p_invoice UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reg INT := 0;
  v_ot  INT := 0;
  v_chg INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can un-bill a case';
  END IF;

  UPDATE public.job_surveyor_regular  SET billed_invoice_id = NULL WHERE billed_invoice_id = p_invoice;
  GET DIAGNOSTICS v_reg = ROW_COUNT;
  UPDATE public.job_surveyor_overtime SET billed_invoice_id = NULL WHERE billed_invoice_id = p_invoice;
  GET DIAGNOSTICS v_ot = ROW_COUNT;
  UPDATE public.case_charges          SET billed_invoice_id = NULL WHERE billed_invoice_id = p_invoice;
  GET DIAGNOSTICS v_chg = ROW_COUNT;

  RETURN jsonb_build_object('regular', v_reg, 'overtime', v_ot, 'charges', v_chg,
                            'total', v_reg + v_ot + v_chg);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.unbill_case_items(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unbill_case_items(uuid) TO authenticated;

-- Sanity checks after running:
--   SELECT * FROM public.case_charges;                       -- admin only
--   SELECT * FROM public.job_attendance_billing;             -- admin only
--   -- outstanding on a case, BY CURRENCY (what the billing screen groups on):
--   -- SELECT b.charge_currency, sum(r.hours * b.charge_rate)
--   --   FROM job_surveyor_regular r
--   --   JOIN job_surveyors js ON js.id = r.job_surveyor_id
--   --   JOIN job_attendance_billing b ON b.regular_entry_id = r.id
--   --  WHERE js.job_id = '<case id>' AND r.billed_invoice_id IS NULL
--   --  GROUP BY 1;
