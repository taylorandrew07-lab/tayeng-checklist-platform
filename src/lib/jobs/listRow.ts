// One list, two kinds of row.
//
// The jobs registers show `jobs`, but a cargo monitoring voyage is the same
// thing to the people reading them: work on a vessel, running or finished. They
// live in a different table with no workflow_status and no job number, so they
// are merged in as a second row kind rather than being forced to pretend to be
// jobs.
//
// Everything here delegates: the job rules stay in lib/jobs/jobDate.ts and the
// voyage rules in lib/cargo/voyageDate.ts, and neither is re-spelled. This file
// only decides how the two are ordered against each other.

import { jobLastDateKey, type JobDateFields } from './jobDate'
import { voyageIsOngoing, voyageLastDateKey } from '@/lib/cargo/voyageDate'
import type { VoyageListRow } from '@/lib/cargo/remote'

export type JobsListRow<J extends JobDateFields = JobDateFields> =
  | { kind: 'job'; id: string; job: J }
  | { kind: 'voyage'; id: string; voyage: VoyageListRow }

/** Work still being done. Jobs: in progress. Voyages: not yet finalised.
 *  This is what floats a row to the top of the register. */
export function listRowIsOngoing<J extends JobDateFields & { workflow_status?: string | null }>(
  r: JobsListRow<J>
): boolean {
  return r.kind === 'voyage'
    ? voyageIsOngoing(r.voyage)
    : (r.job.workflow_status ?? '') === 'in_progress'
}

/** The row's last calendar day, via whichever rule owns it. Both sides run
 *  through dayKey(), so the two are directly comparable. */
export function listRowLastDateKey<J extends JobDateFields>(r: JobsListRow<J>): string {
  return r.kind === 'voyage' ? voyageLastDateKey(r.voyage) : jobLastDateKey(r.job)
}

/**
 * The register's order: ongoing work first, then newest last-day first.
 *
 * The ongoing-first grouping is what the owner asked for — a voyage still being
 * monitored belongs at the top next to the jobs still being worked, not buried
 * by date among finished ones. Ties break on id so client-side paging can't
 * reshuffle rows between renders.
 */
export function byListRowDesc<J extends JobDateFields & { workflow_status?: string | null }>(
  a: JobsListRow<J>, b: JobsListRow<J>
): number {
  const oa = listRowIsOngoing(a), ob = listRowIsOngoing(b)
  if (oa !== ob) return oa ? -1 : 1
  const ka = listRowLastDateKey(a), kb = listRowLastDateKey(b)
  if (ka !== kb) return ka < kb ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Which voyages get a row of their own.
 *
 * A voyage attached to a job (migration 085) is shown ON that job's row instead,
 * so one physical operation is one line. But ONLY when its job is actually
 * present in the list — if the job is invisible to this reader through RLS, or
 * simply hasn't loaded, the voyage falls back to its own row. A voyage must
 * never be able to disappear because of a link pointing somewhere unreachable.
 */
export function splitVoyagesByJob(
  voyages: VoyageListRow[], jobIds: Set<string>
): { standalone: VoyageListRow[]; byJob: Map<string, VoyageListRow[]> } {
  const standalone: VoyageListRow[] = []
  const byJob = new Map<string, VoyageListRow[]>()
  for (const v of voyages) {
    if (v.job_id && jobIds.has(v.job_id)) {
      const list = byJob.get(v.job_id)
      if (list) list.push(v)
      else byJob.set(v.job_id, [v])
    } else {
      standalone.push(v)
    }
  }
  return { standalone, byJob }
}
