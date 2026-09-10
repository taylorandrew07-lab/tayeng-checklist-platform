import { describe, it, expect } from 'vitest'
import { displayVoyageNumber, isVoyagePrefixOnly, VOYAGE_PREFIX } from './voyageNumber'

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

describe('isVoyagePrefixOnly', () => {
  // New Voyage opens with the prefix pre-filled so only the digits get typed.
  // That makes a required field non-empty before anyone has typed anything —
  // without this guard a voyage saves numbered "V-" and then reads as a real
  // number on the register, the annex and every reconciliation after it.
  it('catches the untouched pre-fill, however it is spaced or punctuated', () => {
    expect(isVoyagePrefixOnly(VOYAGE_PREFIX)).toBe(true)
    expect(isVoyagePrefixOnly('V-')).toBe(true)
    expect(isVoyagePrefixOnly('  V-  ')).toBe(true)
    expect(isVoyagePrefixOnly('V')).toBe(true)
    expect(isVoyagePrefixOnly('v-')).toBe(true)
    expect(isVoyagePrefixOnly('V ')).toBe(true)
  })

  it('lets anything with an actual number through', () => {
    expect(isVoyagePrefixOnly('V-013')).toBe(false)
    expect(isVoyagePrefixOnly('13')).toBe(false)
    expect(isVoyagePrefixOnly('24/07')).toBe(false)
    expect(isVoyagePrefixOnly('V-0')).toBe(false)
  })

  it('is false for empty — that is the plain blank check, a separate message', () => {
    expect(isVoyagePrefixOnly('')).toBe(false)
    expect(isVoyagePrefixOnly(null)).toBe(false)
    expect(isVoyagePrefixOnly(undefined)).toBe(false)
  })

  it('the pre-fill survives the blur normaliser untouched', () => {
    // normaliseVoyage only rewrites something that reads as a plain number, so
    // tabbing straight past an untouched box must not invent a voyage number.
    expect(displayVoyageNumber(VOYAGE_PREFIX)).toBe('V-')
  })
})
