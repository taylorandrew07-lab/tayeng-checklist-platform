// The completeness check for a draught-survey voyage.
//
// listInvoiceableJobs is a POOL, and it is filtered five ways: by client, by month (on
// the START date), by workflow_status, by invoice_id IS NULL, and by whatever the admin
// picked. Every one of those is a way a leg becomes invisible — and an invisible leg is
// not merely unwarned, it is silently dropped from the roll-up. A manually closed
// Initial takes 350 off the invoice and leaves it looking perfectly normal.
//
// So the question "is this voyage complete?" is asked of the database directly, with no
// filters at all. Anything the pool could not see becomes a hard block, named, with a
// link — never a warning, because the whole point is that the number looks right.

import { createClient } from '@/lib/supabase/client'
import { groupDraughtVoyages, voyageKey, vesselKey, DRAUGHT_SURVEY, type VoyageGroup, type VoyageJob } from './voyage'

export interface VoyageContextJob extends VoyageJob {
  id: string
  report_number: string | null
  workflow_status: string
  invoice_id: string | null
  billed_under_job_id: string | null
}

export type VoyageContextProblem =
  /** A leg is still being worked — billing the voyage now would close it mid-survey. */
  | { kind: 'in_progress'; jobId: string; stage: string | null; reportNumber: string | null }
  /** A leg was closed by hand, so it never reached the pool. Straight undercharge. */
  | { kind: 'already_closed'; jobId: string; stage: string | null; reportNumber: string | null }
  /** A leg is already on another invoice. */
  | { kind: 'already_invoiced'; jobId: string; stage: string | null; reportNumber: string | null }
  /** A leg belongs to a different client — one line cannot have two payers. */
  | { kind: 'other_client'; jobId: string; stage: string | null; reportNumber: string | null }
  /** A leg has no client at all. */
  | { kind: 'no_client'; jobId: string; stage: string | null; reportNumber: string | null }

export interface VoyageContext {
  /** Every job on this voyage, however invisible to the pool. */
  members: VoyageContextJob[]
  problems: VoyageContextProblem[]
}

/**
 * Look up the FULL membership of each candidate voyage.
 *
 * Deliberately unfiltered: no client filter, no month filter, no status filter, no
 * invoice_id filter, no snooze filter, no date bound. Bounded only by job type and by
 * the vessels actually in play.
 */
export async function fetchVoyageContext(
  groups: VoyageGroup[],
  expectedClientId: string | null,
): Promise<Map<string, VoyageContext>> {
  const out = new Map<string, VoyageContext>()
  if (groups.length === 0) return out

  const vesselIds = [...new Set(groups.flatMap(g => g.members.map(m => m.vessel_id).filter(Boolean)))] as string[]
  const vesselNames = [...new Set(groups.flatMap(g => g.members.map(m => m.vessel_name).filter(Boolean)))] as string[]

  const supabase = createClient()
  let q = supabase.from('jobs')
    .select('id, report_number, vessel_id, vessel_name, client_id, job_type, job_stage, voyage_number, scheduled_date, end_date, workflow_status, invoice_id, billed_under_job_id')
    .eq('job_type', DRAUGHT_SURVEY)
  // Match on either identity, because a job created offline has no vessel_id until it
  // syncs — filtering on the id alone would hide exactly the legs entered dockside.
  const ors: string[] = []
  if (vesselIds.length) ors.push(`vessel_id.in.(${vesselIds.join(',')})`)
  if (vesselNames.length) ors.push(...vesselNames.map(n => `vessel_name.ilike.${n.replace(/[,()]/g, ' ')}`))
  if (ors.length) q = q.or(ors.join(','))

  const { data } = await q
  const all = ((data ?? []) as any[]) as VoyageContextJob[]

  // Re-group the unfiltered set with the same rules, then match each candidate group to
  // its true membership by voyage key (or, for a date-proximity group, by the jobs it
  // already holds — a suggestion has no key to look up).
  const fullGroups = groupDraughtVoyages(all)

  for (const g of groups) {
    const wantVoyage = voyageKey(g.voyage)
    const wantVessel = vesselKey(g.members[0])
    const match = wantVoyage
      ? fullGroups.find(f => voyageKey(f.voyage) === wantVoyage && f.vesselKey === wantVessel)
      : fullGroups.find(f => f.members.some(m => g.members.some(x => x.id === m.id)))
    const members = (match?.members ?? []) as VoyageContextJob[]

    const problems: VoyageContextProblem[] = []
    for (const m of members) {
      const at = { jobId: m.id, stage: m.job_stage, reportNumber: m.report_number }
      if (m.workflow_status === 'in_progress') problems.push({ kind: 'in_progress', ...at })
      else if (m.invoice_id) problems.push({ kind: 'already_invoiced', ...at })
      else if (m.workflow_status === 'closed') problems.push({ kind: 'already_closed', ...at })
      if (!m.client_id) problems.push({ kind: 'no_client', ...at })
      else if (expectedClientId && m.client_id !== expectedClientId) problems.push({ kind: 'other_client', ...at })
    }
    out.set(g.key, { members, problems })
  }
  return out
}

export function describeContextProblem(p: VoyageContextProblem): string {
  const who = `${p.stage ?? 'A'} survey${p.reportNumber ? ` (${p.reportNumber})` : ''}`
  switch (p.kind) {
    case 'in_progress': return `${who} on this voyage is still in progress — billing now would close it mid-survey.`
    case 'already_closed': return `${who} on this voyage was closed by hand, so it is not in the billable list. It would be left off this invoice.`
    case 'already_invoiced': return `${who} on this voyage is already on another invoice.`
    case 'other_client': return `${who} on this voyage belongs to a different client — one line cannot bill two payers.`
    case 'no_client': return `${who} on this voyage has no client set.`
  }
}
