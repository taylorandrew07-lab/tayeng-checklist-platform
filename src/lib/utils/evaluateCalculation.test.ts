import { describe, it, expect } from 'vitest'
import { evaluateCalculation, evalArithmetic } from './index'

const SHIP = '72b10298-ab3b-4e9d-b63c-2129af3116c4'
const SUPPLIER = '2f2d3cda-be96-4df8-9a2a-a79fec2e03f9'
const FORMULA = `{${SHIP}} - {${SUPPLIER}}`

describe('evaluateCalculation (CSP-safe, no eval())', () => {
  it('computes the Difference from the two figures', () => {
    expect(evaluateCalculation(FORMULA, { [SHIP]: '9795', [SUPPLIER]: '10000' })).toBe('-205')
  })

  it('works even with many unrelated fields present (a full checklist)', () => {
    const values: Record<string, string> = { [SHIP]: '9795', [SUPPLIER]: '10000' }
    for (let i = 0; i < 40; i++) values[`field-${i}`] = i % 2 ? 'No|||remark' : '5'
    expect(evaluateCalculation(FORMULA, values)).toBe('-205')
  })

  it('treats missing/non-numeric inputs as 0', () => {
    expect(evaluateCalculation(FORMULA, { [SHIP]: '9795' })).toBe('') // supplier token unresolved → empty
    expect(evaluateCalculation(FORMULA, { [SHIP]: '9795', [SUPPLIER]: 'abc' })).toBe('9795')
  })

  it('returns empty for an unresolved formula token', () => {
    expect(evaluateCalculation(FORMULA, {})).toBe('')
  })

  it('rounds to 4 decimals', () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    expect(evaluateCalculation(`{${a}} / {${b}}`, { [a]: '1', [b]: '3' })).toBe('0.3333')
  })

  // Time (HH:MM) fields become decimal hours, so a duration formula like
  // {end} - {start} yields the elapsed hours — drives OVID billable hours.
  it('treats HH:MM time fields as decimal hours', () => {
    const start = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const end = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    const F = `{${end}} - {${start}}`
    expect(evaluateCalculation(F, { [start]: '08:00', [end]: '17:30' })).toBe('9.5')
    expect(evaluateCalculation(F, { [start]: '06:15', [end]: '14:45' })).toBe('8.5')
  })

  it('sums multiple time intervals (travel out + back)', () => {
    const departBase = '11111111-1111-1111-1111-111111111111'
    const arriveLoc = '22222222-2222-2222-2222-222222222222'
    const departLoc = '33333333-3333-3333-3333-333333333333'
    const arriveBase = '44444444-4444-4444-4444-444444444444'
    // travel = (arrive on location − depart base) + (arrive base − depart location)
    const F = `{${arriveLoc}} - {${departBase}} + {${arriveBase}} - {${departLoc}}`
    const vals = { [departBase]: '07:00', [arriveLoc]: '08:30', [departLoc]: '15:00', [arriveBase]: '16:30' }
    expect(evaluateCalculation(F, vals)).toBe('3') // 1.5 out + 1.5 back
  })
})

describe('evalArithmetic (safe parser, no eval())', () => {
  it('basic operators', () => {
    expect(evalArithmetic('9795 - 10000')).toBe(-205)
    expect(evalArithmetic('2 + 3 * 4')).toBe(14)
    expect(evalArithmetic('(2 + 3) * 4')).toBe(20)
    expect(evalArithmetic('10 / 4')).toBe(2.5)
  })

  it('unary minus / plus', () => {
    expect(evalArithmetic('-5')).toBe(-5)
    expect(evalArithmetic('3 * -2')).toBe(-6)
    expect(evalArithmetic('-(2 + 3)')).toBe(-5)
  })

  it('decimals', () => {
    expect(evalArithmetic('1.5 + 2.25')).toBe(3.75)
    expect(evalArithmetic('.5 * 2')).toBe(1)
  })

  it('rejects malformed input', () => {
    expect(evalArithmetic('1 2')).toBeNull()
    expect(evalArithmetic('(1 + 2')).toBeNull()
    expect(evalArithmetic('1 +')).toBeNull()
    expect(evalArithmetic('')).toBeNull()
  })
})
