// Which jobs never carry a report number (shown as "N/A" on the jobs list). There are
// two independent triggers, and this module is the single source of truth for both so
// every job-creation seam (admin New Job, surveyor offline, offline sync, and the
// future AI/WhatsApp intake through createDraftJob) agrees:
//
//   1. the chosen checklist template has "requires report number" unticked
//      (checklist_templates.requires_report_number = false), or
//   2. the job's type/stage is inherently report-only.
//
// Kept in sync with migration 136 — the set_report_number trigger's report_not_required
// guard and the existing-jobs backfill predicate use the same rule.
//
// Pure functions only (no supabase import) so drafts.ts stays client-agnostic and safe
// to run on the future server intake path.

/** Job types that are report-only — no report number, regardless of any template.
 *  'Cargo Loading' / 'Cargo Discharging' used to live here, but mig 154 merged them
 *  into 'Cargo Survey' (which DOES get a number by default); the admin ticks
 *  "No report required" per job for the occasional report-only cargo survey. */
const NO_REPORT_JOB_TYPES = new Set<string>([
  'Ultrasonic Hatch Testing',
])

/** Stages of a draught survey that carry no report. A draught survey is a sequence on
 *  one voyage — Initial, then any number of Interims, then exactly one Final — and only
 *  the Final has all the information a report needs. Both earlier stages were burning a
 *  number out of the single global running series (next_report_number(), mig 158);
 *  Interim was fixed in migration 186. Historic Interims KEEP the number they were
 *  already issued, so reports already sent to clients still match. */
const DRAUGHT_STAGES_WITHOUT_REPORT = new Set<string>(['Initial', 'Interim'])

/** Whether a job's type/stage alone means it never gets a report number. Mirrored by
 *  the set_report_number trigger predicate (mig 186) — the DB is the real safety net,
 *  because offline sync can send an explicit report_not_required:false that skips the
 *  createDraftJob rule entirely. Change one and you must change the other. */
export function typeSkipsReportNumber(
  jobType: string | null | undefined,
  jobStage?: string | null,
): boolean {
  if (!jobType) return false
  if (NO_REPORT_JOB_TYPES.has(jobType)) return true
  if (jobType === 'Draught Survey' && jobStage && DRAUGHT_STAGES_WITHOUT_REPORT.has(jobStage)) return true
  return false
}

/** Whether a new job should default to report_not_required = true, from the chosen
 *  template opting out OR the job type/stage rule above. */
export function autoReportNotRequired(args: {
  jobType?: string | null
  jobStage?: string | null
  template?: { requires_report_number?: boolean | null } | null
}): boolean {
  const templateOptsOut = args.template != null && args.template.requires_report_number === false
  return templateOptsOut || typeSkipsReportNumber(args.jobType, args.jobStage)
}
