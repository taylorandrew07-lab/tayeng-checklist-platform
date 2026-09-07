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

/** America/Port_of_Spain, UTC-4, FIXED — Trinidad has never observed DST. */
const TZ_OFFSET_MS = 4 * 60 * 60 * 1000

/**
 * Today in TRINIDAD, as YYYY-MM-DD, on any host.
 *
 * Load-bearing, and deliberately not the host's local day. voyagePhase() is read
 * in the browser (the jobs register) AND on the server (the public share annex,
 * a Route Handler), and Vercel runs in UTC — so a host-local answer would call a
 * voyage completed up to four hours early every evening. Shift the instant by the
 * fixed offset and read it back with the UTC accessors, which makes them report
 * Trinidad wall-clock time wherever this runs. Same trick, and the same reason,
 * as lib/jobs/reminderWindow.ts and lib/inventory/calibration.ts.
 */
export function todayKey(now: Date = new Date()): string {
  return new Date(now.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10)
}

export type VoyagePhase = 'ongoing' | 'completed' | 'finalized'

/**
 * Where a voyage is in its life, as the registers should read it.
 *
 *   finalized — the surveyor signed the report off (status). Locked, and the
 *               client's copy stops saying NOT FINALISED.
 *   completed — the Monitoring End has arrived: an end date is set and it is not
 *               after today. Nobody has finalised yet, but the work is done.
 *   ongoing   — no end date (the normal case at sea) or one still in the future.
 *
 * The owner's rule, 2026-09-07: setting the Monitoring End IS ending the voyage.
 * Nary closed Channel Pearl off on 02 Sep by dating it, never pressed Finalise,
 * and the jobs register kept it at the top as "In progress" for a week — because
 * this used to key on status alone. Finalising is still the surveyor's act and
 * still the only thing that locks the document; it is simply no longer the only
 * way for the register to notice the voyage is over.
 *
 * `today` is a parameter so the rule can be tested without faking the clock.
 */
export function voyagePhase(
  v: { status?: string | null } & Pick<VoyageDateFields, 'end_date'>,
  today: string = todayKey(),
): VoyagePhase {
  if ((v.status ?? 'in_progress') === 'finalized') return 'finalized'
  const end = dayKey(v.end_date)
  return end && end <= today ? 'completed' : 'ongoing'
}

/** Work still being done — what floats a voyage to the top of a register and
 *  keeps it under the Open filter. The inverse of "completed or finalised". */
export function voyageIsOngoing(
  v: { status?: string | null } & Pick<VoyageDateFields, 'end_date'>,
  today: string = todayKey(),
): boolean {
  return voyagePhase(v, today) === 'ongoing'
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
  const today = todayKey()
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
