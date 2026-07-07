// The single choke-point through which a job is created. Today only the manual
// New Job form calls it (source='manual'). When the AI intake seam lands, a
// server route will read a WhatsApp/email message, understand it, and call this
// SAME function with a service-role client and source='whatsapp'|'email'|'ai' —
// so the create path is exercised now and never becomes dead scaffolding.
//
// Client-agnostic on purpose: pass the supabase client + actorId explicitly
// (browser anon client today; createServiceClient() on the future server path).

import type { SupabaseClient } from '@supabase/supabase-js'

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
}

export interface DraftJobResult {
  job: any | null
  assignedIds: string[]
  error?: string
  /** Non-fatal: the job was created but attaching extra surveyors failed. */
  assignError?: string
}

export async function createDraftJob(
  supabase: SupabaseClient,
  input: DraftJobInput,
  source: JobSource,
  sourceRef?: string | null,
): Promise<DraftJobResult> {
  const { data: job, error } = await supabase
    .from('jobs')
    .insert({ ...input.job, source, source_ref: sourceRef ?? null })
    .select()
    .single()

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

  if (input.clientId) {
    await supabase.from('client_job_permissions').insert({
      client_id: input.clientId, job_id: job.id,
      can_view_status: true, can_view_pdf: false, can_view_checklist_details: false,
    })
  }

  await supabase.from('activity_log').insert({
    entity: 'job', entity_id: job.id, action: 'created',
    actor_id: input.actorId, meta: { report_number: job.report_number, source },
  })

  return { job, assignedIds: input.surveyorIds, assignError }
}
