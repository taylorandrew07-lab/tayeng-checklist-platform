// P&I cases — the single source for "is this a case, and what state is it in?".
//
// A case IS a job (migration 204): same table, same client and vessel links, same
// attendance logs. What makes it a case is jobs.is_case, derived at creation from
// a job type an admin has marked. Everything about that test lives here so it
// cannot drift across the cases page, the jobs register and reconciliation — the
// way the role-home map drifted across five files.
//
// A case does NOT use workflow_status for its life-cycle. It sits at 'in_progress'
// forever (see the migration header for why a sixth status would be silently
// rewritten) and carries case_status instead.

import { createClient } from '@/lib/supabase/client'
import { createDraftJob } from '@/lib/jobs/drafts'
import { todayKey } from '@/lib/cargo/voyageDate'

/** The seeded job type whose jobs become cases. Mirrors migration 204 section 1. */
export const CASE_JOB_TYPE = 'P&I Case'

export type CaseStatus = 'open' | 'on_hold' | 'concluded'

/** One badge per domain — never inline a new colour map (DESIGN.md). */
export const CASE_STATUS: Record<CaseStatus, { label: string; pill: string; dot: string }> = {
  open:      { label: 'Open',      pill: 'bg-sky-100 text-sky-700',     dot: 'bg-sky-500' },
  on_hold:   { label: 'On hold',   pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  concluded: { label: 'Concluded', pill: 'bg-slate-200 text-slate-600', dot: 'bg-slate-500' },
}

export const CASE_STATUS_ORDER: CaseStatus[] = ['open', 'on_hold', 'concluded']

/** NULL reads as 'open'. The database allows NULL (every ordinary job has it) and
 *  the mig-204 insert trigger only fills it in for cases, so a case written by any
 *  other route still has to land somewhere sensible. Matches the SQL in
 *  job_is_open(), which also treats NULL as open — keep the two in step. */
export function caseStatusOf(c: { case_status?: string | null } | null | undefined): CaseStatus {
  const s = c?.case_status
  return s === 'on_hold' || s === 'concluded' ? s : 'open'
}

/** A case that is still running — the predicate that exempts a case from the
 *  invoicing write-lock and from reconciliation's stale-job flag.
 *
 *  Defined in tracker.ts, beside job_is_open()'s mirror, because that is where it is
 *  load-bearing; re-exported here so case code has one obvious import. */
export { isLiveCase } from './tracker'

/** Whole days between two 'YYYY-MM-DD' keys, or null if the start is missing.
 *
 *  Deliberately string-in, string-out via Date.UTC on the parsed parts. `new
 *  Date('2026-09-01')` is UTC midnight, which is 31 August in Trinidad — the exact
 *  bug that filed every survey dated the 1st under the previous month. Comparing
 *  two UTC-noon instants built from the parts has no timezone in it at all. */
export function daysBetweenKeys(fromKey: string | null | undefined, toKey: string): number | null {
  if (!fromKey) return null
  const a = fromKey.slice(0, 10).split('-').map(Number)
  const b = toKey.slice(0, 10).split('-').map(Number)
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return null
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])
  return Math.round(ms / 86_400_000)
}

/** How long a case has been open, in days. Trinidad's today, never the host's. */
export function caseDaysOpen(
  c: { case_opened_on?: string | null; case_closed_on?: string | null },
  today: string = todayKey(),
): number | null {
  return daysBetweenKeys(c.case_opened_on, c.case_closed_on?.slice(0, 10) || today)
}

export interface CaseRow {
  id: string
  title: string | null
  vessel_name: string | null
  vessel_type: string | null
  client_id: string | null
  client_name: string | null
  case_status: CaseStatus
  case_opened_on: string | null
  case_closed_on: string | null
  notes: string | null
  labour_unit: string | null
  /** Attendance totals across every surveyor on the case. Hours and days are
   *  NEVER summed together — labour_unit says which this job is counted in. */
  regular_hours: number
  overtime_hours: number
  surveyor_names: string[]
  /** The most recent attendance date across both time logs, 'YYYY-MM-DD'. */
  last_attendance: string | null
  /** Attendance already paid for, and attendance not yet billed (migs 205/206).
   *  A case is billed by entry, so these are the two numbers that actually matter
   *  when deciding whether to close off a billing period. */
  billed_hours: number
  outstanding_hours: number
}

const CASE_COLUMNS =
  'id, title, vessel_name, vessel_type, notes, labour_unit, is_case, case_status, ' +
  'case_opened_on, case_closed_on, client_id, client:clients(name)'

/**
 * Every case, newest first. Deliberately unpaginated: a firm has a handful of P&I
 * cases running at a time, not hundreds, and the whole point of the page is to see
 * all of them at once.
 */
