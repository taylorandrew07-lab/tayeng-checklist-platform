import { describe, it, expect } from 'vitest'
import { linearInterpolate, formatNumber, parseValue } from './interpolation'

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

describe('bilinear as three linear steps (new block layout)', () => {
  it('worked example → y2c1=1120, y2c2=1220, final=1160', () => {
    const tX = 126
    const y2c1 = linearInterpolate(120, 1000, 130, 1200, tX)
    const y2c2 = linearInterpolate(120, 1100, 130, 1300, tX)
    const final = linearInterpolate(0, y2c1, 1, y2c2, 0.4)
    expect(y2c1).toBe(1120)
    expect(y2c2).toBe(1220)
    expect(final).toBeCloseTo(1160, 6)
  })

  it('fractional target x (120 1/2) interpolates condition 1', () => {
    const tX = parseValue('120 1/2')!
    expect(linearInterpolate(120, 1000, 130, 1200, tX)).toBe(1010)
  })

  it('negative condition values still interpolate', () => {
    const y2c1 = linearInterpolate(120, 1000, 130, 1200, 126) // 1120
    const y2c2 = linearInterpolate(120, 1100, 130, 1300, 126) // 1220
    // condition values -2 and 2, target -1 → 25% of the way → 1120 + 0.25*100 = 1145
    expect(linearInterpolate(-2, y2c1, 2, y2c2, -1)).toBeCloseTo(1145, 6)
  })
})

describe('parseValue', () => {
  it('parses decimals and negatives', () => {
    expect(parseValue('12.5')).toBe(12.5)
    expect(parseValue('-1')).toBe(-1)
    expect(parseValue('0.5')).toBe(0.5)
  })

  it('parses simple fractions', () => {
    expect(parseValue('1/2')).toBe(0.5)
    expect(parseValue('3/4')).toBe(0.75)
    expect(parseValue('5/16')).toBe(0.3125)
  })

  it('parses mixed numbers with space or hyphen', () => {
    expect(parseValue('12 1/2')).toBe(12.5)
    expect(parseValue('12-1/2')).toBe(12.5)
    expect(parseValue('12 5/16')).toBe(12.3125)
  })

  it('parses negative fractions / mixed numbers', () => {
    expect(parseValue('-1/2')).toBe(-0.5)
    expect(parseValue('-2 1/4')).toBe(-2.25)
  })

  it('returns null for blank or invalid input', () => {
    expect(parseValue('')).toBeNull()
    expect(parseValue('-')).toBeNull()
    expect(parseValue('abc')).toBeNull()
    expect(parseValue('1/0')).toBeNull()
    expect(parseValue('1/2/3')).toBeNull()
  })

  it('fraction interpolation examples resolve correctly', () => {
    // x2 = 10 1/2 between x1=10,x3=11 → halfway → y2=1500
    expect(linearInterpolate(10, 1000, 11, 2000, parseValue('10 1/2')!)).toBe(1500)
    // x2 = 5/16 with x1=0,x3=1,y1=0,y3=16 → 5
    expect(linearInterpolate(0, 0, 1, 16, parseValue('5/16')!)).toBe(5)
    // x1=-1/2,x3=1/2,x2=0,y1=100,y3=200 → 150
    expect(linearInterpolate(parseValue('-1/2')!, 100, parseValue('1/2')!, 200, 0)).toBe(150)
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
