import { describe, it, expect } from 'vitest'
import { formatQty, formatQtyShort, num, splitPacks, toBaseUnits, hasPacks, previewAfter, pluralise } from './packs'
import type { PackShape } from './packs'

const BOTTLES: PackShape = { units_per_pack: 24, unit_label: 'bottle', pack_label: 'box' }
const LOOSE: PackShape = { units_per_pack: 1, unit_label: 'bottle', pack_label: 'pack' }

describe('num', () => {
  // supabase-js hands NUMERIC back as a STRING on some paths. Without this
  // coercion "72" + 24 === "7224" and every count downstream is quietly wrong.
  it('coerces the strings Postgres NUMERIC arrives as', () => {
    expect(num('72')).toBe(72)
    expect(num('72.500')).toBe(72.5)
  })

  it('treats null, undefined and garbage as zero rather than NaN', () => {
    expect(num(null)).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num('not a number')).toBe(0)
  })
})

describe('splitPacks', () => {
  it('splits a whole number of packs', () => {
    expect(splitPacks(72, 24)).toEqual({ packs: 3, loose: 0, unitsTotal: 72 })
  })

  it('splits a part-used pack — the case the two-level model exists for', () => {
    expect(splitPacks(77, 24)).toEqual({ packs: 3, loose: 5, unitsTotal: 77 })
  })

  it('splits negatives TOWARD zero, so −30 is −1 box −6 and not −2 boxes +18', () => {
    expect(splitPacks(-30, 24)).toEqual({ packs: -1, loose: -6, unitsTotal: -30 })
  })

  it('never divides by zero when a pack size is missing or bogus', () => {
    expect(splitPacks(10, 0)).toEqual({ packs: 10, loose: 0, unitsTotal: 10 })
  })
})

describe('hasPacks', () => {
  it('is false at 1 per pack, so a loose item never reads as "72 packs"', () => {
    expect(hasPacks(LOOSE)).toBe(false)
    expect(hasPacks(BOTTLES)).toBe(true)
  })
})

describe('formatQty', () => {
  it('names both levels when the count is whole packs', () => {
    expect(formatQty(72, BOTTLES)).toBe('3 boxes (72 bottles)')
  })

  it('spells out a part-used pack', () => {
    expect(formatQty(77, BOTTLES)).toBe('3 boxes + 5 bottles (77 bottles)')
  })

  it('drops the pack level below one full pack, rather than saying "0 boxes"', () => {
    expect(formatQty(12, BOTTLES)).toBe('12 bottles')
  })

  it('singularises', () => {
    expect(formatQty(24, BOTTLES)).toBe('1 box (24 bottles)')
    expect(formatQty(1, BOTTLES)).toBe('1 bottle')
  })

  it('omits the pack level entirely when units_per_pack is 1', () => {
    expect(formatQty(72, LOOSE)).toBe('72 bottles')
  })

  it('says None at zero, not "0 bottles"', () => {
    expect(formatQty(0, BOTTLES)).toBe('None')
  })

  it('flags a negative as short — the books are wrong, not just empty', () => {
    expect(formatQty(-6, BOTTLES)).toBe('−6 bottles (short)')
  })

  it('accepts the string form NUMERIC arrives as', () => {
    expect(formatQty('72', BOTTLES)).toBe('3 boxes (72 bottles)')
  })

  it('trims NUMERIC(14,3) trailing zeros', () => {
    expect(formatQty('12.000', BOTTLES)).toBe('12 bottles')
  })

  it('does not double up an s on a label that already ends in one', () => {
    expect(formatQty(3, { units_per_pack: 1, unit_label: 'gloves', pack_label: 'box' })).toBe('3 gloves')
  })
})

describe('pluralise', () => {
  // "box" is the label we are guaranteed to use, and a bare +s gives "boxs".
  it('adds -es after x, z, ch and sh', () => {
    expect(pluralise(3, 'box')).toBe('3 boxes')
    expect(pluralise(2, 'brush')).toBe('2 brushes')
    expect(pluralise(2, 'pouch')).toBe('2 pouches')
  })

  it('turns a consonant + y into -ies, but leaves a vowel + y alone', () => {
    expect(pluralise(2, 'battery')).toBe('2 batteries')
    expect(pluralise(2, 'tray')).toBe('2 trays')
  })

  it('leaves the singular alone at exactly one', () => {
    expect(pluralise(1, 'box')).toBe('1 box')
    expect(pluralise(-1, 'box')).toBe('-1 box')
  })

  it('adds a plain -s to ordinary words', () => {
    expect(pluralise(3, 'bottle')).toBe('3 bottles')
    expect(pluralise(3, 'case')).toBe('3 cases')
  })
})

describe('formatQtyShort', () => {
  it('gives the headline unit only', () => {
    expect(formatQtyShort(72, BOTTLES)).toBe('3 boxes')
    expect(formatQtyShort(12, BOTTLES)).toBe('12 bottles')
    expect(formatQtyShort(72, LOOSE)).toBe('72 bottles')
  })

  it('marks a part-used pack with a + so it never reads as exact', () => {
    expect(formatQtyShort(77, BOTTLES)).toBe('3 boxes +')
  })
})

describe('toBaseUnits', () => {
  it('adds packs and loose units together', () => {
    expect(toBaseUnits(2, 3, 24)).toBe(51)
    expect(toBaseUnits(1, 0, 24)).toBe(24)
    expect(toBaseUnits(0, 5, 24)).toBe(5)
  })

  it('round-trips through splitPacks', () => {
    const { packs, loose } = splitPacks(77, 24)
    expect(toBaseUnits(packs, loose, 24)).toBe(77)
  })

  it('accepts the strings a text input produces', () => {
    expect(toBaseUnits('2', '3', 24)).toBe(51)
  })
})

describe('previewAfter', () => {
  it('shows what the location will hold once the movement lands', () => {
    expect(previewAfter(72, -24, BOTTLES)).toBe('2 boxes (48 bottles)')
  })

  it('previews the negative so "Record it anyway" states the consequence', () => {
    expect(previewAfter(6, -30, BOTTLES)).toBe('−24 bottles (short)')
  })

  it('has nothing to preview for a zero delta', () => {
    expect(previewAfter(72, 0, BOTTLES)).toBeNull()
  })
})
