import { describe, it, expect } from 'vitest'
import { readingRows } from './readingRows'
import type { ReadingType } from './types'

const multi = (id: string, name: string, points: { id: string; name: string; group?: string }[]): ReadingType => ({
  id, name, unit: '°C', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points,
})
// isSinglePoint() is `points.length === 1 && !points[0].name` — the lone channel
// of a single-value type is UNNAMED. A one-point type whose point has a name is
// deliberately still a multi-point type, and gets a title plus that one channel.
const single = (id: string, name: string, unit: string): ReadingType => ({
  id, name, unit, appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'main', name: '' }],
})

// The exact shape from the voyage that exposed the bug.
const TYPES = [
  multi('tc', 'Thermocouple temperature', [
    { id: 'p1', name: 'TC 1', group: 'BTM' },
    { id: 'p2', name: 'TC 2', group: 'LVL 2' },
  ]),
  multi('ir', 'Infrared gun', [
    { id: 'fwd', name: 'Fwd' }, { id: 'mid', name: 'Mid' }, { id: 'aft', name: 'Aft' },
  ]),
  single('o2', 'Oxygen', '%'),
  single('co', 'Carbon Monoxide', 'ppm'),
  single('h2', 'H₂ LEL', 'VOL%'),
]

describe('readingRows', () => {
  it('makes EVERY reading type a title at the same level', () => {
    const rows = readingRows(TYPES, 1)
    const titles = rows.filter(r => r.isTitle).map(r => r.label)
    // Oxygen / CO / H2 LEL are titles too — they name what is measured, even
    // though nothing sits beneath them. This is the whole point of the module.
    expect(titles).toEqual([
      'Thermocouple temperature', 'Infrared gun', 'Oxygen', 'Carbon Monoxide', 'H₂ LEL',
    ])
  })

  it('gives a single-channel type ONE row that is both title and values', () => {
    const rows = readingRows([single('o2', 'Oxygen', '%')], 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('title-value')
    expect(rows[0].isTitle).toBe(true)
    expect(rows[0].point).toBeTruthy()   // it carries readings
    expect(rows[0].tag).toBe('%')        // unit sits in the label column
  })

  it('gives a multi-channel type a value-less title followed by its channels', () => {
    const rows = readingRows([TYPES[1]], 1)
    expect(rows.map(r => [r.kind, r.label])).toEqual([
      ['title-only', 'Infrared gun'],
      ['point', 'Fwd'], ['point', 'Mid'], ['point', 'Aft'],
    ])
    expect(rows[0].point).toBeUndefined()          // the title holds no readings
    expect(rows.slice(1).every(r => !r.isTitle)).toBe(true)
  })

  it('starts a group on every type but the first, so the gap lands between blocks', () => {
    const rows = readingRows(TYPES, 1)
    expect(rows.filter(r => r.startsGroup).map(r => r.label)).toEqual([
      'Infrared gun', 'Oxygen', 'Carbon Monoxide', 'H₂ LEL',
    ])
    // Never above the first row — that would gap it off the hold band.
    expect(rows[0].startsGroup).toBe(false)
    // Never on a channel row.
    expect(rows.filter(r => r.kind === 'point').some(r => r.startsGroup)).toBe(false)
  })

  it('carries the point group as the tag, and keys rows per hold', () => {
    expect(readingRows(TYPES, 1).find(r => r.label === 'TC 2')?.tag).toBe('LVL 2')
    expect(readingRows(TYPES, 1)[0].key).not.toBe(readingRows(TYPES, 2)[0].key)
  })

  it('returns nothing for no types', () => {
    expect(readingRows([], 1)).toEqual([])
  })
})
