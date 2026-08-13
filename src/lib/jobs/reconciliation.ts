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
//
// NOTE (migration 188): invoicing now stamps 'invoiced', and the manual close comes
// later — so "billed" is the two-value set isJobLocked(), not 'closed' alone. Every
// status test in this file reads through that helper for the same reason as above:
// a bare 'closed' comparison would make freshly-billed jobs invisible here.
//
// NOTE (migration 186): a draught survey is a VOYAGE — Initial, Interim(s), Final —
// billed as one line on the Final. That breaks three assumptions this file used to
// make, and each break is silent:
//   * "invoice-ready with no invoice = bill it" is WRONG for an Initial or Interim.
//     Told that, an admin raises exactly the standalone line the roll-up exists to
//     prevent — the reconcile tool instructing the error it was built to catch.
//   * an absorbed leg is closed and stamped but owns no line and no amount.
//   * whether a voyage is complete cannot be judged from THIS list, which is
//     snooze-filtered and 18-month-bounded. See the second, unfiltered query below.

import { createClient } from '@/lib/supabase/client'
import type { WorkflowStatus, Invoice, Currency } from '@/lib/types/database'
import type { VesselPrefix } from '@/lib/utils'
import {
  DRAUGHT_SURVEY, draughtStage, groupDraughtVoyages, isDraughtStageJob,
  type VoyageGroup, type VoyageJob,
} from './voyage'
import { isJobLocked } from './tracker'

export type ReconCategory =
  | 'not_completed'           // work looks done but the job was never marked complete
  | 'voyage_leg_unbilled'     // its voyage's Final is invoiced but this leg was missed
  | 'orphaned_rollup'         // absorbed, but its parent is on a different invoice
  | 'billed_no_line'          // stamped + closed, but nothing on the invoice bills it
  | 'ready_to_invoice'        // marked invoice-ready, no invoice yet — bill it
  | 'missing_invoice_record'  // job is closed but no invoice exists
  | 'missing_client'          // billable but no client to invoice
  | 'voyage_missing_final'    // draught legs with no Final — nothing can carry the bill
  | 'awaiting_final'          // a leg waiting for its Final; not actionable yet
  | 'hours_changed'           // billed, but a surveyor's hours were edited afterwards

