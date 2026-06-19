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
