-- ============================================================
-- Migration 089: designate ONE template field as the "billable hours" driver
-- Run via the db-migrate runner. Idempotent.
--
-- The problem: an HOURLY client rate should bill hours × rate, but the Finance
-- "create invoice" flow had no idea which checklist field holds the hours, so every
-- line seeded qty = 1 (i.e. 1 × rate). The OVID Survey's calculated "Total hours
-- (base to base)" never reached the invoice.
--
-- The fix: this flag marks one calculated field per template as the billable-hours
-- source. listInvoiceableJobs() reads that field's saved value per job and the
-- invoice builder seeds the line qty with it WHEN the matched client rate is hourly
-- (fixed / per-unit rates still seed qty 1). Defaults false, so every existing
-- template/field/invoice is unaffected.
--
-- We also flag the OVID Survey "Total hours (base to base)" field
-- (id 0a1d0000-0000-4000-8000-00000000000a, created in migration 086) so OVID
-- billing works immediately. The flag survives template edits because the builder
-- saves fields via upsert (ON CONFLICT DO UPDATE of only the columns it sends).
-- ============================================================

ALTER TABLE public.template_fields
  ADD COLUMN IF NOT EXISTS is_billable_hours BOOLEAN NOT NULL DEFAULT false;

UPDATE public.template_fields
   SET is_billable_hours = true
 WHERE id = '0a1d0000-0000-4000-8000-00000000000a';
