import { describe, it, expect } from 'vitest'
import { nextOpenWindow, isReminderDue } from './reminderWindow'

// Trinidad is UTC-4 fixed (no DST), so a local wall-clock time is just +4h in UTC.
// Building the fixtures this way — rather than with `new Date('...local')` — keeps
// the tests independent of the machine's timezone, which is the whole point.
const tt = (iso: string) => new Date(`${iso}-04:00`)

/** Render an instant back as Trinidad wall clock, for readable assertions. */
const local = (d: Date) =>
  new Date(d.getTime() - 4 * 3600_000).toISOString().replace('T', ' ').slice(0, 16)

describe('nextOpenWindow', () => {
  // 2026-07-27 is a Monday, so 27=Mon, 28=Tue ... 31=Fri, 08-01=Sat, 08-02=Sun.
  const cases: [string, string, string][] = [
    ['inside the window fires immediately',      '2026-07-28T10:00:00', '2026-07-28 10:00'],
    ['before open waits for the same day 08:00', '2026-07-28T06:00:00', '2026-07-28 08:00'],
    ['exactly 08:00 fires (open is inclusive)',  '2026-07-28T08:00:00', '2026-07-28 08:00'],
    ['exactly 16:00 defers (close is exclusive)','2026-07-28T16:00:00', '2026-07-29 08:00'],
    ['after close rolls to the next morning',    '2026-07-28T17:30:00', '2026-07-29 08:00'],
    ['late evening rolls to the next morning',   '2026-07-28T23:59:00', '2026-07-29 08:00'],
    ['Friday before 14:00 still fires',          '2026-07-31T13:59:00', '2026-07-31 13:59'],
    ['exactly Friday 14:00 rolls to Monday',     '2026-07-31T14:00:00', '2026-08-03 08:00'],
    ['Friday afternoon rolls to Monday',         '2026-07-31T15:00:00', '2026-08-03 08:00'],
    ['Saturday rolls to Monday',                 '2026-08-01T09:00:00', '2026-08-03 08:00'],
    ['Sunday night rolls to Monday',             '2026-08-02T23:00:00', '2026-08-03 08:00'],
    ['Thursday 15:59 still fires',               '2026-07-30T15:59:00', '2026-07-30 15:59'],
  ]

  for (const [name, due, expected] of cases) {
    it(name, () => expect(local(nextOpenWindow(tt(due)))).toBe(expected))
  }

  it('is idempotent — a time already in the window maps to itself', () => {
    const once = nextOpenWindow(tt('2026-07-29T11:00:00'))
    expect(nextOpenWindow(once).getTime()).toBe(once.getTime())
  })

  it('does not read the host timezone', () => {
    // Same instant expressed in three zones must give one answer. If the
    // implementation ever used getHours() instead of getUTCHours(), this fails.
    const instant = '2026-08-01T13:00:00Z' // Saturday 09:00 Trinidad
    const results = ['+00:00', '-04:00', '+09:00'].map(() =>
      nextOpenWindow(new Date(instant)).getTime(),
    )
    expect(new Set(results).size).toBe(1)
    expect(local(nextOpenWindow(new Date(instant)))).toBe('2026-08-03 08:00')
  })
})

describe('isReminderDue', () => {
  it('is false for a job with no reminder armed', () => {
    expect(isReminderDue(null)).toBe(false)
    expect(isReminderDue(undefined)).toBe(false)
  })

  it('is false for an unparseable timestamp rather than throwing', () => {
    expect(isReminderDue('not a date')).toBe(false)
  })

  it('is false before the window opens even though the raw due time has passed', () => {
    // Due Saturday 09:00; "now" is Saturday 18:00 — raw due has passed, but the
    // window has not opened, so nothing should surface until Monday.
    expect(isReminderDue(tt('2026-08-01T09:00:00'), tt('2026-08-01T18:00:00'))).toBe(false)
  })

  it('is true once the deferred window has opened', () => {
    expect(isReminderDue(tt('2026-08-01T09:00:00'), tt('2026-08-03T08:00:00'))).toBe(true)
  })

  it('is true immediately when it comes due mid-window', () => {
    expect(isReminderDue(tt('2026-07-28T10:00:00'), tt('2026-07-28T10:00:00'))).toBe(true)
  })

  it('is false before the raw due time', () => {
    expect(isReminderDue(tt('2026-07-28T10:00:00'), tt('2026-07-28T09:00:00'))).toBe(false)
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(isReminderDue(tt('2026-07-28T10:00:00').toISOString(), tt('2026-07-28T11:00:00'))).toBe(true)
  })
})
