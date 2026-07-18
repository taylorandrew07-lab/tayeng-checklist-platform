/**
 * Behavioural verification of the shipped conditional-logic engine against the REAL template
 * structures pulled from the production database (see __fixtures__/liveTemplates.json, dumped
 * after migration 137 applied).
 *
 * Unit tests elsewhere use hand-made data and prove the functions work. These prove the actual
 * seeded Brine Transfer template behaves to spec, and that Ultrasonic Hatch Testing — whose 18
 * hold/bilge fields are gated on a NUMBER field inside a repeatable section — cannot lose answers.
 * Re-dump the fixture if either template is restructured.
 */
import { describe, it, expect } from 'vitest'
import { checkConditionalLogic } from '@/lib/utils'
import { clearHiddenAnswers, type VisibilityUnit } from './clearHidden'
import live from './__fixtures__/liveTemplates.json'

type Field = {
  id: string; section_id: string; label: string; field_type: string
  item_number: string | null; is_required: boolean; unit: string | null
  validation: any; calculation_formula: string | null; conditional_logic: any; options: any
}
type Tpl = { sections: Array<{ id: string; title: string; is_repeatable: boolean; conditional_logic: any }>; fields: Field[] }

const brine = live.brine as unknown as Tpl
const uht = live.uht as unknown as Tpl

/** Look a Brine field up by the item number printed on the paper form. */
const item = (n: string): Field => {
  const f = brine.fields.find(x => x.item_number === n)
  if (!f) throw new Error(`Brine item ${n} not found in the live template`)
  return f
}
const visible = (f: Field, values: Record<string, string>) =>
  checkConditionalLogic(f.conditional_logic, values)

/** Build values keyed by real field id from an item-number map. */
const vals = (spec: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [num, v] of Object.entries(spec)) out[item(num).id] = v
  return out
}

const brineUnits = (): VisibilityUnit[] =>
  brine.sections.flatMap(s =>
    brine.fields
      .filter(f => f.section_id === s.id && !['heading', 'divider'].includes(f.field_type))
      .map(f => ({ key: f.id, logic: f.conditional_logic, sectionLogic: s.conditional_logic })),
  )

/** The four sample chains: [sample taken?, approved?, charterers notified?]. */
const SAMPLE_CHAINS: Array<[string, string, string]> = [
  ['20', '20A', '20B'],  // line sample at commencement
  ['21', '21A', '21B'],  // first foot samples
  ['23', '23A', '23B'],  // second line sample on resumption
  ['24', '24A', '24B'],  // periodic samples
]

