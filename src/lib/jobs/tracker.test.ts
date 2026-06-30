import { describe, it, expect } from 'vitest'
import { shiftHours } from './tracker'

describe('shiftHours — overtime spanning dates/times', () => {
  it('computes a same-day shift', () => {
    expect(shiftHours('2026-06-27', '08:00', '2026-06-27', '14:00')).toBe(6)
  })

  it('computes a shift that crosses midnight into the next day', () => {
    // The user's example: 30 Jun 21:00 → 1 Jul 03:00 = 6h
    expect(shiftHours('2026-06-30', '21:00', '2026-07-01', '03:00')).toBe(6)
  })

  it('computes the screenshot shift as ONE entry (no need to split at midnight)', () => {
    // Previously split into 27/06 08:00–23:59 (15.98h) + 28/06 00:01–02:00 (1.98h).
    // As a single span 27/06 08:00 → 28/06 02:00 it is a clean 18h.
    expect(shiftHours('2026-06-27', '08:00', '2026-06-28', '02:00')).toBe(18)
  })

  it('handles a multi-day span (over a month boundary)', () => {
    // 30 Jun 06:00 → 2 Jul 06:00 = 48h
    expect(shiftHours('2026-06-30', '06:00', '2026-07-02', '06:00')).toBe(48)
  })

  it('handles half-hour precision', () => {
    expect(shiftHours('2026-06-27', '08:15', '2026-06-27', '12:45')).toBe(4.5)
  })

  it('returns 0 when the stop is before/equal the start (invalid)', () => {
    expect(shiftHours('2026-06-27', '14:00', '2026-06-27', '08:00')).toBe(0)
    expect(shiftHours('2026-06-27', '08:00', '2026-06-27', '08:00')).toBe(0)
  })

  it('returns 0 for incomplete input', () => {
    expect(shiftHours('2026-06-27', '', '2026-06-27', '14:00')).toBe(0)
    expect(shiftHours(null, '08:00', null, '14:00')).toBe(0)
  })

  it('falls back to the start date when no stop date is given (same-day only)', () => {
    expect(shiftHours('2026-06-27', '08:00', null, '14:00')).toBe(6)
  })
})
