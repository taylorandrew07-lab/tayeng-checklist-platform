-- ============================================================
-- Migration 043: Invoicing + time/overtime (Phase 2)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Two ledgers on a job:
--   • BILLING  → the client invoice (rates, line items, currency, taxes).
--   • LABOUR   → what we pay surveyors (hours + overtime, with auto overtime-pay).
-- They overlap but differ: hours feed pay; the invoice is billed separately.
--
-- Phase 2 stays ADMIN-DRIVEN for money (no office-write/secretary yet): admins
-- manage rates + invoices + mark paid; surveyors enter their OWN hours; office
-- can READ invoicing with the invoicing.view permission.
-- Invoice-number format is provisional (INV-YY/NNNN) until the real format is given.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Labour ledger — hours + pay on each job↔surveyor line.
--    overtime_pay / regular_pay are computed by the DB (auto overtime-pay calc).
-- ------------------------------------------------------------
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS regular_hours  NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS pay_rate       NUMERIC;
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS overtime_rate  NUMERIC;
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS pay_currency   TEXT NOT NULL DEFAULT 'TTD';
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS regular_pay    NUMERIC GENERATED ALWAYS AS (regular_hours  * COALESCE(pay_rate, 0))      STORED;
ALTER TABLE public.job_surveyors ADD COLUMN IF NOT EXISTS overtime_pay   NUMERIC GENERATED ALWAYS AS (overtime_hours * COALESCE(overtime_rate, 0)) STORED;

-- Surveyors may enter their OWN hours; only admins may set the pay rates.
DROP POLICY IF EXISTS "Surveyors update own hours" ON public.job_surveyors;
CREATE POLICY "Surveyors update own hours" ON public.job_surveyors
  FOR UPDATE USING (surveyor_id = auth.uid()) WITH CHECK (surveyor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_job_surveyor_rate_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_admin()
     AND (NEW.pay_rate IS DISTINCT FROM OLD.pay_rate
          OR NEW.overtime_rate IS DISTINCT FROM OLD.overtime_rate
          OR NEW.pay_currency IS DISTINCT FROM OLD.pay_currency
          OR NEW.surveyor_id IS DISTINCT FROM OLD.surveyor_id) THEN
    RAISE EXCEPTION 'Only an administrator can change surveyor pay rates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS job_surveyors_rate_admin ON public.job_surveyors;
CREATE TRIGGER job_surveyors_rate_admin
  BEFORE UPDATE ON public.job_surveyors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_surveyor_rate_admin();

-- ------------------------------------------------------------
-- 2. App settings (default tax + overdue window) — single row.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  id               BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  default_tax_name TEXT    NOT NULL DEFAULT 'VAT',
  default_tax_rate NUMERIC NOT NULL DEFAULT 12.5,
  overdue_days     INTEGER NOT NULL DEFAULT 30,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES public.profiles(id)
);
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read settings" ON public.app_settings;
CREATE POLICY "Staff read settings" ON public.app_settings
  FOR SELECT USING (public.is_active_staff() OR public.is_office());
DROP POLICY IF EXISTS "Admins manage settings" ON public.app_settings;
CREATE POLICY "Admins manage settings" ON public.app_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 3. Client rates (billing defaults; per client, optionally per job type).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_rates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  job_type   TEXT,                          -- NULL = applies to any job type
  rate_type  TEXT NOT NULL CHECK (rate_type IN ('fixed','hourly','per_unit')),
  rate       NUMERIC NOT NULL DEFAULT 0,
  unit_label TEXT,                          -- e.g. 'vessel' for per_unit
  currency   TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','TTD','EUR','GBP')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_rates_client ON public.client_rates (client_id);
ALTER TABLE public.client_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read client rates" ON public.client_rates;
CREATE POLICY "Read client rates" ON public.client_rates
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('invoicing.view'));
DROP POLICY IF EXISTS "Admins manage client rates" ON public.client_rates;
CREATE POLICY "Admins manage client rates" ON public.client_rates
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- 4. Invoice numbering — provisional INV-YY/NNNN (annual sequence).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  fiscal_year INTEGER PRIMARY KEY,
  last_seq    INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT AS $$
DECLARE fy INTEGER; seq INTEGER;
BEGIN
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.invoice_counters (fiscal_year, last_seq) VALUES (fy, 1)
    ON CONFLICT (fiscal_year) DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1, updated_at = NOW()
    RETURNING last_seq INTO seq;
  RETURN 'INV-' || to_char(NOW(), 'YY') || '/' || lpad(seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 5. Invoices + line items + taxes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id         UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE,
  client_id      UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  currency       TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','TTD','EUR','GBP')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','void')),
  issue_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  subtotal       NUMERIC NOT NULL DEFAULT 0,
  tax_total      NUMERIC NOT NULL DEFAULT 0,
  total          NUMERIC NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     UUID REFERENCES public.profiles(id),
  sent_at        TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_job    ON public.invoices (job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices (status, due_date);

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id  UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty         NUMERIC NOT NULL DEFAULT 1,
  unit_price  NUMERIC NOT NULL DEFAULT 0,
  amount      NUMERIC NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON public.invoice_line_items (invoice_id);

CREATE TABLE IF NOT EXISTS public.invoice_taxes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'VAT',
  rate       NUMERIC NOT NULL DEFAULT 0,
  amount     NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_taxes_invoice ON public.invoice_taxes (invoice_id);

DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Assign an invoice number on insert when one isn't supplied.
CREATE OR REPLACE FUNCTION public.set_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.invoice_number IS NULL THEN NEW.invoice_number := public.next_invoice_number(); END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS invoices_set_number ON public.invoices;
CREATE TRIGGER invoices_set_number BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_number();

-- RLS: admins manage; office reads with invoicing.view. (Client visibility later.)
ALTER TABLE public.invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_taxes      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read invoices" ON public.invoices;
CREATE POLICY "Read invoices" ON public.invoices
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('invoicing.view'));
DROP POLICY IF EXISTS "Admins manage invoices" ON public.invoices;
CREATE POLICY "Admins manage invoices" ON public.invoices
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Read invoice lines" ON public.invoice_line_items;
CREATE POLICY "Read invoice lines" ON public.invoice_line_items
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('invoicing.view'));
DROP POLICY IF EXISTS "Admins manage invoice lines" ON public.invoice_line_items;
CREATE POLICY "Admins manage invoice lines" ON public.invoice_line_items
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Read invoice taxes" ON public.invoice_taxes;
CREATE POLICY "Read invoice taxes" ON public.invoice_taxes
  FOR SELECT USING (public.is_admin() OR public.has_office_permission('invoicing.view'));
DROP POLICY IF EXISTS "Admins manage invoice taxes" ON public.invoice_taxes;
CREATE POLICY "Admins manage invoice taxes" ON public.invoice_taxes
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
