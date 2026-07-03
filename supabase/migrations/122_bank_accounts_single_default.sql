-- Enforce "at most one default bank account" in the database. saveBankAccount
-- previously did two non-atomic writes (set new default, then unset others), so a
-- failure/race could leave two defaults and the invoice builder would pick whichever
-- sorted first. Dedupe any existing extras (keep the most recently updated), then a
-- partial unique index makes the state impossible. The app now unsets others BEFORE
-- marking the new default, so it never trips this index.

UPDATE public.bank_accounts SET is_default = false
WHERE is_default AND id <> (
  SELECT id FROM public.bank_accounts WHERE is_default
  ORDER BY updated_at DESC, id LIMIT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_one_default
  ON public.bank_accounts (is_default) WHERE is_default;

-- Also index the client link (mig 121) so account deletes / "who pays into this
-- account" lookups don't scan client_billing.
CREATE INDEX IF NOT EXISTS client_billing_pay_to_bank_account_idx
  ON public.client_billing (pay_to_bank_account_id) WHERE pay_to_bank_account_id IS NOT NULL;
