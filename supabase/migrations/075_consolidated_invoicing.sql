-- Consolidated, Finance-driven invoicing.
--
-- Until now an invoice was strictly 1:1 with a job (invoices.job_id) and was only
-- created from inside a job. Real billing is monthly and per-client: one invoice
-- carries many vessels' jobs, and is often addressed to a third-party payer
-- (e.g. ASCO pays for BP's vessels). This migration adds the three columns that
-- make that possible, without disturbing the existing per-job path.
--
--   1. invoices.bill_to_client_id  — who the invoice is addressed to / sent to
--      (the payer). NULL means "same as the work client" (invoices.client_id).
--   2. jobs.invoice_id             — the per-vessel stamp: which invoice this job
--      was billed on. Lets a job show its invoice number + sent date, and keeps
--      an already-billed job out of the "available to invoice" list (no double
--      billing). ON DELETE SET NULL so deleting an invoice frees its jobs.
--   3. invoice_line_items.job_id   — ties each invoice line to the vessel/job it
--      bills, so a consolidated invoice has one line per vessel.
--
-- invoices.job_id stays (used by the legacy per-job card); consolidated invoices
-- leave it NULL and link through jobs.invoice_id instead.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bill_to_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_invoice ON public.jobs (invoice_id);

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_job ON public.invoice_line_items (job_id);
