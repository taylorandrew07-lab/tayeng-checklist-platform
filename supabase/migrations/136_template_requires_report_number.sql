-- ============================================================
-- Migration 136: per-template "requires a report number" flag, and teach the
-- auto-number trigger to respect the existing report_not_required opt-out. Idempotent.
--
-- Background. Some job kinds never carry a report number and should show "N/A":
-- Initial Draught surveys, Cargo Loading, Cargo Discharging, and Ultrasonic Hatch
-- Testing. Report numbers are assigned by the BEFORE INSERT trigger set_report_number
-- (mig 042), which burns a number whenever report_number IS NULL — it does NOT look
-- at jobs.report_not_required (mig 119). So today a job flagged "no report" still
-- consumes a live sequence number on insert. This migration fixes that at three levels:
--   1. a template-level opt-out checkbox (checklist_templates.requires_report_number),
--   2. the trigger now skips numbering when report_not_required is true, and
--   3. a one-off backfill flags existing jobs of the four kinds.
-- The application seams (createDraftJob + the New Job forms) set report_not_required
-- at creation from the template flag OR the job type/stage rule; see src/lib/jobs/reportPolicy.ts.
-- ============================================================

-- 1. New template flag. Default TRUE so every existing template keeps numbering jobs.
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS requires_report_number BOOLEAN NOT NULL DEFAULT true;

-- 2. Seed FALSE for templates whose jobs are report-only. Only 'Ultrasonic Hatch
--    Testing' actually exists as a checklist_templates row today (Cargo Loading /
--    Cargo Discharging / Draught Survey are report-only job_types with no template),
--    so the cargo/draught ILIKEs are harmless no-ops that future-proof any such
--    template someone creates later.
UPDATE public.checklist_templates
   SET requires_report_number = false
 WHERE requires_report_number = true
   AND ( name ILIKE '%ultrasonic hatch%'
      OR name ILIKE '%cargo loading%'
      OR name ILIKE '%cargo discharg%'
      OR name ILIKE '%draught%' );

-- 3. ESSENTIAL: teach the auto-number trigger to honour the opt-out flag. Without
--    this, the mig-042 BEFORE INSERT trigger still assigns a number even when the
--    job opts out. The trigger jobs_set_report_number is already bound to this
--    function, so a CREATE OR REPLACE of the body is all that's needed (no re-CREATE
--    TRIGGER). Keeps the original SECURITY DEFINER + search_path; CREATE OR REPLACE
--    preserves the existing ownership and ACLs from migs 042/049.
CREATE OR REPLACE FUNCTION public.set_report_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.report_number IS NULL AND NOT COALESCE(NEW.report_not_required, false) THEN
    NEW.report_number := public.next_report_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Backfill existing jobs of the four report-only kinds. Guard on report_number
--    IS NULL so any job that already owns a real number is left untouched — we never
--    hide a number that was genuinely issued. Draught only skips at the Initial stage;
--    Interim/Final keep their numbers. job_type stores the current type NAME as free
--    text ('Draught Survey' renamed from 'Draft Survey' in mig 081; 'Cargo Loading'
--    from 'Extended Cargo Loadout' in mig 114) — match the current names.
--    This UPDATE only writes report_not_required (not report_number), so the admin
--    column guard (enforce_job_admin_columns, mig 049) is not tripped.
UPDATE public.jobs
   SET report_not_required = true
 WHERE report_number IS NULL
   AND report_not_required = false
   AND ( job_type IN ('Ultrasonic Hatch Testing', 'Cargo Loading', 'Cargo Discharging')
      OR (job_type = 'Draught Survey' AND job_stage = 'Initial') );
