-- ============================================================
-- Migration 147: Cargo Survey qualifier reads "Loading" / "Discharging".
--
-- Migration 108 added jobs.job_stage as the broad-type qualifier and the app labelled the
-- Cargo Survey one "Direction", with the values 'Loaded' and 'Discharge'. "Direction" is
-- not how the office talks about these jobs, and the two values were not even the same
-- part of speech. The picker is now labelled "Loading/Discharging" with matching values,
-- so existing rows are renamed to keep old and new jobs reading the same in lists, the
-- Stage CSV column and the job detail page.
--
-- Scoped to job_type = 'Cargo Survey' on purpose. The Draught Survey stages
-- (Initial/Interim/Final) and the Hire Survey ones (On-hire/Off-hire) are untouched, and
-- the separate 'Cargo Loading' / 'Cargo Discharging' JOB TYPES are deliberately left
-- alone — this is a wording change, not a merge of job types.
--
-- Report-number policy is unaffected: the only stage-sensitive rule (migration 136) keys
-- off (job_type = 'Draught Survey' AND job_stage = 'Initial').
--
-- Historic jobs.title strings keep the old word — the title is frozen at creation and
-- appears on reports and invoices already issued, so it is not rewritten here.
--
-- Idempotent: safe to re-run (a second run matches zero rows).
-- ============================================================

UPDATE public.jobs
SET job_stage = CASE job_stage
  WHEN 'Loaded' THEN 'Loading'
  WHEN 'Discharge' THEN 'Discharging'
END
WHERE job_type = 'Cargo Survey'
  AND job_stage IN ('Loaded', 'Discharge');
