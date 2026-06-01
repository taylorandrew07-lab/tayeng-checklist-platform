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
})
