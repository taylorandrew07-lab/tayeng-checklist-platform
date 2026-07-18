import { describe, it, expect } from 'vitest'
import { clearHiddenAnswers, type VisibilityUnit } from './clearHidden'

const showWhen = (field: string, value: string, operator: 'equals' | 'not_equals' = 'equals') =>
  ({ operator: 'and' as const, conditions: [{ field_id: field, operator, value }] })

describe('clearHiddenAnswers', () => {
  it('returns null when nothing is hidden', () => {
    const units: VisibilityUnit[] = [
      { key: '20', logic: null },
      { key: '20A', logic: showWhen('20', 'yes') },
    ]
    expect(clearHiddenAnswers(units, { '20': 'yes', '20A': 'no' })).toBeNull()
  })

  it('returns null when there is nothing to clear, even if fields are hidden', () => {
    const units: VisibilityUnit[] = [{ key: '20A', logic: showWhen('20', 'yes') }]
    expect(clearHiddenAnswers(units, { '20': 'no' })).toBeNull()
  })

  it('clears an answer whose parent no longer shows it', () => {
    const units: VisibilityUnit[] = [
      { key: '20', logic: null },
      { key: '20A', logic: showWhen('20', 'yes') },
    ]
    const out = clearHiddenAnswers(units, { '20': 'no', '20A': 'no' })
    expect(out).toEqual({ '20': 'no', '20A': '' })
  })

  it('does not mutate the input map', () => {
    const values = { '20': 'no', '20A': 'no' }
    clearHiddenAnswers([{ key: '20A', logic: showWhen('20', 'yes') }], values)
    expect(values['20A']).toBe('no')
  })

  // The exact Brine Transfer defect this module exists to fix.
  it('stops item 22 lingering after its trigger is corrected away', () => {
    const units: VisibilityUnit[] = [
      { key: '20', logic: null },
      { key: '20A', logic: showWhen('20', 'yes') },
      {
        key: '22',
        logic: {
          operator: 'or',
          conditions: [
            { field_id: '20A', operator: 'equals', value: 'no' },
            { field_id: '21A', operator: 'equals', value: 'no' },
          ],
        },
      },
    ]
    // Surveyor said 20=Yes, 20A=No (so 22 appeared and was answered), then corrected 20 to No.
    const out = clearHiddenAnswers(units, { '20': 'no', '20A': 'no', '22': 'yes' })
    // 20A clears because 20 is No; then 22 clears because its trigger is gone.
    expect(out).toEqual({ '20': 'no', '20A': '', '22': '' })
  })

  it('cascades down a three-level chain (6 → 6A → 6B)', () => {
    const units: VisibilityUnit[] = [
      { key: '6', logic: null },
      { key: '6A', logic: showWhen('6', 'yes') },
      {
        key: '6B',
        logic: {
          operator: 'and',
          conditions: [
            { field_id: '6', operator: 'equals', value: 'yes' },
            { field_id: '6A', operator: 'equals', value: 'no' },
          ],
        },
      },
    ]
    const out = clearHiddenAnswers(units, { '6': 'no', '6A': 'no', '6B': 'yes' })
    expect(out).toEqual({ '6': 'no', '6A': '', '6B': '' })
  })

  it('clears answers in a hidden section', () => {
    const sectionLogic = showWhen('phase1_done', 'yes')
    const units: VisibilityUnit[] = [
      { key: 'a', logic: null, sectionLogic },
      { key: 'b', logic: null, sectionLogic },
    ]
    expect(clearHiddenAnswers(units, { a: 'x', b: 'y' })).toEqual({ a: '', b: '' })
  })

  it('leaves visible answers untouched', () => {
    const units: VisibilityUnit[] = [
      { key: '6', logic: null },
      { key: '6A', logic: showWhen('6', 'yes') },
    ]
    expect(clearHiddenAnswers(units, { '6': 'yes', '6A': 'no' })).toBeNull()
  })

  it('handles remarks-suffixed values (yes|||note) via the shared evaluator', () => {
    const units: VisibilityUnit[] = [
      { key: '20', logic: null },
      { key: '20A', logic: showWhen('20', 'yes') },
    ]
    // Parent is "yes" with remarks — 20A must stay visible, so nothing is cleared.
    expect(clearHiddenAnswers(units, { '20': 'yes|||sampled at 0900', '20A': 'no' })).toBeNull()
  })

  it('leaves a mutually-satisfying pair alone (both are genuinely visible)', () => {
    const units: VisibilityUnit[] = [
      { key: 'x', logic: showWhen('y', 'yes') },
      { key: 'y', logic: showWhen('x', 'yes') },
    ]
    expect(clearHiddenAnswers(units, { x: 'yes', y: 'yes' })).toBeNull()
  })

  // Ultrasonic Hatch Testing gates 18 Hold/Bilge fields on a "Number of holds" NUMBER input with
  // `greater_than`. A number input passes through '' on every keystroke, and parseFloat('') is NaN
  // so every gated field reads as hidden. The caller must not sweep on an empty new value — this
  // documents what would be destroyed if that guard were ever removed.
  it('would blank every gated answer when a numeric parent is momentarily empty', () => {
    const gated = (n: number): VisibilityUnit => ({
      key: `hold${n}`,
      logic: { operator: 'and', conditions: [{ field_id: 'holds', operator: 'greater_than', value: String(n - 1) }] },
    })
    const units = [{ key: 'holds', logic: null }, ...[1, 2, 3].map(gated)]
    const answered = { holds: '3', hold1: 'pass', hold2: 'pass', hold3: 'fail' }

    // Parent intact — nothing is touched.
    expect(clearHiddenAnswers(units, answered)).toBeNull()

    // Parent momentarily blank mid-keystroke — everything would go. Hence the guard in
    // JobChecklistEditor.updateValue, which never calls this with an empty new value.
    expect(clearHiddenAnswers(units, { ...answered, holds: '' }))
      .toEqual({ holds: '', hold1: '', hold2: '', hold3: '' })

    // Genuinely reducing the count clears only the answers that are now out of range.
    expect(clearHiddenAnswers(units, { ...answered, holds: '2' }))
      .toEqual({ holds: '2', hold1: 'pass', hold2: 'pass', hold3: '' })
  })

  it('terminates on a cyclic template that hides itself, instead of spinning', () => {
    // Each is shown only when the other is 'yes', but both hold 'no' — so both are hidden,
    // and clearing either keeps the other hidden. Must settle, not loop.
    const units: VisibilityUnit[] = [
      { key: 'x', logic: showWhen('y', 'yes') },
      { key: 'y', logic: showWhen('x', 'yes') },
    ]
    const out = clearHiddenAnswers(units, { x: 'no', y: 'no' })
    expect(out).toEqual({ x: '', y: '' })
  })
})
