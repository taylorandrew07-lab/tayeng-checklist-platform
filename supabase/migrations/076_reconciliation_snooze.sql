-- Reconciliation "clear": let an admin dismiss a job's billing red-flags from the
-- Finance → Reconcile list quickly (e.g. while testing) WITHOUT deleting the job.
-- It's a snooze, not a delete — the flag re-surfaces automatically once the
-- timestamp lapses, so nothing is forgotten permanently.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS recon_snoozed_until timestamptz;
