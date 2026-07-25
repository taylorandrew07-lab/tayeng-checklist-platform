// "Mark complete" — the single seam every role uses to finish a job.
//
// WHY THIS EXISTS: before this, finishing a job was a side effect of the checklist
// Submit button and existed nowhere else. Report-only jobs (no template) could not
// be finished by a surveyor at all, co-surveyors could not either, and a submit
// whose status write failed left the job submitted-but-in_progress with the
// checklist locked and no way back. Jobs sat at in_progress forever and silently
// fell out of the invoice queue (lib/jobs/invoicing.ts filters on report_ready).
//
// One function, one vocabulary word — "complete" — for surveyors and admins alike.

import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils'
import { advanceWorkflowTo } from '@/lib/jobs/tracker'

/** The word, in one place. Every surface that finishes a job — the job page header,
 *  the checklist's sticky bar, its confirm dialog — reads it from here, so the
 *  vocabulary can never drift back into Submit/Advance/Mark submitted. */
export const COMPLETE_LABEL = 'Mark complete'

export type SubmitOutcome = 'ok' | 'denied' | 'failed'

/**
 * Mark a job submitted, resiliently. Setting `submitted_at` is a tiny, idempotent
 * write, so on flaky field wifi we RETRY it and, after any error/timeout, VERIFY by
 * re-reading `submitted_at` — because the write often lands even when the response is
 * lost. This is the core reliability fix: a surveyor on a weak connection can no
 * longer end up with a fully-filled checklist that silently never submitted.
 *  - 'ok'     → submitted (this call, a prior attempt, or already submitted)
 *  - 'denied' → 0 rows AND not submitted → genuine RLS/permission denial
 *  - 'failed' → couldn't reach the server after retries (answers are safe; retry)
 */
export async function submitJobWithRetry(jobId: string): Promise<SubmitOutcome> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const supabase = createClient()
    try {
      const { data, error } = await withTimeout(
        supabase.from('jobs').update({ submitted_at: new Date().toISOString() }).eq('id', jobId).select('id'),
        20_000, 'Submitting checklist'
      )
      if (!error && data && data.length > 0) return 'ok'
      if (!error && data && data.length === 0) {
        // 0 rows: either a real RLS denial or it's already submitted — verify.
        const { data: chk } = await supabase.from('jobs').select('submitted_at').eq('id', jobId).maybeSingle()
        return chk?.submitted_at ? 'ok' : 'denied'
      }
      // An error fell through — the write may still have landed; verify below.
    } catch { /* network/timeout — verify below, then retry */ }

    try {
      const { data: chk } = await createClient().from('jobs').select('submitted_at').eq('id', jobId).maybeSingle()
      if (chk?.submitted_at) return 'ok'
    } catch { /* couldn't verify either — retry */ }

    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
  }
  return 'failed'
}

/** Total labour logged against a job, across every surveyor on it. Drives the
 *  "no hours logged" warning — a warning, never a block: fixed-price and day-rate
 *  jobs legitimately have none, and blocking would just create a second stuck
 *  state to replace the one this whole feature exists to remove. */
export async function jobLoggedHours(jobId: string): Promise<number> {
  const { data } = await createClient()
    .from('job_surveyors').select('regular_hours, overtime_hours').eq('job_id', jobId)
  return (data ?? []).reduce(
    (a: number, r: any) => a + Number(r.regular_hours ?? 0) + Number(r.overtime_hours ?? 0), 0,
  )
}

export interface CompleteJobResult {
  error?: string
  /** True when this call moved the status; false when it was already report_ready+
   *  (an idempotent repeat, not a failure). */
  advanced: boolean
}

/**
 * Finish a job: stamp `submitted_at`, then advance in_progress → report_ready.
 *
 * ORDER IS LOAD-BEARING and the two writes are NOT equivalent in cost. `submitted_at`
 * locks the checklist, so if it lands and the advance doesn't, the surveyor is stuck.
 * That is exactly the old bug. So: the advance failing is reported as a hard error
 * the caller must show, never swallowed, and the button stays clickable to retry —
 * both writes are idempotent, so retrying is always safe.
 *
 * `hasChecklist` only decides whether we stamp `submitted_at` at all. Report-only
 * jobs have no checklist to lock; stamping them anyway gives every job one honest
 * "declared finished" timestamp, which is what the reconcile check reads.
 */
export async function completeJob(jobId: string): Promise<CompleteJobResult> {
  const outcome = await submitJobWithRetry(jobId)
  if (outcome === 'denied') {
    return { advanced: false, error: 'You don’t have permission to complete this job. Ask an admin to assign you to it.' }
  }
  if (outcome === 'failed') {
    return { advanced: false, error: 'Couldn’t reach the server. Your work is saved — check your connection and tap Mark complete again.' }
  }

  // Bounded so a stalled request can't hang the button, but — unlike the old
  // fire-and-forget version — a timeout is surfaced, not discarded.
  let res: { error?: string; changed: boolean }
  try {
    res = await withTimeout(advanceWorkflowTo(jobId, 'report_ready'), 12_000, 'Completing the job')
  } catch (e: any) {
    return { advanced: false, error: e?.message ?? 'Completing the job timed out — please try again.' }
  }
  if (res.error) return { advanced: false, error: res.error }
  return { advanced: res.changed }
}
