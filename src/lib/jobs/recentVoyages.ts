// The voyage number a surveyor is most likely about to type.
//
// Andrew: "if somebody already did a Chaconia initial draught and now they are coming
// to do a Chaconia interim draught, maybe the app can put in the voyage number from the
// initial in grey text and the surveyor can just press tab or enter."
//
// This matters more than it looks: of the draught surveys on the system when this was
// built, only 2 of 30 carried a voyage number at all. Every one that gets entered is a
// voyage the biller does not have to infer from dates.
//
// The suggestion is never a pre-filled VALUE — the field stays empty until the surveyor
// accepts it. A genuinely new voyage must never be silently stamped with the last one.
//
// OFFLINE: the surveyor's New Job form runs dockside with no signal, so these rows ride
// along in the newjobcache IndexedDB store with the templates and clients. There is no
// live query to fall back on.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DRAUGHT_SURVEY, normaliseVoyage, vesselKey } from './voyage'

/** One vessel's most recent voyage number, with enough context for the surveyor to
 *  recognise whether it is the voyage they are actually on. */
export interface RecentVoyage {
  vessel_key: string
  vessel_name: string
  voyage_number: string
  /** The stage it came from — "from Initial" reads very differently from "from Final". */
  job_stage: string | null
  /** The job's own date, so a stale voyage is visibly stale. */
  scheduled_date: string | null
}

/** How far back a voyage stays suggestible. Beyond this the vessel is almost certainly
 *  on its next voyage, and offering the old number would actively cause the mis-stamping
 *  this feature exists to prevent. */
export const SUGGEST_WITHIN_DAYS = 30

/** How many vessels to remember. Small on purpose: this payload is cached on a phone. */
const MAX_VESSELS = 60

/**
 * Recent draught-survey voyage numbers, one row per vessel (the latest).
 * Read once when the New Job data is loaded, cached for offline use.
 */
export async function fetchRecentVoyages(supabase: SupabaseClient): Promise<RecentVoyage[]> {
  const since = new Date(Date.now() - SUGGEST_WITHIN_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('jobs')
    .select('vessel_id, vessel_name, voyage_number, job_stage, scheduled_date')
    .eq('job_type', DRAUGHT_SURVEY)
    .not('voyage_number', 'is', null)
    .gte('scheduled_date', since)
    .order('scheduled_date', { ascending: false })
    .limit(400)

  const latest = new Map<string, RecentVoyage>()
  for (const row of (data ?? []) as any[]) {
    if (!row.vessel_name || !row.voyage_number) continue
    const key = vesselKey(row)
    // Rows arrive newest first, so the first sighting of a vessel is its latest voyage.
    if (latest.has(key)) continue
    latest.set(key, {
      vessel_key: key,
      vessel_name: row.vessel_name,
      voyage_number: row.voyage_number,
      job_stage: row.job_stage ?? null,
      scheduled_date: row.scheduled_date ?? null,
    })
    if (latest.size >= MAX_VESSELS) break
  }
  return [...latest.values()]
}

/**
 * The voyage to offer for a vessel the surveyor is typing, or null.
 *
 * Pure, so the "don't suggest a stale voyage" rule is testable. `today` is injected
 * rather than read from the clock for the same reason.
 */
export function suggestVoyageFor(
  vesselName: string | null | undefined,
  recents: RecentVoyage[],
  today: string,
): RecentVoyage | null {
  const key = vesselKey({ vessel_id: null, vessel_name: vesselName ?? '' })
  if (!key) return null
  const hit = recents.find(r => r.vessel_key === key)
  if (!hit || !hit.voyage_number) return null
  if (hit.scheduled_date) {
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${hit.scheduled_date}T00:00:00Z`)) / 86_400_000
    // A voyage from months ago is worse than no suggestion: accepting it out of habit
    // would silently bill this survey onto a voyage that closed long ago.
    if (!Number.isFinite(age) || age > SUGGEST_WITHIN_DAYS) return null
  }
  return hit
}

/** "from Initial, 11 Aug" — why this number is being offered, so the surveyor can tell
 *  at a glance whether it is the voyage they are on. */
export function describeSuggestion(r: RecentVoyage, formatDate: (d: string) => string): string {
  const parts = [r.job_stage ? `from ${r.job_stage}` : 'last used']
  if (r.scheduled_date) parts.push(formatDate(r.scheduled_date))
  return parts.join(', ')
}

/** The value the suggestion would store if accepted. */
export function suggestedValue(r: RecentVoyage | null): string {
  return r ? (normaliseVoyage(r.voyage_number) ?? '') : ''
}
