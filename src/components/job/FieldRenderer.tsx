'use client'

import { useEffect, useRef } from 'react'
import { Info } from 'lucide-react'
import type { TemplateField } from '@/lib/types/database'
import { evaluateCalculation, checkConditionalLogic } from '@/lib/utils'
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
          {field.label}
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
        const opts = field.field_type === 'yes_no_na'
          ? [
              { value: 'yes', label: 'Yes', active: 'border-green-500 bg-green-50 text-green-700' },
              { value: 'no', label: 'No', active: 'border-red-500 bg-red-50 text-red-700' },
              { value: 'na', label: 'N/A', active: 'border-gray-400 bg-gray-100 text-gray-600' },
            ]
          : [
              { value: 'yes', label: 'Yes', active: 'border-green-500 bg-green-50 text-green-700' },
              { value: 'no', label: 'No', active: 'border-red-500 bg-red-50 text-red-700' },
            ]
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
  const result = field.calculation_formula
    ? evaluateCalculation(field.calculation_formula, allValues)
    : ''

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onChange(result) }, [result])

  return (
    <div className="flex items-center gap-2">
      <div className="input-base bg-gray-50 text-gray-700 flex-1 font-mono">
        {result || '—'}
      </div>
      {field.unit && <span className="text-sm text-gray-500">{field.unit}</span>}
    </div>
  )
}
