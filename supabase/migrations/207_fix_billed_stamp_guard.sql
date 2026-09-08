-- ============================================================
-- Migration 207: the billed-stamp guard must not fight the FK cascade
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- THE BUG. Migration 206's guard forced billed_invoice_id back whenever is_admin()
-- was false. is_admin() reads auth.uid(), which is NULL on ANY connection without a
-- JWT — the service role, the migration runner, and, critically, the referential
-- action Postgres runs for ON DELETE SET NULL.
--
-- So deleting an invoice did this: the RI action issued an UPDATE setting
-- billed_invoice_id to NULL, this BEFORE trigger fired with no auth.uid(), decided
-- the actor was not an admin, and RESTORED the old value — the id of the invoice
-- being deleted. The delete then succeeded. The attendance was left pointing at an
-- invoice that no longer exists, still counted as billed, and those hours could never
-- be billed again. No error, anywhere.
--
-- That is the exact unwind path mig 206's own header calls the reason the design is
-- safe ("deleting an invoice releases exactly its entries"). It was releasing nothing.
-- Caught by e2e/smoke-cases.mjs, which is the only thing that could have caught it —
-- vitest covers no RLS, no triggers and no referential actions.
--
-- THE FIX. The guard exists to stop a SURVEYOR rewriting what has been billed. It was
-- never meant to police trusted connections, and it cannot police a cascade. So it now
-- applies only to a real, signed-in, non-admin user. Everything else — an admin, the
-- service role in an /api route that has already authorised its caller, and Postgres's
-- own referential actions — passes through.
-- ============================================================

-- == 1. Only a real non-admin USER is blocked ================================
CREATE OR REPLACE FUNCTION public.guard_attendance_billed_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- auth.uid() IS NOT NULL is the whole fix: it means "a person is doing this".
  -- Without it the guard also catches the ON DELETE SET NULL cascade and undoes it.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    NEW.billed_invoice_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.billed_invoice_id ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$fn$;

-- == 2. Repair anything the old guard stranded ===============================
-- An attendance pointing at an invoice that no longer exists is billed for ever: the
-- billing UI counts it as paid, and nothing will ever release it. Normally the FK makes
-- this state impossible; the old trigger manufactured it by writing the value back
-- after the referential action had cleared it.
--
-- Idempotent, and a no-op on a healthy database.
UPDATE public.job_surveyor_regular r
   SET billed_invoice_id = NULL
 WHERE r.billed_invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = r.billed_invoice_id);

UPDATE public.job_surveyor_overtime o
   SET billed_invoice_id = NULL
 WHERE o.billed_invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = o.billed_invoice_id);

-- Sanity checks after running:
--   -- must both be 0: nothing may reference a missing invoice
--   SELECT count(*) FROM public.job_surveyor_regular r
--    WHERE r.billed_invoice_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = r.billed_invoice_id);
--   SELECT count(*) FROM public.job_surveyor_overtime o
--    WHERE o.billed_invoice_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = o.billed_invoice_id);
--   -- and `npm run smoke-cases` must end with "deleting the invoice returns its
--   -- attendances to outstanding".
