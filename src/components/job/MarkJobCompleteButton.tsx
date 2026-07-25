'use client'

// The ONE "job is finished" control. Same label, same guards, same write seam for
// surveyors and admins — admins do fieldwork too, so there is deliberately no
// role branch in here. Mounted in the job page header (surveyor + admin) and, for
// checklist jobs, delegated to the checklist's own submit dialog so the
// required-question check and its tap-to-jump list are never bypassed.

import { useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { completeJob, jobLoggedHours, COMPLETE_LABEL } from '@/lib/jobs/complete'

interface Props {
  job: { id: string; template_id?: string | null; workflow_status?: string | null; submitted_at?: string | null }
  /** Reload the page's job row after a successful completion. */
  onChanged: () => void
  /** Checklist jobs only: hand off to the mounted checklist editor's submit dialog.
   *  Return true if it was handled there; false/undefined falls back to completing
   *  directly (e.g. the editor isn't mounted on this tab). */
  requestChecklistComplete?: () => boolean
  className?: string
}

export default function MarkJobCompleteButton({ job, onChanged, requestChecklistComplete, className = '' }: Props) {
  const [busy, setBusy] = useState(false)

  // Only ever offered on a job that hasn't been finished yet. Going backwards stays
  // an admin-only action through the workflow card's "Set status…" select — the
  // surveyor-facing vocabulary has one direction.
  const status = job.workflow_status ?? 'in_progress'
  if (status !== 'in_progress') return null

  async function handleClick() {
    // Checklist job with the editor on screen → its dialog owns the flow (it lists
    // unanswered required questions and can jump to them). Same seam underneath.
    // Skipped once submitted_at is set: that's the repair case (checklist submitted
    // but the status write never landed), where the checklist is already locked and
    // re-running its validation would only get in the way. completeJob is idempotent.
    if (job.template_id && !job.submitted_at && requestChecklistComplete?.()) return

    setBusy(true)
    try {
      // Hours are a WARNING, never a block — fixed-price and day-rate jobs
      // legitimately have none, and blocking would just trade one stuck state for
      // another. A best-effort read: if it fails, don't stand between the surveyor
      // and finishing their job.
      let hours = -1
      try { hours = await jobLoggedHours(job.id) } catch { /* warn-only; skip */ }

      const warn = hours === 0
        ? 'No hours have been logged on this job yet. You can still add them afterwards.\n\n'
        : ''
      const ok = await confirmDialog({
        title: COMPLETE_LABEL,
        message: `${warn}Mark this job complete? It moves to “Report ready” so the office can raise the report and invoice. An admin can reopen it if something needs correcting.`,
        confirmLabel: COMPLETE_LABEL,
      })
      if (!ok) { setBusy(false); return }

      const res = await completeJob(job.id)
      if (res.error) { toast.error(res.error); setBusy(false); return }
      toast.success(res.advanced ? 'Job marked complete' : 'This job was already complete')
      onChanged()
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not complete the job — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className={`btn-primary ${className}`}
      title={COMPLETE_LABEL}
      aria-label={COMPLETE_LABEL}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
      {COMPLETE_LABEL}
    </button>
  )
}
