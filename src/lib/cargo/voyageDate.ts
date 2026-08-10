// A cargo voyage's date for ordering and display in the jobs registers.
//
// The voyage twin of lib/jobs/jobDate.ts. A voyage has no scheduled_date /
// end_date columns — its dates live inside the `doc` JSONB — so it cannot be
// routed through jobLastDate(); it gets the same SHAPE of rule, spelled for its
// own fields, and this is the one place it is spelled.
//
// ⚠️ This is a deliberate COLUMN-ONLY approximation of effectiveEndDate()
// (lib/cargo/periods.ts). The real one also scans readings and periodMeta so an
// open-ended voyage can never hide a day already recorded — but those live in
// `doc`, which holds every reading and is far too heavy to pull into a list
// query. Anything RENDERING a voyage must still call effectiveEndDate() on the
// full document. Only list ordering and the date column use these.

import { dayKey } from '@/lib/utils'

/** The date fields a voyage LIST row carries (selected out of doc via
 *  PostgREST arrow paths, so both arrive as strings, and endDate arrives as ''
 *  rather than null when the voyage is still open-ended). */
export interface VoyageDateFields {
  start_date?: string | null
  end_date?: string | null
  created_at?: string | null
}

/** A voyage is ongoing until the surveyor finalises it. Deliberately keyed on
 *  status and NOT on the end date: a voyage whose last monitoring day has passed
 *  is still open work until it is signed off, and one with no end date at all is
 *  the normal case at sea. */
export function voyageIsOngoing(v: { status?: string | null }): boolean {
  return (v.status ?? 'in_progress') !== 'finalized'
}

/**
 * The voyage's last day. Its end date once the surveyor has set one; otherwise
 * (open-ended — types.ts documents endDate as '' until the finish is known) the
 * later of its start date and today, so a running voyage sorts to the top of a
 * newest-first list instead of sinking to the day it began.
 */
export function voyageLastDate(v: VoyageDateFields): string | null {
  const end = dayKey(v.end_date)
  if (end) return end
  const start = dayKey(v.start_date)
  if (!start) return null
  const today = dayKey(new Date().toISOString())
  return start > today ? start : today
}

/** Sort key: the last day as a local calendar day, matching jobLastDateKey so a
 *  voyage and a job can be ordered against each other honestly. */
export function voyageLastDateKey(v: VoyageDateFields): string {
  return voyageLastDate(v) ?? dayKey(v.created_at)
}

/** True when the voyage covers more than one day — i.e. its start is worth
 *  showing underneath the last date, as jobs do. */
export function voyageSpansDays(v: VoyageDateFields): boolean {
  const start = dayKey(v.start_date)
  const last = voyageLastDate(v)
  return !!start && !!last && start !== last
}
