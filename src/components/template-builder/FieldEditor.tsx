'use client'

import { useState, useEffect } from 'react'
import { Trash2, Plus, X, Bookmark, Save } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import type { BuilderField } from './types'
import { FIELD_TYPE_OPTIONS, getDefaultYesNoOptions } from './types'
import type { FieldOption, ConditionalLogic } from '@/lib/types/database'
import { listResponseSets, createResponseSet, type ResponseSet } from '@/lib/templates/responseSets'

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
  allFields: BuilderField[]
  /** Auto sequential number for this field within its section (read-only). '' for layout fields. */
  displayNumber: string
  onChange: (field: BuilderField) => void
  onDelete: () => void
}

// Accessible on/off switch used for inline toggles
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex items-center gap-2 cursor-pointer select-none"
    >
      <span className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-gray-300')}>
        <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-1')} />
      </span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </button>
  )
}

export default function FieldEditor({ field, allFields, displayNumber, onChange, onDelete }: FieldEditorProps) {
  // Collapse is owned by the parent SortableField (chip row ↔ editor); this editor
  // always renders its body when mounted, so opening a field takes a single click.
  const [showConditional, setShowConditional] = useState(!!field.conditional_logic)
  // Item 3: help text hidden by default, shown only when the box is checked (or a value already exists)
  const [showHelp, setShowHelp] = useState(!!field.help_text)
  const [responseSets, setResponseSets] = useState<ResponseSet[]>([])
  const needsOptions = field.field_type === 'dropdown' || field.field_type === 'multiple_choice'
  useEffect(() => {
    if (needsOptions) listResponseSets().then(setResponseSets).catch(() => {})
  }, [needsOptions])

  function update(patch: Partial<BuilderField>) {
    onChange({ ...field, ...patch })
  }

  // Apply a saved response set's options to this field (copied in — editing the set
  // later never changes this template).
  function applyResponseSet(id: string) {
    const set = responseSets.find(s => s.id === id)
    if (set) update({ options: set.options.map(o => ({ ...o })) })
  }

  // Save this field's current options as a new reusable set.
  async function saveResponseSet() {
    if (field.options.length === 0) { toast.error('Add some options first'); return }
    const name = window.prompt('Name this response set (reusable across templates):')?.trim()
    if (!name) return
    const res = await createResponseSet(name, field.options)
    if (res.error) { toast.error(res.error); return }
    if (res.set) { setResponseSets(prev => [...prev, res.set!].sort((a, b) => a.name.localeCompare(b.name))); toast.success(`Saved “${name}”`) }
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

  const isLayoutField = field.field_type === 'heading' || field.field_type === 'divider'
  const isYesNo = field.field_type === 'yes_no' || field.field_type === 'yes_no_na' || field.field_type === 'pass_fail'

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm">
      {/* Field header (static — collapse is handled by the parent row) */}
      <div className="flex items-center gap-3 px-4 py-3 select-none border-b border-gray-100">
        {displayNumber && (
          <span className="flex-shrink-0 w-6 h-6 rounded-md bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
            {displayNumber}
          </span>
        )}
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
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
          {/* Item number + field type + label */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label-base">Field Type</label>
              <select
                value={field.field_type}
                onChange={(e) => {
                  const newType = e.target.value as BuilderField['field_type']
                  // Switching between yes/no variants MERGES: keep any existing option
                  // (with its custom colour) whose value still applies, and only add the
                  // variant's new values (e.g. 'na') — so flipping yes_no→yes_no_na to
                  // add N/A no longer wipes admin-customised colours.
                  const newOptions =
                    newType === 'yes_no' || newType === 'yes_no_na' || newType === 'pass_fail'
                      ? (() => {
                          const byValue = new Map(field.options.map(o => [o.value, o]))
                          return getDefaultYesNoOptions(newType).map(d => byValue.get(d.value) ?? d)
                        })()
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
              {/* Friendly preview of any {uuid} tokens already in the label */}
              {(() => {
                const tokenIds = Array.from(field.label.matchAll(/\{([^}]+)\}/g), m => m[1])
                const resolved = tokenIds.map(id => allFields.find(f => f.id === id)?.label ?? `[Unknown: ${id.slice(0, 8)}…]`)
                return resolved.length > 0 ? (
                  <p className="text-xs text-purple-600 mt-1">Dynamic value: {resolved.join(', ')}</p>
                ) : null
              })()}
              {/* Insert dynamic value — only dropdown fields that appear before this one */}
              {(() => {
                const idx = allFields.findIndex(f => f.id === field.id)
                const sources = allFields
                  .slice(0, idx >= 0 ? idx : allFields.length)
                  .filter(f => f.field_type === 'dropdown')
                return sources.length > 0 ? (
                  <div className="mt-1.5">
                    <p className="text-xs text-gray-500 mb-1">Insert dynamic value into label:</p>
                    <div className="flex flex-wrap gap-1">
                      {sources.map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => update({ label: field.label + `{${f.id}}` })}
                          className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200 hover:bg-purple-100"
                          title={`Insert value of "${f.label}" into this label`}
                        >
                          + {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null
              })()}
              {METADATA_PATTERNS.some(p => field.label.toLowerCase().includes(p)) && (
                <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                  <span>ℹ</span>
                  Already captured as job metadata — consider removing
                </p>
              )}
            </div>
          </div>

          {/* Item 5: inline toggles directly beneath the label */}
          {!isLayoutField && (
            <div className="space-y-3">
              <div className="flex items-center gap-6 flex-wrap">
                <Toggle
                  checked={field.is_required}
                  onChange={() => update({ is_required: !field.is_required })}
                  label="Required"
                />
                <Toggle
                  checked={showConditional}
                  onChange={() => {
                    const next = !showConditional
                    setShowConditional(next)
                    updateConditional(next ? { operator: 'and', conditions: [] } : null)
                  }}
                  label="Conditional display"
                />
                {isYesNo && (
                  <Toggle
                    checked={field.with_remarks}
                    onChange={() => update({ with_remarks: !field.with_remarks })}
                    label="With Remarks"
                  />
                )}
              </div>

              {showConditional && field.conditional_logic && (
                <ConditionalLogicEditor
                  logic={field.conditional_logic}
                  onChange={updateConditional}
                  availableFields={allFields.filter(f => f.id !== field.id && !['photo', 'video_link', 'signature', 'heading', 'divider'].includes(f.field_type))}
                />
              )}
            </div>
          )}

          {/* Non-layout fields have more options */}
          {!isLayoutField && (
            <>
              {/* Unit — number fields only */}
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

              {/* Item 3: collapsible help text */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showHelp}
                    onChange={(e) => {
                      setShowHelp(e.target.checked)
                      if (!e.target.checked) update({ help_text: '' })
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">Add help text</span>
                </label>
                {showHelp && (
                  <input
                    type="text"
                    value={field.help_text}
                    onChange={(e) => update({ help_text: e.target.value })}
                    className="input-base mt-2"
                    placeholder="Optional instructions for surveyors"
                  />
                )}
              </div>

              {/* Number validation */}
              {field.field_type === 'number' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="space-y-3">
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
                    {allFields.filter(f => ['number', 'time'].includes(f.field_type) && f.id !== field.id).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {allFields
                          .filter(f => ['number', 'time'].includes(f.field_type) && f.id !== field.id)
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

                  {/* Display format */}
                  <div>
                    <label className="label-base">Display Format</label>
                    <div className="flex gap-4 mt-1">
                      {(['number', 'percentage'] as const).map(fmt => (
                        <label key={fmt} className="flex items-center gap-2 cursor-pointer text-sm">
                          <input
                            type="radio"
                            checked={(field.validation.display_as ?? 'number') === fmt}
                            onChange={() => update({ validation: { ...field.validation, display_as: fmt } })}
                            className="rounded-full"
                          />
                          {fmt === 'percentage' ? 'Percentage (%)' : 'Number'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Percentage thresholds */}
                  {field.validation.display_as === 'percentage' && (
                    <div>
                      <label className="label-base">Color Thresholds (absolute %)</label>
                      <div className="space-y-1.5 mt-1">
                        {(field.validation.thresholds ?? [
                          { max: 1.0, color: 'green' as const },
                          { max: 2.0, color: 'amber' as const },
                          { color: 'red' as const },
                        ]).map((t, i, arr) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${t.color === 'green' ? 'bg-green-500' : t.color === 'amber' ? 'bg-amber-400' : 'bg-red-500'}`} />
                            <span className="text-gray-600 w-16">{t.color === 'green' ? 'Green' : t.color === 'amber' ? 'Amber' : 'Red'}</span>
                            {t.max !== undefined ? (
                              <>
                                <span className="text-gray-400">below</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={t.max}
                                  onChange={(e) => {
                                    const updated = arr.map((th, j) => j === i ? { ...th, max: parseFloat(e.target.value) } : th)
                                    update({ validation: { ...field.validation, thresholds: updated } })
                                  }}
                                  className="w-16 border border-gray-300 rounded px-2 py-0.5 text-xs"
                                />
                                <span className="text-gray-400">%</span>
                              </>
                            ) : (
                              <span className="text-gray-400">2.00%+</span>
                            )}
                          </div>
                        ))}
                        <p className="text-xs text-gray-400">Uses absolute value of result</p>
                      </div>
                    </div>
                  )}

                  {/* Billable hours: feeds the invoice qty when the client rate is hourly */}
                  <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={field.is_billable_hours}
                      onChange={(e) => update({ is_billable_hours: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-gray-700">
                      Use as billable hours
                      <span className="block text-xs text-gray-400">On Finance &gt; Create invoice, this field&apos;s value seeds the line quantity (hours) when the client&apos;s rate for the job type is hourly. Set this on one field per template.</span>
                    </span>
                  </label>
                </div>
              )}

              {/* Options for dropdown / multiple_choice */}
              {needsOptions && (
                <div>
                  {/* Reusable response sets — apply a saved set, or save these options */}
                  <div className="flex items-center gap-2 mb-2">
                    <Bookmark className="h-3.5 w-3.5 text-brand-500 flex-shrink-0" />
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) applyResponseSet(e.target.value) }}
                      className="input-base py-1 text-xs flex-1"
                      title="Apply a saved response set's options to this field"
                    >
                      <option value="">Use a saved response set…</option>
                      {responseSets.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.options.length})</option>
                      ))}
                    </select>
                    <button type="button" onClick={saveResponseSet} className="text-xs btn-secondary py-1 px-2 whitespace-nowrap" title="Save these options as a reusable set">
                      <Save className="h-3 w-3" />Save set
                    </button>
                  </div>
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
                  {field.field_type === 'multiple_choice' && (
                    <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={field.validation?.allow_other === true}
                        onChange={(e) => update({ validation: { ...field.validation, allow_other: e.target.checked } })}
                      />
                      <span className="text-sm text-gray-700">
                        Allow &ldquo;Other&rdquo; free-text answers
                        <span className="block text-xs text-gray-400">Surveyor can add a condition that isn&apos;t in the list above.</span>
                      </span>
                    </label>
                  )}
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

            </>
          )}
        </div>
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
              // Any options-bearing field (yes_no / yes_no_na / pass_fail / dropdown /
              // multiple_choice) gets a constrained dropdown from its own options, so a
              // rule can't silently never-fire on a typo (e.g. "Pass" vs the stored "pass").
              (refField && ['yes_no', 'yes_no_na', 'pass_fail', 'dropdown', 'multiple_choice'].includes(refField.field_type) && refField.options.length > 0) ? (
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
