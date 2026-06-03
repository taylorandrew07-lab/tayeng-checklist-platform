import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import type { JobStatus, TemplateStatus, FieldType } from '@/lib/types/database'

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
export function vesselPrefixForLabel(label: string): 'M.T.' | 'M.V.' | null {
  const l = label.toLowerCase()
  if (!l.includes('vessel')) return null
  if (l.includes('bunker')) return 'M.T.'
  return 'M.V.'
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
  if (!raw) return ''
  let v = raw.trim()
  if (!v) return ''
  const initials = prefix.replace(/\./g, '').toLowerCase() // e.g. 'M.T.' → 'mt'
  const a = initials[0], b = initials[1]
  // Strip one or more leading "<a> <b>" prefix tokens (dots/spaces optional),
  // each followed by a separator so real words like "Mtoto" are left intact.
  const stripRe = new RegExp(`^(?:${a}\\.?\\s*${b}\\.?[\\s.]+)+`, 'i')
  v = v.replace(stripRe, '').trim()
  if (!v) return ''
  const titled = v.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
  return `${prefix} ${titled}`
}

export function getJobStatusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    draft: 'Draft',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    completed: 'Completed',
    client_visible: 'Client Visible',
    archived: 'Archived',
  }
  return labels[status] ?? status
}

export function getJobStatusColor(status: JobStatus): string {
  const colors: Record<JobStatus, string> = {
    draft: 'bg-gray-100 text-gray-700',
    assigned: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    submitted: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    client_visible: 'bg-teal-100 text-teal-700',
    archived: 'bg-red-100 text-red-700',
  }
  return colors[status] ?? 'bg-gray-100 text-gray-700'
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
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr})`)()
    return isFinite(result) ? String(Math.round(result * 10000) / 10000) : ''
  } catch {
    return ''
  }
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
