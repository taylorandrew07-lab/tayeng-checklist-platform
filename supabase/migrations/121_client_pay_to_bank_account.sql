-- Link each client to the bank account they pay INTO (ours), so the invoice
-- builder defaults the right account automatically once the payer is chosen
-- (e.g. ASCO always pays to the FCB USD account). Lives on client_billing —
-- the private admin/office payment table (office needs invoicing.view to read,
-- which is exactly who builds invoices). NULL = no link; the builder falls back
-- to the global default bank account as before. Deleting a bank account simply
-- unlinks it (SET NULL) — invoices already issued keep their printed details.

ALTER TABLE public.client_billing
  ADD COLUMN IF NOT EXISTS pay_to_bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;
