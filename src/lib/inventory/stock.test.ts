import { describe, it, expect } from 'vitest'
import { stockLevel, reorderShortfall, soonestExpiry, totalUnits, unitsAt, byUrgency } from './stock'
import type { ItemWithStock, StockRow } from './types'

const row = (location_id: string, qty_units: number, expiry_date: string | null = null): StockRow =>
  ({ item_id: 'i1', location_id, qty_units, expiry_date })

describe('stockLevel', () => {
  it('treats sitting exactly ON the minimum as low — a minimum you have hit is hit', () => {
    expect(stockLevel(24, 24)).toBe('low')
    expect(stockLevel(25, 24)).toBe('ok')
    expect(stockLevel(23, 24)).toBe('low')
  })

  it('separates out (finished, normal) from negative (books are wrong)', () => {
    expect(stockLevel(0, 24)).toBe('out')
    expect(stockLevel(-6, 24)).toBe('negative')
  })

  it('flags a negative even when no threshold is set', () => {
    expect(stockLevel(-1, null)).toBe('negative')
    expect(stockLevel(0, null)).toBe('out')
  })

  it('reads a null minimum as "no alert wanted", not as a minimum of zero', () => {
    expect(stockLevel(1, null)).toBe('ok')
  })

  it('accepts the strings NUMERIC arrives as', () => {
    expect(stockLevel('24', '24')).toBe('low')
  })
})

describe('reorderShortfall', () => {
  it('orders up to the reorder quantity, not just back to the minimum', () => {
    expect(reorderShortfall(10, 24, 96)).toBe(86)
  })

  it('tops up to the minimum when no reorder quantity is set', () => {
    expect(reorderShortfall(10, 24, null)).toBe(14)
  })

  it('is zero above the minimum, and zero when no minimum is set', () => {
    expect(reorderShortfall(30, 24, 96)).toBe(0)
    expect(reorderShortfall(0, null, null)).toBe(0)
  })

  it('never returns a negative order', () => {
    expect(reorderShortfall(200, 24, 96)).toBe(0)
  })
})

describe('soonestExpiry', () => {
  it('picks the earliest date across locations', () => {
    expect(soonestExpiry([row('a', 10, '2027-03-01'), row('b', 5, '2026-09-04')])).toBe('2026-09-04')
  })

  it('ignores a date on a location that holds nothing — an empty shelf cannot expire', () => {
    expect(soonestExpiry([row('a', 10, '2027-03-01'), row('b', 0, '2026-01-01')])).toBe('2027-03-01')
  })

  it('is null when nothing carries a date', () => {
    expect(soonestExpiry([row('a', 10), row('b', 5)])).toBeNull()
  })
})

describe('totalUnits / unitsAt', () => {
  it('sums across locations and reads one out', () => {
    const rows = [row('main', 48), row('deco', 24)]
    expect(totalUnits(rows)).toBe(72)
    expect(unitsAt(rows, 'deco')).toBe(24)
  })

  it('reports zero for a location with no row at all', () => {
    expect(unitsAt([row('main', 48)], 'deco')).toBe(0)
  })
})

describe('byUrgency', () => {
  const item = (name: string, total_units: number, min_qty_units: number | null) =>
    ({ name, total_units, min_qty_units } as ItemWithStock)

  it('ranks negative before out before low before ok, then alphabetically', () => {
    const sorted = [
      item('Fine', 100, 10),
      item('Low', 5, 10),
      item('Out', 0, 10),
      item('Negative', -2, 10),
    ].sort(byUrgency).map(i => i.name)
    expect(sorted).toEqual(['Negative', 'Out', 'Low', 'Fine'])
  })

  it('falls back to name within the same level', () => {
    const sorted = [item('Zinc', 0, 10), item('Acid', 0, 10)].sort(byUrgency).map(i => i.name)
    expect(sorted).toEqual(['Acid', 'Zinc'])
  })
})
