import { describe, it, expect } from 'vitest'
import { buildHoldSeries, buildPointSeries, layoutChart, seriesColor } from './charts'
import { setReadingValue, type ReadingType, type Voyage, type Period } from './types'

const o2: ReadingType = {
  id: 'rt_o2', name: 'Oxygen', unit: '%', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'main', name: '' }],
}
const tc: ReadingType = {
  id: 'rt_tc', name: 'Thermocouple', unit: '°C', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'tc1', name: 'TC 1', group: 'BTM' }, { id: 'tc2', name: 'TC 2', group: 'TOP' }],
}

function baseVoyage(holdCount = 2, readingTypes: ReadingType[] = [o2]): Voyage {
  return {
    id: 'v1', userId: 'u1', vesselName: 'Test', voyageNumber: 'V1', cargoType: '',
    loadingPort: '', dischargePort: '', startDate: '2026-06-07', endDate: '2026-06-08',
    holdCount, surveyorName: 'S', readingTypes, readings: {}, periodMeta: {}, createdAt: 0, updatedAt: 0,
  }
}
function withValue(v: Voyage, date: string, period: Period, hold: number, rtId: string, ptId: string, val: string): Voyage {
  return setReadingValue(v, date, period, hold, rtId, ptId, val)
}

describe('buildHoldSeries (single-value → line per hold)', () => {
  it('builds one series per applicable hold across the timeline', () => {
    let v = baseVoyage()
    v = withValue(v, '2026-06-07', '0600', 1, o2.id, 'main', '20.9')
    v = withValue(v, '2026-06-07', '0600', 2, o2.id, 'main', '20.5')
    const m = buildHoldSeries(v, o2, o2.points[0])
    expect(m.timepoints).toHaveLength(6)
    expect(m.series.map(s => s.label)).toEqual(['Hold 1', 'Hold 2'])
    expect(m.series[0].values[0]).toBe(20.9)
    expect(m.hasData).toBe(true)
  })

  it('honours the holds filter', () => {
    let v = baseVoyage()
    v = withValue(v, '2026-06-07', '0600', 2, o2.id, 'main', '5')
    const m = buildHoldSeries(v, o2, o2.points[0], { holds: [2] })
    expect(m.series.map(s => s.label)).toEqual(['Hold 2'])
  })

  it('flags no data and defaults the range to 0..1', () => {
    const m = buildHoldSeries(baseVoyage(), o2, o2.points[0])
    expect(m.hasData).toBe(false)
    expect(m.yMin).toBe(0); expect(m.yMax).toBe(1)
  })
})

describe('buildPointSeries (multi-point → line per point for a hold)', () => {
  it('plots every point of the type by default (All)', () => {
    let v = baseVoyage(2, [tc])
    v = withValue(v, '2026-06-07', '0600', 1, tc.id, 'tc1', '30')
    v = withValue(v, '2026-06-07', '0600', 1, tc.id, 'tc2', '40')
    const m = buildPointSeries(v, tc, 1, 'all')
    expect(m.subtitle).toBe('Hold 1')
    expect(m.series.map(s => s.label)).toEqual(['BTM · TC 1', 'TOP · TC 2'])
    expect(m.series[0].values[0]).toBe(30)
    expect(m.series[1].values[0]).toBe(40)
  })

  it('restricts to selected points', () => {
    let v = baseVoyage(1, [tc])
    v = withValue(v, '2026-06-07', '0600', 1, tc.id, 'tc2', '99')
    const m = buildPointSeries(v, tc, 1, ['tc2'])
    expect(m.series.map(s => s.key)).toEqual(['tc2'])
    expect(m.series[0].values[0]).toBe(99)
  })

  it('reads from the selected hold only', () => {
    let v = baseVoyage(2, [tc])
    v = withValue(v, '2026-06-07', '0600', 2, tc.id, 'tc1', '7')
    const h1 = buildPointSeries(v, tc, 1, 'all')
    const h2 = buildPointSeries(v, tc, 2, 'all')
    expect(h1.hasData).toBe(false)
    expect(h2.series[0].values[0]).toBe(7)
  })
})

describe('layoutChart', () => {
  it('breaks each series into segments around null gaps, in-canvas', () => {
    let v = baseVoyage(1)
    v = withValue(v, '2026-06-07', '0600', 1, o2.id, 'main', '1')
    v = withValue(v, '2026-06-07', '1800', 1, o2.id, 'main', '3')
    v = withValue(v, '2026-06-08', '1200', 1, o2.id, 'main', '5')
    const L = layoutChart(buildHoldSeries(v, o2, o2.points[0]), 500, 200)
    const s = L.series[0]
    expect(s.segments.length).toBe(3)
    for (const seg of s.segments) for (const p of seg) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(500)
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(200)
    }
  })
})

describe('seriesColor', () => {
  it('cycles past the palette length and is distinct for neighbours', () => {
    expect(seriesColor(0)).not.toBe(seriesColor(1))
    expect(seriesColor(0)).toBe(seriesColor(16))
  })
})
