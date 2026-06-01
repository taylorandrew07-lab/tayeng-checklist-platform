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
