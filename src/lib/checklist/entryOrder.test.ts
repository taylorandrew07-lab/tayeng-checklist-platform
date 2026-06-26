import { describe, it, expect } from 'vitest'
import { presentInstances, resolveEntryOrder, nextInstanceId, moveEntry } from './entryOrder'

describe('entryOrder', () => {
  it('finds instances that carry data (ignoring blanks)', () => {
    const present = presentInstances(['f1', 'f2'], [
      { f1: 'a', 'f1@@1': 'b', 'f1@@2': '', f2: '', 'f2@@1': [] as any },
      { 'f2@@3': ['x'] },
    ])
    expect([...present].sort((a, b) => a - b)).toEqual([0, 1, 3]) // 2 blank, f2@@1 empty
  })

  it('falls back to natural ascending order with no stored order', () => {
    expect(resolveEntryOrder(new Set([0, 1, 2]))).toEqual([0, 1, 2])
  })

  it('honours a stored order and drops ids with no data', () => {
    // Stored [2,0,1] but instance 1 was emptied → [2,0]
    expect(resolveEntryOrder(new Set([0, 2]), [2, 0, 1])).toEqual([2, 0])
  })

  it('appends present-but-unordered ids (drift safety)', () => {
    expect(resolveEntryOrder(new Set([0, 1, 5]), [1, 0])).toEqual([1, 0, 5])
  })

  it('guarantees at least one entry for an empty section', () => {
    expect(resolveEntryOrder(new Set())).toEqual([0])
    expect(resolveEntryOrder(new Set(), [])).toEqual([0])
  })

  it('never reuses an instance id', () => {
    expect(nextInstanceId([0, 1, 2])).toBe(3)
    expect(nextInstanceId([0, 3, 1])).toBe(4) // after a delete left a gap
    expect(nextInstanceId([])).toBe(0)
  })

  it('moves an entry up and down', () => {
    expect(moveEntry([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]) // 9→4 style
    expect(moveEntry([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3])
    expect(moveEntry([0, 1, 2], 1, 99)).toEqual([0, 2, 1]) // clamp
  })
})
