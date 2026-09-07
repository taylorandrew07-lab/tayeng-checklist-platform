// formatReportNumber's YY-MM, pinned to the company's timezone.
//
// Separate from tracker.test.ts so pinning TZ here cannot change how the existing
// tracker tests run. Same reason as lib/jobs/view.test.ts: scheduled_date is a Postgres
// DATE, and parsing '2026-09-01' with new Date() gives UTC midnight — 31 Aug in Trinidad
// — so the admin "fill missing report numbers" tool stamped a 1 Sep job as 26-08-NNN and
// wrote it to the row. The trigger path (next_report_number(), mig 042/158) is SQL and
// was never affected; this covers the manual bulk tool only.
const HOST_TZ = process.env.TZ
process.env.TZ = 'America/Port_of_Spain'

import { describe, it, expect, afterAll } from 'vitest'
import { formatReportNumber } from './tracker'

afterAll(() => {
  if (HOST_TZ === undefined) delete process.env.TZ
  else process.env.TZ = HOST_TZ
})

describe('formatReportNumber', () => {
  it('numbers a job scheduled on the 1st under that month, not the one before', () => {
    expect(formatReportNumber('2026-09-01', 5)).toBe('26-09-005')
  })

  it('keeps the last day of a month in that month', () => {
    expect(formatReportNumber('2026-08-31', 5)).toBe('26-08-005')
  })

  it('numbers a 1 January job in the new year', () => {
    expect(formatReportNumber('2026-01-01', 1)).toBe('26-01-001')
  })

  it('pads the sequence to three digits and leaves longer ones alone', () => {
    expect(formatReportNumber('2026-09-15', 7)).toBe('26-09-007')
    expect(formatReportNumber('2026-09-15', 263)).toBe('26-09-263')
    expect(formatReportNumber('2026-09-15', 1042)).toBe('26-09-1042')
  })

  it('reads a timestamptz created_at fallback as its local day', () => {
    // 02:30 UTC on 1 Sep is still 31 Aug in Trinidad, which is the day the job shows.
    expect(formatReportNumber('2026-09-01T02:30:00+00:00', 9)).toBe('26-08-009')
    expect(formatReportNumber('2026-09-01T16:00:00+00:00', 9)).toBe('26-09-009')
  })
})
