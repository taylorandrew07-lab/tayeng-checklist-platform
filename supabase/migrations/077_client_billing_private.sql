-- Client privacy: surveyors must only ever see client NAMES — never contact,
-- fees or payment info. Postgres RLS can't hide individual columns (all logged-in
-- users share one DB role), so the sensitive fields move into their own table,
-- client_billing, readable by admin + office only. `clients` is left effectively
-- name-only, which surveyors already read for job pickers.
--
-- Fees already live in client_rates (admin/office-only) — untouched here.

CREATE TABLE IF NOT EXISTS public.client_billing (
  client_id      UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  -- contact (moved out of clients)
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  address        TEXT,
  notes          TEXT,
  -- payment (new)
  bank_details   TEXT,
  payment_terms  TEXT,
  ap_email       TEXT,
  ap_contact     TEXT,
  ap_phone       TEXT,
  tax_number     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Carry existing contact info over before the columns are dropped.
INSERT INTO public.client_billing (client_id, contact_name, contact_email, contact_phone, address, notes)
SELECT id, contact_name, contact_email, contact_phone, address, notes FROM public.clients
ON CONFLICT (client_id) DO NOTHING;

DROP TRIGGER IF EXISTS update_client_billing_updated_at ON public.client_billing;
CREATE TRIGGER update_client_billing_updated_at BEFORE UPDATE ON public.client_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.client_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage client billing" ON public.client_billing;
CREATE POLICY "Admins manage client billing" ON public.client_billing
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Office read client billing" ON public.client_billing;
CREATE POLICY "Office read client billing" ON public.client_billing
  FOR SELECT USING (public.has_office_permission('clients.view') OR public.has_office_permission('invoicing.view'));

-- Now drop the sensitive columns from clients so they're no longer readable by
-- surveyors (who have a name-level SELECT on clients).
ALTER TABLE public.clients DROP COLUMN IF EXISTS contact_name;
ALTER TABLE public.clients DROP COLUMN IF EXISTS contact_email;
ALTER TABLE public.clients DROP COLUMN IF EXISTS contact_phone;
ALTER TABLE public.clients DROP COLUMN IF EXISTS address;
ALTER TABLE public.clients DROP COLUMN IF EXISTS notes;
