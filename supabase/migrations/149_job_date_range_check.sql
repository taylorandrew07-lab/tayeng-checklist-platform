-- Migration 149 — guard against an inverted job date range.
--
-- Jobs sort and display by their LAST day (COALESCE(end_date, scheduled_date),
-- see lib/jobs/jobDate.ts). A row where end_date < scheduled_date renders as a
-- range that ends before it starts. The app write paths now all prevent this
-- (the New Job forms reject it, the inline Date editors clamp it, and the
-- checklist-submit sync only moves scheduled_date when it stays <= end_date),
-- but nothing at the database level enforced it — migration 111 added end_date
-- bare.
--
-- Added NOT VALID on purpose: it guards every future INSERT/UPDATE immediately
-- without scanning existing rows, so it cannot fail the migration if some
-- historic row already violates it. Validate later (ALTER TABLE ... VALIDATE
-- CONSTRAINT) once any such rows are cleaned up, if we want it enforced
-- retroactively. Idempotent: the constraint is added only when absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_end_date_after_start'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_end_date_after_start
      CHECK (end_date IS NULL OR end_date >= scheduled_date)
      NOT VALID;
  END IF;
END $$;