describe('Brine Transfer — conditional rules, against the live seeded template', () => {
  // Every "iff parent = Yes" rule from the source form.
  const simple: Array<[string, string]> = [
    ['1A', '1'], ['4A', '4'], ['6A', '6'], ['20A', '20'],
    ['21A', '21'], ['23A', '23'], ['24A', '24'], ['29A', '29'], ['31A', '31'],
  ]
  it.each(simple)('%s is shown only when %s is Yes', (child, parent) => {
    expect(visible(item(child), vals({ [parent]: 'yes' }))).toBe(true)
    expect(visible(item(child), vals({ [parent]: 'no' }))).toBe(false)
    expect(visible(item(child), vals({ [parent]: 'na' }))).toBe(false)
    expect(visible(item(child), {})).toBe(false)
  })

  it('6B is shown only when 6 is Yes AND 6A is No (the two-level branch)', () => {
    expect(visible(item('6B'), vals({ '6': 'yes', '6A': 'no' }))).toBe(true)
    expect(visible(item('6B'), vals({ '6': 'yes', '6A': 'yes' }))).toBe(false)
    expect(visible(item('6B'), vals({ '6': 'no', '6A': 'no' }))).toBe(false)
    // The case the ancestor chain exists to prevent: 6=No, so 6A never showed and is blank.
    expect(visible(item('6B'), vals({ '6': 'no' }))).toBe(false)
  })

  // Migration 138 replaced the single item 22 with a per-sample escalation, so the
  // off-spec question always sits directly under the sample that failed.
  it.each(SAMPLE_CHAINS)('%s → %s → %s escalates only on a failed inspection', (n, a, b) => {
    expect(visible(item(b), vals({ [n]: 'yes', [a]: 'no' }))).toBe(true)
    expect(visible(item(b), vals({ [n]: 'yes', [a]: 'yes' }))).toBe(false)
    expect(visible(item(b), vals({ [n]: 'yes', [a]: 'na' }))).toBe(false)
    // Sample never taken: the approval question never showed, so no escalation.
    expect(visible(item(b), vals({ [n]: 'no' }))).toBe(false)
    expect(visible(item(b), {})).toBe(false)
  })

  it('keeps the four escalations independent of each other', () => {
    // A failure on the line sample must not raise the periodic-sample escalation.
    const v = vals({ '20': 'yes', '20A': 'no' })
    expect(visible(item('20B'), v)).toBe(true)
    for (const b of ['21B', '23B', '24B']) expect(visible(item(b), v)).toBe(false)
  })

  it('no longer carries the old cross-section item 22', () => {
    const offSpec = brine.fields.filter(f => /charterers been notified/i.test(f.label))
    expect(offSpec).toHaveLength(4)
    // Every one is gated on its own two-step chain, not an OR across sections.
    for (const f of offSpec) {
      expect(f.conditional_logic.operator).toBe('and')
      expect(f.conditional_logic.conditions).toHaveLength(2)
    }
  })

  it('remarks on a parent answer do not break its children (yes|||note)', () => {
    expect(visible(item('20A'), vals({ '20': 'yes|||sampled at 0900' }))).toBe(true)
  })

  // The defect that motivated clearHiddenAnswers, replayed on the real template.
  it.each(SAMPLE_CHAINS)('correcting %s clears %s and retires %s', (n, a, b) => {
    const before = vals({ [n]: 'yes', [a]: 'no', [b]: 'yes' })
    expect(visible(item(b), before)).toBe(true)

    const corrected = { ...before, [item(n).id]: 'no' }
    const after = clearHiddenAnswers(brineUnits(), corrected)

    expect(after).not.toBeNull()
    expect(after![item(a).id]).toBe('')
    expect(after![item(b).id]).toBe('')
    expect(visible(item(b), after!)).toBe(false)
  })

  it('clears the whole 6 → 6A → 6B chain in one pass', () => {
    const answered = vals({ '6': 'yes', '6A': 'no', '6B': 'yes' })
    const corrected = { ...answered, [item('6').id]: 'no' }
    const after = clearHiddenAnswers(brineUnits(), corrected)
    expect(after![item('6A').id]).toBe('')
    expect(after![item('6B').id]).toBe('')
  })

  it('leaves a fully consistent checklist untouched', () => {
    const consistent = vals({ '6': 'yes', '6A': 'yes', '20': 'yes', '20A': 'yes' })
    expect(clearHiddenAnswers(brineUnits(), consistent)).toBeNull()
  })
})

describe('Brine Transfer — structure, against the live seeded template', () => {
  it('carries items 1..32 plus every lettered sub-item', () => {
    const nums = brine.fields.map(f => f.item_number).filter(Boolean) as string[]
    for (let n = 1; n <= 32; n++) expect(nums, `item ${n}`).toContain(String(n))
    for (const l of ['1A', '4A', '6A', '6B', '20A', '20B', '21A', '21B', '23A', '23B', '24A', '24B', '29A', '31A']) {
      expect(nums, `item ${l}`).toContain(l)
    }
    expect(nums, 'item 33 was retired when item 22 was removed').not.toContain('33')
  })

  it('withholds N/A only where the answer cannot legitimately be "not applicable"', () => {
    // Shore-side soundings and meter photographs, and the cargo certificate. The vessel-side
    // equivalents (14, 15, 28, 29) DO offer N/A — a ship may have no ATGs and no flow meter.
    const strict = brine.fields.filter(f => f.field_type === 'yes_no').map(f => f.item_number).sort()
    expect(strict).toEqual(['9', '10', '30', '31', '32'].sort())
    for (const n of ['14', '15', '28', '29']) expect(item(n).field_type).toBe('yes_no_na')
  })

  it('reverse-colours item 6 so a single cargo type reads green', () => {
    const six = item('6').options as Array<{ value: string; color?: string }>
    expect(six.find(o => o.value === 'no')?.color).toBe('green')
    expect(six.find(o => o.value === 'yes')?.color).toBe('amber')
  })

  it('reports the difference and its variance on ONE line, as the fuel report does', () => {
    const calcs = brine.fields.filter(f => f.field_type === 'calculated')
    expect(calcs, 'a separate % Variance row would print on its own line').toHaveLength(1)

    const diff = calcs[0]
    const ship = brine.fields.find(f => f.label === "Ship's figure")!
    const shore = brine.fields.find(f => f.label === 'Shore figure')!

    expect(diff.calculation_formula).toBe(`{${ship.id}}-{${shore.id}}`)
    expect(diff.unit).toBe('BBLS')
    expect(diff.validation.display_as).toBe('percentage')
    // The denominator is the LAST token in the formula — it must be the SHORE figure.
    const tokens = Array.from(diff.calculation_formula!.matchAll(/\{([^}]+)\}/g), m => m[1])
    expect(tokens[tokens.length - 1]).toBe(shore.id)
    expect(diff.validation.thresholds).toEqual([
      { max: 1, color: 'green' }, { max: 2, color: 'amber' }, { color: 'red' },
    ])
  })

  it('carries the header fields the report puts in its right-hand column', () => {
    // JobPDF finds these by label and suppresses them from the body (JobPDF.tsx:530-532, 543-549).
    expect(brine.fields.find(f => /\bdate\b/i.test(f.label))?.field_type).toBe('date')
    expect(brine.fields.find(f => /\bport\b/i.test(f.label))?.field_type).toBe('text')
    expect(brine.fields.find(f => /method.*delivery/i.test(f.label))?.field_type).toBe('dropdown')
  })

  it('has no in-section sub-headings left', () => {
    expect(brine.fields.filter(f => f.field_type === 'heading')).toEqual([])
  })

  it('keeps the repeatable hourly section free of conditionals and required fields', () => {
    const hourly = brine.sections.find(s => s.is_repeatable)!
    const fields = brine.fields.filter(f => f.section_id === hourly.id)
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.filter(f => f.conditional_logic)).toEqual([])
    expect(fields.filter(f => f.is_required)).toEqual([])
  })
})

