import { describe, it, expect } from 'vitest'
import {
  REMINDER_BUCKETS, crossedBuckets, tightestBucket, daysUntil,
  dueLabel, nextDueDate, trinidadToday, calibrationStatus,
} from './calibration'

// A fixed instant, so these never drift with the wall clock.
// 2026-08-17T13:00:00Z is 09:00 in Trinidad on the same calendar day.
const NOW = new Date('2026-08-17T13:00:00Z')

describe('trinidadToday', () => {
  it('reads the Trinidad calendar day on a UTC host', () => {
    expect(trinidadToday(NOW)).toBe('2026-08-17')
  })

  it('is still the previous day at 02:00 UTC — the four-hour trap', () => {
    // Vercel and GitHub Actions both run in UTC. Without the fixed offset, a
    // run just after midnight UTC would compute reminders a day early.
    expect(trinidadToday(new Date('2026-08-18T02:00:00Z'))).toBe('2026-08-17')
  })
})

describe('daysUntil', () => {
  it('counts whole calendar days forward', () => {
    expect(daysUntil('2026-08-24', NOW)).toBe(7)
  })

  it('is zero on the due date and negative past it', () => {
    expect(daysUntil('2026-08-17', NOW)).toBe(0)
    expect(daysUntil('2026-08-14', NOW)).toBe(-3)
  })

  it('is null for a missing or unparseable date', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil('not a date', NOW)).toBeNull()
  })
})

describe('crossedBuckets', () => {
  // The load-bearing test. With an equality check (days === bucket) a cron that
  // misses a day SKIPS that reminder instead of sending it late.
  it('reports every bucket crossed, not just the one exactly equalled', () => {
    expect(crossedBuckets('2026-08-20', NOW)).toEqual([60, 30, 7]) // 3 days out
  })

  it('still reports 7 when the cron missed the exact day', () => {
    expect(crossedBuckets('2026-08-22', NOW)).toEqual([60, 30, 7]) // 5 days out
  })

  it('crosses a bucket exactly on its boundary', () => {
    expect(crossedBuckets('2026-08-24', NOW)).toEqual([60, 30, 7]) // exactly 7
    expect(crossedBuckets('2026-09-16', NOW)).toEqual([60, 30])    // exactly 30
  })

  it('crosses nothing while still beyond the widest rung', () => {
    expect(crossedBuckets('2027-01-01', NOW)).toEqual([])
  })

  it('crosses the whole ladder at once for a gauge entered already overdue', () => {
    expect(crossedBuckets('2026-08-10', NOW)).toEqual([60, 30, 7, 0])
  })

  it('includes 0 on the due date itself, so nothing goes overdue in silence', () => {
    expect(crossedBuckets('2026-08-17', NOW)).toEqual([60, 30, 7, 0])
  })

  it('crosses 60 and 30 together for an item added 20 days from due', () => {
    // The caller latches both but talks about 30 only — see tightestBucket.
    expect(crossedBuckets('2026-09-06', NOW)).toEqual([60, 30])
  })

  it('has no buckets for a missing date', () => {
    expect(crossedBuckets(null, NOW)).toEqual([])
  })
})

describe('tightestBucket', () => {
  it('is the rung the message should be about', () => {
    expect(tightestBucket('2026-09-06', NOW)).toBe(30)
    expect(tightestBucket('2026-08-20', NOW)).toBe(7)
    expect(tightestBucket('2026-08-10', NOW)).toBe(0)
  })

  it('is null when nothing is due', () => {
    expect(tightestBucket('2027-01-01', NOW)).toBeNull()
    expect(tightestBucket(null, NOW)).toBeNull()
  })
})

describe('REMINDER_BUCKETS', () => {
  it('runs widest first and matches the migration-190 CHECK', () => {
    // inventory_reminders.days_out CHECK (days_out IN (60, 30, 7, 0)).
    // A change here without a matching migration silently drops reminders.
    expect(REMINDER_BUCKETS).toEqual([60, 30, 7, 0])
  })
})

describe('calibrationStatus', () => {
  it('bands the same way a personal document does', () => {
    expect(calibrationStatus('2026-08-14').status).toBe('expired')
    expect(calibrationStatus('2027-06-01').status).toBe('ok')
    expect(calibrationStatus(null).status).toBe('none')
  })
})

describe('dueLabel', () => {
  it('reads naturally either side of the date', () => {
    expect(dueLabel('2026-08-29', NOW)).toBe('Due in 12 days')
    expect(dueLabel('2026-08-18', NOW)).toBe('Due in 1 day')
    expect(dueLabel('2026-08-17', NOW)).toBe('Due today')
    expect(dueLabel('2026-08-14', NOW)).toBe('Overdue by 3 days')
    expect(dueLabel('2026-08-16', NOW)).toBe('Overdue by 1 day')
    expect(dueLabel(null, NOW)).toBe('No date set')
  })
})

describe('nextDueDate', () => {
  it('suggests the next date from the interval', () => {
    expect(nextDueDate('2026-08-17', 12)).toBe('2027-08-17')
    expect(nextDueDate('2026-08-17', 6)).toBe('2027-02-17')
  })

  it('suggests nothing without both halves', () => {
    expect(nextDueDate(null, 12)).toBeNull()
    expect(nextDueDate('2026-08-17', null)).toBeNull()
    expect(nextDueDate('2026-08-17', 0)).toBeNull()
  })
})
