import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import type { TemplateStatus, FieldType } from '@/lib/types/database'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy HH:mm')
  } catch {
    return dateStr
  }
}

/**
 * Returns the canonical vessel-type prefix a text field's value should carry,
 * based on its label, or null if the field is not a vessel-name field.
 *  - "Bunker Vessel Name" (a tanker) → "M.T." (Motor Tanker)
 *  - the surveyed vessel (e.g. "Vessel", "Vessel Name") → "M.V." (Motor Vessel)
 * Mirrors the vessel/bunker matching used for metadata auto-fill so the same
 * fields are affected.
 */
// Descriptor fields that contain "vessel" but are NOT the vessel name, so must
// not receive an M.V./M.T. prefix (e.g. "Vessel Type", "Vessel IMO Number").
const NON_NAME_VESSEL_QUALIFIERS = [
  'type', 'imo', 'flag', 'owner', 'call sign', 'callsign', 'grt', 'nrt', 'dwt',
  'length', 'beam', 'draft', 'draught', 'year', 'built', 'class', 'port',
  'registry', 'number', 'no.', 'gross', 'net', 'tonnage', 'loa',
]

export function vesselPrefixForLabel(label: string): 'M.T.' | 'M.V.' | null {
  const l = label.toLowerCase()
  if (!l.includes('vessel')) return null
  // Only the vessel *name* fields are prefixed — skip descriptor fields.
  if (NON_NAME_VESSEL_QUALIFIERS.some(q => l.includes(q))) return null
  if (l.includes('bunker')) return 'M.T.'
  return 'M.V.'
}

/**
 * True when a field's label denotes the SURVEYED vessel's name field — the one
 * that should be auto-filled with the job's vessel_name and shown as "the
 * vessel" in the PDF. Built on vesselPrefixForLabel so descriptor fields
 * ("Vessel IMO Number", "Vessel Type", …) and the separate bunker vessel are
 * excluded. Use this instead of an ad-hoc `label.includes('vessel')` check.
 */
export function isSurveyedVesselNameField(label: string): boolean {
  return vesselPrefixForLabel(label) === 'M.V.'
}

/**
 * Normalises a vessel name to "<prefix> Title Cased Name":
 *  - strips any existing prefix the user typed (so we never double up, e.g.
 *    "M.T. M.T. Test" → "M.T. Test"), matching forms like "MT", "M.T.", "M T"
 *  - title-cases the remaining words ("TEST VESSEL" → "Test Vessel")
 *  - re-applies the canonical prefix
 * Returns '' for empty input (and never returns a bare prefix on its own).
 */
export function normalizeVesselName(raw: string, prefix: 'M.T.' | 'M.V.'): string {
  const titled = titleCaseVesselName(raw)
  return titled ? `${prefix} ${titled}` : ''
}

/**
 * Canonical BARE vessel name (no prefix) for storage + display wherever a vessel
 * name appears without an explicit prefix (job list, jobs.vessel_name, the vessels
 * directory, cargo voyages). Standardises however a surveyor typed it:
 *  - strips a leading M.V./M.T./MV/MT prefix (dots/spaces optional, repeatable) so
 *    the stored name stays bare and the UI re-adds the canonical prefix
 *  - Title-Cases each word: "DELTA TITAN" → "Delta Titan", "delta emperor" →
 *    "Delta Emperor", "Bonnie D" → "Bonnie D" (single letters stay capitalised),
 *    "o'brien" → "O'Brien", "delta-titan" → "Delta-Titan"
 * Returns '' for empty / prefix-only input.
 */
export function titleCaseVesselName(raw: string): string {
  if (!raw) return ''
  let v = raw.trim()
  if (!v) return ''
  // Strip leading M.V./M.T. prefix tokens (dots/spaces optional), each followed by
  // a separator so real words like "Mtoto"/"Mvuli" are left intact.
  v = v.replace(/^(?:m\.?\s*[vt]\.?[\s.]+)+/i, '').trim()
  if (!v) return ''
  return v.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
}

export function getTemplateStatusColor(status: TemplateStatus): string {
  const colors: Record<TemplateStatus, string> = {
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-green-100 text-green-700',
    archived: 'bg-red-100 text-red-700',
  }
  return colors[status] ?? 'bg-gray-100 text-gray-700'
}

export function getFieldTypeLabel(type: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    dropdown: 'Dropdown',
    yes_no: 'Yes / No',
    yes_no_na: 'Yes / No / N/A',
    multiple_choice: 'Multiple Choice',
    textarea: 'Long Text / Remarks',
    calculated: 'Calculated',
    photo: 'Photo Upload',
    signature: 'Signature',
    heading: 'Section Heading',
    divider: 'Divider',
  }
  return labels[type] ?? type
}

