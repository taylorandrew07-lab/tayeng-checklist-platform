import { describe, it, expect } from 'vitest'
import { durationHM, readingStatusOf, validateReport, emptyDriReport, type VoyageLogEntry } from './dri'
import type { Voyage } from './types'

function voyage(overrides: Partial<Voyage> = {}): Voyage {
  return {
    holdCount: 3, vesselName: 'V', voyageNumber: '1', startDate: '2026-01-01', endDate: '2026-01-05',
    readingTypes: [], readings: {}, dri: emptyDriReport(3), ...overrides,
  } as unknown as Voyage
}
const logEntry = (o: Partial<VoyageLogEntry>): VoyageLogEntry =>
  ({ id: '1', logDate: '2026-01-01', slot: '0600', readingsTaken: true, holdsList: 'all', weather: 'clear and sunny', seaState: 'calm', sealingFoamOk: true, ...o }) as VoyageLogEntry

describe('durationHM', () => {
  it('computes whole hours + minutes', () => {
    expect(durationHM('2026-01-01T06:00', '2026-01-01T08:30')).toEqual({ hours: 2, minutes: 30 })
  })
  it('returns null for missing or reversed timestamps', () => {
    expect(durationHM('2026-01-01T08:00', '2026-01-01T06:00')).toBeNull()
    expect(durationHM('', '2026-01-01T06:00')).toBeNull()
  })
})

describe('readingStatusOf (back-compat)', () => {
  it('prefers explicit readingStatus', () => {
    expect(readingStatusOf(logEntry({ readingStatus: 'not_taken', readingsTaken: true }))).toBe('not_taken')
  })
  it('falls back to the legacy boolean', () => {
    expect(readingStatusOf(logEntry({ readingsTaken: true }))).toBe('taken')
    expect(readingStatusOf(logEntry({ readingsTaken: false }))).toBe('could_not')
  })
})

describe('validateReport', () => {
  it('flags a hold number outside the configured range', () => {
    const dri = emptyDriReport(3)
    dri.irReadings = [{ id: '1', phase: 'LOAD', readingDate: '2026-01-01', readingTime: '0600', holdNo: 9, fwdC: 1, midC: 1, aftC: 1 }]
    const issues = validateReport(voyage({ dri }), ['ir_load'])
    expect(issues.some(i => /outside 1–3/.test(i.message))).toBe(true)
  })
  it('warns when the loading-completed milestone is missing', () => {
    const issues = validateReport(voyage(), ['sof_load'])
    expect(issues.some(i => /loading completed/.test(i.message))).toBe(true)
  })
  it('errors when completed is before commenced', () => {
    const dri = emptyDriReport(3)
    dri.commencedOn = '2026-01-05'; dri.completedOn = '2026-01-01'
    const issues = validateReport(voyage({ dri }), [])
    expect(issues.some(i => i.severity === 'error')).toBe(true)
  })
})
