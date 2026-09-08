-- ============================================================
-- Migration 206: billing a P&I case by ATTENDANCE, not by job
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- THE PROBLEM. Over a case's life two surveyors each log 10 hours across four
-- months. You close off billing for those 20 hours. The case runs on; six months
-- later there are more hours, and those go on the NEXT invoice. The case must know,
-- permanently, which attendances have been paid for and which have not.
--
-- The job-level model cannot express that. jobs.invoice_id is a SCALAR: billing a
-- job consumes its one and only invoice slot, stamps it 'invoiced' and freezes it,
-- and release_jobs_from_invoice cannot restore 'in_progress'. A case would be
-- billable exactly once, ever, and un-billing it would strand it in a state that is
-- not a case state. Migration 205 refuses that outright.
--
-- THE MODEL. The billable unit is the ATTENDANCE ENTRY, not the job. Each row in the
-- two time logs carries the invoice that paid for it; NULL means outstanding. So:
--   * a case is billed as many times as you like, over years, staying open throughout
--   * jobs.invoice_id stays NULL on the case, so nothing in the job-level invoicing
--     path (voyage roll-up, reconciliation, the hours-changed check) is touched
--   * deleting an invoice releases exactly its entries, via ON DELETE SET NULL --
--     the same unwind behaviour invoices already have
--   * an attendance added LATE, dated inside an already-billed period, is still
--     outstanding and appears on the next invoice instead of vanishing. A
--     date-cutoff-only design would have silently lost it.
--
-- invoice_line_items.job_id has no unique constraint (mig 075), so many invoices can
-- each carry a line naming the same case. No junction table is needed.
-- ============================================================

-- == 1. The billing stamp on each attendance =================================
ALTER TABLE public.job_surveyor_regular
  ADD COLUMN IF NOT EXISTS billed_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.job_surveyor_overtime
  ADD COLUMN IF NOT EXISTS billed_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.job_surveyor_regular.billed_invoice_id IS
  'The invoice that paid for this attendance. NULL = outstanding. ON DELETE SET NULL so deleting an invoice returns its entries to outstanding. Admin-only.';
COMMENT ON COLUMN public.job_surveyor_overtime.billed_invoice_id IS
  'The invoice that paid for this attendance. NULL = outstanding. ON DELETE SET NULL so deleting an invoice returns its entries to outstanding. Admin-only.';

-- "What does this invoice cover" and "what is still outstanding" are the only two
-- questions asked of these columns, so both get a partial index for their half.
CREATE INDEX IF NOT EXISTS idx_jsr_billed   ON public.job_surveyor_regular  (billed_invoice_id) WHERE billed_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jso_billed   ON public.job_surveyor_overtime (billed_invoice_id) WHERE billed_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jsr_unbilled ON public.job_surveyor_regular  (job_surveyor_id)   WHERE billed_invoice_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_jso_unbilled ON public.job_surveyor_overtime (job_surveyor_id)   WHERE billed_invoice_id IS NULL;

-- == 2. Only an admin may say what has been billed ===========================
-- The surveyor policies on both logs are FOR ALL on their own rows (migs 111/157), so
-- without this a surveyor could clear the stamp and have their already-paid hours
-- re-billed, or set it and quietly write off work. RLS cannot gate a COLUMN, so a
-- trigger forces the value back exactly as mig 162 does for reminder_hours.
CREATE OR REPLACE FUNCTION public.guard_attendance_billed_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.billed_invoice_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.billed_invoice_id ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS jsr_guard_billed ON public.job_surveyor_regular;
CREATE TRIGGER jsr_guard_billed
  BEFORE INSERT OR UPDATE ON public.job_surveyor_regular
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_billed_stamp();

DROP TRIGGER IF EXISTS jso_guard_billed ON public.job_surveyor_overtime;
CREATE TRIGGER jso_guard_billed
  BEFORE INSERT OR UPDATE ON public.job_surveyor_overtime
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_billed_stamp();

