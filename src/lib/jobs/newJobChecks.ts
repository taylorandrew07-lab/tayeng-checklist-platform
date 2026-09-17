// The "are you sure?" list for creating a job.
//
// These are SOFT checks, not validation: every field here is genuinely optional and
// the job must still be creatable without it. The only thing that happens is one
// confirmation listing what's blank — one tap of Yes and it's created. Hard rules
// (job type, vessel, date) stay where they are, as errors, in each form.
//
// TO ADD A FIELD: add one entry to NEW_JOB_CONFIRM_CHECKS and, if it isn't already
// there, the value it reads to NewJobDraft. Both New Job forms — admin and surveyor —
// pick it up with no other change. Keep the labels as full sentences: they are read
// out one per line in the dialog.

/** The slice of either New Job form that the checks can see. */
export interface NewJobDraft {
  /** Chosen from the client list. Empty when "No client" is selected. */
  clientId: string
  /** A new client typed in for admin approval — counts as answered. */
  newClientName: string
  jobType: string
  jobStage: string
  vesselName: string
  portLocation: string
  voyageNumber: string
  /** Surveyor ids on the job. The surveyor form's owner counts as one. */
  surveyorIds: string[]
  notes: string
}

export interface NewJobCheck {
  key: string
  /** Read out when the field is blank. A full sentence — see the note above. */
  label: string
  /** True when the field HAS been filled in. */
  filled: (d: NewJobDraft) => boolean
  /** Optional: only ask on jobs where the field means anything. Default: always. */
  applies?: (d: NewJobDraft) => boolean
}

export const NEW_JOB_CONFIRM_CHECKS: NewJobCheck[] = [
  {
    key: 'client',
    label: 'No client has been selected.',
    // A requested-but-unapproved client is an answer: the admin links it on approval
    // (mig 155), so asking again here would be nagging about a decision already made.
    filled: d => Boolean(d.clientId) || Boolean(d.newClientName.trim()),
  },
]

/** The checks that apply to this job and are still blank, in list order. */
export function missingNewJobFields(draft: NewJobDraft): NewJobCheck[] {
  return NEW_JOB_CONFIRM_CHECKS.filter(c => (c.applies ? c.applies(draft) : true) && !c.filled(draft))
}

/**
 * The dialog body. One blank field reads as a plain sentence; several are bulleted,
 * one per line — ConfirmDialog renders the message with `whitespace-pre-line`.
 */
export function describeMissingNewJobFields(missing: NewJobCheck[]): string {
  const list = missing.length === 1
    ? missing[0].label
    : missing.map(c => `• ${c.label}`).join('\n')
  return `${list}\n\nAre you sure you want to create this job?`
}
