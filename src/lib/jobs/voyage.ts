// Draught-survey voyages — the ONE place that decides which surveys belong together.
//
// A draught survey is not one job, it is a sequence on one vessel voyage:
//   Initial (no report) → Interim* (zero, one or many, no report) → exactly one Final.
// Each leg is its own job, so each used to become its own invoice line and the client
// saw three charges for one voyage. The Final carries the report AND the whole bill;
// the earlier legs are absorbed into it.
//
// Imported by the invoice pool, the invoice builder AND reconciliation. Do not
// re-derive any of this locally: if the builder and the reconcile tool disagree about
// what a voyage is, the disagreement shows up as permanent false alarms that no one can
// clear, and as surveys that are quietly billed twice or not at all.
//
// DATES. This is a fourth family of date logic that must NOT go through
// jobLastDateKey (see the header of jobDate.ts): grouping needs BOTH bounds, like the
// double-booking windows in conflicts.ts. It also deliberately refuses created_at as a
// fallback — an admin entering ten backlogged jobs in one sitting stamps them all with
// the same created_at, which would fuse ten unrelated voyages across several vessels
// into a single suggestion.
//
// Pure: no supabase, no React. The data companion is fetchVoyageContext in
// lib/jobs/voyageContext.ts, which is the deliberately UNFILTERED query.

import { dayKey } from '@/lib/utils'

/** The job type this whole module is scoped to. Nothing else groups. */
export const DRAUGHT_SURVEY = 'Draught Survey'

/** The stages of a draught survey, in the order they happen. Mirrors STAGE_OPTIONS in
 *  newJobConfig.ts; reportPolicy.test.ts pins the two together. */
export const DRAUGHT_STAGES = ['Initial', 'Interim', 'Final'] as const
export type DraughtStage = (typeof DRAUGHT_STAGES)[number]

const STAGE_RANK: Record<DraughtStage, number> = { Initial: 0, Interim: 1, Final: 2 }

/**
 * How far apart two legs of the same voyage can sit, and how long a whole voyage can
 * run, before date proximity stops being evidence.
 *
 * These only ever affect SUGGESTIONS — a group built from an actual voyage number
 * ignores both. Tune them against a real gap distribution before trusting them further;
 * they are exported so a test (and a future settings row) can reason about them.
 */
export const VOYAGE_GAP_DAYS = 14
export const VOYAGE_SPAN_DAYS = 45

/** The job shape grouping needs. Deliberately narrow so every caller — the invoice
 *  pool, the builder, reconciliation — can satisfy it from its own select. */
export interface VoyageJob {
  id: string
  job_type: string | null
  job_stage: string | null
  vessel_id?: string | null
  vessel_name: string | null
  client_id: string | null
  voyage_number?: string | null
  scheduled_date: string | null
  end_date?: string | null
}

/** Why a group cannot be billed as one voyage as it stands. */
export type VoyageProblem = 'no_final' | 'multiple_finals'

export interface VoyageGroup<J extends VoyageJob = VoyageJob> {
  /** Stable identity for React keys, snoozing and grouped counts. */
  key: string
  /** 'confident' — every member carries the same voyage number, so the grouping is a
   *  fact. 'suggested' — inferred from vessel + date proximity, so it is a proposal and
   *  must never bill without the admin confirming it. */
  confidence: 'confident' | 'suggested'
  vesselKey: string
  vesselName: string | null
  clientId: string | null
  /** The canonical voyage number, or null for a date-proximity group. */
  voyage: string | null
  /** Initial → Interim(s) → Final, then by date. */
  members: J[]
  final: J | null
  problems: VoyageProblem[]
}

// ── Identity ────────────────────────────────────────────────────────────────

/** The hard scope gate. A job that fails this is never grouped and always bills
 *  exactly as it does today — that is what keeps every other job type untouched.
 *  A draught survey with a missing or unrecognised stage deliberately fails too:
 *  guessing which leg it is would be guessing what to charge. */
export function isDraughtStageJob(j: Pick<VoyageJob, 'job_type' | 'job_stage'>): boolean {
  return j.job_type === DRAUGHT_SURVEY && DRAUGHT_STAGES.includes(j.job_stage as DraughtStage)
}

export function draughtStage(j: Pick<VoyageJob, 'job_stage'>): DraughtStage | null {
  return DRAUGHT_STAGES.includes(j.job_stage as DraughtStage) ? (j.job_stage as DraughtStage) : null
}

/**
 * The voyage number as it should be STORED: canonical 'V-###' when the input can be
 * read as one, otherwise the trimmed input exactly as typed.
 *
 * Deliberately lenient. This field is entered dockside, offline, on a phone; refusing
 * to save a job because a voyage reference is oddly shaped is a worse failure than
 * storing an odd shape. (The cargo module's own voyage numbers look like 'V-2026-014',
 * so a hard format lock would also fight existing data.)
 *
 * Mirrors public.normalise_voyage in migration 186 for the values that function
 * accepts. Note the zero-padding is guarded on length: SQL's lpad TRUNCATES a longer
 * string, so an unguarded pad would silently renumber every voyage above 999.
 */
