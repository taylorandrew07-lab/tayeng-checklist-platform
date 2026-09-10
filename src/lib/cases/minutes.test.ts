import { describe, it, expect } from 'vitest'
import {
  QUICK_BLOCK_MINUTES, formatMinutes, minutesToHours, minutesFromHM, hmFromMinutes, sumMinutes,
} from './minutes'

// The bug this module exists to prevent, pinned first. Everything else is detail.
describe('ten-minute blocks do not drift', () => {
  it('six quick blocks are exactly one hour', () => {
    const blocks = Array.from({ length: 6 }, () => ({ minutes: QUICK_BLOCK_MINUTES }))
    expect(sumMinutes(blocks)).toBe(60)
    expect(minutesToHours(sumMinutes(blocks))).toBe(1)
  })

  // The old model stored hours as a 2dp number, so a block was 0.17 and six were 1.02 —
  // a 2% over-bill that compounds. This asserts the arithmetic we deliberately left behind.
  it('the decimal-hours approach it replaced would have over-billed', () => {
    const asDecimal = Math.round((10 / 60) * 100) / 100      // 0.17
    expect(asDecimal * 6).toBeCloseTo(1.02, 5)
    expect(minutesToHours(60)).toBe(1)                        // what we do instead
  })

  it('a hundred blocks still land exactly', () => {
    expect(sumMinutes(Array.from({ length: 100 }, () => ({ minutes: 10 })))).toBe(1000)
  })
})

describe('formatMinutes', () => {
  it('reads the way a person would say it', () => {
    expect(formatMinutes(0)).toBe('0 m')
    expect(formatMinutes(10)).toBe('10 m')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(100)).toBe('1 h 40 m')
    expect(formatMinutes(1440)).toBe('24 h')
  })

  it('never shows a negative or a fraction', () => {
    expect(formatMinutes(-30)).toBe('0 m')
    expect(formatMinutes(10.4)).toBe('10 m')
  })
})

describe('minutesFromHM / hmFromMinutes', () => {
  it('round-trips', () => {
    for (const m of [0, 10, 59, 60, 95, 480, 1000]) {
      const { hours, mins } = hmFromMinutes(m)
      expect(minutesFromHM(hours, mins)).toBe(m)
    }
  })

  // It reads straight from two text inputs, so blanks and junk are the normal case.
  it('tolerates what a text input actually contains', () => {
    expect(minutesFromHM('', '')).toBe(0)
    expect(minutesFromHM('1', '')).toBe(60)
    expect(minutesFromHM('', '45')).toBe(45)
    expect(minutesFromHM('abc', '10')).toBe(10)
    expect(minutesFromHM(null, undefined)).toBe(0)
    expect(minutesFromHM('-2', '0')).toBe(0)
  })

  it('accepts minutes past 60 rather than arguing', () => {
    expect(minutesFromHM(0, 90)).toBe(90)
    expect(hmFromMinutes(90)).toEqual({ hours: 1, mins: 30 })
  })
})

describe('minutesToHours', () => {
  it('is 2dp for an invoice line', () => {
    expect(minutesToHours(30)).toBe(0.5)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(10)).toBe(0.17)   // fine ON THE WAY OUT; never stored
  })
})

describe('sumMinutes', () => {
  it('ignores nulls and missing values', () => {
    expect(sumMinutes([{ minutes: 10 }, { minutes: null }, {}, { minutes: 5 }])).toBe(15)
  })
})
