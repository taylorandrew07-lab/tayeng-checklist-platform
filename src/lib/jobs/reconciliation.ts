// Reconciliation red-flag: surface jobs where work is done but billing would
// otherwise be forgotten — marked invoice-ready but never invoiced, a job CLOSED
// with no actual invoice record, a billable job with no client to invoice, an
// invoice left unsent, or one that has gone overdue.
// All derived from job + invoice state (no extra tables).
//
// NOTE (migration 145): this list must NOT filter out 'closed' jobs. Closing is
// now what invoicing DOES, so every billed job is closed — excluding them (as the
// pre-145 query did) would leave four of the six categories permanently empty and
// silently kill the only tool that catches forgotten billing.

import { createClient } from '@/lib/supabase/client'
import type { WorkflowStatus, Invoice, Currency } from '@/lib/types/database'

export type ReconCategory =
  | 'not_completed'           // work looks done but the job was never marked complete
  | 'ready_to_invoice'        // marked invoice-ready, no invoice yet — bill it
  | 'missing_invoice_record'  // job is closed but no invoice exists
  | 'missing_client'          // billable but no client set — can't invoice
  | 'hours_changed'           // billed, but a surveyor's hours were edited afterwards

export const RECON_META: Record<ReconCategory, { label: string; blurb: string; pill: string; dot: string }> = {
  not_completed:          { label: 'Not completed',      blurb: 'Work looks finished but nobody marked the job complete — it can’t be invoiced until they do.', pill: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  ready_to_invoice:       { label: 'Ready to invoice',   blurb: 'Marked invoice-ready — no invoice raised yet.',    pill: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  missing_invoice_record: { label: 'Invoice missing',    blurb: 'Job was closed but no invoice exists.',            pill: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  missing_client:         { label: 'No client',          blurb: 'Billable, but no client is set to invoice.',       pill: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  hours_changed:          { label: 'Hours changed',      blurb: 'Labour was edited after this was invoiced — check the billed hours.', pill: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
}

// Display order: most urgent / most-likely-forgotten first. 'not_completed' leads —
// it is the earliest point at which billing can silently stall, and every category
// below it is unreachable until the job is completed.
export const RECON_ORDER: ReconCategory[] = ['not_completed', 'ready_to_invoice', 'missing_invoice_record', 'missing_client', 'hours_changed']

/** A job whose checklist was submitted is flagged immediately (submitted means the
 *  surveyor declared it done, so a still-'in_progress' status is a stuck write).
 *  A job with nothing submitted is only stale after this many days — report-only
 *  jobs have no submit event, and multi-day loadouts legitimately run for weeks. */
export const STALE_IN_PROGRESS_DAYS = 21

export interface ReconItem {
  job_id: string
  report_number: string | null
  vessel_name: string | null
  client_name: string | null
  workflow_status: WorkflowStatus
  category: ReconCategory
  invoice_id: string | null
  invoice_status: Invoice['status'] | null
  invoice_total: number | null
  currency: Currency | null
}

interface ReconJob {
  workflow_status: WorkflowStatus
  client_id: string | null
  submitted_at?: string | null
  scheduled_date?: string | null
  end_date?: string | null
  created_at?: string | null
}

function categorize(job: ReconJob, inv: { status: Invoice['status']; created_at?: string } | undefined, hoursChanged = false, staleBefore?: string): ReconCategory | null {
  if (inv && inv.status !== 'void') {
    if (hoursChanged) return 'hours_changed' // billed, but labour edited since
    return null // invoiced with a record — fine
  }
  // No invoice on the job. 'closed' should only ever be reached BY invoicing, so a
  // closed job with no invoice is either a manual close or a lost invoice — flag it.
  if (job.workflow_status === 'closed') return 'missing_invoice_record'
  if (job.workflow_status === 'invoice_ready') return job.client_id ? 'ready_to_invoice' : 'missing_client'
  // Jobs that never got marked complete. Nothing downstream can see them — the
  // invoice builder only lists report_ready/invoice_ready — so before this check
  // the reconcile page, the one tool built to catch forgotten billing, stayed
  // silent on the single most common way billing is forgotten.
  if (job.workflow_status === 'in_progress') {
    // Submitted checklist + still in_progress = the status write never landed.
    // Unambiguous; no age grace period.
    if (job.submitted_at) return 'not_completed'
    // Otherwise judge by the job's last working day, falling back to created.
    const worked = job.end_date || job.scheduled_date || (job.created_at ?? '').slice(0, 10)
    if (staleBefore && worked && worked < staleBefore) return 'not_completed'
  }
  return null // in_progress but still recent, or report_ready — not yet billable
}

/** How far back the reconcile list looks. Replaces the old "exclude closed jobs"
 *  filter as the volume guard — closed jobs are now the ones we most need to see. */
const RECON_WINDOW_MONTHS = 18

export async function listReconciliation(): Promise<{ items: ReconItem[]; counts: Record<ReconCategory, number> }> {
  const supabase = createClient()
  const nowIso = new Date().toISOString()
  const since = new Date(); since.setMonth(since.getMonth() - RECON_WINDOW_MONTHS)
  const [{ data: jobs }, { data: invoices }, { data: labour }] = await Promise.all([
    supabase.from('jobs')
      .select('id, report_number, vessel_name, client_id, workflow_status, invoice_id, submitted_at, scheduled_date, end_date, created_at, client:clients(name)')
      // Closed jobs are INCLUDED on purpose — post-145 they are the billed ones, and
      // the unsent/overdue/hours-changed checks only ever apply to them. Bounded by
      // date instead so the list stays a working queue, not the whole history.
      .gte('created_at', since.toISOString())
      // Hide jobs an admin has snoozed (cleared) until the snooze lapses.
      .or(`recon_snoozed_until.is.null,recon_snoozed_until.lt.${nowIso}`),
    supabase.from('invoices').select('id, job_id, status, total, currency, created_at'),
    // Latest labour edit per job — to flag hours changed AFTER a job was invoiced.
    supabase.from('job_surveyors').select('job_id, updated_at'),
  ])

  // job_id → most-recent labour edit (max updated_at across its surveyor rows).
  const labourMax = new Map<string, string>()
  for (const r of (labour ?? []) as any[]) {
    const cur = labourMax.get(r.job_id)
    if (!cur || r.updated_at > cur) labourMax.set(r.job_id, r.updated_at)
  }

  // A job links to an invoice via the legacy per-job FK (invoices.job_id) OR the
  // consolidated stamp (jobs.invoice_id → invoices.id). Index by both so a
  // consolidated-invoiced job isn't wrongly flagged "invoice missing".
  const byJob = new Map<string, any>()
  const byId = new Map<string, any>()
  for (const inv of (invoices ?? []) as any[]) {
    if (inv.id) byId.set(inv.id, inv)
    if (inv.job_id && !byJob.has(inv.job_id)) byJob.set(inv.job_id, inv)
  }

  // Cut-off for "this job has been sitting in progress too long" (date-only, so it
  // compares directly against scheduled_date/end_date).
  const staleCut = new Date(); staleCut.setDate(staleCut.getDate() - STALE_IN_PROGRESS_DAYS)
  const staleBefore = staleCut.toISOString().slice(0, 10)

  const counts: Record<ReconCategory, number> = { not_completed: 0, ready_to_invoice: 0, missing_invoice_record: 0, missing_client: 0, hours_changed: 0 }
  const items: ReconItem[] = []
  for (const j of (jobs ?? []) as any[]) {
    const inv = byJob.get(j.id) ?? (j.invoice_id ? byId.get(j.invoice_id) : null)
    // Labour edited after the invoice was created → likely under/over-billing.
    const lm = labourMax.get(j.id)
    const hoursChanged = !!(inv?.created_at && lm && lm > inv.created_at)
    const category = categorize(j, inv, hoursChanged, staleBefore)
    if (!category) continue
    counts[category]++
    items.push({
      job_id: j.id, report_number: j.report_number, vessel_name: j.vessel_name,
      client_name: j.client?.name ?? null, workflow_status: j.workflow_status, category,
      invoice_id: inv?.id ?? null, invoice_status: inv?.status ?? null,
      invoice_total: inv ? Number(inv.total ?? 0) : null, currency: inv?.currency ?? null,
    })
  }

  items.sort((a, b) => RECON_ORDER.indexOf(a.category) - RECON_ORDER.indexOf(b.category))
  return { items, counts }
}

/** Number of days a cleared reconciliation flag stays hidden before re-surfacing. */
export const RECON_SNOOZE_DAYS = 14

/** Clear one or many jobs from the reconcile list WITHOUT deleting them — snoozes
 *  their billing flags for RECON_SNOOZE_DAYS, after which they re-appear. */
export async function snoozeReconciliation(jobIds: string | string[], days = RECON_SNOOZE_DAYS): Promise<{ error?: string }> {
  const ids = Array.isArray(jobIds) ? jobIds : [jobIds]
  if (ids.length === 0) return {}
  const until = new Date(); until.setDate(until.getDate() + days)
  const { error } = await createClient().from('jobs').update({ recon_snoozed_until: until.toISOString() }).in('id', ids)
  return { error: error?.message }
}