describe('Ultrasonic Hatch Testing — the numeric-parent data-loss guard', () => {
  const holdsField = uht.fields.find(f => /number of holds/i.test(f.label))!
  const gated = uht.fields.filter(f => f.conditional_logic)
  const units: VisibilityUnit[] = uht.sections.flatMap(s =>
    uht.fields
      .filter(f => f.section_id === s.id && !['heading', 'divider'].includes(f.field_type))
      .map(f => ({ key: f.id, logic: f.conditional_logic, sectionLogic: s.conditional_logic })),
  )

  it('really does gate 18 hold/bilge fields on a number field', () => {
    expect(gated.length).toBe(18)
    for (const f of gated) {
      expect(f.conditional_logic.conditions[0].field_id).toBe(holdsField.id)
      expect(f.conditional_logic.conditions[0].operator).toBe('greater_than')
    }
  })

  /** A consistent survey: holds = n, with every field actually visible at that count answered. */
  const surveyOf = (n: number) => {
    const v: Record<string, string> = { [holdsField.id]: String(n) }
    for (const f of gated) if (checkConditionalLogic(f.conditional_logic, v)) v[f.id] = 'pass'
    return v
  }

  it('leaves a consistent survey alone', () => {
    const survey = surveyOf(5)
    // Sanity: 5 holds + 5 bilges are in range, the other 8 gated fields are not.
    expect(Object.keys(survey).length).toBe(11)
    expect(clearHiddenAnswers(units, survey)).toBeNull()
  })

  // Documents precisely what the updateValue guard prevents. If someone removes that guard,
  // this test still passes — it is the guard's justification, not its enforcement.
  it('an EMPTY holds count reads as hiding every gated field', () => {
    const survey = surveyOf(5)
    const answeredIds = gated.filter(f => survey[f.id]).map(f => f.id)
    expect(answeredIds.length).toBe(10)

    const midKeystroke = { ...survey, [holdsField.id]: '' }
    const wiped = clearHiddenAnswers(units, midKeystroke)

    expect(wiped).not.toBeNull()
    for (const id of answeredIds) {
      const label = gated.find(f => f.id === id)!.label
      expect(wiped![id], `${label} would be destroyed`).toBe('')
    }
  })

  it('genuinely reducing the holds count clears only the now-out-of-range answers', () => {
    const reduced = clearHiddenAnswers(units, { ...surveyOf(5), [holdsField.id]: '3' })
    expect(reduced).not.toBeNull()
    const hold2 = gated.find(f => f.label === 'Hold 2')!
    const hold5 = gated.find(f => f.label === 'Hold 5')!
    expect(reduced![hold2.id]).toBe('pass')   // 3 > 1, still shown
    expect(reduced![hold5.id]).toBe('')       // 3 > 4 is false, retired
  })
})
