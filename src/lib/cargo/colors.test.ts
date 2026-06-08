import { describe, it, expect } from 'vitest'
import { evaluateCellColor, readingCellColor, defaultColorRules } from './colors'
import { setReadingValue, type Voyage, type ReadingType, type ColorRules } from './types'

const RULES: ColorRules = { amber: 60, red: 65, rateDeltaC: 10, gradient: true }
const RED = '#fee2e2', AMBER = '#fef9c3', GREEN = '#dcfce7'

describe('evaluateCellColor — absolute bands (solid)', () => {
  it('≥65 is solid red', () => {
    expect(evaluateCellColor(65, null, RULES).bg).toBe(RED)
    expect(evaluateCellColor(80, 79, RULES).bg).toBe(RED)
  })
  it('60–64.9 is solid amber', () => {
    expect(evaluateCellColor(60, null, RULES).bg).toBe(AMBER)
    expect(evaluateCellColor(64.9, null, RULES).bg).toBe(AMBER)
  })
  it('below 60 with no prior reading is green', () => {
    expect(evaluateCellColor(59.9, null, RULES).bg).toBe(GREEN)
  })
})

describe('evaluateCellColor — 24h rate of change', () => {
  it('a rise ≥10° turns amber even below 60', () => {
    expect(evaluateCellColor(45, 35, RULES).bg).toBe(AMBER) // +10
    expect(evaluateCellColor(50, 30, RULES).bg).toBe(AMBER) // +20
  })
  it('a smaller rise gradients between green and amber (not solid)', () => {
    const c = evaluateCellColor(42, 35, RULES).bg // +7 → 0.7 of the way
    expect(c).not.toBe(GREEN)
    expect(c).not.toBe(AMBER)
  })
  it('falling/steady temperatures stay green', () => {
    expect(evaluateCellColor(40, 45, RULES).bg).toBe(GREEN)
  })
  it('absolute red wins over rate', () => {
    expect(evaluateCellColor(66, 10, RULES).bg).toBe(RED)
  })
})

function voyage(): Voyage {
  return {
    id: 'v', userId: 'u', vesselName: 'T', voyageNumber: 'V', cargoType: '', loadingPort: '', dischargePort: '',
    startDate: '2026-06-07', endDate: '2026-06-09', holdCount: 1, surveyorName: 'S',
    readingTypes: [], readings: {}, periodMeta: {}, createdAt: 0, updatedAt: 0,
  }
}
const tc: ReadingType = {
  id: 'rt_tc', name: 'TC', unit: '°C', appliesTo: 'all', includeInTables: true, includeInCharts: false,
  includeInPdf: true, points: [{ id: 'tc1', name: 'TC 1' }], colorRules: RULES,
}

describe('readingCellColor', () => {
  it('returns null when colours are toggled off or no rules', () => {
    let v = { ...voyage(), readingTypes: [tc] }
    v = setReadingValue(v, '2026-06-08', '0600', 1, 'rt_tc', 'tc1', '70')
    expect(readingCellColor({ ...v, showColors: false }, tc, 1, '2026-06-08', '0600', 'tc1')).toBeNull()
    const noRules = { ...tc, colorRules: undefined }
    expect(readingCellColor({ ...v, readingTypes: [noRules] }, noRules, 1, '2026-06-08', '0600', 'tc1')).toBeNull()
  })

  it('uses the previous day same period for the 24h jump', () => {
    let v = { ...voyage(), readingTypes: [tc] }
    v = setReadingValue(v, '2026-06-07', '0600', 1, 'rt_tc', 'tc1', '40')
    v = setReadingValue(v, '2026-06-08', '0600', 1, 'rt_tc', 'tc1', '52') // +12 vs prev day → amber
    expect(readingCellColor(v, tc, 1, '2026-06-08', '0600', 'tc1')?.bg).toBe(AMBER)
  })

  it('null for blank / non-numeric cells', () => {
    const v = { ...voyage(), readingTypes: [tc] }
    expect(readingCellColor(v, tc, 1, '2026-06-08', '0600', 'tc1')).toBeNull()
  })
})

describe('defaultColorRules', () => {
  it('matches the DRI defaults', () => {
    expect(defaultColorRules()).toMatchObject({ amber: 60, red: 65, rateDeltaC: 10, gradient: true })
  })
})
