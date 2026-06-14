-- ============================================================
-- Migration 049: Security hardening (audit Batch A)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Fixes from the security audit:
--  #1 Surveyors could move their job_surveyors assignment to another job_id.
--  #2 Surveyors could change protected job columns (workflow/report/approval).
--  #3 anon/public could execute the numbering counter functions.
--  #5 Secondary surveyors (job_surveyors) could not edit checklist data.
--  #6 Invoice integrity: one invoice per job + non-negative money.
--  #9a Server-side upload size + MIME allowlist on sensitive buckets.
-- ============================================================

-- ── #3 Lock down the numbering counters ─────────────────────────────────────
-- The set_report_number / set_invoice_number triggers are SECURITY DEFINER and
-- call these internally, so revoking direct EXECUTE does not break auto-numbering.
REVOKE EXECUTE ON FUNCTION public.next_report_number()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_report_number()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number() FROM anon, authenticated;

-- ── #1 Non-admins may not reassign a job_surveyors row (job_id / surveyor_id) ─
CREATE OR REPLACE FUNCTION public.enforce_job_surveyor_rate_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_admin()
     AND (NEW.pay_rate      IS DISTINCT FROM OLD.pay_rate
       OR NEW.overtime_rate IS DISTINCT FROM OLD.overtime_rate
       OR NEW.pay_currency  IS DISTINCT FROM OLD.pay_currency
       OR NEW.surveyor_id   IS DISTINCT FROM OLD.surveyor_id
       OR NEW.job_id        IS DISTINCT FROM OLD.job_id) THEN
    RAISE EXCEPTION 'Only an administrator can change a surveyor assignment or pay rate';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── #2 Non-admins may only touch a safe set of job columns ──────────────────
-- Surveyors legitimately update status/started_at/submitted_at (checklist) and
-- advance workflow_status to in_progress / report_ready. Everything sensitive
-- (report number, approval identity/timestamps, paid/closed) is admin-only, and
-- workflow_status may not jump to approved/invoiced/sent/paid/closed.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  IF NEW.report_number      IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS jobs_admin_columns ON public.jobs;
CREATE TRIGGER jobs_admin_columns BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_admin_columns();

-- ── #5 Multi-surveyor: job_surveyors members can edit checklist data ─────────
DROP POLICY IF EXISTS "Surveyors can manage own job values" ON public.job_field_values;
CREATE POLICY "Surveyors can manage own job values" ON public.job_field_values FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_field_values.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_field_values.job_id AND js.surveyor_id = auth.uid())))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_field_values.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_field_values.job_id AND js.surveyor_id = auth.uid())));

DROP POLICY IF EXISTS "Surveyors can manage own job photos" ON public.job_photos;
CREATE POLICY "Surveyors can manage own job photos" ON public.job_photos FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_photos.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_photos.job_id AND js.surveyor_id = auth.uid())))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_photos.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_photos.job_id AND js.surveyor_id = auth.uid())));

DROP POLICY IF EXISTS "Surveyors can manage own job signatures" ON public.job_signatures;
CREATE POLICY "Surveyors can manage own job signatures" ON public.job_signatures FOR ALL
  USING (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_signatures.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_signatures.job_id AND js.surveyor_id = auth.uid())))
  WITH CHECK (get_my_role() = 'surveyor' AND (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_signatures.job_id AND j.assigned_to = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_surveyors js WHERE js.job_id = job_signatures.job_id AND js.surveyor_id = auth.uid())));

-- ── #6 Invoice integrity ────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_job ON public.invoices (job_id) WHERE job_id IS NOT NULL;

ALTER TABLE public.invoices           DROP CONSTRAINT IF EXISTS chk_invoices_nonneg;
ALTER TABLE public.invoices           ADD  CONSTRAINT chk_invoices_nonneg CHECK (subtotal >= 0 AND tax_total >= 0 AND total >= 0);
ALTER TABLE public.invoice_line_items DROP CONSTRAINT IF EXISTS chk_ili_nonneg;
ALTER TABLE public.invoice_line_items ADD  CONSTRAINT chk_ili_nonneg CHECK (qty >= 0 AND unit_price >= 0 AND amount >= 0);
ALTER TABLE public.invoice_taxes      DROP CONSTRAINT IF EXISTS chk_itax_nonneg;
ALTER TABLE public.invoice_taxes      ADD  CONSTRAINT chk_itax_nonneg CHECK (rate >= 0 AND amount >= 0);

-- ── #9a Server-side upload limits on sensitive buckets ──────────────────────
-- PDF + images only; size caps. Supabase Storage rejects oversize / wrong-MIME
-- uploads at the API regardless of what the browser claims.
UPDATE storage.buckets
  SET file_size_limit = 15728640,  -- 15 MB
      allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']
  WHERE id = 'personal-documents';
UPDATE storage.buckets
  SET file_size_limit = 26214400,  -- 25 MB (final reports / VOS)
      allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png','image/webp']
  WHERE id = 'job-files';