-- == 3. What we CHARGE for a surveyor, per case ==============================
-- A sibling table, not a column on job_surveyors, and deliberately so: RLS cannot hide
-- a column, and job_surveyors is readable by the surveyor it belongs to. A charge rate
-- next to the pay rate would show every surveyor the margin on their own time.
-- Same reasoning and same shape as client_billing (mig 077) and staff_private (130).
CREATE TABLE IF NOT EXISTS public.job_surveyor_billing (
  job_surveyor_id UUID PRIMARY KEY REFERENCES public.job_surveyors(id) ON DELETE CASCADE,
  charge_rate     NUMERIC,
  charge_currency TEXT NOT NULL DEFAULT 'TTD',
  updated_by      UUID REFERENCES public.profiles(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.job_surveyor_billing DROP CONSTRAINT IF EXISTS jsb_currency_chk;
ALTER TABLE public.job_surveyor_billing ADD CONSTRAINT jsb_currency_chk
  CHECK (charge_currency IN ('USD', 'TTD', 'EUR', 'GBP'));
ALTER TABLE public.job_surveyor_billing DROP CONSTRAINT IF EXISTS jsb_rate_nonneg;
ALTER TABLE public.job_surveyor_billing ADD CONSTRAINT jsb_rate_nonneg
  CHECK (charge_rate IS NULL OR charge_rate >= 0);

ALTER TABLE public.job_surveyor_billing ENABLE ROW LEVEL SECURITY;

-- Admins only, for everything. No surveyor policy of any kind: a surveyor must not be
-- able to read what the client is charged for their hour.
DROP POLICY IF EXISTS "Admins manage case charge rates" ON public.job_surveyor_billing;
CREATE POLICY "Admins manage case charge rates" ON public.job_surveyor_billing
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- == 4. Close off a case's outstanding attendances ===========================
-- Called AFTER the invoice and its lines exist, so the money and the stamps commit
-- against a real invoice. One UPDATE per table, each re-checking billed_invoice_id IS
-- NULL, so two admins billing the same case at once cannot double-bill an entry --
-- the second finds nothing and reports zero rather than silently re-stamping.
--
-- The cutoff is on entry_date, the day the work happened, NOT on when the row was
-- typed. An attendance entered late but dated inside the period is picked up by the
-- NEXT run, because it is still outstanding.
DROP FUNCTION IF EXISTS public.bill_case_attendances(uuid, uuid, date);
CREATE OR REPLACE FUNCTION public.bill_case_attendances(
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
  v_reg  INT := 0;
  v_ot   INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can bill a case';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_case AND j.is_case) THEN
    RAISE EXCEPTION 'Job % is not a P&I case', p_case;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice) THEN
    RAISE EXCEPTION 'Invoice % does not exist', p_invoice;
  END IF;

  UPDATE public.job_surveyor_regular r
     SET billed_invoice_id = p_invoice
    FROM public.job_surveyors js
   WHERE js.id = r.job_surveyor_id
     AND js.job_id = p_case
     AND r.billed_invoice_id IS NULL
     AND r.entry_date IS NOT NULL
     AND r.entry_date <= p_cutoff;
  GET DIAGNOSTICS v_reg = ROW_COUNT;

  UPDATE public.job_surveyor_overtime o
     SET billed_invoice_id = p_invoice
    FROM public.job_surveyors js
   WHERE js.id = o.job_surveyor_id
     AND js.job_id = p_case
     AND o.billed_invoice_id IS NULL
     AND o.entry_date IS NOT NULL
     AND o.entry_date <= p_cutoff;
  GET DIAGNOSTICS v_ot = ROW_COUNT;

  RETURN jsonb_build_object('regular', v_reg, 'overtime', v_ot, 'total', v_reg + v_ot);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.bill_case_attendances(uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bill_case_attendances(uuid, uuid, date) TO authenticated;

-- Release every attendance an invoice paid for, without deleting the invoice. Deleting
-- one already releases them (ON DELETE SET NULL); this is for VOIDING, which leaves the
-- invoice row in place and would otherwise strand its hours as billed for ever.
DROP FUNCTION IF EXISTS public.unbill_case_attendances(uuid);
CREATE OR REPLACE FUNCTION public.unbill_case_attendances(p_invoice UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reg INT := 0;
  v_ot  INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can un-bill a case';
  END IF;

  UPDATE public.job_surveyor_regular  SET billed_invoice_id = NULL WHERE billed_invoice_id = p_invoice;
  GET DIAGNOSTICS v_reg = ROW_COUNT;
  UPDATE public.job_surveyor_overtime SET billed_invoice_id = NULL WHERE billed_invoice_id = p_invoice;
  GET DIAGNOSTICS v_ot = ROW_COUNT;

  RETURN jsonb_build_object('regular', v_reg, 'overtime', v_ot, 'total', v_reg + v_ot);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.unbill_case_attendances(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unbill_case_attendances(uuid) TO authenticated;

-- Sanity checks after running:
--   SELECT count(*) FROM public.job_surveyor_regular WHERE billed_invoice_id IS NULL;
--   SELECT * FROM public.job_surveyor_billing;                    -- admin only
--   -- outstanding hours on a case:
--   -- SELECT sum(r.hours) FROM job_surveyor_regular r
--   --   JOIN job_surveyors js ON js.id = r.job_surveyor_id
--   --  WHERE js.job_id = '<case id>' AND r.billed_invoice_id IS NULL;
