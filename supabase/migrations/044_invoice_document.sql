-- ============================================================
-- Migration 044: Invoice document fields (for the printable PDF)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Real invoices carry more than line items: a fillable DESCRIPTION narrative
-- (references like "CONTAINER #…" / "M.V. …" + the "TO: Attending…" body), an
-- ATTENTION line (e.g. "Operations Manager"), a client REFERENCE (YOUR REF / PO
-- NUMBER), and — on foreign invoices — a BANK DETAILS block. We also align the
-- auto invoice number to the real format YY-MM-NNN (still editable per invoice,
-- e.g. the Saint Lucia "26/SLU 019" variant).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Document fields on the invoice.
-- ------------------------------------------------------------
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS reference    TEXT;  -- YOUR REF / PO NUMBER
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS attention    TEXT;  -- e.g. "Operations Manager"
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bank_details TEXT;  -- shown on foreign invoices

-- ------------------------------------------------------------
-- 2. A default bank-details block (pre-fills new invoices; editable per invoice).
-- ------------------------------------------------------------
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS bank_details_default TEXT;

-- ------------------------------------------------------------
-- 3. Invoice number → YY-MM-NNN, a fiscal-year running sequence (mirrors the
--    report number's reset on 1 Feb). Editable afterward for entity variants.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS TEXT AS $$
DECLARE fy INTEGER; seq INTEGER;
BEGIN
  fy := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 2 THEN EXTRACT(YEAR FROM NOW())::INT ELSE EXTRACT(YEAR FROM NOW())::INT - 1 END;
  INSERT INTO public.invoice_counters (fiscal_year, last_seq) VALUES (fy, 1)
    ON CONFLICT (fiscal_year) DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1, updated_at = NOW()
    RETURNING last_seq INTO seq;
  RETURN to_char(NOW(), 'YY-MM-') || lpad(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
