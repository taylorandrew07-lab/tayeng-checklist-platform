import { describe, it, expect } from 'vitest'
import { itemNumberFor, applyItemNumbering, isLayoutField } from './itemNumbering'

const f = (field_type: string, item_number?: string | null) => ({ field_type, item_number })

describe('isLayoutField', () => {
  it('identifies headings and dividers', () => {
    expect(isLayoutField(f('heading'))).toBe(true)
    expect(isLayoutField(f('divider'))).toBe(true)
    expect(isLayoutField(f('yes_no'))).toBe(false)
  })
})

describe('applyItemNumbering — auto mode (pre-existing behaviour, must not change)', () => {
  it('renumbers a plain section 1..n and skips layout fields', () => {
    const out = applyItemNumbering([
      f('heading'),
      f('yes_no', '1'),
      f('yes_no', '2'),
      f('divider'),
      f('text', '3'),
    ])
    expect(out.map(x => x.item_number)).toEqual(['', '1', '2', '', '3'])
    expect(out.map(x => x.order_index)).toEqual([0, 1, 2, 3, 4])
  })

  it('stamps numbers onto a section that had none', () => {
    const out = applyItemNumbering([f('yes_no'), f('yes_no'), f('text')])
    expect(out.map(x => x.item_number)).toEqual(['1', '2', '3'])
  })

  it('renumbers after a reorder', () => {
    const out = applyItemNumbering([f('text', '3'), f('yes_no', '1'), f('yes_no', '2')])
    expect(out.map(x => x.item_number)).toEqual(['1', '2', '3'])
  })

  it('overwrites hand-authored numbers — which is exactly why manual mode exists', () => {
    const out = applyItemNumbering([f('yes_no', '6'), f('yes_no', '6A'), f('yes_no', '7')])
    expect(out.map(x => x.item_number)).toEqual(['1', '2', '3'])
  })
})

describe('applyItemNumbering — manual mode', () => {
  it('preserves the Brine segregation chain 6 / 6A / 6B across an edit', () => {
    const out = applyItemNumbering([
      f('heading'),
      f('yes_no', '6'),
      f('yes_no', '6A'),
      f('yes_no', '6B'),
      f('yes_no', '7'),
    ], true)
    expect(out.map(x => x.item_number)).toEqual(['', '6', '6A', '6B', '7'])
  })

  it('preserves numbering that continues across phases rather than restarting', () => {
    // FINAL phase of Brine — starts at 27, not 1.
    const out = applyItemNumbering([
      f('heading'),
      f('yes_no', '27'),
      f('yes_no', '28'),
      f('yes_no', '30'),
      f('number', '30A'),
    ], true)
    expect(out.map(x => x.item_number)).toEqual(['', '27', '28', '30', '30A'])
  })

  it('preserves the recovered BPTT reconciliation numbering C1A..C1D', () => {
    const out = applyItemNumbering([
      f('number', 'C1A'),
      f('number', 'C1B'),
      f('calculated', 'C1C'),
      f('calculated', 'C1D'),
    ], true)
    expect(out.map(x => x.item_number)).toEqual(['C1A', 'C1B', 'C1C', 'C1D'])
  })

  it('still re-stamps order_index so reordering persists', () => {
    const out = applyItemNumbering([f('yes_no', '9'), f('yes_no', '8')], true)
    expect(out.map(x => x.order_index)).toEqual([0, 1])
    expect(out.map(x => x.item_number)).toEqual(['9', '8'])
  })

  it('leaves layout fields unnumbered', () => {
    const out = applyItemNumbering([f('heading', 'ignored'), f('yes_no', '1A')], true)
    expect(out.map(x => x.item_number)).toEqual(['', '1A'])
  })

  it('is idempotent', () => {
    const once = applyItemNumbering([f('yes_no', '6'), f('yes_no', '6A')], true)
    expect(applyItemNumbering(once, true)).toEqual(once)
  })
})

describe('itemNumberFor', () => {
  it('agrees with applyItemNumbering in both modes so builder and report never disagree', () => {
    const fields = [f('heading'), f('yes_no', '6'), f('yes_no', '6A'), f('yes_no', '7')]
    for (const manual of [false, true]) {
      const stamped = applyItemNumbering(fields, manual)
      fields.forEach((_, i) => expect(itemNumberFor(fields, i, manual)).toBe(stamped[i].item_number))
    }
  })

  it('returns empty for an out-of-range index', () => {
    expect(itemNumberFor([f('yes_no', '1')], 5)).toBe('')
  })
})
