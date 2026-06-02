import { describe, it, expect } from 'vitest'
import { linearInterpolate, bilinearInterpolate, formatNumber } from './interpolation'

describe('linearInterpolate', () => {
  it('midpoint: X1=10,Y1=1000,X2=20,Y2=2000, targetX=15 → 1500', () => {
    expect(linearInterpolate(10, 1000, 20, 2000, 15)).toBe(1500)
  })

  it('negative + decimal: X1=-1,Y1=950,X2=1,Y2=1050, targetX=0.5 → 1025', () => {
    expect(linearInterpolate(-1, 950, 1, 1050, 0.5)).toBe(1025)
  })

  it('targetX at X1 returns Y1', () => {
    expect(linearInterpolate(10, 1000, 20, 2000, 10)).toBe(1000)
  })
})

describe('bilinearInterpolate', () => {
  it('worked example → R1=1040, R2=1240, result=1160', () => {
    const { r1, r2, result } = bilinearInterpolate({
      x1: 0, x2: 1, targetX: 0.4,
      y1: 120, y2: 130, targetY: 126,
      q11: 1000, q21: 1100, q12: 1200, q22: 1300,
    })
    expect(r1).toBeCloseTo(1040, 6)
    expect(r2).toBeCloseTo(1240, 6)
    expect(result).toBeCloseTo(1160, 6)
  })
})

describe('formatNumber', () => {
  it('defaults to fixed decimals, no scientific notation', () => {
    expect(formatNumber(1500, 3)).toBe('1500.000')
    expect(formatNumber(1025.5, 2)).toBe('1025.50')
    expect(formatNumber(1160, 0)).toBe('1160')
  })

  it('clamps decimals to 0–6 and handles non-finite', () => {
    expect(formatNumber(1, 9)).toBe('1.000000')
    expect(formatNumber(Infinity, 3)).toBe('—')
    expect(formatNumber(NaN, 3)).toBe('—')
  })
})