export function normaliseVoyage(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^(?:V(?:OYAGE|OY)?)?[-._\s]?0*(\d+)$/i.exec(trimmed)
  if (!m) return trimmed
  const digits = m[1]
  return `V-${digits.length >= 3 ? digits : digits.padStart(3, '0')}`
}

/**
 * The GROUPING key for a voyage number — case, padding and punctuation insensitive, so
 * a legacy 'V086' and a freshly typed 'V-086' are the same voyage without having to
 * rewrite every historic row first.
 */
export function voyageKey(raw: string | null | undefined): string | null {
  const canonical = normaliseVoyage(raw)
  if (!canonical) return null
  const key = canonical.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key || null
}

/** Which hull this job is on. vessel_id when it exists; the name is the fallback
 *  because a job created offline has no vessel_id until it syncs. */
export function vesselKey(j: Pick<VoyageJob, 'vessel_id' | 'vessel_name'>): string {
  return j.vessel_id || (j.vessel_name ?? '').trim().toLowerCase()
}

// ── Dates ───────────────────────────────────────────────────────────────────

function startKey(j: VoyageJob): string | null { return dayKey(j.scheduled_date) || null }
function endKey(j: VoyageJob): string | null {
  const start = startKey(j)
  if (!start) return null
  const end = dayKey(j.end_date) || start
  // Bad data (an end before the start) collapses to a single day rather than producing
  // a negative window that would make everything look adjacent.
  return end < start ? start : end
}

