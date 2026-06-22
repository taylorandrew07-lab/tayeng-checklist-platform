-- Multiple bank accounts to choose from on an invoice (bank details change / there
-- are several: a USD account, a TTD account, a new bank…). Replaces the single
-- app_settings.bank_details_default text block. Admin-managed; office may read for
-- building invoices. The chosen account's text is copied onto the invoice when it's
-- created, so an issued invoice keeps the details it was sent with.

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label       TEXT NOT NULL,                 -- e.g. "RBC USD account"
  currency    TEXT,                          -- optional 'USD'|'TTD'|'EUR'|'GBP'; NULL = any
  details     TEXT NOT NULL,                 -- the block printed on the invoice
  is_default  BOOLEAN NOT NULL DEFAULT false,
  sort        INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_bank_accounts_updated_at ON public.bank_accounts;
CREATE TRIGGER update_bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Carry the old single default over as the first account (default).
INSERT INTO public.bank_accounts (label, details, is_default)
SELECT 'Default', bank_details_default, true
FROM public.app_settings
WHERE id = true AND bank_details_default IS NOT NULL AND length(trim(bank_details_default)) > 0;

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage bank accounts" ON public.bank_accounts;
CREATE POLICY "Admins manage bank accounts" ON public.bank_accounts
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Office read bank accounts" ON public.bank_accounts;
CREATE POLICY "Office read bank accounts" ON public.bank_accounts
  FOR SELECT USING (public.has_office_permission('invoicing.view'));
