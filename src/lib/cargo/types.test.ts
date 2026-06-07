import { describe, it, expect } from 'vitest'
import {
  cloneReadingTypes, readingTypeAppliesToHold, defaultReadingTypes, type ReadingType,
} from './types'

const rt = (over: Partial<ReadingType> = {}): ReadingType => ({
  id: 'rt_1', name: 'O2', unit: '%', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true, ...over,
})

describe('cloneReadingTypes', () => {
  it('produces an independent copy — mutating the clone never touches the source', () => {
    const source = [rt({ appliesTo: [1, 2, 3] })]
    const clone = cloneReadingTypes(source)

    // Different array + element identity
    expect(clone).not.toBe(source)
    expect(clone[0]).not.toBe(source[0])
    expect(clone[0].appliesTo).not.toBe(source[0].appliesTo)

    // Mutating the clone's appliesTo must not bleed into the source
    ;(clone[0].appliesTo as number[]).push(99)
    expect(source[0].appliesTo).toEqual([1, 2, 3])
  })

  it('preserves the "all" sentinel', () => {
    const clone = cloneReadingTypes([rt({ appliesTo: 'all' })])
    expect(clone[0].appliesTo).toBe('all')
  })

  it('deep-copies the default reading set', () => {
    const defaults = defaultReadingTypes()
    const clone = cloneReadingTypes(defaults)
    expect(clone).toHaveLength(defaults.length)
    expect(clone[0]).not.toBe(defaults[0])
  })
})

describe('readingTypeAppliesToHold', () => {
  it('"all" applies to every hold', () => {
    expect(readingTypeAppliesToHold(rt({ appliesTo: 'all' }), 7)).toBe(true)
  })
  it('a hold list applies only to listed holds', () => {
    const r = rt({ appliesTo: [1, 3] })
    expect(readingTypeAppliesToHold(r, 1)).toBe(true)
    expect(readingTypeAppliesToHold(r, 2)).toBe(false)
    expect(readingTypeAppliesToHold(r, 3)).toBe(true)
  })
})
