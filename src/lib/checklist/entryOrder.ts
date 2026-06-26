// Display order for repeatable-section entries.
//
// A repeatable section stores one row per (job_id, field_id, instance); the
// `instance` is a STABLE id. The ORDER those entries are shown/printed is tracked
// separately (jobs.repeatable_order, migration 106) so an entry can be inserted
// between others or drag-reordered WITHOUT renumbering or moving any saved data —
// only this list of ids changes. Absent order ⇒ natural ascending instance order,
// i.e. exactly the legacy behaviour, so existing jobs/reports are unchanged.

import { parseInstanceKey } from '@/lib/offline/instanceKeys'

/** Instance ids that actually carry data, across composite-keyed maps, for the
 *  given section field ids. Empty strings / empty arrays don't count (a blank
 *  entry isn't persisted, so it shouldn't keep an id alive across a reload). */
export function presentInstances(fieldIds: Iterable<string>, maps: Array<Record<string, unknown>>): Set<number> {
  const ids = new Set<string>(fieldIds)
  const present = new Set<number>()
  for (const map of maps) {
    for (const k of Object.keys(map)) {
      const v = map[k]
      const empty = v == null || (typeof v === 'string' && v === '') || (Array.isArray(v) && v.length === 0)
      if (empty) continue
      const { fieldId, instance } = parseInstanceKey(k)
      if (ids.has(fieldId)) present.add(instance)
    }
  }
  return present
}

/** Resolve a section's display order from its present instance ids and an optional
 *  stored order:
 *   - keep the stored order, dropping ids that no longer have data,
 *   - append any present-but-unordered ids ascending (drift safety),
 *   - guarantee at least one entry (id 0) for a brand-new/empty section.
 *  Pure + deterministic; unit-tested. */
export function resolveEntryOrder(present: Set<number>, stored?: number[] | null): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const id of stored ?? []) {
    if (present.has(id) && !seen.has(id)) { out.push(id); seen.add(id) }
  }
  for (const id of [...present].sort((a, b) => a - b)) {
    if (!seen.has(id)) { out.push(id); seen.add(id) }
  }
  return out.length ? out : [0]
}

/** Resolve a repeatable section's entry order straight from the data the editor and
 *  report have on hand — the composite-keyed maps PLUS the photo rows (which carry
 *  their own `instance`). Single source of truth so the editor and PDF never diverge. */
export function resolveEntryOrderFromData(
  fieldIds: string[],
  maps: Array<Record<string, unknown>>,
  photos: Array<{ field_id: string | null; instance: number }>,
  stored?: number[] | null,
): number[] {
  const present = presentInstances(fieldIds, maps)
  const ids = new Set(fieldIds)
  for (const p of photos) if (p.field_id && ids.has(p.field_id)) present.add(p.instance)
  return resolveEntryOrder(present, stored)
}

/** Next free (never-reused) instance id for a section, given its current order. */
export function nextInstanceId(order: number[]): number {
  return order.length ? Math.max(...order) + 1 : 0
}

/** Move the entry at `from` to `to` (clamped), returning a new array. */
export function moveEntry(order: number[], from: number, to: number): number[] {
  const next = order.slice()
  if (from < 0 || from >= next.length) return next
  const clamped = Math.max(0, Math.min(to, next.length - 1))
  const [id] = next.splice(from, 1)
  next.splice(clamped, 0, id)
  return next
}
