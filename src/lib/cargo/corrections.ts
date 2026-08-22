// Super-admin corrections, merged over a voyage at READ time.
//
// Cargo sync is push-only: pushVoyage() upserts the WHOLE document with no merge
// and no revision check, and the surveyor's device pushes on a 60-second loop
// after merely opening the voyage. So a correction written into cargo_voyages.doc
// is destroyed silently, usually within the minute.
//
// Corrections therefore live in cargo_voyage_corrections (mig 195) — a table
// pushVoyage never names — and are applied on top of the document every time it
// is read. The surveyor keeps sole ownership of the document; the super admin
// owns the patch; the two never write the same storage, so there is no conflict
// to resolve and nothing on the surveyor's device has to change.
//
// Everything here is PURE and must stay that way: it runs over a voyage the
// workspace may be holding in React state, and mutating that object would put a
// change the surveyor never made in front of his next sync.

import type { Voyage } from './types'

/** Fields the super admin may correct. Everything here is either identity,
 *  editorial prose, or the recorded observations themselves — see the notes on
 *  the two deliberate exclusions below. */
export const CORRECTABLE_FIELDS = [
  'vesselName', 'vesselType', 'voyageNumber', 'cargoType',
  'loadingPort', 'dischargePort', 'surveyorName', 'clientName',
  'remarks', 'observations',
  'startDate', 'endDate', 'holdCount',
] as const
export type CorrectableField = typeof CORRECTABLE_FIELDS[number]

// NOT correctable, and not by oversight:
//
//   clientId — pushed to cargo_voyages.client_id, and that COLUMN is what RLS
//     uses to decide which client may read the voyage. A patch cannot change an
//     access decision, so correcting it here would show the new client in the
//     app while the old one kept the access. That split is worse than not
//     offering it. Re-point a voyage with setVoyageJob / the client field on the
//     surveyor's device.
//   status — likewise a pushed column, and finalising is the surveyor's act.

export interface CorrectionEntry {
  /** Always stored as a string; coerced back on apply for numeric fields. */
  value: string
  /** What the document said when the correction was made — used to notice that
   *  the surveyor has since changed it himself. */
  from: string
  at: string
  by: string
  byName?: string
}

export interface CorrectionLogEntry {
  at: string; by: string; byName?: string
  field: string; from: string; to: string
}

export interface CorrectionPatch {
  fields?: Partial<Record<CorrectableField, CorrectionEntry>>
  /** Keyed by readingKey(): date|period|hold|typeId|pointId */
  readings?: Record<string, CorrectionEntry>
}

/** The address of one reading inside the nested readings map. */
export function readingKey(
  dateISO: string, period: string, hold: number | string, typeId: string, pointId: string
): string {
  return `${dateISO}|${period}|${hold}|${typeId}|${pointId}`
}

/** Split a reading key back into its parts. Returns null if it isn't one. */
export function parseReadingKey(key: string) {
  const p = key.split('|')
  if (p.length !== 5) return null
  return { dateISO: p[0], period: p[1], hold: p[2], typeId: p[3], pointId: p[4] }
}

const NUMERIC: CorrectableField[] = ['holdCount']

/**
 * The voyage as it should be READ — the surveyor's document with the super
 * admin's corrections laid over it.
 *
 * Pure: returns a new object and never touches the input. Only the branches that
 * actually have corrections are cloned, so an uncorrected voyage costs nothing.
 */
export function applyCorrections(voyage: Voyage, patch: CorrectionPatch | null | undefined): Voyage {
  if (!patch) return voyage
  const fields = patch.fields ?? {}
  const readings = patch.readings ?? {}
  if (Object.keys(fields).length === 0 && Object.keys(readings).length === 0) return voyage

  const out: Voyage = { ...voyage }

  for (const [k, entry] of Object.entries(fields)) {
    const field = k as CorrectableField
    if (!CORRECTABLE_FIELDS.includes(field) || !entry) continue
    if (NUMERIC.includes(field)) {
      const n = Number(entry.value)
      if (Number.isFinite(n)) (out as unknown as Record<string, unknown>)[field] = n
    } else {
      (out as unknown as Record<string, unknown>)[field] = entry.value
    }
  }

  const readingKeys = Object.keys(readings)
  if (readingKeys.length) {
    // Clone only the path down to each corrected value — the readings map is
    // five levels deep and a whole-tree clone on every read would be wasteful.
    const next: Voyage['readings'] = { ...(voyage.readings ?? {}) }
    for (const key of readingKeys) {
      const at = parseReadingKey(key)
      if (!at) continue
      const { dateISO, period, hold, typeId, pointId } = at
      const byDate = { ...(next[dateISO] ?? {}) }
      const byPeriod = { ...(byDate[period] ?? {}) }
      const byHold = { ...(byPeriod[hold] ?? {}) }
      const byType = { ...(byHold[typeId] ?? {}) }
      byType[pointId] = readings[key].value
      byHold[typeId] = byType
      byPeriod[hold] = byHold
      byDate[period] = byPeriod
      next[dateISO] = byDate
    }
    out.readings = next
  }

  return out
}

/** The value the document itself currently holds for a correctable field. */
export function docValue(voyage: Voyage, field: CorrectableField): string {
  const v = (voyage as unknown as Record<string, unknown>)[field]
  return v == null ? '' : String(v)
}

/**
 * Corrections the surveyor has since overtaken — where the document no longer
 * says what it said when the correction was made.
 *
 * Never resolved automatically in either direction: silently dropping a
 * correction, or silently keeping one over a value the surveyor has deliberately
 * changed, are the same class of bug. This only surfaces it for a human.
 */
export function staleCorrections(voyage: Voyage, patch: CorrectionPatch | null | undefined): CorrectableField[] {
  const fields = patch?.fields ?? {}
  return (Object.keys(fields) as CorrectableField[])
    .filter(f => CORRECTABLE_FIELDS.includes(f) && fields[f]!.from !== docValue(voyage, f))
}

/** Overlay corrected identity onto a LIST row, which reads columns rather than
 *  the document. Without this a corrected vessel name would be right on the
 *  voyage page and wrong in every list that links to it. */
export function correctRow<T extends { vessel_name?: string | null; voyage_number?: string | null }>(
  row: T, patch: CorrectionPatch | null | undefined
): T {
  const f = patch?.fields
  if (!f) return row
  const out = { ...row }
  if (f.vesselName) out.vessel_name = f.vesselName.value
  if (f.voyageNumber) out.voyage_number = f.voyageNumber.value
  return out
}