export function evaluateCalculation(
  formula: string,
  values: Record<string, string>
): string {
  try {
    let expr = formula
    for (const [fieldId, value] of Object.entries(values)) {
      const num = parseFloat(value)
      if (!isNaN(num)) {
        expr = expr.replace(new RegExp(`\\{${fieldId}\\}`, 'g'), String(num))
      } else {
        expr = expr.replace(new RegExp(`\\{${fieldId}\\}`, 'g'), '0')
      }
    }
    // Only allow safe math expressions
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return ''
    // Evaluate WITHOUT eval()/Function(): those need CSP 'unsafe-eval', which we
    // (correctly) don't allow, so they throw in the browser and the result silently
    // came back empty. This safe arithmetic parser keeps the CSP locked down.
    const result = evalArithmetic(expr)
    return result !== null && isFinite(result) ? String(Math.round(result * 10000) / 10000) : ''
  } catch {
    return ''
  }
}

/**
 * Evaluate a basic arithmetic expression (numbers, + - * /, parentheses, unary
 * +/-) without eval()/Function — so it works under a CSP that forbids
 * 'unsafe-eval'. Returns null on any malformed input.
 */
export function evalArithmetic(input: string): number | null {
  const matched = input.match(/\d+\.?\d*|\.\d+|[+\-*/()]/g)
  if (!matched) return null
  const tokens: string[] = matched
  let pos = 0
  const peek = (): string | undefined => tokens[pos]

  function parseExpr(): number | null {
    let v = parseTerm()
    if (v === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++]
      const r = parseTerm()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function parseTerm(): number | null {
    let v = parseFactor()
    if (v === null) return null
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++]
      const r = parseFactor()
      if (r === null) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function parseFactor(): number | null {
    const t = peek()
    if (t === '+') { pos++; return parseFactor() }
    if (t === '-') { pos++; const f = parseFactor(); return f === null ? null : -f }
    if (t === '(') {
      pos++
      const v = parseExpr()
      if (peek() !== ')') return null
      pos++
      return v
    }
    if (t !== undefined && /^(?:\d+\.?\d*|\.\d+)$/.test(t)) { pos++; return parseFloat(t) }
    return null
  }

  const result = parseExpr()
  // Reject leftover tokens (malformed input like "1 2" or "(1+2").
  if (result === null || pos !== tokens.length) return null
  return result
}

/**
 * Formats a USG difference + true percentage for display in the "Difference" calculated field.
 * Returns null pct when denominator is zero/missing (safe no-divide guard).
 */
export function formatDiffPercentage(
  rawDiff: number,
  denominatorStr: string | undefined
): { display: string; pct: number | null } {
  const denominator = parseFloat(denominatorStr ?? '')
  if (!isFinite(denominator) || denominator === 0) {
    return { display: '—', pct: null }
  }
  const pct = (rawDiff / denominator) * 100
  const diffDisplay = Number.isInteger(rawDiff) ? String(rawDiff) : rawDiff.toFixed(2)
  return { display: `${diffDisplay} USG: ${pct.toFixed(2)}%`, pct }
}

export function checkConditionalLogic(
  logic: { operator: 'and' | 'or'; conditions: Array<{ field_id: string; operator: string; value: string }> } | null,
  values: Record<string, string>
): boolean {
  if (!logic || !logic.conditions?.length) return true

  const results = logic.conditions.map((condition) => {
    // Strip |||remarks suffix from yes_no/yes_no_na values before comparing
    const raw = values[condition.field_id] ?? ''
    const fieldValue = raw.includes('|||') ? raw.split('|||')[0] : raw
    switch (condition.operator) {
      case 'equals': return fieldValue === condition.value
      case 'not_equals': return fieldValue !== condition.value
      case 'contains': return fieldValue.includes(condition.value)
      case 'greater_than': return parseFloat(fieldValue) > parseFloat(condition.value)
      case 'less_than': return parseFloat(fieldValue) < parseFloat(condition.value)
      case 'is_empty': return !fieldValue
      case 'is_not_empty': return !!fieldValue
      default: return true
    }
  })

  return logic.operator === 'and'
    ? results.every(Boolean)
    : results.some(Boolean)
}

export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Races a promise against a timeout. Rejects with a user-visible message if
 * the timeout fires first. The underlying request is still in-flight but the
 * UI is unblocked.
 */
export function withTimeout<T>(thenable: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`${label} timed out — check your connection and try again.`)),
      ms
    )
  })
  return Promise.race([Promise.resolve(thenable), timeout]).finally(() => {
    if (timerId !== undefined) clearTimeout(timerId)
  })
}
