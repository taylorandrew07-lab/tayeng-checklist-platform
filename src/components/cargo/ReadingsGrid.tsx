'use client'

import { useMemo, useRef, useState } from 'react'
import {
  type Voyage, type Period, PERIODS, PERIOD_LABELS,
  readingTypeAppliesToHold, isSinglePoint, getReadingValue, setReadingValue,
} from '@/lib/cargo/types'
import { readingCellColor, type CellColor } from '@/lib/cargo/colors'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'
import { Palette } from 'lucide-react'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void
}

function setPeriodMeta(v: Voyage, date: string, period: Period, patch: { actualTime?: string; remarks?: string }): Voyage {
  const periodMeta = { ...v.periodMeta }
  const byDate = { ...(periodMeta[date] ?? {}) }
  byDate[period] = { ...(byDate[period] ?? {}), ...patch }
  periodMeta[date] = byDate
  return { ...v, periodMeta }
}

interface InputRow { rtId: string; ptId: string; label: string; group?: string; unit: string }

export default function ReadingsGrid({ voyage, onChange }: Props) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const holds = holdNumbers(voyage.holdCount)

  const [hold, setHold] = useState(holds[0] ?? 1)
  const [date, setDate] = useState(dates[0] ?? '')
  const inputsRef = useRef<Map<string, HTMLInputElement>>(new Map())

  const colorsOn = voyage.showColors !== false
  const hasColorRules = voyage.readingTypes.some(rt => rt.colorRules)

  // Reading types shown for this hold, in order, with their points.
  const types = voyage.readingTypes.filter(rt => rt.includeInTables && readingTypeAppliesToHold(rt, hold))

  // Flat ordered list of input rows (one per point, or one per single-value type) for keyboard nav.
  const orderedRows: InputRow[] = []
  for (const rt of types) {
    if (isSinglePoint(rt)) {
      orderedRows.push({ rtId: rt.id, ptId: rt.points[0].id, label: rt.name, unit: rt.unit })
    } else {
      for (const pt of rt.points) orderedRows.push({ rtId: rt.id, ptId: pt.id, label: pt.name, group: pt.group, unit: rt.unit })
    }
  }
  const rowIndexOf = new Map(orderedRows.map((r, i) => [`${r.rtId}:${r.ptId}`, i]))

  const key = (r: number, c: number) => `r${r}c${c}`
  function focusCell(r: number, c: number) {
    const el = inputsRef.current.get(key(r, c))
    if (el) { el.focus(); el.select() }
  }

  function handleKeyDown(e: React.KeyboardEvent, r: number, c: number) {
    const maxR = orderedRows.length - 1
    const maxC = PERIODS.length - 1
    const el = e.currentTarget as HTMLInputElement
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusCell(Math.min(r + 1, maxR), c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(Math.max(r - 1, 0), c) }
    else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, Math.min(c + 1, maxC)) }
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) { e.preventDefault(); focusCell(r, Math.max(c - 1, 0)) }
  }

  // Paste a tab/newline block starting at (r,c): down a column, or a 2-D block.
  function handlePaste(e: React.ClipboardEvent, r: number, c: number) {
    const text = e.clipboardData.getData('text')
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return
    e.preventDefault()
    const rows = text.replace(/\r/g, '').split('\n')
    if (rows.length && rows[rows.length - 1] === '') rows.pop()
    let next = voyage
    rows.forEach((rowText, dr) => {
      const cells = rowText.split('\t')
      cells.forEach((cell, dc) => {
        const rr = r + dr, cc = c + dc
        if (rr < orderedRows.length && cc < PERIODS.length) {
          const row = orderedRows[rr]
          next = setReadingValue(next, date, PERIODS[cc], hold, row.rtId, row.ptId, cell.trim())
        }
      })
    })
    onChange(next)
  }

  if (dates.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">Set valid monitoring start and end dates on the Setup tab to enter readings.</p>
  }
  if (types.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No reading types apply to this hold / are marked &ldquo;Include in tables&rdquo;. Configure them on the Setup tab.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-base">Hold</label>
          <select className="input-base" value={hold} onChange={e => setHold(Number(e.target.value))}>
            {holds.map(h => <option key={h} value={h}>Hold {h}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Date</label>
          <select className="input-base" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
          </select>
        </div>
        {hasColorRules && (
          <button
            onClick={() => onChange({ ...voyage, showColors: !colorsOn })}
            className={`btn-secondary ${colorsOn ? 'text-brand-700 border-brand-300' : 'text-gray-500'}`}
            title="Toggle temperature colour coding"
          >
            <Palette className="h-4 w-4" />Colours: {colorsOn ? 'On' : 'Off'}
          </button>
        )}
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[150px]">Reading</th>
              {PERIODS.map(p => (
                <th key={p} className="px-2 py-2 font-semibold text-gray-600 text-center min-w-[90px]">{PERIOD_LABELS[p]}</th>
              ))}
            </tr>
            <tr className="border-b border-gray-200 bg-white">
              <th className="text-right px-3 py-1 text-xs font-medium text-gray-400 sticky left-0 bg-white z-10">Actual time</th>
              {PERIODS.map(p => (
                <th key={p} className="px-1 py-1">
                  <input
                    type="time"
                    className="w-full text-center px-1 py-0.5 rounded border border-gray-200 text-xs"
                    value={voyage.periodMeta?.[date]?.[p]?.actualTime ?? ''}
                    onChange={e => onChange(setPeriodMeta(voyage, date, p, { actualTime: e.target.value }))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map(rt => {
              const single = isSinglePoint(rt)
              if (single) {
                const r = rowIndexOf.get(`${rt.id}:${rt.points[0].id}`)!
                return (
                  <tr key={rt.id} className="border-b border-gray-100">
                    <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white z-10">
                      {rt.name}{rt.unit ? <span className="text-gray-400 font-normal"> ({rt.unit})</span> : null}
                    </td>
                    {PERIODS.map((p, c) => (
                      <CellInput key={p} {...{ inputsRef, r, c, value: getReadingValue(voyage, date, p, hold, rt.id, rt.points[0].id),
                        color: readingCellColor(voyage, rt, hold, date, p, rt.points[0].id),
                        onValue: val => onChange(setReadingValue(voyage, date, p, hold, rt.id, rt.points[0].id, val)),
                        onKeyDown: handleKeyDown, onPaste: handlePaste }} />
                    ))}
                  </tr>
                )
              }
              return (
                <RowsForType key={rt.id} rt={rt}>
                  {rt.points.map(pt => {
                    const r = rowIndexOf.get(`${rt.id}:${pt.id}`)!
                    return (
                      <tr key={pt.id} className="border-b border-gray-100">
                        <td className="px-3 py-1.5 sticky left-0 bg-white z-10">
                          <span className="text-gray-700">{pt.name || '—'}</span>
                          {pt.group ? <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{pt.group}</span> : null}
                        </td>
                        {PERIODS.map((p, c) => (
                          <CellInput key={p} {...{ inputsRef, r, c, value: getReadingValue(voyage, date, p, hold, rt.id, pt.id),
                            color: readingCellColor(voyage, rt, hold, date, p, pt.id),
                            onValue: val => onChange(setReadingValue(voyage, date, p, hold, rt.id, pt.id, val)),
                            onKeyDown: handleKeyDown, onPaste: handlePaste }} />
                        ))}
                      </tr>
                    )
                  })}
                </RowsForType>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <label className="label-base">Period Remarks</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {PERIODS.map(p => (
            <textarea
              key={p}
              className="input-base min-h-[52px] text-sm"
              placeholder={`${PERIOD_LABELS[p]} notes`}
              value={voyage.periodMeta?.[date]?.[p]?.remarks ?? ''}
              onChange={e => onChange(setPeriodMeta(voyage, date, p, { remarks: e.target.value }))}
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">Entering Hold {hold} · {formatVoyageDate(date)}. Arrow keys / Enter move between cells; paste a column straight from Excel.</p>
    </div>
  )
}

/** Renders a reading-type sub-header row followed by its point rows. */
function RowsForType({ rt, children }: { rt: { name: string; unit: string }; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-gray-50/70 border-b border-gray-200">
        <td colSpan={1 + PERIODS.length} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50/70">
          {rt.name}{rt.unit ? ` (${rt.unit})` : ''}
        </td>
      </tr>
      {children}
    </>
  )
}

function CellInput({
  inputsRef, r, c, value, color, onValue, onKeyDown, onPaste,
}: {
  inputsRef: React.MutableRefObject<Map<string, HTMLInputElement>>
  r: number; c: number; value: string
  color?: CellColor | null
  onValue: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent, r: number, c: number) => void
  onPaste: (e: React.ClipboardEvent, r: number, c: number) => void
}) {
  const k = `r${r}c${c}`
  return (
    <td className="px-1 py-1">
      <input
        ref={el => { if (el) inputsRef.current.set(k, el); else inputsRef.current.delete(k) }}
        value={value}
        onChange={e => onValue(e.target.value)}
        onKeyDown={e => onKeyDown(e, r, c)}
        onPaste={e => onPaste(e, r, c)}
        inputMode="decimal"
        style={color ? { backgroundColor: color.bg, color: color.fg, borderColor: color.bg } : undefined}
        className="w-full text-center px-2 py-1 rounded border border-gray-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
      />
    </td>
  )
}
