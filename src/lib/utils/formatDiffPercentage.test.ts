import { describe, it, expect } from 'vitest'
import { formatDiffPercentage } from './index'

describe('formatDiffPercentage', () => {
  it('ship=88000, supplier=89210 → -1210 USG: -1.36%', () => {
    const { display, pct } = formatDiffPercentage(-1210, '89210')
    expect(display).toBe('-1210 USG: -1.36%')
    expect(pct).toBeCloseTo(-1.357, 2)
  })

  it('ship=10000, supplier=9999 → 1 USG: 0.01%', () => {
    const { display, pct } = formatDiffPercentage(1, '9999')
    expect(display).toBe('1 USG: 0.01%')
    expect(pct).toBeCloseTo(0.01, 2)
  })

  it('ship=20000, supplier=25000 → -5000 USG: -20.00%', () => {
    const { display, pct } = formatDiffPercentage(-5000, '25000')
    expect(display).toBe('-5000 USG: -20.00%')
    expect(pct).toBeCloseTo(-20, 2)
  })

  it('supplier=0 → safe no-divide placeholder', () => {
    const { display, pct } = formatDiffPercentage(100, '0')
    expect(display).toBe('—')
    expect(pct).toBeNull()
  })

  it('supplier=undefined → safe placeholder', () => {
    const { display, pct } = formatDiffPercentage(100, undefined)
    expect(display).toBe('—')
    expect(pct).toBeNull()
  })

  it('supplier=empty string → safe placeholder', () => {
    const { display, pct } = formatDiffPercentage(100, '')
    expect(display).toBe('—')
    expect(pct).toBeNull()
  })

  // The unit parameter was added for Brine Transfer (BBLS). Existing fuel templates pass no
  // unit and MUST keep the historic "USG" wording — the cases above are that guard.
  it('omitted unit falls back to USG (legacy fuel templates unchanged)', () => {
    expect(formatDiffPercentage(-1210, '89210').display).toBe('-1210 USG: -1.36%')
    expect(formatDiffPercentage(-1210, '89210', undefined).display).toBe('-1210 USG: -1.36%')
  })

  it('explicit unit is used verbatim — brine reconciles in BBLS', () => {
    const { display, pct } = formatDiffPercentage(-1210, '89210', 'BBLS')
    expect(display).toBe('-1210 BBLS: -1.36%')
    expect(pct).toBeCloseTo(-1.357, 2)
  })

  it('unit does not affect the no-divide guard', () => {
    expect(formatDiffPercentage(100, '0', 'BBLS').display).toBe('—')
  })

  // Andrew's colour bands key off the ABSOLUTE percentage, so a ship shortfall (negative
  // difference) must band identically to an equal-sized overage.
  it('signs are preserved so a ship shortfall reads negative', () => {
    expect(formatDiffPercentage(-500, '50000', 'BBLS').pct).toBeCloseTo(-1.0, 5)
    expect(formatDiffPercentage(500, '50000', 'BBLS').pct).toBeCloseTo(1.0, 5)
  })
})
