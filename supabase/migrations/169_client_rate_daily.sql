-- ============================================================
-- 169 — Client rates: a first-class DAY rate
--
--  A job is billed by the hour OR by the day (jobs.labour_unit, migration 148), but
--  client_rates only carried 'hourly'. A day-billed job therefore had no rate that
--  could price it: the invoice builder left the unit price at 0 for the user to fill
--  in by hand, or the day rate got smuggled in as a per_unit rate whose unit_label
--  happened to read "day".
--
--  'daily' makes that explicit and lets the builder seed qty = billable_days.
--  Existing per_unit-with-unit_label-'day(s)' rates keep working exactly as before —
--  nothing is migrated automatically, since editing a client's rates is their call.
-- ============================================================

ALTER TABLE public.client_rates DROP CONSTRAINT IF EXISTS client_rates_rate_type_check;
ALTER TABLE public.client_rates ADD CONSTRAINT client_rates_rate_type_check
  CHECK (rate_type IN ('fixed','hourly','daily','per_unit','per_km'));
