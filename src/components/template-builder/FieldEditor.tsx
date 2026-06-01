'use client'

import { useState } from 'react'
import { Trash2, Plus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BuilderField, BuilderSection } from './types'
import { FIELD_TYPE_OPTIONS, getDefaultYesNoOptions } from './types'
import type { FieldOption, ConditionalLogic } from '@/lib/types/database'

const COLOR_SWATCH: Record<NonNullable<FieldOption['color']>, { bg: string; ring: string; label: string }> = {
  green: { bg: 'bg-green-500', ring: 'ring-green-500', label: 'Green' },
  red: { bg: 'bg-red-500', ring: 'ring-red-500', label: 'Red' },
  gray: { bg: 'bg-gray-400', ring: 'ring-gray-400', label: 'Gray' },
  amber: { bg: 'bg-amber-400', ring: 'ring-amber-400', label: 'Amber' },
}
const COLOR_OPTIONS = ['green', 'red', 'gray', 'amber'] as const

const METADATA_PATTERNS = ['vessel', 'date', 'port', 'berth', 'surveyor']

interface FieldEditorProps {
  field: BuilderField
  sections: BuilderSection[]
  allFields: BuilderField[]
  onChange: (field: BuilderField) => void
  onDelete: () => void
}

export default function FieldEditor({ field, sections, allFields, onChange, onDelete }: FieldEditorProps) {
  const [expanded, setExpanded] = useState(true)
  const [showConditional, setShowConditional] = useState(!!field.conditional_logic)

  function update(patch: Partial<BuilderField>) {
    onChange({ ...field, ...patch })
  }

  function addOption() {
    const newOption: FieldOption = { value: `option_${Date.now()}`, label: `Option ${field.options.length + 1}` }
    update({ options: [...field.options, newOption] })
  }

  function updateOption(index: number, patch: Partial<FieldOption>) {
    const updated = field.options.map((o, i) => i === index ? { ...o, ...patch } : o)
    update({ options: updated })
  }

  function removeOption(index: number) {
    update({ options: field.options.filter((_, i) => i !== index) })
  }

  function updateConditional(logic: ConditionalLogic | null) {
    update({ conditional_logic: logic })
  }

  const needsOptions = field.field_type === 'dropdown' || field.field_type === 'multiple_choice'
  const isLayoutField = field.field_type === 'heading' || field.field_type === 'divider'
  const isYesNo = field.field_type === 'yes_no' || field.field_type === 'yes_no_na'

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm">
      {/* Field header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {field.label || 'Unnamed Field'}
            </span>
            {field.is_required && (
              <span className="text-xs text-red-500 font-medium">Required</span>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {FIELD_TYPE_OPTIONS.find(t => t.value === field.field_type)?.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Delete field"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4">
          {/* Item number + field type + label */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-base">Field Type</label>
              <select
                value={field.field_type}
                onChange={(e) => {
                  const newType = e.target.value as BuilderField['field_type']
                  const newOptions =
                    newType === 'yes_no' || newType === 'yes_no_na'
                      ? getDefaultYesNoOptions(newType)
                      : (newType === 'dropdown' || newType === 'multiple_choice') ? field.options : []
                  update({ field_type: newType, options: newOptions })
                }}
                className="input-base"
              >
                {Object.entries(
                  FIELD_TYPE_OPTIONS.reduce<Record<string, typeof FIELD_TYPE_OPTIONS>>((acc, opt) => {
                    if (!acc[opt.group]) acc[opt.group] = []
                    acc[opt.group].push(opt)
                    return acc
                  }, {})
                ).map(([group, opts]) => (
                  <optgroup key={group} label={group}>
                    {opts.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Label */}
            <div>
              <label className="label-base">Label</label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => update({ label: e.target.value })}
                className="input-base"
                placeholder="Field label"
              />
              {METADATA_PATTERNS.some(p => field.label.toLowerCase().includes(p)) && (
                <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                  <span>ℹ</span>
                  Already captured as job metadata — consider removing
                </p>
              )}
            </div>
          </div>

          {/* Item number */}
          {!isLayoutField && (
            <div>
              <label className="label-base">Item No. <span className="text-gray-400 font-normal">(e.g. A1, B3)</span></label>
              <input
                type="text"
                value={field.item_number}
                onChange={(e) => update({ item_number: e.target.value })}
                className="input-base"
                placeholder="Optional — shown as prefix"
              />
            </div>
          )}

          {/* Non-layout fields have more options */}
          {!isLayoutField && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-base">Placeholder</label>
                  <input
                    type="text"
                    value={field.placeholder}
                    onChange={(e) => update({ placeholder: e.target.value })}
                    className="input-base"
                    placeholder="Optional placeholder"
                  />
                </div>
                {field.field_type === 'number' && (
                  <div>
                    <label className="label-base">Unit (e.g. kg, L, m)</label>
                    <input
                      type="text"
                      value={field.unit}
                      onChange={(e) => update({ unit: e.target.value })}
                      className="input-base"
                      placeholder="kg"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="label-base">Help Text</label>
                <input
                  type="text"
                  value={field.help_text}
                  onChange={(e) => update({ help_text: e.target.value })}
                  className="input-base"
                  placeholder="Optional instructions for surveyors"
                />
              </div>

              {/* Required + With Remarks toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => update({ is_required: !field.is_required })}
                    className={cn('relative w-10 h-6 rounded-full transition-colors', field.is_required ? 'bg-brand-600' : 'bg-gray-300')}
                  >
                    <div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', field.is_required ? 'translate-x-5' : 'translate-x-1')} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">Required</span>
                </label>
                {isYesNo && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <div
                      onClick={() => update({ with_remarks: !field.with_remarks })}
                      className={cn('relative w-10 h-6 rounded-full transition-colors', field.with_remarks ? 'bg-brand-600' : 'bg-gray-300')}
                    >
                      <div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', field.with_remarks ? 'translate-x-5' : 'translate-x-1')} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">With Remarks</span>
                  </label>
                )}
              </div>

              {/* Number validation */}
              {field.field_type === 'number' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label-base">Min Value</label>
                    <input
                      type="number"
                      value={field.validation.min ?? ''}
                      onChange={(e) => update({ validation: { ...field.validation, min: e.target.value === '' ? undefined : parseFloat(e.target.value) } })}
                      className="input-base"
                      placeholder="No minimum"
                    />
                  </div>
                  <div>
                    <label className="label-base">Max Value</label>
                    <input
                      type="number"
                      value={field.validation.max ?? ''}
                      onChange={(e) => update({ validation: { ...field.validation, max: e.target.value === '' ? undefined : parseFloat(e.target.value) } })}
                      className="input-base"
                      placeholder="No maximum"
                    />
                  </div>
                </div>
              )}

              {/* Calculated formula */}
              {field.field_type === 'calculated' && (
                <div>
                  <label className="label-base">Calculation Formula</label>
                  <input
                    type="text"
                    value={field.calculation_formula}
                    onChange={(e) => update({ calculation_formula: e.target.value })}
                    className="input-base font-mono"
                    placeholder="{field_id_1} + {field_id_2} * 1.1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Reference other fields using their ID in curly braces: {'{field_id}'}. Supports +, -, *, /
                  </p>
                  {allFields.filter(f => f.field_type === 'number' && f.id !== field.id).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {allFields
                        .filter(f => f.field_type === 'number' && f.id !== field.id)
                        .map(f => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => update({ calculation_formula: field.calculation_formula + `{${f.id}}` })}
                            className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100"
                          >
                            + {f.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Options for dropdown / multiple_choice */}
              {needsOptions && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label-base mb-0">Options</label>
                    <button
                      type="button"
                      onClick={addOption}
                      className="text-xs btn-secondary py-1 px-2"
                    >
                      <Plus className="h-3 w-3" />
                      Add Option
                    </button>
                  </div>
                  <div className="space-y-2">
                    {field.options.map((option, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={option.label}
                          onChange={(e) => updateOption(idx, { label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                          className="input-base flex-1"
                          placeholder={`Option ${idx + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(idx)}
                          className="p-1.5 text-red-400 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    {field.options.length === 0 && (
                      <p className="text-xs text-gray-400 italic">No options yet. Add at least one option.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Color picker for yes_no / yes_no_na */}
              {isYesNo && (
                <div>
                  <label className="label-base mb-2">Answer Colors</label>
                  <div className="space-y-2">
                    {field.options.map((opt, idx) => (
                      <div key={opt.value} className="flex items-center gap-3">
                        <span className="text-sm text-gray-700 w-10 font-medium">{opt.label}</span>
                        <div className="flex gap-2">
                          {COLOR_OPTIONS.map(color => {
                            const swatch = COLOR_SWATCH[color]
                            const selected = opt.color === color
                            return (
                              <button
                                key={color}
                                type="button"
                                title={swatch.label}
                                onClick={() => updateOption(idx, { color })}
                                className={cn(
                                  `w-6 h-6 rounded-full ${swatch.bg} transition-all`,
                                  selected ? `ring-2 ring-offset-1 ${swatch.ring}` : 'opacity-60 hover:opacity-100'
                                )}
                              />
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Default value for yes_no / yes_no_na */}
              {isYesNo && (
                <div>
                  <label className="label-base">Default Value</label>
                  <select
                    value={field.default_value}
                    onChange={(e) => update({ default_value: e.target.value })}
                    className="input-base"
                  >
                    <option value="">No default</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    {field.field_type === 'yes_no_na' && <option value="na">N/A</option>}
                  </select>
                </div>
              )}

              {/* Default value (not for photo/signature/calculated/yes_no/yes_no_na) */}
              {!['photo', 'signature', 'calculated', 'yes_no', 'yes_no_na', 'multiple_choice'].includes(field.field_type) && (
                <div>
                  <label className="label-base">Default Value</label>
                  {field.field_type === 'dropdown' ? (
                    <select
                      value={field.default_value}
                      onChange={(e) => update({ default_value: e.target.value })}
                      className="input-base"
                    >
                      <option value="">No default</option>
                      {field.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.field_type === 'date' ? 'date' : field.field_type === 'time' ? 'time' : 'text'}
                      value={field.default_value}
                      onChange={(e) => update({ default_value: e.target.value })}
                      className="input-base"
                      placeholder="Optional default value"
                    />
                  )}
                </div>
              )}

              {/* Conditional logic */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showConditional}
                      onChange={(e) => {
                        setShowConditional(e.target.checked)
                        if (!e.target.checked) updateConditional(null)
                        else updateConditional({ operator: 'and', conditions: [] })
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm font-medium text-gray-700">Conditional display</span>
                  </label>
                </div>

                {showConditional && field.conditional_logic && (
                  <ConditionalLogicEditor
                    logic={field.conditional_logic}
                    onChange={updateConditional}
                    availableFields={allFields.filter(f => f.id !== field.id && !['photo', 'signature', 'heading', 'divider'].includes(f.field_type))}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface ConditionalLogicEditorProps {
  logic: ConditionalLogic
  onChange: (logic: ConditionalLogic) => void
  availableFields: BuilderField[]
}

function ConditionalLogicEditor({ logic, onChange, availableFields }: ConditionalLogicEditorProps) {
  function addCondition() {
    if (!availableFields.length) return
    onChange({
      ...logic,
      conditions: [...logic.conditions, {
        field_id: availableFields[0].id,
        operator: 'equals',
        value: '',
      }],
    })
  }

  function updateCondition(index: number, patch: Partial<ConditionalLogic['conditions'][0]>) {
    const updated = logic.conditions.map((c, i) => i === index ? { ...c, ...patch } : c)
    onChange({ ...logic, conditions: updated })
  }

  function removeCondition(index: number) {
    onChange({ ...logic, conditions: logic.conditions.filter((_, i) => i !== index) })
  }

  return (
    <div className="border border-amber-200 rounded-lg bg-amber-50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-700 font-medium">Show this field when</span>
        <select
          value={logic.operator}
          onChange={(e) => onChange({ ...logic, operator: e.target.value as 'and' | 'or' })}
          className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
        >
          <option value="and">ALL conditions are met</option>
          <option value="or">ANY condition is met</option>
        </select>
      </div>

      {logic.conditions.map((condition, idx) => {
        const refField = availableFields.find(f => f.id === condition.field_id)
        const isOrphaned = !availableFields.find(f => f.id === condition.field_id)
        return (
          <div key={idx} className="space-y-1">
            {isOrphaned && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <span>⚠</span> Referenced field not found — update this condition
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
            <select
              value={condition.field_id}
              onChange={(e) => updateCondition(idx, { field_id: e.target.value })}
              className={cn('text-xs border rounded px-2 py-1 bg-white flex-1 min-w-0', isOrphaned ? 'border-red-400' : 'border-amber-300')}
            >
              {isOrphaned && (
                <option value={condition.field_id}>[Missing field: {condition.field_id.slice(0, 8)}…]</option>
              )}
              {availableFields.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <select
              value={condition.operator}
              onChange={(e) => updateCondition(idx, { operator: e.target.value as ConditionalLogic['conditions'][0]['operator'] })}
              className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
            >
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
              <option value="greater_than">greater than</option>
              <option value="less_than">less than</option>
              <option value="is_empty">is empty</option>
              <option value="is_not_empty">is not empty</option>
            </select>
            {!['is_empty', 'is_not_empty'].includes(condition.operator) && (
              (refField?.field_type === 'yes_no' || refField?.field_type === 'yes_no_na') ? (
                <select
                  value={condition.value}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  {refField?.field_type === 'yes_no_na' && <option value="na">N/A</option>}
                </select>
              ) : refField?.field_type === 'dropdown' ? (
                <select
                  value={condition.value}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
                >
                  <option value="">Select…</option>
                  {refField.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={condition.value}
                  onChange={(e) => updateCondition(idx, { value: e.target.value })}
                  className="text-xs border border-amber-300 rounded px-2 py-1 bg-white w-24"
                  placeholder="value"
                />
              )
            )}
            <button
              type="button"
              onClick={() => removeCondition(idx)}
              className="text-red-400 hover:text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            </div>
          </div>
        )
      })}

      <button
        type="button"
        onClick={addCondition}
        disabled={!availableFields.length}
        className="text-xs text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1"
      >
        <Plus className="h-3 w-3" />
        Add condition
      </button>
    </div>
  )
}
