'use client'

import { useMemo, useRef, useState } from 'react'
import {
  type Voyage, type Period, PERIODS, PERIOD_LABELS, readingTypeAppliesToHold,
} from '@/lib/cargo/types'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void
}

/** Immutably set one reading value in the nested readings map. */
function setReading(v: Voyage, date: string, period: Period, hold: number, rtId: string, value: string): Voyage {
  const readings = { ...v.readings }
  const byDate = { ...(readings[date] ?? {}) }
  const byPeriod = { ...(byDate[period] ?? {}) }
  const byHold = { ...(byPeriod[String(hold)] ?? {}) }
  byHold[rtId] = value
  byPeriod[String(hold)] = byHold
  byDate[period] = byPeriod
  readings[date] = byDate
  return { ...v, readings }
}

function setPeriodMeta(v: Voyage, date: string, period: Period, patch: { actualTime?: string; remarks?: string }): Voyage {
  const periodMeta = { ...v.periodMeta }
  const byDate = { ...(periodMeta[date] ?? {}) }
  byDate[period] = { ...(byDate[period] ?? {}), ...patch }
  periodMeta[date] = byDate
  return { ...v, periodMeta }
}

export default function ReadingsGrid({ voyage, onChange }: Props) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const holds = holdNumbers(voyage.holdCount)
  const cols = voyage.readingTypes.filter(rt => rt.includeInTables)

  const [date, setDate] = useState(dates[0] ?? '')
  const [period, setPeriod] = useState<Period>('0600')
  const inputsRef = useRef<Map<string, HTMLInputElement>>(new Map())

  const meta = voyage.periodMeta?.[date]?.[period] ?? {}
  const getVal = (hold: number, rtId: string) => voyage.readings?.[date]?.[period]?.[String(hold)]?.[rtId] ?? ''

  const key = (r: number, c: number) => `r${r}c${c}`

  function focusCell(r: number, c: number) {
    const el = inputsRef.current.get(key(r, c))
    if (el) { el.focus(); el.select() }
  }

  function handleKeyDown(e: React.KeyboardEvent, r: number, c: number) {
    const maxR = holds.length - 1
    const maxC = cols.length - 1
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusCell(Math.min(r + 1, maxR), c) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(Math.max(r - 1, 0), c) }
    else if (e.key === 'ArrowRight' && (e.currentTarget as HTMLInputElement).selectionStart === (e.currentTarget as HTMLInputElement).value.length) { e.preventDefault(); focusCell(r, Math.min(c + 1, maxC)) }
    else if (e.key === 'ArrowLeft' && (e.currentTarget as HTMLInputElement).selectionStart === 0) { e.preventDefault(); focusCell(r, Math.max(c - 1, 0)) }
  }

  // Paste a tab/newline-separated block starting at (r,c).
  function handlePaste(e: React.ClipboardEvent, r: number, c: number) {
    const text = e.clipboardData.getData('text')
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return // single value: default behaviour
    e.preventDefault()
    const rows = text.replace(/\r/g, '').split('\n').filter((row, i, arr) => row.length > 0 || i < arr.length - 1)
    let next = voyage
    rows.forEach((rowText, dr) => {
      const cells = rowText.split('\t')
      cells.forEach((cell, dc) => {
        const rr = r + dr
        const cc = c + dc
        if (rr < holds.length && cc < cols.length) {
          const hold = holds[rr]
          const rt = cols[cc]
          if (readingTypeAppliesToHold(rt, hold)) next = setReading(next, date, period, hold, rt.id, cell.trim())
        }
      })
    })
    onChange(next)
  }

  if (dates.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">Set valid monitoring start and end dates on the Setup tab to enter readings.</p>
  }
  if (cols.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No reading types are marked &ldquo;Include in tables&rdquo;. Configure them on the Setup tab.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-base">Date</label>
          <select className="input-base" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Monitoring Period</label>
          <select className="input-base" value={period} onChange={e => setPeriod(e.target.value as Period)}>
            {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Actual Time</label>
          <input type="time" className="input-base" value={meta.actualTime ?? ''} onChange={e => onChange(setPeriodMeta(voyage, date, period, { actualTime: e.target.value }))} />
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10">Hold</th>
              {cols.map(rt => (
                <th key={rt.id} className="px-2 py-2 font-semibold text-gray-600 text-center whitespace-nowrap min-w-[90px]">
                  {rt.name}{rt.unit ? <span className="text-gray-400 font-normal"> ({rt.unit})</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holds.map((hold, r) => (
              <tr key={hold} className="border-b border-gray-100">
                <td className="px-3 py-1.5 font-medium text-gray-700 sticky left-0 bg-white z-10">Hold {hold}</td>
                {cols.map((rt, c) => {
                  const applies = readingTypeAppliesToHold(rt, hold)
                  return (
                    <td key={rt.id} className="px-1 py-1">
                      <input
                        ref={el => { if (el) inputsRef.current.set(key(r, c), el); else inputsRef.current.delete(key(r, c)) }}
                        disabled={!applies}
                        value={applies ? getVal(hold, rt.id) : ''}
                        onChange={e => onChange(setReading(voyage, date, period, hold, rt.id, e.target.value))}
                        onKeyDown={e => handleKeyDown(e, r, c)}
                        onPaste={e => handlePaste(e, r, c)}
                        inputMode="decimal"
                        className="w-full text-center px-2 py-1 rounded border border-gray-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-gray-50 disabled:text-gray-300"
                        placeholder={applies ? '' : '—'}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <label className="label-base">Period Remarks</label>
        <textarea
          className="input-base min-h-[60px]"
          value={meta.remarks ?? ''}
          onChange={e => onChange(setPeriodMeta(voyage, date, period, { remarks: e.target.value }))}
          placeholder="Optional notes for this monitoring period"
        />
      </div>

      <p className="text-xs text-gray-400">Tip: use arrow keys / Enter to move between cells. Paste a block copied from Excel directly into a cell.</p>
    </div>
  )
}