export const RECON_META: Record<ReconCategory, { label: string; blurb: string; pill: string; dot: string }> = {
  not_completed:          { label: 'Not completed',      blurb: 'Work looks finished but nobody marked the job complete — it can’t be invoiced until they do.', pill: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  voyage_leg_unbilled:    { label: 'Survey missed off',  blurb: 'This voyage’s final survey has been invoiced, but this leg was left out of it — the client was undercharged. Add it to that invoice rather than raising a new one.', pill: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  orphaned_rollup:        { label: 'Roll-up broken',     blurb: 'Billed under a final survey that is now on a different invoice (or none). The link needs repairing.', pill: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  billed_no_line:         { label: 'Billed, not charged', blurb: 'Closed and stamped onto an invoice, but nothing on that invoice actually charges for it.', pill: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  ready_to_invoice:       { label: 'Ready to invoice',   blurb: 'Marked invoice-ready — no invoice raised yet.',    pill: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-500' },
  missing_invoice_record: { label: 'Invoice missing',    blurb: 'Job was closed but no invoice exists.',            pill: 'bg-red-100 text-red-700',      dot: 'bg-red-500' },
  missing_client:         { label: 'No client',          blurb: 'Billable, but no client is set to invoice.',       pill: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  voyage_missing_final:   { label: 'No final survey',    blurb: 'These draught surveys have no final, so nothing can carry the voyage’s bill. Set the last one’s stage to Final.', pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  awaiting_final:         { label: 'Awaiting final',     blurb: 'Part of a voyage still in progress — it bills with its final survey, not on its own.', pill: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  hours_changed:          { label: 'Hours changed',      blurb: 'Labour was edited after this was invoiced — check the billed hours.', pill: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
}

// Display order: most urgent / most-likely-forgotten first. The three money-losing
// voyage faults sit at the top with 'not_completed'; 'awaiting_final' sits last
// because it is information, not a task.
export const RECON_ORDER: ReconCategory[] = [
  'not_completed', 'voyage_leg_unbilled', 'orphaned_rollup', 'billed_no_line',
  'ready_to_invoice', 'missing_invoice_record', 'missing_client',
  'voyage_missing_final', 'awaiting_final', 'hours_changed',
]

/** Categories an admin may NOT snooze away. Each of these means money is already
 *  wrong — a survey billed at nothing, or billed to nobody. Hiding one for a
 *  fortnight is how it becomes permanent. */
export const NON_SNOOZABLE: ReconCategory[] = ['voyage_leg_unbilled', 'orphaned_rollup', 'billed_no_line']

/** A job whose checklist was submitted is flagged immediately (submitted means the
 *  surveyor declared it done, so a still-'in_progress' status is a stuck write).
 *  A job with nothing submitted is only stale after this many days — report-only
 *  jobs have no submit event, and multi-day loadouts legitimately run for weeks. */
export const STALE_IN_PROGRESS_DAYS = 21

export interface ReconItem {
  job_id: string
  report_number: string | null
  vessel_name: string | null
  vessel_type: VesselPrefix | null
  voyage_number: string | null
  client_name: string | null
  workflow_status: WorkflowStatus
  category: ReconCategory
  invoice_id: string | null
  invoice_status: Invoice['status'] | null
  invoice_total: number | null
  currency: Currency | null
  /** Non-null when this survey is billed under another job's line. The row must then
   *  show no money of its own — the amount belongs to the Final, and printing it on
   *  every leg would show a voyage's total once per leg. */
  billed_under_job_id: string | null
  /** Voyage identity, so the badge and the tab count voyages rather than legs, and so
   *  snoozing one leg snoozes its whole group. */
  group_key: string | null
  group_size: number
}

/** The job fields reconciliation reads. REQUIRED, not optional, on purpose: the
 *  select string below is hand-maintained and unchecked by tsc, so a field left out
 *  of it would arrive undefined and every rule that reads it would quietly never
 *  fire — a reconcile page that looks clean because it is blind. reconciliation.test
 *  asserts the select string names each of these. */
export interface ReconJob extends VoyageJob {
  id: string
  workflow_status: WorkflowStatus
  invoice_id: string | null
  billed_under_job_id: string | null
  submitted_at: string | null
  created_at: string | null
}

export interface CategorizeContext {
  inv?: { id?: string; status: Invoice['status']; created_at?: string } | null
  hoursChanged?: boolean
  staleBefore?: string
  /** This job's voyage group, from the UNFILTERED grading query. */
  group?: VoyageGroup<ReconJob> | null
  /** The parent named by billed_under_job_id, if it could be resolved. */
  parent?: { invoice_id: string | null } | null
  /** True when an invoice line names this job directly. */
  hasLine?: boolean
  /** True when the invoice this job is stamped on has at least one job-linked line.
   *  Distinguishes a genuine no-line fault from the standalone report-only job that
   *  createConsolidatedInvoice creates, which is stamped but never line-linked by
   *  design and sits on an invoice whose only lines are manual. */
  invoiceHasJobLines?: boolean
}

export function categorize(job: ReconJob, ctx: CategorizeContext = {}): ReconCategory | null {
  const { inv, hoursChanged = false, staleBefore, group, parent, hasLine, invoiceHasJobLines } = ctx
  const live = inv && inv.status !== 'void' ? inv : undefined

  // ── Absorbed legs ─────────────────────────────────────────────────────────
  // A leg billed under a Final is correctly billed: closed, stamped, no line of its
  // own. The one thing that can go wrong is the two drifting apart.
  if (job.billed_under_job_id) {
    if (!parent || parent.invoice_id !== job.invoice_id) return 'orphaned_rollup'
    return null
  }

  if (live) {
    // Stamped and closed, but nothing on the invoice charges for it — a line deleted,
    // or a create that stamped and then failed. Absorbed legs are excluded above; the
    // standalone report-only job is excluded by invoiceHasJobLines.
    if (!hasLine && invoiceHasJobLines) return 'billed_no_line'
    if (hoursChanged) return 'hours_changed'
    return null
  }

  // ── No live invoice ───────────────────────────────────────────────────────
  // isJobLocked, not === 'closed': an INVOICED job with no live invoice is the identical
  // fault — stamped, frozen, and nothing billing it. Left as a bare 'closed' test, every
  // job billed since mig 188 would be invisible to the one page built to catch exactly
  // this, and would stay invisible until someone happened to close it by hand.
  if (isJobLocked(job.workflow_status)) return 'missing_invoice_record'

  // Draught legs answer to their voyage, not to their own status. Doing this BEFORE
  // the ready_to_invoice rule is the whole point: that rule would tell an admin to
  // raise a standalone "Interim Draught Survey" line.
  const stage = isDraughtStageJob(job) ? draughtStage(job) : null
  if (stage && stage !== 'Final' && group) {
    const final = group.final
    const finalBilled = !!final && final.invoice_id != null
    // The Final has already gone out and this leg was not on it. Real money.
    if (finalBilled) return 'voyage_leg_unbilled'
    if (group.problems.includes('no_final')) {
      // Only worth raising once the leg is otherwise ready to bill; before that the
      // Final simply hasn't been done yet, which is normal mid-voyage.
      return job.workflow_status === 'invoice_ready' ? 'voyage_missing_final' : null
    }
    // Its Final exists but isn't billed yet — nothing to do, and saying "bill it"
    // here is exactly the instruction that produces a wrong invoice.
    return job.workflow_status === 'invoice_ready' ? 'awaiting_final' : null
  }

  if (job.workflow_status === 'invoice_ready') {
    if (!job.client_id) return 'missing_client'
    // A Final whose voyage has no other legs bills normally.
    return 'ready_to_invoice'
  }

  // Jobs that never got marked complete. Nothing downstream can see them — the
  // invoice builder only lists report_ready/invoice_ready — so before this check
  // the reconcile page, the one tool built to catch forgotten billing, stayed
  // silent on the single most common way billing is forgotten.
  if (job.workflow_status === 'in_progress') {
    // Submitted checklist + still in_progress = the status write never landed.
    if (job.submitted_at) return 'not_completed'
    const worked = job.end_date || job.scheduled_date || (job.created_at ?? '').slice(0, 10)
    if (staleBefore && worked && worked < staleBefore) return 'not_completed'
  }
  return null
}

/** How far back the reconcile list looks. Replaces the old "exclude closed jobs"
 *  filter as the volume guard — closed jobs are now the ones we most need to see. */
const RECON_WINDOW_MONTHS = 18

/** The columns categorize() reads. Kept as a named constant so the test can assert
 *  every ReconJob field appears in it — this string is the one thing tsc cannot check,
 *  and a field missing from it fails SILENTLY as undefined. */
export const RECON_JOB_COLUMNS =
  'id, report_number, vessel_name, vessel_type, vessel_id, voyage_number, job_type, job_stage, ' +
  'client_id, workflow_status, invoice_id, billed_under_job_id, submitted_at, ' +
  'scheduled_date, end_date, created_at, client:clients(name)'

export async function listReconciliation(): Promise<{ items: ReconItem[]; counts: Record<ReconCategory, number> }> {
  const supabase = createClient()
  const nowIso = new Date().toISOString()
  const since = new Date(); since.setMonth(since.getMonth() - RECON_WINDOW_MONTHS)
  const [{ data: jobs }, { data: invoices }, { data: labour }, { data: lines }, { data: allDraught }] = await Promise.all([
    supabase.from('jobs')
      .select(RECON_JOB_COLUMNS)
      // Closed jobs are INCLUDED on purpose — post-145 they are the billed ones, and
      // the unsent/overdue/hours-changed checks only ever apply to them. Bounded by
      // date instead so the list stays a working queue, not the whole history.
      .gte('created_at', since.toISOString())
      // Hide jobs an admin has snoozed (cleared) until the snooze lapses.
      .or(`recon_snoozed_until.is.null,recon_snoozed_until.lt.${nowIso}`),
    supabase.from('invoices').select('id, job_id, status, total, currency, created_at'),
    // Latest labour edit per job — to flag hours changed AFTER a job was invoiced.
    supabase.from('job_surveyors').select('job_id, updated_at'),
    // Which jobs an invoice actually CHARGES for. jobs.invoice_id says a job is
    // stamped; only a line says it is billed, and the two can come apart.
    supabase.from('invoice_line_items').select('invoice_id, job_id'),
    // ── The completeness query. DELIBERATELY UNFILTERED ────────────────────
    // No snooze filter, no 18-month bound, no status or invoice filter. Whether a
    // voyage is complete is a fact about the voyage, and the list above is a
    // work queue: snoozing one Interim would otherwise make its group read
    // "Initial + Final, all accounted for" — a false all-clear, for a fortnight,
    // on the one thing this page exists to catch.
    // Bounded by job_type instead. If draught volume ever makes that too broad,
    // narrow it to the vessels in scope — never to the filtered set.
    supabase.from('jobs')
      .select('id, vessel_id, vessel_name, client_id, job_type, job_stage, voyage_number, scheduled_date, end_date, invoice_id, workflow_status, billed_under_job_id, submitted_at, created_at, report_number')
      .eq('job_type', DRAUGHT_SURVEY),
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

  const jobsWithLine = new Set<string>()
  const invoicesWithJobLines = new Set<string>()
  for (const l of (lines ?? []) as any[]) {
    if (l.job_id) { jobsWithLine.add(l.job_id); invoicesWithJobLines.add(l.invoice_id) }
  }

  // Voyage groups from the unfiltered set, and an index from job id → its group.
  const draughtAll = ((allDraught ?? []) as any[]) as ReconJob[]
  const groups = groupDraughtVoyages(draughtAll)
  const groupOf = new Map<string, VoyageGroup<ReconJob>>()
  for (const g of groups) for (const m of g.members) groupOf.set(m.id, g)
  const draughtById = new Map(draughtAll.map(j => [j.id, j]))

  // Cut-off for "this job has been sitting in progress too long" (date-only, so it
  // compares directly against scheduled_date/end_date).
  const staleCut = new Date(); staleCut.setDate(staleCut.getDate() - STALE_IN_PROGRESS_DAYS)
  const staleBefore = staleCut.toISOString().slice(0, 10)

  const counts = Object.fromEntries(RECON_ORDER.map(c => [c, 0])) as Record<ReconCategory, number>
  const items: ReconItem[] = []
  for (const j of (jobs ?? []) as any[]) {
    const inv = byJob.get(j.id) ?? (j.invoice_id ? byId.get(j.invoice_id) : null)
    const lm = labourMax.get(j.id)
    const hoursChanged = !!(inv?.created_at && lm && lm > inv.created_at)
    const group = groupOf.get(j.id) ?? null
    const parent = j.billed_under_job_id
      ? (draughtById.get(j.billed_under_job_id) ?? null)
      : null
    const category = categorize(j as ReconJob, {
      inv, hoursChanged, staleBefore, group, parent,
      hasLine: jobsWithLine.has(j.id),
      invoiceHasJobLines: !!(inv?.id && invoicesWithJobLines.has(inv.id)),
    })
    if (!category) continue
    counts[category]++
    items.push({
      job_id: j.id, report_number: j.report_number, vessel_name: j.vessel_name, vessel_type: j.vessel_type ?? null,
      voyage_number: j.voyage_number ?? null,
      client_name: j.client?.name ?? null, workflow_status: j.workflow_status, category,
      invoice_id: inv?.id ?? null, invoice_status: inv?.status ?? null,
      // An absorbed leg shows NO money: the amount lives on the Final's line, and
      // printing it here too would show one voyage's total once per leg.
      invoice_total: inv && !j.billed_under_job_id ? Number(inv.total ?? 0) : null,
      currency: inv?.currency ?? null,
      billed_under_job_id: j.billed_under_job_id ?? null,
      group_key: group && group.members.length > 1 ? group.key : null,
      group_size: group ? group.members.length : 1,
    })
  }

  items.sort((a, b) => RECON_ORDER.indexOf(a.category) - RECON_ORDER.indexOf(b.category))
  return { items, counts }
}

/** Number of days a cleared reconciliation flag stays hidden before re-surfacing. */
export const RECON_SNOOZE_DAYS = 14

/** Clear one or many jobs from the reconcile list WITHOUT deleting them — snoozes
 *  their billing flags for RECON_SNOOZE_DAYS, after which they re-appear.
 *
 *  Pass the whole voyage's job ids for a grouped row: snoozing one leg while its
 *  siblings stay visible produces a group that reads as complete when it isn't. */
export async function snoozeReconciliation(jobIds: string | string[], days = RECON_SNOOZE_DAYS): Promise<{ error?: string }> {
  const ids = Array.isArray(jobIds) ? jobIds : [jobIds]
  if (ids.length === 0) return {}
  const until = new Date(); until.setDate(until.getDate() + days)
  const { error } = await createClient().from('jobs').update({ recon_snoozed_until: until.toISOString() }).in('id', ids)
  return { error: error?.message }
}
