import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  monitoringDates, holdsToPages, holdNumbers, effectiveEndDate, defaultPickerDate, formatVoyageRange,
  periodsForDate, periodsInRange, periodLabel, addExtraRound, removeExtraRound, hhmmToInput, inputToHhmm,
} from './periods'

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

describe('periodsForDate (extra monitoring rounds)', () => {
  const base = ['0600', '1200', '1800']
  const v = { startDate: '2026-06-07' }

  it('gives the base three when a voyage has no schedule at all', () => {
    expect(periodsForDate(v, '2026-06-09')).toEqual(base)
    expect(periodsForDate({ ...v, readingSchedule: [] }, '2026-06-09')).toEqual(base)
  })

  it('applies an extra round from its first day, and not the day before', () => {
    const w = { ...v, readingSchedule: [{ time: '2200', from: '2026-06-09' }] }
    expect(periodsForDate(w, '2026-06-08')).toEqual(base)
    expect(periodsForDate(w, '2026-06-09')).toEqual([...base, '2200'])
    expect(periodsForDate(w, '2026-07-01')).toEqual([...base, '2200'])
  })

  it('sorts by time, not by when it was added', () => {
    const w = { ...v, readingSchedule: [
      { time: '2200', from: '2026-06-08' },
      { time: '1500', from: '2026-06-09' },
    ] }
    expect(periodsForDate(w, '2026-06-09')).toEqual(['0600', '1200', '1500', '1800', '2200'])
  })

  it('stops on the day after `until`, leaving earlier days intact', () => {
    const w = { ...v, readingSchedule: [{ time: '2200', from: '2026-06-08', until: '2026-06-10' }] }
    expect(periodsForDate(w, '2026-06-10')).toContain('2200')
    expect(periodsForDate(w, '2026-06-11')).toEqual(base)
  })

  it('de-duplicates an extra round that repeats a base time', () => {
    const w = { ...v, readingSchedule: [{ time: '1200', from: '2026-06-08' }] }
    expect(periodsForDate(w, '2026-06-09')).toEqual(base)
  })

  it('unions across a range for the charts filter', () => {
    const w = { ...v, readingSchedule: [{ time: '2200', from: '2026-06-09', until: '2026-06-10' }] }
    expect(periodsInRange(w, '2026-06-07', '2026-06-08')).toEqual(base)
    expect(periodsInRange(w, '2026-06-07', '2026-06-12')).toEqual([...base, '2200'])
    expect(periodsInRange(w, '2026-06-11', '2026-06-12')).toEqual(base)
  })

  it('labels a round', () => {
    expect(periodLabel('2200')).toBe('2200 hrs')
  })
})

describe('addExtraRound / removeExtraRound', () => {
  const v = { startDate: '2026-06-07' as string, readingSchedule: undefined as { time: string; from: string; until?: string }[] | undefined }

  it('adding then removing on the SAME day leaves no trace', () => {
    const added = addExtraRound(v, '2200', '2026-06-09')
    const gone = removeExtraRound(added, '2200', '2026-06-09')
    expect(gone.readingSchedule).toEqual([])
    expect(periodsForDate(gone, '2026-06-09')).toEqual(['0600', '1200', '1800'])
  })

  it('removing later closes the window on the day before', () => {
    const w = removeExtraRound(addExtraRound(v, '2200', '2026-06-09'), '2200', '2026-06-12')
    expect(w.readingSchedule).toEqual([{ time: '2200', from: '2026-06-09', until: '2026-06-11' }])
    expect(periodsForDate(w, '2026-06-11')).toContain('2200')
    expect(periodsForDate(w, '2026-06-12')).not.toContain('2200')
  })

  it('re-adding after a stop keeps both windows and the gap between them', () => {
    let w = addExtraRound(v, '2200', '2026-06-09')
    w = removeExtraRound(w, '2200', '2026-06-12')
    w = addExtraRound(w, '2200', '2026-06-15')
    expect(w.readingSchedule).toHaveLength(2)
    expect(periodsForDate(w, '2026-06-11')).toContain('2200') // first window
    expect(periodsForDate(w, '2026-06-13')).not.toContain('2200') // the gap
    expect(periodsForDate(w, '2026-06-16')).toContain('2200') // second window
  })

  it('closing one window does not disturb an already-closed earlier one', () => {
    const w = removeExtraRound({
      ...v,
      readingSchedule: [
        { time: '2200', from: '2026-06-01', until: '2026-06-03' },
        { time: '2200', from: '2026-06-09' },
      ],
    }, '2200', '2026-06-12')
    expect(w.readingSchedule).toEqual([
      { time: '2200', from: '2026-06-01', until: '2026-06-03' },
      { time: '2200', from: '2026-06-09', until: '2026-06-11' },
    ])
  })

  it('leaves other rounds alone', () => {
    const w = removeExtraRound(addExtraRound(addExtraRound(v, '2200', '2026-06-09'), '1500', '2026-06-09'), '2200', '2026-06-10')
    expect(periodsForDate(w, '2026-06-11')).toEqual(['0600', '1200', '1500', '1800'])
  })
})

describe('hhmm converters', () => {
  it('round-trips a time input', () => {
    expect(hhmmToInput('2200')).toBe('22:00')
    expect(inputToHhmm('22:00')).toBe('2200')
    expect(inputToHhmm('07:30')).toBe('0730')
  })

  it('returns empty for junk rather than a half-formed round', () => {
    expect(hhmmToInput('')).toBe('')
    expect(inputToHhmm('')).toBe('')
    expect(inputToHhmm('nope')).toBe('')
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
