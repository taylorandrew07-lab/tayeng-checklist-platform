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

describe('Brine Transfer — conditional rules, against the live seeded template', () => {
  // Every "iff parent = Yes" rule from the source form.
  const simple: Array<[string, string]> = [
    ['1A', '1'], ['4A', '4'], ['6A', '6'], ['20A', '20'],
    ['21A', '21'], ['24A', '24'], ['25A', '25'], ['30A', '30'], ['32A', '32'],
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

  it('22 appears when ANY inspection fails, including ones in a later section', () => {
    for (const failed of ['20A', '21A', '24A', '25A']) {
      expect(visible(item('22'), vals({ [failed]: 'no' }))).toBe(true)
    }
  })

  it('22 stays hidden while every inspection passes or is unanswered', () => {
    expect(visible(item('22'), vals({ '20A': 'yes', '21A': 'yes', '24A': 'yes', '25A': 'yes' }))).toBe(false)
    expect(visible(item('22'), {})).toBe(false)
  })

  it('22 keys off the sub-items, never their parents', () => {
    // A sample simply not taken (parent = No) must NOT raise the off-spec question.
    expect(visible(item('22'), vals({ '20': 'no', '24': 'no' }))).toBe(false)
  })

  it('remarks on a parent answer do not break its children (yes|||note)', () => {
    expect(visible(item('20A'), vals({ '20': 'yes|||sampled at 0900' }))).toBe(true)
  })

  // The defect that motivated clearHiddenAnswers, replayed on the real template.
  it('correcting item 20 clears 20A and retires item 22 from the report', () => {
    const before = vals({ '20': 'yes', '20A': 'no', '22': 'yes' })
    expect(visible(item('22'), before)).toBe(true)

    const corrected = { ...before, [item('20').id]: 'no' }
    const after = clearHiddenAnswers(brineUnits(), corrected)

    expect(after).not.toBeNull()
    expect(after![item('20A').id]).toBe('')
    expect(after![item('22').id]).toBe('')
    expect(visible(item('22'), after!)).toBe(false)
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
  it('carries items 1..33 plus all ten lettered sub-items', () => {
    const nums = brine.fields.map(f => f.item_number).filter(Boolean) as string[]
    for (let n = 1; n <= 33; n++) expect(nums, `item ${n}`).toContain(String(n))
    for (const l of ['1A', '4A', '6A', '6B', '20A', '21A', '24A', '25A', '30A', '32A']) {
      expect(nums, `item ${l}`).toContain(l)
    }
  })

  it('withholds N/A on the hard-evidence items only', () => {
    const strict = brine.fields.filter(f => f.field_type === 'yes_no').map(f => f.item_number).sort()
    expect(strict).toEqual(['10', '14', '15', '29', '30', '31', '32', '33', '9'].sort())
  })

  it('reverse-colours item 6 so a single cargo type reads green', () => {
    const six = item('6').options as Array<{ value: string; color?: string }>
    expect(six.find(o => o.value === 'no')?.color).toBe('green')
    expect(six.find(o => o.value === 'yes')?.color).toBe('amber')
  })

  it('reconciles Ship minus Shore in BBLS with the agreed colour bands', () => {
    const diff = brine.fields.find(f => f.label.startsWith('Difference'))!
    const pct = brine.fields.find(f => f.validation?.display_as === 'percentage')!
    const ship = brine.fields.find(f => f.label === "Ship's figure")!
    const shore = brine.fields.find(f => f.label === 'Shore figure')!

    expect(diff.calculation_formula).toBe(`{${ship.id}}-{${shore.id}}`)
    expect(diff.unit).toBe('BBLS')
    expect(pct.unit).toBe('BBLS')
    // The denominator is the LAST token in the formula — it must be the SHORE figure.
    const tokens = Array.from(pct.calculation_formula!.matchAll(/\{([^}]+)\}/g), m => m[1])
    expect(tokens[tokens.length - 1]).toBe(shore.id)
    expect(pct.validation.thresholds).toEqual([
      { max: 1, color: 'green' }, { max: 2, color: 'amber' }, { color: 'red' },
    ])
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
