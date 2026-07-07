// Notify surveyors that they've been assigned a job. Reuses the internal inbox
// (messages + message_recipients) via the service-role send route, which also
// fires a best-effort email and drives the nav unread badge. Best-effort: never
// blocks the create/assign flow.
//
// Note: /api/messages/send only lets admins target recipientIds, so this works
// from the admin New Job form. Surveyor-created and offline-sync assignments
// bypass it (a non-admin can only message admins) — a future server-side seam
// (service role) will post these directly.

import { sendMessage } from '@/lib/messages/api'

export interface AssignedJob {
  id: string
  title: string
  scheduled_date: string | null
  start_time: string | null
  vessel_name: string | null
}

/** Sends one in-app message (+ email) per assigned surveyor. Swallows failures. */
export async function notifyAssignment(job: AssignedJob, surveyorIds: string[]): Promise<void> {
  if (!surveyorIds.length) return
  const when = job.scheduled_date
    ? `on ${job.scheduled_date}${job.start_time ? ` at ${job.start_time.slice(0, 5)}` : ''}`
    : '(date to be scheduled)'
  try {
    await sendMessage({
      subject: `New job assigned: ${job.title}`,
      body: `You've been assigned to ${job.vessel_name ?? job.title} ${when}.\n\nOpen it in the app for the full details.`,
      recipientIds: surveyorIds,
    })
  } catch {
    // Non-fatal — the assignment itself already succeeded.
  }
}
