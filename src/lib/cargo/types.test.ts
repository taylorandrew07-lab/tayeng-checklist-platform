import { describe, it, expect } from 'vitest'
import {
  cloneReadingTypes, readingTypeAppliesToHold, defaultReadingTypes, isSinglePoint,
  getReadingValue, setReadingValue, normalizeVoyage, type ReadingType, type Voyage,
} from './types'

const rt = (over: Partial<ReadingType> = {}): ReadingType => ({
  id: 'rt_1', name: 'O2', unit: '%', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'main', name: '' }], ...over,
})

function makeVoyage(over: Partial<Voyage> = {}): Voyage {
  return {
    id: 'v1', userId: 'u1', vesselName: 'T', voyageNumber: 'V1', cargoType: '',
    loadingPort: '', dischargePort: '', startDate: '2026-06-07', endDate: '2026-06-07',
    holdCount: 2, surveyorName: 'S', readingTypes: [rt()], readings: {}, periodMeta: {},
    createdAt: 0, updatedAt: 0, ...over,
  }
}

describe('cloneReadingTypes', () => {
  it('deep-copies appliesTo and points so the source is never mutated', () => {
    const source = [rt({ appliesTo: [1, 2], points: [{ id: 'a', name: 'TC 1', group: 'BTM' }] })]
    const clone = cloneReadingTypes(source)
    expect(clone[0]).not.toBe(source[0])
    expect(clone[0].points).not.toBe(source[0].points)
    expect(clone[0].points[0]).not.toBe(source[0].points[0])
    ;(clone[0].appliesTo as number[]).push(9)
    clone[0].points[0].name = 'changed'
    expect(source[0].appliesTo).toEqual([1, 2])
    expect(source[0].points[0].name).toBe('TC 1')
  })

  it('deep-copies the default reading set (incl. the 9 camera zones)', () => {
    const defaults = defaultReadingTypes()
    const camera = defaults.find(d => d.id === 'rt_ir_camera')!
    expect(camera.points).toHaveLength(9)
    const clone = cloneReadingTypes(defaults)
    expect(clone.find(d => d.id === 'rt_ir_camera')!.points).not.toBe(camera.points)
  })
})

describe('isSinglePoint', () => {
  it('is true only for one unnamed point', () => {
    expect(isSinglePoint(rt())).toBe(true)
    expect(isSinglePoint(rt({ points: [{ id: 'a', name: 'TC 1' }] }))).toBe(false)
    expect(isSinglePoint(rt({ points: [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }] }))).toBe(false)
  })
})

describe('getReadingValue / setReadingValue', () => {
  it('round-trips a value through the nested map without disturbing siblings', () => {
    let v = makeVoyage()
    v = setReadingValue(v, '2026-06-07', '0600', 1, 'rt_1', 'main', '20.9')
    v = setReadingValue(v, '2026-06-07', '0600', 2, 'rt_1', 'main', '20.5')
    expect(getReadingValue(v, '2026-06-07', '0600', 1, 'rt_1', 'main')).toBe('20.9')
    expect(getReadingValue(v, '2026-06-07', '0600', 2, 'rt_1', 'main')).toBe('20.5')
    expect(getReadingValue(v, '2026-06-07', '1200', 1, 'rt_1', 'main')).toBe('')
  })
})

describe('readingTypeAppliesToHold', () => {
  it('handles all vs specific holds', () => {
    expect(readingTypeAppliesToHold(rt({ appliesTo: 'all' }), 7)).toBe(true)
    expect(readingTypeAppliesToHold(rt({ appliesTo: [1, 3] }), 2)).toBe(false)
  })
})

describe('normalizeVoyage', () => {
  it('migrates legacy single-value readings ([rtId]=string) to the point shape', () => {
    const legacy = makeVoyage({
      readingTypes: [{ ...rt(), points: [] as any }], // legacy type with no points
      // legacy readings: value stored directly under the reading type id
      readings: { '2026-06-07': { '0600': { '1': { rt_1: '20.9' as any } } } },
    })
    const v = normalizeVoyage(legacy)
    expect(v.readingTypes[0].points.length).toBeGreaterThanOrEqual(1)
    expect(getReadingValue(v, '2026-06-07', '0600', 1, 'rt_1', 'main')).toBe('20.9')
  })

  it('returns the same object when nothing needs migrating', () => {
    const v = makeVoyage()
    expect(normalizeVoyage(v)).toBe(v)
  })
})
