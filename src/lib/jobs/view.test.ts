// The Jobs register's year/month filter, pinned to the company's timezone.
//
// This whole file exists because of one bug: a job surveyed on 1 September 2026 showed up
// under the August filter and was missing from September. jobs.scheduled_date /
// jobs.end_date are Postgres DATE columns that arrive as a bare '2026-09-01', and
// new Date() parses a date-only string as UTC midnight — 31 Aug 20:00 in Trinidad — so
// getMonth() answered August. The Date column beside it read 01 Sep, because that path
// goes through dayKey/parseISO (local midnight).
//
// TZ is set here rather than in vitest.config.ts so this file's timezone can't change how
// any other test runs. It must happen before anything constructs a Date; Node re-reads
// process.env.TZ on assignment, and the imports below are hoisted but only *define*
// functions, so no Date exists yet. process.env is process-global and vitest can run
// several files in one worker, so the original is put back in afterAll. On CI (UTC) the
// old code was correct and every assertion here would pass vacuously — without the pin
// there is no regression test in this file at all.
const HOST_TZ = process.env.TZ
process.env.TZ = 'America/Port_of_Spain'

import { describe, it, expect, afterAll } from 'vitest'
import { availableYears, inYearMonth, MONTH_LABELS } from './view'

afterAll(() => {
  if (HOST_TZ === undefined) delete process.env.TZ
  else process.env.TZ = HOST_TZ
})

const SEP = 8 // MONTH_LABELS is 0-based, matching the toolbar's <option value={i}>
const AUG = 7
const JAN = 0

describe('the timezone this file pins', () => {
  it('is four hours behind UTC, or these tests prove nothing', () => {
    // A guard on the guard: if the pin ever stops taking effect, fail here with a clear
    // reason instead of letting every assertion below pass for the wrong reason.
    expect(new Date('2026-09-01T00:00:00Z').getTimezoneOffset()).toBe(240)
  })

  it('still mis-parses a bare date the old way, which is the bug being guarded', () => {
    expect(new Date('2026-09-01').getMonth()).toBe(AUG)
  })
})

describe('inYearMonth', () => {
  it('puts a job dated the 1st of September in September, not August', () => {
    expect(inYearMonth('2026-09-01', 2026, SEP)).toBe(true)
    expect(inYearMonth('2026-09-01', 2026, AUG)).toBe(false)
  })

  it('keeps the last day of August in August', () => {
    expect(inYearMonth('2026-08-31', 2026, AUG)).toBe(true)
    expect(inYearMonth('2026-08-31', 2026, SEP)).toBe(false)
  })

  it('puts a job dated 1 January in that year, not the one before', () => {
    expect(inYearMonth('2026-01-01', 2026, JAN)).toBe(true)
    expect(inYearMonth('2026-01-01', 2025, 'all')).toBe(false)
    expect(inYearMonth('2026-01-01', 2026, 'all')).toBe(true)
  })

  it('reads a timestamptz created_at as its local day', () => {
    // 03:30 UTC on 1 Sep is 23:30 on 31 Aug in Trinidad — the day the Date column shows.
    expect(inYearMonth('2026-09-01T03:30:00+00:00', 2026, AUG)).toBe(true)
    expect(inYearMonth('2026-09-01T03:30:00+00:00', 2026, SEP)).toBe(false)
    // Midday is unambiguous either way.
    expect(inYearMonth('2026-09-01T12:00:00+00:00', 2026, SEP)).toBe(true)
  })

  it('matches every month index the toolbar can offer', () => {
    MONTH_LABELS.forEach((_, i) => {
      const first = `2026-${String(i + 1).padStart(2, '0')}-01`
      expect(inYearMonth(first, 2026, i)).toBe(true)
    })
  })

  it('lets everything through when the year is "all"', () => {
    // Even a stale month, and even a date it could not parse.
    expect(inYearMonth('2026-09-01', 'all', AUG)).toBe(true)
    expect(inYearMonth(null, 'all', 'all')).toBe(true)
  })

  it('rejects a missing or unparseable date once a year is chosen', () => {
    expect(inYearMonth(null, 2026, 'all')).toBe(false)
    expect(inYearMonth(undefined, 2026, 'all')).toBe(false)
    expect(inYearMonth('', 2026, 'all')).toBe(false)
    expect(inYearMonth('not a date', 2026, 'all')).toBe(false)
  })
})

describe('availableYears', () => {
  const yearsOf = (dates: (string | null)[]) => availableYears(dates.map(d => ({ d })), r => r.d)

  it('offers the year a 1 January job actually belongs to', () => {
    expect(yearsOf(['2026-01-01'])).toEqual([2026])
  })

  it('lists distinct years newest first', () => {
    expect(yearsOf(['2026-01-01', '2025-12-31', '2026-09-01'])).toEqual([2026, 2025])
  })

  it('skips rows with no usable date', () => {
    expect(yearsOf([null, '', 'not a date', '2026-05-04'])).toEqual([2026])
  })
})
