'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Info, Plus, X, Video } from 'lucide-react'
import type { TemplateField } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { getCachedNewJobData } from '@/lib/offline/db'
import { evaluateCalculation, checkConditionalLogic, formatDiffPercentage } from '@/lib/utils'
import { instanceKey } from '@/lib/offline/instanceKeys'
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
  /** Called when a text field loses focus, with its current value (for normalisation). */
  onBlur?: (value: string) => void
  readOnly?: boolean
  /** Pre-computed label with {uuid} tokens already substituted. Falls back to field.label. */
  resolvedLabel?: string
  /** Repeatable-section entry instance (0 = bare/non-repeatable). Drives calc-field
   *  token resolution so each entry computes from its own inputs. */
  instance?: number
}

function FieldRenderer({
  field,
  value,
  valueArray,
  signature,
  allValues,
  onChange,
  onArrayChange,
  onSignatureChange,
  onBlur,
  readOnly = false,
  resolvedLabel,
  instance = 0,
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
          onBlur={(e) => onBlur?.(e.target.value)}
          disabled={readOnly}
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
            min={field.validation?.min}
            max={field.validation?.max}
            className={`${baseInputClass} flex-1`}
          />
          {field.unit && <span className="text-sm text-gray-500 flex-shrink-0">{field.unit}</span>}
        </div>
      )}

      {field.field_type === 'client_select' && (
        <ClientSelectInput
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          baseInputClass={baseInputClass}
          listId={`clients-${field.id}`}
        />
      )}

      {field.field_type === 'textarea' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
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

      {(field.field_type === 'yes_no' || field.field_type === 'yes_no_na' || field.field_type === 'pass_fail') && (() => {
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
          pass: 'green',
          fail: 'red',
        }
        const allOpts = field.field_type === 'pass_fail'
          ? [
              { value: 'pass', label: 'Pass' },
              { value: 'fail', label: 'Fail' },
            ]
          : field.field_type === 'yes_no_na'
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

      {field.field_type === 'multiple_choice' && (() => {
        const selected = valueArray ?? []
        const options = field.options ?? []
        const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v
        const allowOther = field.validation?.allow_other === true
        const customValues = selected.filter(v => !options.some(o => o.value === v))

        // Read-only (incl. the in-app report view): show ONLY the chosen answers, as
        // their labels — not the whole option list.
        if (readOnly) {
          if (selected.length === 0) return <p className="text-sm text-gray-400">—</p>
          return (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((v, i) => (
                <span key={i} className="text-xs px-2 py-1 rounded-md bg-brand-50 text-brand-700 border border-brand-100">{labelFor(v)}</span>
              ))}
            </div>
          )
        }

        return (
          <div className="space-y-2">
            {options.map(opt => {
              const checked = selected.includes(opt.value)
              return (
                <label key={opt.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onArrayChange?.(checked ? selected.filter(v => v !== opt.value) : [...selected, opt.value])}
                    className="rounded border-gray-300 text-brand-600"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              )
            })}
            {allowOther && (
              <OtherAnswers
                customValues={customValues}
                onAdd={(text) => { if (!selected.includes(text)) onArrayChange?.([...selected, text]) }}
                onRemove={(text) => onArrayChange?.(selected.filter(v => v !== text))}
                baseInputClass={baseInputClass}
              />
            )}
          </div>
        )
      })()}

      {field.field_type === 'video_link' && (
        <VideoLinkInput
          links={valueArray ?? []}
          onChange={v => onArrayChange?.(v)}
          readOnly={readOnly}
          baseInputClass={baseInputClass}
        />
      )}

      {field.field_type === 'calculated' && (
        <CalculatedField
          field={field}
          value={value}
          allValues={allValues}
          instance={instance}
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

function CalculatedField({ field, value, allValues, instance = 0, onChange }: {
  field: TemplateField
  value: string
  allValues: Record<string, string>
  instance?: number
  onChange: (v: string) => void
}) {
  // Re-parse the formula only when the inputs it reads (or the entry instance)
  // actually change — not on every keystroke elsewhere on the checklist.
  const computed = useMemo(
    () => (field.calculation_formula ? evaluateCalculation(field.calculation_formula, allValues, instance) : ''),
    [field.calculation_formula, allValues, instance],
  )

  // The result is derived, but it must still be PERSISTED so it lands in the PDF
  // and the saved record. Only push a non-empty recompute up — never let a
  // transient empty result (e.g. while inputs are still hydrating from a draft)
  // overwrite an already-saved figure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (computed !== '') onChange(computed) }, [computed])

  // Prefer the freshly computed value; fall back to the persisted one so the
  // field never shows "—" when a correct value is already on record.
  const effective = computed !== '' ? computed : value

  const isPercent = field.validation?.display_as === 'percentage'
  const numVal = parseFloat(effective)

  let displayVal = effective || '—'
  let colorCls = 'bg-gray-50 text-gray-700'

  if (isPercent && !isNaN(numVal)) {
    // Denominator = last {uuid} token in the formula (the supplier / reference figure)
    const tokens = Array.from((field.calculation_formula ?? '').matchAll(/\{([^}]+)\}/g), m => m[1])
    const denominatorId = tokens[tokens.length - 1]
    const { display, pct } = formatDiffPercentage(
      numVal,
      denominatorId ? (allValues[instanceKey(denominatorId, instance)] ?? allValues[denominatorId]) : undefined,
      field.unit || undefined
    )
    // If the denominator isn't available (e.g. showing a persisted fallback
    // without live inputs), keep the plain figure rather than collapsing to "—".
    displayVal = display === '—' ? (effective || '—') : display
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

/**
 * Video Link input — one or more pasted external URLs (videos live on our NAS,
 * nothing is uploaded to Supabase). Persists only valid, non-empty URLs (via the
 * value_array path, like multiple_choice); keeps a local trailing blank row for
 * editing so an in-progress entry never gets stored.
 */
function isHttpUrl(u: string): boolean {
  try { const x = new URL(u.trim()); return x.protocol === 'http:' || x.protocol === 'https:' }
  catch { return false }
}

/**
 * "Other" free-text answers for a multiple_choice field (when validation.allow_other).
 * Custom answers are stored in the same value_array as the chosen option values; they
 * just don't match any option, so they render as their raw text everywhere.
 */
function OtherAnswers({ customValues, onAdd, onRemove, baseInputClass }: {
  customValues: string[]
  onAdd: (text: string) => void
  onRemove: (text: string) => void
  baseInputClass: string
}) {
  const [text, setText] = useState('')
  function add() {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-2.5 space-y-2">
      <p className="text-xs font-medium text-gray-500">Other (not listed above)</p>
      {customValues.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customValues.map((v, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-brand-50 text-brand-700 border border-brand-100">
              {v}
              <button type="button" onClick={() => onRemove(v)} className="text-brand-400 hover:text-red-600" aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Type a condition that isn't listed…"
          className={`${baseInputClass} flex-1`}
        />
        <button type="button" onClick={add} className="btn-secondary text-sm py-1.5 px-2.5 whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" />Add
        </button>
      </div>
    </div>
  )
}

function VideoLinkInput({ links, onChange, readOnly, baseInputClass }: {
  links: string[]
  onChange: (v: string[]) => void
  readOnly: boolean
  baseInputClass: string
}) {
  const [rows, setRows] = useState<string[]>(links.length ? links : [''])
  // Re-seed from the persisted value only when it genuinely changes from outside
  // (e.g. a draft hydrates), not on our own edits — so the editing row is kept.
  const lastExternal = useRef(links)
  useEffect(() => {
    if (links.join('') !== lastExternal.current.join('')) {
      lastExternal.current = links
      setRows(links.length ? links : [''])
    }
  }, [links])

  function commit(next: string[]) {
    setRows(next)
    // Persist only valid http(s) URLs — the single source of truth so storage,
    // required-field validation and the PDF all agree (no junk strings stored or
    // rendered as broken links). The local `rows` buffer keeps what's being typed.
    const cleaned = next.map(s => s.trim()).filter(isHttpUrl)
    lastExternal.current = cleaned
    onChange(cleaned)
  }

  if (readOnly) {
    const valid = links.filter(isHttpUrl)
    if (valid.length === 0) return <p className="text-sm text-gray-400">—</p>
    return (
      <div className="space-y-1">
        {valid.map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 break-all">
            <Video className="h-3.5 w-3.5 flex-shrink-0" />Video {i + 1}
          </a>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((url, i) => {
        const invalid = url.trim() !== '' && !isHttpUrl(url)
        return (
          <div key={i}>
            <div className="flex items-center gap-2">
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={e => commit(rows.map((r, j) => j === i ? e.target.value : r))}
                placeholder="https://… (paste the video link)"
                className={`${baseInputClass} flex-1 ${invalid ? 'border-red-400 focus:border-red-400' : ''}`}
              />
              {rows.length > 1 && (
                <button type="button" onClick={() => commit(rows.filter((_, j) => j !== i))} className="btn-ghost p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove link">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {invalid && <p className="text-xs text-red-600 mt-1">Enter a full URL starting with http:// or https://</p>}
          </div>
        )
      })}
      <button type="button" onClick={() => setRows([...rows, ''])} className="text-sm text-brand-600 hover:text-brand-800 font-medium inline-flex items-center gap-1">
        <Plus className="h-3.5 w-3.5" />Add another link
      </button>
    </div>
  )
}

/**
 * Client-linked field: a text input backed by a <datalist> of the org's active
 * clients, so the surveyor can pick an existing client OR type a free-text name
 * (e.g. a commissioning company that isn't a client). Stores the plain name string,
 * so it renders like any text field on the report. Surveyors can read clients
 * (same access the offline new-job picklists rely on).
 */
function ClientSelectInput({ value, onChange, readOnly, baseInputClass, listId }: {
  value: string
  onChange: (v: string) => void
  readOnly: boolean
  baseInputClass: string
  listId: string
}) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let active = true
    const fromCache = async () => {
      const cached = await getCachedNewJobData().catch(() => undefined)
      if (active && cached?.clients) setNames((cached.clients as { name: string }[]).map(c => c.name).filter(Boolean))
    }
    void (async () => {
      try {
        const { data } = await createClient().from('clients').select('name').eq('is_active', true).order('name')
        if (!active) return
        if (data && data.length) setNames((data as { name: string }[]).map(c => c.name).filter(Boolean))
        else await fromCache() // offline / empty → fall back to the offline new-job cache
      } catch {
        await fromCache()
      }
    })()
    return () => { active = false }
  }, [])

  if (readOnly) return <p className="text-sm text-gray-800">{value || '—'}</p>
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Pick a client or type a name"
        className={baseInputClass}
      />
      <datalist id={listId}>
        {names.map(n => <option key={n} value={n} />)}
      </datalist>
    </>
  )
}

// Re-render a field only when ITS OWN inputs change. The parent (JobChecklistEditor)
// passes a fresh `allValues` map and fresh inline callbacks every keystroke, which
// used to re-render every field (and re-run conditional/calc logic) on each character
// — the input lag surveyors felt on large checklists. The callbacks are behaviourally
// identical each render (they close over a stable `key` and useCallback'd setters that
// use functional updates), so it's safe to ignore them here. Only fields that actually
// read `allValues` — conditional-logic fields and calculated fields — need to re-render
// when the shared map changes.
function fieldPropsEqual(prev: FieldRendererProps, next: FieldRendererProps): boolean {
  const dependsOnAllValues = !!next.field.conditional_logic || next.field.field_type === 'calculated'
  if (dependsOnAllValues && prev.allValues !== next.allValues) return false
  return (
    prev.field === next.field &&
    prev.value === next.value &&
    prev.valueArray === next.valueArray &&
    prev.signature === next.signature &&
    prev.readOnly === next.readOnly &&
    prev.resolvedLabel === next.resolvedLabel &&
    prev.instance === next.instance
  )
}

export default memo(FieldRenderer, fieldPropsEqual)
