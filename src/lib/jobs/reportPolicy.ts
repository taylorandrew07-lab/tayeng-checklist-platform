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

/** Job types that are report-only — no report number, regardless of any template. */
const NO_REPORT_JOB_TYPES = new Set<string>([
  'Ultrasonic Hatch Testing',
  'Cargo Loading',
  'Cargo Discharging',
])

/** Whether a job's type/stage alone means it never gets a report number. Draught
 *  surveys only skip at the Initial stage; Interim/Final still get numbered. */
export function typeSkipsReportNumber(
  jobType: string | null | undefined,
  jobStage?: string | null,
): boolean {
  if (!jobType) return false
  if (NO_REPORT_JOB_TYPES.has(jobType)) return true
  if (jobType === 'Draught Survey' && jobStage === 'Initial') return true
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
