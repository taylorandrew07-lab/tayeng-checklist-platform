// The single choke-point through which a job is created. Today only the manual
// New Job form calls it (source='manual'). When the AI intake seam lands, a
// server route will read a WhatsApp/email message, understand it, and call this
// SAME function with a service-role client and source='whatsapp'|'email'|'ai' —
// so the create path is exercised now and never becomes dead scaffolding.
//
// Client-agnostic on purpose: pass the supabase client + actorId explicitly
// (browser anon client today; createServiceClient() on the future server path).

import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyAssignment } from '@/lib/jobs/notify'
import { typeSkipsReportNumber } from '@/lib/jobs/reportPolicy'

export type JobSource = 'manual' | 'whatsapp' | 'email' | 'ai'

export interface DraftJobInput {
  /** A full row for jobs.insert — every column the caller wants to set. `source`
   *  and `source_ref` are applied from the args below, not from here. */
  job: Record<string, unknown>
  /** Surveyors to attach (job_surveyors). The primary should also be in job.assigned_to. */
  surveyorIds: string[]
  /** Who is creating this — used for job_surveyors.created_by and the activity log. */
  actorId: string
  /** When set, grants the client status visibility (client_job_permissions). */
  clientId?: string | null
  /** Idempotent create: upsert on the client-supplied job.id instead of insert, for
   *  retry-safe paths (offline sync). Requires job.id to be set. */
  upsert?: boolean
  /** Notify newly-assigned surveyors in-app + email. Default true. The actor is
   *  always skipped (never notify yourself). */
  notify?: boolean
}

export interface DraftJobResult {
  job: any | null
  assignedIds: string[]
  error?: string
  /** Non-fatal: the job was created but attaching extra surveyors failed. */
  assignError?: string
  /** Non-fatal: the job was created but granting the client status view failed. */
  permissionError?: string
}

export async function createDraftJob(
  supabase: SupabaseClient,
  input: DraftJobInput,
  source: JobSource,
  sourceRef?: string | null,
): Promise<DraftJobResult> {
  const row: Record<string, unknown> = { ...input.job, source, source_ref: sourceRef ?? null }
  // Safety net so every create path (incl. future AI/WhatsApp intake) marks the
  // report-only job types as N/A even if a caller forgets. Only fills in the flag
  // when the caller left it unset — an explicit value (e.g. an admin ticking or
  // un-ticking "No report required") always wins. The template opt-out is applied
  // by each caller (it needs the template row, which this seam doesn't fetch).
  if (row.report_not_required == null) {
    row.report_not_required = typeSkipsReportNumber(
      row.job_type as string | null | undefined,
      row.job_stage as string | null | undefined,
    )
  }
  const { data: job, error } = await (input.upsert
    ? supabase.from('jobs').upsert(row, { onConflict: 'id' })
    : supabase.from('jobs').insert(row)
  ).select().single()

  if (error || !job) {
    return { job: null, assignedIds: [], error: error?.message ?? 'Failed to create job' }
  }

  let assignError: string | undefined
  if (input.surveyorIds.length) {
    // Upsert (not insert): the mig-124 trigger already added the primary
    // (assigned_to) row on job insert, so a plain insert would trip
    // UNIQUE(job_id, surveyor_id).
    const { error: jsErr } = await supabase.from('job_surveyors').upsert(
      input.surveyorIds.map(id => ({ job_id: job.id, surveyor_id: id, created_by: input.actorId })),
      { onConflict: 'job_id,surveyor_id', ignoreDuplicates: true },
    )
    if (jsErr) assignError = jsErr.message
  }

  let permissionError: string | undefined
  if (input.clientId) {
    // ignoreDuplicates: on a retried offline sync the row already exists, and the
    // surveyor RLS policy (mig 053) grants INSERT only — a plain upsert would take
    // the ON CONFLICT DO UPDATE path and get rejected (silently, before this fix).
    // DO NOTHING needs no UPDATE grant, so the retry is a no-op instead of an error.
    const { error: cpErr } = await supabase.from('client_job_permissions').upsert({
      client_id: input.clientId, job_id: job.id,
      can_view_status: true, can_view_pdf: false, can_view_checklist_details: false,
    }, { onConflict: 'client_id,job_id', ignoreDuplicates: true })
    if (cpErr) permissionError = cpErr.message
  }

  await supabase.from('activity_log').insert({
    entity: 'job', entity_id: job.id, action: 'created',
    actor_id: input.actorId, meta: { report_number: job.report_number, source },
  })

  // Notify assigned surveyors (never the actor). Built into the seam so every
  // create path — incl. the future AI/WhatsApp intake — notifies automatically.
  if (input.notify !== false) {
    const recipients = input.surveyorIds.filter(id => id !== input.actorId)
    if (recipients.length) {
      await notifyAssignment({
        id: job.id, title: job.title,
        scheduled_date: (job as any).scheduled_date ?? null,
        start_time: (job as any).start_time ?? null,
        vessel_name: (job as any).vessel_name ?? null,
      }, recipients)
    }
  }

  return { job, assignedIds: input.surveyorIds, assignError, permissionError }
}
