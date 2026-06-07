import { describe, it, expect } from 'vitest'
import { buildChartModel, layoutChart, holdColor } from './charts'
import { type Voyage, type ReadingType } from './types'

const rt: ReadingType = {
  id: 'rt_o2', name: 'Oxygen', unit: '%', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
}

function voyage(readings: Voyage['readings'], holdCount = 2): Voyage {
  return {
    id: 'v1', userId: 'u1', vesselName: 'Test', voyageNumber: 'V1', cargoType: '',
    loadingPort: '', dischargePort: '', startDate: '2026-06-07', endDate: '2026-06-08',
    holdCount, surveyorName: 'S', readingTypes: [rt], readings, periodMeta: {},
    createdAt: 0, updatedAt: 0,
  }
}

describe('buildChartModel', () => {
  it('builds one series per applicable hold across the date×period timeline', () => {
    const m = buildChartModel(voyage({
      '2026-06-07': { '0600': { '1': { rt_o2: '20.9' }, '2': { rt_o2: '20.5' } } },
    }), rt)
    // 2 days × 3 periods = 6 timepoints; 2 holds
    expect(m.timepoints).toHaveLength(6)
    expect(m.series).toHaveLength(2)
    expect(m.series[0].values[0]).toBe(20.9)
    expect(m.hasData).toBe(true)
  })

  it('marks missing/blank/non-numeric readings as null gaps', () => {
    const m = buildChartModel(voyage({
      '2026-06-07': { '0600': { '1': { rt_o2: '' }, '2': { rt_o2: 'n/a' } } },
    }), rt)
    expect(m.series[0].values[0]).toBeNull()
    expect(m.series[1].values[0]).toBeNull()
    expect(m.hasData).toBe(false)
  })

  it('respects the hold filter and a reading type that applies to specific holds', () => {
    const limited: ReadingType = { ...rt, appliesTo: [2] }
    const v = { ...voyage({ '2026-06-07': { '0600': { '2': { rt_o2: '5' } } } }), readingTypes: [limited] }
    const m = buildChartModel(v, limited, { holds: 'all' })
    expect(m.series.map(s => s.hold)).toEqual([2])
  })

  it('respects period and date-range filters', () => {
    const m = buildChartModel(voyage({}), rt, { periods: ['0600'], dateRange: ['2026-06-07', '2026-06-07'] })
    expect(m.timepoints).toEqual([{ dateISO: '2026-06-07', period: '0600' }])
  })

  it('pads a flat line and defaults an empty range to 0..1', () => {
    const flat = buildChartModel(voyage({
      '2026-06-07': { '0600': { '1': { rt_o2: '10' } } },
    }), rt)
    expect(flat.yMin).toBeLessThan(10)
    expect(flat.yMax).toBeGreaterThan(10)

    const empty = buildChartModel(voyage({}), rt)
    expect(empty.yMin).toBe(0)
    expect(empty.yMax).toBe(1)
  })
})

describe('layoutChart', () => {
  it('breaks the line into segments around null gaps', () => {
    const m = buildChartModel(voyage({
      '2026-06-07': { '0600': { '1': { rt_o2: '1' } }, '1800': { '1': { rt_o2: '3' } } },
      '2026-06-08': { '1200': { '1': { rt_o2: '5' } } },
    }, 1), rt)
    const L = layoutChart(m, 500, 200)
    const hold1 = L.series.find(s => s.hold === 1)!
    // timeline = [d1 0600(1), d1 1200(null), d1 1800(3), d2 0600(null), d2 1200(5), d2 1800(null)]
    // => three separate single/multi-point segments split by the nulls
    expect(hold1.segments.length).toBe(3)
    // coordinates stay within the canvas
    for (const seg of hold1.segments) for (const p of seg) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(500)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(200)
    }
  })

  it('produces 5 y ticks and at most 6 x labels', () => {
    const m = buildChartModel(voyage({ '2026-06-07': { '0600': { '1': { rt_o2: '1' } } } }, 1), rt)
    const L = layoutChart(m, 500, 200)
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
