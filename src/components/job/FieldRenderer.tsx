'use client'

import { useEffect, useRef } from 'react'
import { Info } from 'lucide-react'
import type { TemplateField } from '@/lib/types/database'
import { evaluateCalculation, checkConditionalLogic, formatDiffPercentage } from '@/lib/utils'
import SignaturePad from './SignaturePad'

interface FieldRendererProps {
  field: TemplateField
  value: string
  valueArray?: string[]
  signature?: string
  allValues: Record<string, string>
  onChange: (value: string) => void
  onArrayChange?: (values: string[]) => void
  onSignatureChange?: (data: string) => void
  readOnly?: boolean
  /** Pre-computed label with {uuid} tokens already substituted. Falls back to field.label. */
  resolvedLabel?: string
}

export default function FieldRenderer({
  field,
  value,
  valueArray,
  signature,
  allValues,
  onChange,
  onArrayChange,
  onSignatureChange,
  readOnly = false,
  resolvedLabel,
}: FieldRendererProps) {
  // Check conditional visibility
  const isVisible = checkConditionalLogic(field.conditional_logic, allValues)
  if (!isVisible) return null

  const baseInputClass = `input-base ${readOnly ? 'bg-gray-50' : ''}`

  if (field.field_type === 'heading') {
    return (
      <div className="pt-2">
        <h3 className="text-base font-semibold text-gray-900">{field.label}</h3>
        {field.help_text && <p className="text-sm text-gray-500 mt-0.5">{field.help_text}</p>}
      </div>
    )
  }

  if (field.field_type === 'divider') {
    return <hr className="border-gray-200 my-2" />
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <label className="label-base mb-0">
          {field.item_number && (
            <span className="text-brand-600 font-semibold mr-1.5">{field.item_number}</span>
          )}
          {resolvedLabel ?? field.label}
          {field.is_required && <span className="text-red-500 ml-1">*</span>}
        </label>
        {field.unit && (
          <span className="text-xs text-gray-500 flex-shrink-0 mt-0.5">{field.unit}</span>
        )}
      </div>

      {field.help_text && (
        <div className="flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">{field.help_text}</p>
        </div>
      )}

      {/* Field inputs */}
      {field.field_type === 'text' && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          placeholder={field.placeholder ?? ''}
          className={baseInputClass}
        />
      )}

      {field.field_type === 'number' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={readOnly}
            placeholder={field.placeholder ?? ''}
            min={field.validation?.min}
            max={field.validation?.max}
            className={`${baseInputClass} flex-1`}
          />
          {field.unit && <span className="text-sm text-gray-500 flex-shrink-0">{field.unit}</span>}
        </div>
      )}

      {field.field_type === 'textarea' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          placeholder={field.placeholder ?? ''}
          rows={3}
          className={`${baseInputClass} resize-y`}
        />
      )}

      {field.field_type === 'date' && (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className={baseInputClass}
        />
      )}

      {field.field_type === 'time' && (
        <input
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className={baseInputClass}
        />
      )}

      {field.field_type === 'dropdown' && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          className={baseInputClass}
        >
          <option value="">Select an option…</option>
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {(field.field_type === 'yes_no' || field.field_type === 'yes_no_na') && (() => {
        const COLOR_ACTIVE_CLASSES: Record<string, string> = {
          green: 'border-green-500 bg-green-50 text-green-700',
          red: 'border-red-500 bg-red-50 text-red-700',
          gray: 'border-gray-400 bg-gray-100 text-gray-600',
          amber: 'border-amber-500 bg-amber-50 text-amber-700',
        }
        const DEFAULT_COLORS: Record<string, string> = {
          yes: 'green',
          no: 'red',
          na: 'gray',
        }
        const allOpts = field.field_type === 'yes_no_na'
          ? [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
              { value: 'na', label: 'N/A' },
            ]
          : [
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]
        const opts = allOpts.map(o => {
          const configuredColor = field.options?.find(opt => opt.value === o.value)?.color
          const colorKey = configuredColor ?? DEFAULT_COLORS[o.value] ?? 'gray'
          return { ...o, active: COLOR_ACTIVE_CLASSES[colorKey] ?? COLOR_ACTIVE_CLASSES.gray }
        })
        // Parse combined value: "yes|||some remarks"
        const [answer, remarks] = value.includes('|||') ? value.split('|||') : [value, '']
        return (
          <div className="space-y-2">
            <div className="flex gap-3">
              {opts.map(opt => (
                <label key={opt.value} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-colors ${
                  answer === opt.value ? opt.active : 'border-gray-200 hover:border-gray-300'
                } ${readOnly ? 'pointer-events-none' : ''}`}>
                  <input type="radio" name={`yn_${field.id}`} value={opt.value} checked={answer === opt.value}
                    onChange={() => onChange(opt.value + (field.with_remarks && remarks ? '|||' + remarks : ''))}
                    disabled={readOnly} className="sr-only" />
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              ))}
            </div>
            {field.with_remarks && (
              <input
                type="text"
                value={remarks}
                onChange={(e) => onChange((answer || '') + '|||' + e.target.value)}
                disabled={readOnly}
                placeholder="Remarks…"
                className={`input-base text-sm ${readOnly ? 'bg-gray-50' : ''}`}
              />
            )}
          </div>
        )
      })()}

      {field.field_type === 'multiple_choice' && (
        <div className="space-y-2">
          {field.options?.map(opt => {
            const checked = (valueArray ?? []).includes(opt.value)
            return (
              <label key={opt.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                checked ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
              } ${readOnly ? 'pointer-events-none' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const current = valueArray ?? []
                    onArrayChange?.(checked ? current.filter(v => v !== opt.value) : [...current, opt.value])
                  }}
                  disabled={readOnly}
                  className="rounded border-gray-300 text-brand-600"
                />
                <span className="text-sm">{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}

      {field.field_type === 'calculated' && (
        <CalculatedField
          field={field}
          allValues={allValues}
          onChange={onChange}
        />
      )}

      {field.field_type === 'signature' && (
        <SignaturePad
          value={signature ?? ''}
          onChange={(data) => onSignatureChange?.(data)}
          disabled={readOnly}
        />
      )}

      {field.field_type === 'photo' && !readOnly && (
        <p className="text-sm text-gray-500 italic">
          Photos are uploaded separately using the Photos section below.
        </p>
      )}

      {field.field_type === 'photo' && readOnly && value && (
        <p className="text-sm text-gray-600">{value} photo(s) uploaded</p>
      )}
    </div>
  )
}

function CalculatedField({ field, allValues, onChange }: {
  field: TemplateField
  allValues: Record<string, string>
  onChange: (v: string) => void
}) {
  const rawResult = field.calculation_formula
    ? evaluateCalculation(field.calculation_formula, allValues)
    : ''

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(rawResult) }, [rawResult])

  const isPercent = field.validation?.display_as === 'percentage'
  const numVal = parseFloat(rawResult)

  let displayVal = rawResult || '—'
  let colorCls = 'bg-gray-50 text-gray-700'

  if (isPercent && !isNaN(numVal)) {
    // Denominator = last {uuid} token in the formula (the supplier / reference figure)
    const tokens = Array.from((field.calculation_formula ?? '').matchAll(/\{([^}]+)\}/g), m => m[1])
    const denominatorId = tokens[tokens.length - 1]
    const { display, pct } = formatDiffPercentage(
      numVal,
      denominatorId ? allValues[denominatorId] : undefined
    )
    displayVal = display
    if (pct !== null) {
      const absVal = Math.abs(pct)
      const thresholds = field.validation?.thresholds ?? [
        { max: 1.0, color: 'green' as const },
        { max: 2.0, color: 'amber' as const },
        { color: 'red' as const },
      ]
      const match = thresholds.find(t => t.max === undefined || absVal < t.max)
      const c = match?.color ?? 'red'
      colorCls = c === 'green' ? 'bg-green-50 text-green-700 border-green-300 font-semibold'
        : c === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-300 font-semibold'
        : 'bg-red-50 text-red-700 border-red-300 font-semibold'
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`input-base flex-1 font-mono ${colorCls}`}>
        {displayVal}
      </div>
      {field.unit && !isPercent && <span className="text-sm text-gray-500">{field.unit}</span>}
    </div>
  )
}
