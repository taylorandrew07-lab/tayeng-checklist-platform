import { describe, it, expect } from 'vitest'
import { displayVoyageNumber } from './voyageNumber'

describe('displayVoyageNumber', () => {
  it('pads a bare number to the V-### the rest of the fleet uses', () => {
    // The Trinidad Pearl case: the surveyor typed "13", every other voyage reads V-###.
    expect(displayVoyageNumber('13')).toBe('V-013')
    expect(displayVoyageNumber('7')).toBe('V-007')
    expect(displayVoyageNumber('047')).toBe('V-047')
  })

  it('leaves an already-canonical number alone', () => {
    expect(displayVoyageNumber('V-047')).toBe('V-047')
  })

  it('tidies the near-misses people actually type', () => {
    expect(displayVoyageNumber('v13')).toBe('V-013')
    expect(displayVoyageNumber('V 13')).toBe('V-013')
    expect(displayVoyageNumber('voyage 13')).toBe('V-013')
    expect(displayVoyageNumber('  V-13  ')).toBe('V-013')
  })

  it('never mangles a number that is not a plain sequence', () => {
    // Refusing to touch these is the point: a voyage reference is entered
    // dockside and an odd shape must survive exactly as typed.
    expect(displayVoyageNumber('V-2026-014')).toBe('V-2026-014')
    expect(displayVoyageNumber('24/07')).toBe('24/07')
    expect(displayVoyageNumber('ATL-9B')).toBe('ATL-9B')
  })

  it('does not truncate a number above 999', () => {
    expect(displayVoyageNumber('1234')).toBe('V-1234')
  })

  it('renders an absent number as an empty string, never null', () => {
    expect(displayVoyageNumber(null)).toBe('')
    expect(displayVoyageNumber(undefined)).toBe('')
    expect(displayVoyageNumber('   ')).toBe('')
  })
})