export async function listCases(): Promise<CaseRow[]> {
  const supabase = createClient()

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select(CASE_COLUMNS)
    .eq('is_case', true)
    .order('case_opened_on', { ascending: false, nullsFirst: false })

  if (error || !jobs?.length) return []

  const ids = (jobs as any[]).map(j => j.id)

  // Surveyors + their rolled-up hours, then the two attendance logs for "when did
  // we last attend". Same shape as listJobTrackerRows: flat queries, joined in JS.
  const { data: js } = await supabase
    .from('job_surveyors')
    .select('id, job_id, regular_hours, overtime_hours, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name)')
    .in('job_id', ids)

  const jsRows = (js ?? []) as any[]
  const jsToJob = new Map<string, string>()
  for (const r of jsRows) jsToJob.set(r.id, r.job_id)

  const lastByJob = new Map<string, string>()
  const billByJob = new Map<string, { billed: number; outstanding: number }>()
  const jsIds = jsRows.map(r => r.id)
  if (jsIds.length) {
    const [reg, ot] = await Promise.all([
      supabase.from('job_surveyor_regular').select('job_surveyor_id, entry_date, hours, billed_invoice_id').in('job_surveyor_id', jsIds),
      supabase.from('job_surveyor_overtime').select('job_surveyor_id, entry_date, hours, billed_invoice_id').in('job_surveyor_id', jsIds),
    ])
    for (const r of [...((reg.data ?? []) as any[]), ...((ot.data ?? []) as any[])]) {
      const jobId = jsToJob.get(r.job_surveyor_id)
      if (!jobId) continue
      const d = (r.entry_date ?? '').slice(0, 10)
      if (d) {
        const seen = lastByJob.get(jobId)
        if (!seen || d > seen) lastByJob.set(jobId, d)   // plain string compare: both are YYYY-MM-DD
      }
      const b = billByJob.get(jobId) ?? { billed: 0, outstanding: 0 }
      // NULL billed_invoice_id is the whole model: it means "not paid for yet".
      if (r.billed_invoice_id) b.billed += Number(r.hours ?? 0)
      else b.outstanding += Number(r.hours ?? 0)
      billByJob.set(jobId, b)
    }
  }

  const agg = new Map<string, { names: string[]; reg: number; ot: number }>()
  for (const r of jsRows) {
    let e = agg.get(r.job_id)
    if (!e) { e = { names: [], reg: 0, ot: 0 }; agg.set(r.job_id, e) }
    const n = r.surveyor?.full_name
    if (n && !e.names.includes(n)) e.names.push(n)
    e.reg += Number(r.regular_hours ?? 0)
    e.ot  += Number(r.overtime_hours ?? 0)
  }

  return (jobs as any[]).map(j => {
    const a = agg.get(j.id)
    return {
      id: j.id,
      title: j.title ?? null,
      vessel_name: j.vessel_name ?? null,
      vessel_type: j.vessel_type ?? null,
      client_id: j.client_id ?? null,
      client_name: j.client?.name ?? null,
      case_status: caseStatusOf(j),
      case_opened_on: j.case_opened_on ?? null,
      case_closed_on: j.case_closed_on ?? null,
      notes: j.notes ?? null,
      labour_unit: j.labour_unit ?? null,
      regular_hours: a?.reg ?? 0,
      overtime_hours: a?.ot ?? 0,
      surveyor_names: a?.names ?? [],
      last_attendance: lastByJob.get(j.id) ?? null,
      billed_hours: billByJob.get(j.id)?.billed ?? 0,
      outstanding_hours: billByJob.get(j.id)?.outstanding ?? 0,
    }
  })
}

/** Move a case through its life-cycle. Admin-only at the database (mig 204 §4);
 *  this is the UI half. Stamps case_closed_on on the way to 'concluded' and clears
 *  it on the way back out, so "how long was it open" stays honest either way. */
export async function setCaseStatus(jobId: string, next: CaseStatus): Promise<{ error?: string }> {
  const patch: Record<string, unknown> = {
    case_status: next,
    case_closed_on: next === 'concluded' ? todayKey() : null,
  }
  const { data, error } = await createClient()
    .from('jobs').update(patch).eq('id', jobId).select('id')
  if (error) return { error: error.message }
  // A 0-row update is an RLS refusal, which PostgREST reports as success.
  if (!data?.length) return { error: 'You do not have permission to change this case.' }
  return {}
}

/**
 * Open a case. Routes through createDraftJob like every other job-creation path,
 * so the future AI/WhatsApp intake seam gets cases for free.
 *
 * is_case is NOT passed: the mig-204 insert trigger derives it from the job type,
 * which is the only route a non-admin has, and letting the client assert it would
 * mean trusting the client for the flag that unlocks the invoicing write-lock.
 */
export async function createCase(input: {
  title: string
  clientId: string | null
  vesselName: string | null
  actorId: string
  surveyorIds: string[]
  notes?: string | null
  openedOn?: string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { job, error } = await createDraftJob(supabase, {
    job: {
      title: input.title,
      job_type: CASE_JOB_TYPE,
      template_id: null,
      client_id: input.clientId,
      vessel_name: input.vesselName,
      created_by: input.actorId,
      assigned_to: input.surveyorIds[0] ?? null,
      workflow_status: 'in_progress',
      notes: input.notes ?? null,
      scheduled_date: input.openedOn ?? todayKey(),
      case_opened_on: input.openedOn ?? todayKey(),
    },
    surveyorIds: input.surveyorIds,
    actorId: input.actorId,
    clientId: input.clientId,
  }, 'manual')

  if (error) return { error }
  return { id: job?.id }
}
