-- ============================================================
-- Migration 113: per-unit billable quantity. Idempotent.
--
-- Mirrors is_billable_hours (mig 089), but for per-UNIT rates: a checklist field whose
-- numeric value is the quantity to bill (e.g. UHT "Number of holds" = the number of
-- holds / bilges inspected). The invoice builder seeds a per-unit line's quantity from
-- this value instead of defaulting to 1, so "5 holds → qty 5" without retyping.
-- ============================================================

ALTER TABLE public.template_fields ADD COLUMN IF NOT EXISTS is_billable_quantity BOOLEAN NOT NULL DEFAULT false;

-- UHT "Number of holds" drives the per-bilge / per-hold billing quantity.
UPDATE public.template_fields SET is_billable_quantity = true
 WHERE id = '75480000-0000-4000-8000-000000000004';
