-- ============================================================
-- Migration 154: retire the 'Cargo Loading' and 'Cargo Discharging' JOB TYPES,
-- folding them into the single 'Cargo Survey' type. Idempotent.
--
-- Background. 'Cargo Survey' already carries a Loading/Discharging qualifier in
-- jobs.job_stage (migs 108 + 147), so one Cargo Survey job covers both directions.
-- The separate 'Cargo Loading' / 'Cargo Discharging' types (mig 114) were therefore
-- redundant; the only field unique to them was jobs.cargo_type, which the New Job
-- forms and the job detail page now also show for 'Cargo Survey'.
--
-- We carry existing jobs across, mapping the direction that was baked into the type
-- NAME onto job_stage:
--   'Cargo Loading'     -> job_type 'Cargo Survey', job_stage 'Loading'
--   'Cargo Discharging' -> job_type 'Cargo Survey', job_stage 'Discharging'
--
-- report_not_required is deliberately LEFT UNTOUCHED. The old jobs were flagged
-- report-only at creation (mig 136 backfill), and set_report_number keys off that
-- flag ALONE (never job_type, see mig 136 §3), so any number already withheld stays
-- withheld and any issued number stays issued. New 'Cargo Survey' jobs default to a
-- report number; the admin ticks "No report required" per job for the report-only
-- cases (that toggle already exists on both the New Job form and the job page).
--
-- jobs.job_type stores the type NAME as free text (not a FK), so the UPDATEs below
-- are the whole migration for existing rows; then the now-unused types are removed.
-- ============================================================

-- Make sure the surviving type exists (defensive; it already does wherever these
-- jobs live, but this keeps a fresh/partial DB safe).
INSERT INTO public.job_types (name)
  SELECT 'Cargo Survey'
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types WHERE name = 'Cargo Survey');

-- Carry existing jobs across, mapping the name-encoded direction onto job_stage.
-- Only fill job_stage when it's blank so a re-run (or any hand-set stage) is preserved.
UPDATE public.jobs
   SET job_type  = 'Cargo Survey',
       job_stage = COALESCE(NULLIF(job_stage, ''), 'Loading')
 WHERE job_type = 'Cargo Loading';

UPDATE public.jobs
   SET job_type  = 'Cargo Survey',
       job_stage = COALESCE(NULLIF(job_stage, ''), 'Discharging')
 WHERE job_type = 'Cargo Discharging';

-- Remove the retired types from the New Job picker. Safe no-op if already gone.
DELETE FROM public.job_types WHERE name IN ('Cargo Loading', 'Cargo Discharging');