function daysBetween(aKey: string, bKey: string): number {
  const ms = Date.parse(`${bKey}T00:00:00Z`) - Date.parse(`${aKey}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : Number.POSITIVE_INFINITY
}

/** Gap between two jobs measured between RANGES — end of the earlier to start of the
 *  later. Overlapping jobs return 0: two surveys running over the same days are strong
 *  evidence of one voyage, not weak evidence of two. */
export function gapDays(earlier: VoyageJob, later: VoyageJob): number {
  const e = endKey(earlier), s = startKey(later)
  if (!e || !s) return Number.POSITIVE_INFINITY
  return Math.max(0, daysBetween(e, s))
}

// ── Grouping ────────────────────────────────────────────────────────────────

function orderMembers<J extends VoyageJob>(members: J[]): J[] {
  return [...members].sort((a, b) => {
    const ra = STAGE_RANK[draughtStage(a) as DraughtStage] ?? 99
    const rb = STAGE_RANK[draughtStage(b) as DraughtStage] ?? 99
    if (ra !== rb) return ra - rb
    const ka = startKey(a) ?? '', kb = startKey(b) ?? ''
    if (ka !== kb) return ka < kb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function buildGroup<J extends VoyageJob>(
  members: J[], confidence: 'confident' | 'suggested', voyage: string | null, key: string,
): VoyageGroup<J> {
  const ordered = orderMembers(members)
  const finals = ordered.filter(m => draughtStage(m) === 'Final')
  const problems: VoyageProblem[] = []
  if (finals.length === 0) problems.push('no_final')
  if (finals.length > 1) problems.push('multiple_finals')
  const head = ordered[0]
  return {
    key,
    // Two Finals is a data error, not a voyage — never let it bill on its own say-so,
    // even when every member agrees on the voyage number.
    confidence: finals.length > 1 ? 'suggested' : confidence,
    vesselKey: vesselKey(head),
    vesselName: head.vessel_name,
    clientId: head.client_id ?? null,
    voyage,
    members: ordered,
    final: finals.length === 1 ? finals[0] : null,
    problems,
  }
}

/**
 * Chain the legs of one vessel+client that carry NO voyage number, by date proximity.
 *
 * A Final ends its chain — the next survey starts a new voyage. An Initial that turns
 * up mid-chain also ends the previous one, because a second Initial on the same hull
 * means the vessel is on its next voyage. Anything further apart than VOYAGE_GAP_DAYS,
 * or that would stretch the voyage past VOYAGE_SPAN_DAYS, starts a new chain.
 */
function chainByProximity<J extends VoyageJob>(jobs: J[]): J[][] {
  const dated = jobs.filter(j => startKey(j))
    .sort((a, b) => {
      const ka = startKey(a)!, kb = startKey(b)!
      if (ka !== kb) return ka < kb ? -1 : 1
      // Same day: keep the survey order, so an Initial never lands after its Final.
      const ra = STAGE_RANK[draughtStage(a) as DraughtStage] ?? 99
      const rb = STAGE_RANK[draughtStage(b) as DraughtStage] ?? 99
      return ra - rb
    })

  const chains: J[][] = []
  let current: J[] = []
  let chainStart: string | null = null

  const close = () => { if (current.length) chains.push(current); current = []; chainStart = null }

  for (const job of dated) {
    if (current.length === 0) {
      current = [job]; chainStart = startKey(job)
      if (draughtStage(job) === 'Final') close()
      continue
    }
    const prev = current[current.length - 1]
    const gap = gapDays(prev, job)
    const span = chainStart ? daysBetween(chainStart, endKey(job) ?? chainStart) : 0
    const startsNewVoyage = draughtStage(job) === 'Initial'
    if (startsNewVoyage || gap > VOYAGE_GAP_DAYS || span > VOYAGE_SPAN_DAYS) {
      close()
      current = [job]; chainStart = startKey(job)
      if (draughtStage(job) === 'Final') close()
      continue
    }
    current.push(job)
    if (draughtStage(job) === 'Final') close()
  }
  close()
  return chains
}

/**
 * Group draught surveys into voyages.
 *
 * Two passes, in order of trust:
 *   A. Same vessel, same client, same voyage number → CONFIDENT. This is a recorded
 *      fact, not an inference.
 *   B. Same vessel, same client, no voyage number, close together in time → SUGGESTED.
 *      Never bills without the admin confirming it.
 *
 * Never groups across vessels, and never across clients: two different payers cannot
 * share one line, so a chain that would cross a client boundary is two chains.
 *
 * Every non-draught job, and every draught survey with no recognisable stage, is
 * returned as its own singleton group with confidence 'confident' and no final — the
 * caller bills those exactly as it always has.
 */
export function groupDraughtVoyages<J extends VoyageJob>(jobs: J[]): VoyageGroup<J>[] {
  const draught = jobs.filter(isDraughtStageJob)

  // Partition by hull AND payer.
  const buckets = new Map<string, J[]>()
  for (const j of draught) {
    const k = `${j.client_id ?? ''}|${vesselKey(j)}`
    const list = buckets.get(k)
    if (list) list.push(j); else buckets.set(k, [j])
  }

  const groups: VoyageGroup<J>[] = []
  for (const [bucketKey, members] of buckets) {
    const numbered = new Map<string, J[]>()
    const unnumbered: J[] = []
    for (const j of members) {
      const vk = voyageKey(j.voyage_number)
      if (vk) {
        const list = numbered.get(vk)
        if (list) list.push(j); else numbered.set(vk, [j])
      } else {
        unnumbered.push(j)
      }
    }

    for (const [vk, group] of numbered) {
      groups.push(buildGroup(group, 'confident', normaliseVoyage(group[0].voyage_number), `v:${bucketKey}:${vk}`))
    }
    // A single unnumbered survey is not a suggestion — there is nothing to group it
    // with. It stays a group of one so the caller can still see it is a draught leg.
    chainByProximity(unnumbered).forEach((chain, i) => {
      groups.push(buildGroup(chain, chain.length > 1 ? 'suggested' : 'confident', null, `d:${bucketKey}:${i}`))
    })
    // Undated, unnumbered surveys can join nothing. Surface them individually so the
    // reconcile tool can ask for a date or a voyage number rather than silently
    // dropping them out of every group.
    for (const j of unnumbered.filter(x => !startKey(x))) {
      groups.push(buildGroup([j], 'confident', null, `u:${j.id}`))
    }
  }
  return groups
}

/** True when this group actually collapses several jobs into one bill. A group of one
 *  is just an ordinary job and takes the untouched single-job path. */
export function isRollUp<J extends VoyageJob>(g: VoyageGroup<J>): boolean {
  return g.members.length > 1
}

/** Whether this group may be billed as one voyage without further input: it has exactly
 *  one Final and no structural problem. Confidence is a SEPARATE question — a suggested
 *  group is billable only once the admin confirms it, which is the caller's job. */
export function isBillableAsVoyage<J extends VoyageJob>(g: VoyageGroup<J>): boolean {
  return g.problems.length === 0 && g.final != null
}

/** Human explanation of why these jobs are together, for the group row. */
export function describeGrouping<J extends VoyageJob>(g: VoyageGroup<J>): string {
  if (g.voyage) return `Voyage ${g.voyage}`
  if (g.members.length === 1) return 'No voyage number'
  const first = g.members.reduce((a, b) => (startKey(a) ?? '') <= (startKey(b) ?? '') ? a : b)
  const last = g.members.reduce((a, b) => (endKey(a) ?? '') >= (endKey(b) ?? '') ? a : b)
  const from = startKey(first), to = endKey(last)
  const span = from && to ? daysBetween(from, to) : 0
  return `Same vessel, ${span === 0 ? 'same day' : `within ${span} day${span === 1 ? '' : 's'}`} — no voyage number`
}
