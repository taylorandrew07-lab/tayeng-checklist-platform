// Reconciliation red-flag: surface jobs where work is done but billing would
// otherwise be forgotten — report approved but never invoiced, a workflow that
// advanced past "invoiced" with no actual invoice record, a billable job with
// no client to invoice, an invoice left unsent, or one that has gone overdue.
// All derived from job + invoice state (no extra tables).

import { createClient } from '@/lib/supabase/client'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import { isOverdue } from '@/lib/jobs/invoicing'
import type { WorkflowStatus, Invoice, Currency } from '@/lib/types/database'

export type ReconCategory =
  | 'ready_to_invoice'        // report approved, no invoice yet — bill it
  | 'missing_invoice_record'  // status says invoiced/sent/paid but no invoice exists
  | 'missing_client'          // billable but no client set — can't invoice
  | 'unsent_invoice'          // a draft invoice that hasn't been sent
  | 'overdue_invoice'         // sent invoice past its due date

export const RECON_META: Record<ReconCategory, { label: string; blurb: string; pill: string; dot: string }> = {
  ready_to_invoice:       { label: 'Ready to invoice',   blurb: 'Report approved — no invoice raised yet.',         pill: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  missing_invoice_record: { label: 'Invoice missing',    blurb: 'Marked invoiced/sent/paid but no invoice exists.', pill: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  missing_client:         { label: 'No client',          blurb: 'Billable, but no client is set to invoice.',       pill: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  unsent_invoice:         { label: 'Draft — not sent',   blurb: 'An invoice is drafted but has not been sent.',      pill: 'bg-cyan-100 text-cyan-700',    dot: 'bg-cyan-500' },
  overdue_invoice:        { label: 'Overdue',            blurb: 'A sent invoice is past its due date.',              pill: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
}

// Display order: most urgent / most-likely-forgotten first.
export const RECON_ORDER: ReconCategory[] = ['ready_to_invoice', 'missing_invoice_record', 'missing_client', 'overdue_invoice', 'unsent_invoice']

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
  due_date: string | null
  last_reminded_at: string | null
}

const idx = (s: WorkflowStatus) => WORKFLOW_ORDER.indexOf(s)

function categorize(job: { workflow_status: WorkflowStatus; client_id: string | null }, inv: { status: Invoice['status']; due_date: string | null } | undefined): ReconCategory | null {
  if (inv) {
    if (isOverdue(inv)) return 'overdue_invoice'
    if (inv.status === 'draft') return 'unsent_invoice'
    return null // sent / paid with a record — fine
  }
  // No invoice on the job.
  if (idx(job.workflow_status) >= idx('invoiced')) return 'missing_invoice_record'
  if (job.workflow_status === 'approved') return job.client_id ? 'ready_to_invoice' : 'missing_client'
  return null // still earlier in the workflow — not yet billable
}

export async function listReconciliation(): Promise<{ items: ReconItem[]; counts: Record<ReconCategory, number> }> {
  const supabase = createClient()
  const nowIso = new Date().toISOString()
  const [{ data: jobs }, { data: invoices }] = await Promise.all([
    supabase.from('jobs')
      .select('id, report_number, vessel_name, client_id, workflow_status, invoice_id, client:clients(name)')
      .neq('workflow_status', 'closed')
      // Hide jobs an admin has snoozed (cleared) until the snooze lapses.
      .or(`recon_snoozed_until.is.null,recon_snoozed_until.lt.${nowIso}`),
    supabase.from('invoices').select('id, job_id, status, due_date, total, currency, last_reminded_at'),
  ])

  // A job links to an invoice via the legacy per-job FK (invoices.job_id) OR the
  // consolidated stamp (jobs.invoice_id → invoices.id). Index by both so a
  // consolidated-invoiced job isn't wrongly flagged "invoice missing".
  const byJob = new Map<string, any>()
  const byId = new Map<string, any>()
  for (const inv of (invoices ?? []) as any[]) {
    if (inv.id) byId.set(inv.id, inv)
    if (inv.job_id && !byJob.has(inv.job_id)) byJob.set(inv.job_id, inv)
  }

  const counts: Record<ReconCategory, number> = { ready_to_invoice: 0, missing_invoice_record: 0, missing_client: 0, unsent_invoice: 0, overdue_invoice: 0 }
  const items: ReconItem[] = []
  for (const j of (jobs ?? []) as any[]) {
    const inv = byJob.get(j.id) ?? (j.invoice_id ? byId.get(j.invoice_id) : null)
    const category = categorize(j, inv)
    if (!category) continue
    counts[category]++
    items.push({
      job_id: j.id, report_number: j.report_number, vessel_name: j.vessel_name,
      client_name: j.client?.name ?? null, workflow_status: j.workflow_status, category,
      invoice_id: inv?.id ?? null, invoice_status: inv?.status ?? null,
      invoice_total: inv ? Number(inv.total ?? 0) : null, currency: inv?.currency ?? null,
      due_date: inv?.due_date ?? null, last_reminded_at: inv?.last_reminded_at ?? null,
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
