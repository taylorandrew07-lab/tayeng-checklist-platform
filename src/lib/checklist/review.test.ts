import { describe, it, expect } from 'vitest'
import { reviewChecklist, type ReviewSection } from './review'
import { instanceKey } from '@/lib/offline/instanceKeys'
import type { FieldOption } from '@/lib/types/database'

/** yes_no_na with the house colours: yes green, no red, na grey, ni amber. */
const YN = null // null options => resolveAnswerOptions falls back to the defaults

/** A reversed question: answering YES is the problem, so Yes is red and No is green. */
const REVERSED: FieldOption[] = [
  { value: 'yes', label: 'Yes', color: 'red' },
  { value: 'no', label: 'No', color: 'green' },
  { value: 'na', label: 'N/A', color: 'gray' },
]

function base(sections: ReviewSection[], over: Partial<Parameters<typeof reviewChecklist>[0]> = {}) {
  return reviewChecklist({
    sections,
    values: {},
    arrayValues: {},
    signatures: {},
    instancesFor: () => [0],
    hasPhoto: () => false,
    ...over,
  })
}

describe('reviewChecklist — findings', () => {
  const sections: ReviewSection[] = [{
    id: 's1',
    fields: [
      { id: 'a', label: 'Are the certificates valid?', field_type: 'yes_no_na', item_number: '3.1', options: YN },
      { id: 'b', label: 'Any outstanding conditions of class?', field_type: 'yes_no_na', item_number: '3.5', options: REVERSED },
    ],
  }]

  it('reports a red No, and does NOT report a green No on a reversed question', () => {
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'no', [instanceKey('b', 0)]: 'no' },
    })
    expect(findings.map(f => f.itemNumber)).toEqual(['3.1'])
    expect(findings[0].severity).toBe('red')
  })

  it('reports a red Yes on a reversed question — the word is never the rule', () => {
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'yes', [instanceKey('b', 0)]: 'yes' },
    })
    expect(findings.map(f => f.itemNumber)).toEqual(['3.5'])
    expect(findings[0].severity).toBe('red')
  })

  it('treats Not Inspected as an amber finding, and N/A as no finding', () => {
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'ni', [instanceKey('b', 0)]: 'na' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('amber')
  })

  it('splits the remark off an "answer|||remarks" value', () => {
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'no|||two certificates expired' },
    })
    expect(findings[0].answer).toBe('NO')   // answerBadgeText upper-cases the badge
    expect(findings[0].remark).toBe('two certificates expired')
  })

  it('keeps a remark that itself contains the separator', () => {
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'no|||a|||b' },
    })
    expect(findings[0].remark).toBe('a|||b')
  })
})

describe('reviewChecklist — unanswered', () => {
  const sections: ReviewSection[] = [{
    id: 's1',
    fields: [
      { id: 'txt', label: 'Master name', field_type: 'text', item_number: '6.1' },
      { id: 'sig', label: 'Signature', field_type: 'signature', item_number: '15.1' },
      { id: 'mc', label: 'Certificates sighted', field_type: 'multiple_choice', item_number: '3.2' },
      { id: 'pic', label: 'Ship particulars', field_type: 'photo', item_number: '2.11' },
      { id: 'head', label: 'A heading', field_type: 'heading' },
      { id: 'calc', label: 'Difference', field_type: 'calculated' },
    ],
  }]

  it('lists every blank answerable question and never a heading or a calc', () => {
    const { unanswered } = base(sections)
    expect(unanswered.map(u => u.fieldId)).toEqual(['txt', 'sig', 'mc', 'pic'])
  })

  it('counts a signature, a multi-select and a photo as answered when present', () => {
    const { unanswered } = base(sections, {
      values: { [instanceKey('txt', 0)]: 'Capt. Ali' },
      signatures: { [instanceKey('sig', 0)]: 'data:image/png;base64,x' },
      arrayValues: { [instanceKey('mc', 0)]: ['load_line'] },
      hasPhoto: (id) => id === 'pic',
    })
    expect(unanswered).toEqual([])
  })

  it('treats a remark with no answer picked as still unanswered', () => {
    const { unanswered } = base(sections, {
      values: { [instanceKey('txt', 0)]: '|||just a note' },
    })
    expect(unanswered.map(u => u.fieldId)).toContain('txt')
  })

  it('restricts to required questions when asked', () => {
    const withReq: ReviewSection[] = [{
      id: 's1',
      fields: [
        { id: 'r', label: 'Required', field_type: 'text', is_required: true },
        { id: 'o', label: 'Optional', field_type: 'text', is_required: false },
      ],
    }]
    expect(base(withReq, { requiredOnly: true }).unanswered.map(u => u.fieldId)).toEqual(['r'])
    expect(base(withReq).unanswered.map(u => u.fieldId)).toEqual(['r', 'o'])
  })

  it('skips questions the form is hiding — they were not "left" unanswered', () => {
    const { unanswered } = base(sections, {
      isVisible: (_s, f) => f.id !== 'txt',
    })
    expect(unanswered.map(u => u.fieldId)).not.toContain('txt')
  })

  it('a blank question is never also counted as a finding', () => {
    const yn: ReviewSection[] = [{ id: 's', fields: [{ id: 'q', label: 'Q', field_type: 'yes_no_na', options: YN }] }]
    const { unanswered, findings } = base(yn)
    expect(unanswered).toHaveLength(1)
    expect(findings).toHaveLength(0)
  })
})

describe('reviewChecklist — repeatable sections', () => {
  const sections: ReviewSection[] = [{
    id: 'rep',
    is_repeatable: true,
    fields: [{ id: 'q', label: 'Line condition', field_type: 'yes_no_na', item_number: '4.1', options: null }],
  }]

  it('walks every entry and keys each row to its own instance', () => {
    const { findings, unanswered } = reviewChecklist({
      sections,
      values: { [instanceKey('q', 0)]: 'no', [instanceKey('q', 2)]: 'yes' },
      arrayValues: {},
      signatures: {},
      instancesFor: () => [0, 2, 5],
      hasPhoto: () => false,
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].instance).toBe(0)
    expect(findings[0].key).toBe(instanceKey('q', 0))
    // Entry 5 was never filled in.
    expect(unanswered.map(u => u.instance)).toEqual([5])
  })
})

describe('reviewChecklist — ordering and labels', () => {
  it('returns rows in checklist order, section by section', () => {
    const sections: ReviewSection[] = [
      { id: 's1', fields: [{ id: 'a', label: 'A', field_type: 'yes_no_na', item_number: '1.1', options: null }] },
      { id: 's2', fields: [{ id: 'b', label: 'B', field_type: 'yes_no_na', item_number: '2.1', options: null }] },
    ]
    const { findings } = base(sections, {
      values: { [instanceKey('b', 0)]: 'no', [instanceKey('a', 0)]: 'no' },
    })
    expect(findings.map(f => f.itemNumber)).toEqual(['1.1', '2.1'])
  })

  it('runs labels through the caller resolver', () => {
    const sections: ReviewSection[] = [
      { id: 's', fields: [{ id: 'a', label: 'Condition of {x}', field_type: 'yes_no_na', options: null }] },
    ]
    const { findings } = base(sections, {
      values: { [instanceKey('a', 0)]: 'no' },
      resolveLabel: (l) => l.replace('{x}', 'No.3 line'),
    })
    expect(findings[0].label).toBe('Condition of No.3 line')
  })
})
