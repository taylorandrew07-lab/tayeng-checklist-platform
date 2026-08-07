import { describe, it, expect, vi, afterEach } from 'vitest'
import { monitoringDates, holdsToPages, holdNumbers, effectiveEndDate, defaultPickerDate, formatVoyageRange } from './periods'

describe('holdsToPages', () => {
  it('keeps 1–6 holds on a single page', () => {
    for (let n = 1; n <= 6; n++) {
      const pages = holdsToPages(n)
      expect(pages).toHaveLength(1)
      expect(pages[0]).toEqual(holdNumbers(n))
    }
  })

  it('splits 7–10 holds per the spec', () => {
    expect(holdsToPages(7)).toEqual([[1, 2, 3, 4], [5, 6, 7]])
    expect(holdsToPages(8)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(holdsToPages(9)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9]])
    expect(holdsToPages(10)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]])
  })

  it('every hold appears exactly once across pages', () => {
    for (let n = 1; n <= 10; n++) {
      const flat = holdsToPages(n).flat()
      expect(flat).toEqual(holdNumbers(n))
    }
  })
})

describe('monitoringDates', () => {
  it('returns an inclusive ISO date range', () => {
    expect(monitoringDates('2026-06-07', '2026-06-09')).toEqual(['2026-06-07', '2026-06-08', '2026-06-09'])
  })

  it('returns a single day when start === end', () => {
    expect(monitoringDates('2026-06-07', '2026-06-07')).toEqual(['2026-06-07'])
  })

  it('returns empty for an inverted or invalid range', () => {
    expect(monitoringDates('2026-06-09', '2026-06-07')).toEqual([])
    expect(monitoringDates('', '')).toEqual([])
  })

  it('spans month boundaries', () => {
    expect(monitoringDates('2026-06-29', '2026-07-01')).toEqual(['2026-06-29', '2026-06-30', '2026-07-01'])
  })
})

describe('effectiveEndDate (open-ended voyages)', () => {
  afterEach(() => { vi.useRealTimers() })
  const atNoonLocal = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00`))

  it('uses the stored end date when the voyage has one', () => {
    expect(effectiveEndDate({ startDate: '2026-06-07', endDate: '2026-06-09' })).toBe('2026-06-09')
  })

  it('runs to today when no end date is known yet', () => {
    vi.useFakeTimers()
    atNoonLocal('2026-06-10')
    expect(effectiveEndDate({ startDate: '2026-06-07', endDate: '' })).toBe('2026-06-10')
    expect(monitoringDates('2026-06-07', effectiveEndDate({ startDate: '2026-06-07' }))).toHaveLength(4)
  })

  it('never hides a day that already has data, even if the clock is behind', () => {
    vi.useFakeTimers()
    atNoonLocal('2026-06-08')
    expect(effectiveEndDate({
      startDate: '2026-06-07',
      readings: { '2026-06-07': {}, '2026-06-11': {} },
      periodMeta: { '2026-06-09': {} },
    })).toBe('2026-06-11')
  })

  it('stays a single day for a voyage that starts in the future', () => {
    vi.useFakeTimers()
    atNoonLocal('2026-06-01')
    expect(effectiveEndDate({ startDate: '2026-06-07' })).toBe('2026-06-07')
  })
})

describe('defaultPickerDate', () => {
  const week = monitoringDates('2026-06-07', '2026-06-13')

  it('opens on the newest day, never on day 1', () => {
    expect(defaultPickerDate(week)).toBe('2026-06-13')
  })

  it('falls back to the newest day when nothing has data yet', () => {
    expect(defaultPickerDate(week, () => false)).toBe('2026-06-13')
  })

  it('skips back to the newest day that has data for read-only views', () => {
    const filled = new Set(['2026-06-07', '2026-06-10'])
    expect(defaultPickerDate(week, d => filled.has(d))).toBe('2026-06-10')
  })

  it('returns empty for an empty range', () => {
    expect(defaultPickerDate([])).toBe('')
    expect(defaultPickerDate([], () => true)).toBe('')
  })
})

describe('formatVoyageRange', () => {
  it('reads "ongoing" while the end date is unknown', () => {
    expect(formatVoyageRange({ startDate: '2026-06-07', endDate: '' })).toBe('07 June 2026 – ongoing')
  })

  it('shows both dates once the voyage is closed off', () => {
    expect(formatVoyageRange({ startDate: '2026-06-07', endDate: '2026-06-09' })).toBe('07 June 2026 – 09 June 2026')
  })
})
