// Stock-level evaluation. PURE — unit-tested in stock.test.ts.
//
// One place decides what "low" means, so the item list, the low-stock panel and
// the surveyor attention card can never disagree about which items are a problem.

import { num } from './packs'
import type { ItemWithStock, StockRow } from './types'

/**
 * 'negative' — the recorded count is below zero, so the books are provably wrong
 *              and someone needs to recount. Ranks above 'out': an item that is
 *              merely finished is normal; one at −6 is a data fault.
 * 'out'      — exactly zero.
 * 'low'      — at or below the reorder threshold. AT the threshold counts as low;
 *              a minimum you are sitting exactly on is a minimum you have hit.
 * 'ok'       — everything else, including every item with no threshold set.
 */
export type StockLevel = 'negative' | 'out' | 'low' | 'ok'

const RANK: Record<StockLevel, number> = { negative: 0, out: 1, low: 2, ok: 3 }

export function stockLevel(totalUnits: number | string, minUnits: number | string | null): StockLevel {
  const total = num(totalUnits)
  if (total < 0) return 'negative'
  if (total === 0) return 'out'
  // null means "no alert wanted for this item" — not "a minimum of zero".
  if (minUnits === null || minUnits === undefined) return 'ok'
  return total <= num(minUnits) ? 'low' : 'ok'
}

export function needsAttention(level: StockLevel): boolean {
  return level !== 'ok'
}

export function totalUnits(rows: StockRow[]): number {
  return rows.reduce((sum, r) => sum + num(r.qty_units), 0)
}

export function unitsAt(rows: StockRow[], locationId: string): number {
  return num(rows.find(r => r.location_id === locationId)?.qty_units)
}

/** Earliest expiry across an item's locations — the one worth badging. */
export function soonestExpiry(rows: StockRow[]): string | null {
  const dates = rows
    .filter(r => r.expiry_date && num(r.qty_units) > 0)
    .map(r => r.expiry_date as string)
    .sort()
  return dates[0] ?? null
}

/**
 * How many base units to buy to get back to a healthy level. Uses the reorder
 * quantity when one is set (order a sensible batch, not the bare minimum), else
 * tops back up to the threshold. 0 when there is nothing to do.
 */
export function reorderShortfall(
  totalUnits: number | string,
  minUnits: number | string | null,
  reorderUnits: number | string | null,
): number {
  if (minUnits === null || minUnits === undefined) return 0
  const total = num(totalUnits)
  const min = num(minUnits)
  if (total > min) return 0
  const target = reorderUnits === null || reorderUnits === undefined ? min : num(reorderUnits)
  return Math.max(0, target - total)
}

export function groupStockByItem(rows: StockRow[]): Map<string, StockRow[]> {
  const out = new Map<string, StockRow[]>()
  for (const r of rows) {
    const list = out.get(r.item_id)
    if (list) list.push(r)
    else out.set(r.item_id, [r])
  }
  return out
}

/** Sort for the low-stock board: worst first, then alphabetical. */
export function byUrgency(a: ItemWithStock, b: ItemWithStock): number {
  const ra = RANK[stockLevel(a.total_units, a.min_qty_units)]
  const rb = RANK[stockLevel(b.total_units, b.min_qty_units)]
  return ra !== rb ? ra - rb : a.name.localeCompare(b.name)
}
