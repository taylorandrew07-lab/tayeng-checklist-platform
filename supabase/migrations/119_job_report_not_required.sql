-- ============================================================
-- Migration 119: mark a job as NOT requiring a report ("N/A"). Idempotent.
--
-- Many jobs don't produce a report, so they should not consume a unique report
-- number nor show up as "missing a report number". Previously the only states were
-- a unique number or NULL (= still needs one) — and typing a placeholder like "N/A"
-- into several jobs hit the UNIQUE(report_number) index. This flag lets a job opt out
-- entirely: report_number stays NULL (no uniqueness clash) and the UI shows "N/A".
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS report_not_required BOOLEAN NOT NULL DEFAULT false;
