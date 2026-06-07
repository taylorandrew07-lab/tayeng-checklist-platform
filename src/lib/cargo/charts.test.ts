import { describe, it, expect } from 'vitest'
import { buildChartModel, layoutChart, holdColor } from './charts'
import { setReadingValue, type ReadingType, type Voyage, type Period } from './types'

const rt: ReadingType = {
  id: 'rt_o2', name: 'Oxygen', unit: '%', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'main', name: '' }],
}
const PT = rt.points[0]

function baseVoyage(holdCount = 2, readingTypes: ReadingType[] = [rt]): Voyage {
  return {
    id: 'v1', userId: 'u1', vesselName: 'Test', voyageNumber: 'V1', cargoType: '',
    loadingPort: '', dischargePort: '', startDate: '2026-06-07', endDate: '2026-06-08',
    holdCount, surveyorName: 'S', readingTypes, readings: {}, periodMeta: {},
    createdAt: 0, updatedAt: 0,
  }
}

/** Set a value via the public helper so the test uses the real nested shape. */
function withValue(v: Voyage, date: string, period: Period, hold: number, rtId: string, ptId: string, val: string): Voyage {
  return setReadingValue(v, date, period, hold, rtId, ptId, val)
}

describe('buildChartModel', () => {
  it('builds one series per applicable hold across the date×period timeline', () => {
    let v = baseVoyage()
    v = withValue(v, '2026-06-07', '0600', 1, rt.id, PT.id, '20.9')
    v = withValue(v, '2026-06-07', '0600', 2, rt.id, PT.id, '20.5')
    const m = buildChartModel(v, rt, PT)
    expect(m.timepoints).toHaveLength(6) // 2 days × 3 periods
    expect(m.series).toHaveLength(2)
    expect(m.series[0].values[0]).toBe(20.9)
    expect(m.hasData).toBe(true)
  })

  it('marks missing/blank readings as null gaps', () => {
    const m = buildChartModel(baseVoyage(), rt, PT)
    expect(m.series[0].values.every(x => x === null)).toBe(true)
    expect(m.hasData).toBe(false)
  })

  it('respects a reading type that applies to specific holds', () => {
    const limited: ReadingType = { ...rt, appliesTo: [2] }
    let v = baseVoyage(2, [limited])
    v = withValue(v, '2026-06-07', '0600', 2, limited.id, PT.id, '5')
    const m = buildChartModel(v, limited, limited.points[0], { holds: 'all' })
    expect(m.series.map(s => s.hold)).toEqual([2])
  })

  it('respects period and date-range filters', () => {
    const m = buildChartModel(baseVoyage(), rt, PT, { periods: ['0600'], dateRange: ['2026-06-07', '2026-06-07'] })
    expect(m.timepoints).toEqual([{ dateISO: '2026-06-07', period: '0600' }])
  })

  it('charts a specific point of a multi-point type', () => {
    const tc: ReadingType = { ...rt, id: 'rt_tc', name: 'TC', points: [{ id: 'tc1', name: 'TC 1' }, { id: 'tc2', name: 'TC 2' }] }
    let v = baseVoyage(1, [tc])
    v = withValue(v, '2026-06-07', '0600', 1, tc.id, 'tc1', '30')
    v = withValue(v, '2026-06-07', '0600', 1, tc.id, 'tc2', '99')
    const m = buildChartModel(v, tc, tc.points[0]) // TC 1 only
    expect(m.series[0].values[0]).toBe(30)
  })

  it('pads a flat line and defaults an empty range to 0..1', () => {
    let flat = baseVoyage(1)
    flat = withValue(flat, '2026-06-07', '0600', 1, rt.id, PT.id, '10')
    const fm = buildChartModel(flat, rt, PT)
    expect(fm.yMin).toBeLessThan(10)
    expect(fm.yMax).toBeGreaterThan(10)

    const empty = buildChartModel(baseVoyage(), rt, PT)
    expect(empty.yMin).toBe(0)
    expect(empty.yMax).toBe(1)
  })
})

describe('layoutChart', () => {
  it('breaks the line into segments around null gaps and stays in-canvas', () => {
    let v = baseVoyage(1)
    v = withValue(v, '2026-06-07', '0600', 1, rt.id, PT.id, '1')
    v = withValue(v, '2026-06-07', '1800', 1, rt.id, PT.id, '3')
    v = withValue(v, '2026-06-08', '1200', 1, rt.id, PT.id, '5')
    const m = buildChartModel(v, rt, PT)
    const L = layoutChart(m, 500, 200)
    const hold1 = L.series.find(s => s.hold === 1)!
    expect(hold1.segments.length).toBe(3) // three values separated by nulls
    for (const seg of hold1.segments) for (const p of seg) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(500)
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(200)
    }
  })

  it('produces 5 y ticks and at most 6 x labels', () => {
    let v = baseVoyage(1)
    v = withValue(v, '2026-06-07', '0600', 1, rt.id, PT.id, '1')
    const L = layoutChart(buildChartModel(v, rt, PT), 500, 200)
    expect(L.yTicks).toHaveLength(5)
    expect(L.xTicks.length).toBeLessThanOrEqual(6)
  })
})

describe('holdColor', () => {
  it('is stable and cycles past the palette length', () => {
    expect(holdColor(1)).toBe(holdColor(11))
    expect(holdColor(1)).not.toBe(holdColor(2))
  })
})
