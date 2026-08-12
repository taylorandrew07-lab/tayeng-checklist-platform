import { describe, it, expect } from 'vitest'
import type { FieldOption } from '@/lib/types/database'
import {
  resolveAnswerOptions,
  getDefaultAnswerOptions,
  answerColor,
  answerBadgeText,
  isAnswerFamily,
} from './answerOptions'

// The point of this file: the option LIST became template-driven so the Pre-Hire
// Inspection template can offer "Not inspected" alongside Yes/No/N-A. That must not
// change a single existing field, so the first block pins the old behaviour exactly.

describe('resolveAnswerOptions — backward compatibility', () => {
  it('falls back to the defaults when a field has no options', () => {
    expect(resolveAnswerOptions('yes_no_na', null).map(o => o.value)).toEqual(['yes', 'no', 'na'])
    expect(resolveAnswerOptions('yes_no', []).map(o => o.value)).toEqual(['yes', 'no'])
    expect(resolveAnswerOptions('pass_fail', undefined).map(o => o.value)).toEqual(['pass', 'fail'])
  })

  it('renders migration 008 backfilled sets exactly as before', () => {
    // The literal JSON written by 008_backfill_yesno_options.sql.
    const backfilled = [
      { value: 'yes', label: 'Yes', color: 'green' as const },
      { value: 'no', label: 'No', color: 'red' as const },
      { value: 'na', label: 'N/A', color: 'gray' as const },
    ]
    expect(resolveAnswerOptions('yes_no_na', backfilled)).toEqual(backfilled)
  })

  it('keeps the reversed colours on Brine item 6 (yes=amber, no=green)', () => {
    // migration 137: an item where "No" is the desired answer.
    const reversed = [
      { value: 'yes', label: 'Yes', color: 'amber' as const },
      { value: 'no', label: 'No', color: 'green' as const },
      { value: 'na', label: 'N/A', color: 'gray' as const },
    ]
    const got = resolveAnswerOptions('yes_no_na', reversed)
    expect(got.map(o => [o.value, o.color])).toEqual([['yes', 'amber'], ['no', 'green'], ['na', 'gray']])
  })

  it('keeps the UHT pass/fail colours (migration 074)', () => {
    const uht = [
      { value: 'pass', label: 'Pass', color: 'green' as const },
      { value: 'fail', label: 'Fail', color: 'red' as const },
    ]
    expect(resolveAnswerOptions('pass_fail', uht)).toEqual(uht)
  })

  it('applies a partial colour-only override without losing the default choices', () => {
    // A single unlabelled entry is not a usable list, but its colour must still win.
    // Cast: `label` is required on FieldOption, but options arrive from JSONB, where a
    // hand-written partial override is possible — that is the case being guarded.
    const got = resolveAnswerOptions('yes_no_na', [{ value: 'no', color: 'green' } as FieldOption])
    expect(got.map(o => o.value)).toEqual(['yes', 'no', 'na'])
    expect(got.find(o => o.value === 'no')?.color).toBe('green')
    expect(got.find(o => o.value === 'yes')?.color).toBe('green')
  })
})

describe('resolveAnswerOptions — template-supplied lists', () => {
  const fourWay = [
    { value: 'yes', label: 'Yes', color: 'green' as const },
    { value: 'no', label: 'No', color: 'red' as const },
    { value: 'na', label: 'N/A', color: 'gray' as const },
    { value: 'ni', label: 'Not inspected', color: 'gray' as const },
  ]

  it('uses a complete labelled list verbatim, in order', () => {
    expect(resolveAnswerOptions('yes_no_na', fourWay).map(o => o.label))
      .toEqual(['Yes', 'No', 'N/A', 'Not inspected'])
  })

  it('colours a value the template did not colour, from the house vocabulary', () => {
    const got = resolveAnswerOptions('yes_no_na', [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'ni', label: 'Not inspected' },
    ])
    expect(got.map(o => o.color)).toEqual(['green', 'red', 'gray'])
  })

  it('does not mutate the caller’s options array', () => {
    const input = fourWay.map(o => ({ ...o }))
    resolveAnswerOptions('yes_no_na', input)
    expect(input).toEqual(fourWay)
  })

  it('getDefaultAnswerOptions returns a fresh copy each call', () => {
    const a = getDefaultAnswerOptions('yes_no_na')
    a[0].color = 'amber'
    expect(getDefaultAnswerOptions('yes_no_na')[0].color).toBe('green')
  })
})

describe('PDF helpers', () => {
  it('answerColor prefers the template, then the house default, then grey', () => {
    expect(answerColor('no', [{ value: 'no', label: 'No', color: 'green' }])).toBe('green')
    expect(answerColor('no', [])).toBe('red')
    expect(answerColor('ni', [])).toBe('gray')
    expect(answerColor('something-else', [])).toBe('gray')
  })

  it('answerBadgeText keeps the badge short', () => {
    expect(answerBadgeText('', [])).toBe('—')
    expect(answerBadgeText('yes', [])).toBe('YES')
    // A long label falls back to the value, so the fixed-width badge cell still fits.
    expect(answerBadgeText('ni', [{ value: 'ni', label: 'Not inspected' }])).toBe('NI')
    expect(answerBadgeText('na', [{ value: 'na', label: 'N/A' }])).toBe('N/A')
  })
})

describe('isAnswerFamily', () => {
  it('matches only the three yes/no-family types', () => {
    expect(['yes_no', 'yes_no_na', 'pass_fail'].every(isAnswerFamily)).toBe(true)
    expect(['text', 'dropdown', 'multiple_choice', 'photo', null, undefined].some(isAnswerFamily)).toBe(false)
  })
})
