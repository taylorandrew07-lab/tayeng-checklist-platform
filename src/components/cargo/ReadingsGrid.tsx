'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type Voyage, type Period, BASE_PERIODS,
  readingTypeAppliesToHold, isSinglePoint, getReadingValue, setReadingValue, clearPeriodFrom,
} from '@/lib/cargo/types'
import { readingCellColor, type CellColor } from '@/lib/cargo/colors'
import {
  monitoringDates, effectiveEndDate, defaultPickerDate, formatVoyageDate, holdNumbers,
  periodsForDate, periodLabel, inputToHhmm, addExtraRound, removeExtraRound,
} from '@/lib/cargo/periods'
import { countPhotosForPeriodFrom, deletePhotosForPeriodFrom } from '@/lib/cargo/db'
import { RowDeleteButton } from '@/components/ui/RowDeleteButton'
import { confirmDialog } from '@/components/ui/confirm'
import { Palette, Plus } from 'lucide-react'

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
  // Open-ended voyages (no end date yet) run to today — see effectiveEndDate.
  const endISO = effectiveEndDate(voyage)
  const dates = useMemo(() => monitoringDates(voyage.startDate, endISO), [voyage.startDate, endISO])
  const holds = holdNumbers(voyage.holdCount)

  const [hold, setHold] = useState(holds[0] ?? 1)
  // Opens on the newest day — that's the round being entered.
  const [picked, setDate] = useState(() => defaultPickerDate(dates))
  // Clamped rather than stored: purging the tail of an open-ended voyage can
  // shrink the calendar out from under the selected day.
  const date = dates.includes(picked) ? picked : defaultPickerDate(dates)
  const inputsRef = useRef<Map<string, HTMLInputElement>>(new Map())

  // Which rounds THIS day has: the base three plus any extra running on it.
  const periods = useMemo(() => periodsForDate(voyage, date), [voyage, date])

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
    const maxC = periods.length - 1
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
        if (rr < orderedRows.length && cc < periods.length) {
          const row = orderedRows[rr]
          next = setReadingValue(next, date, periods[cc], hold, row.rtId, row.ptId, cell.trim())
        }
      })
    })
    onChange(next)
  }

  // --- Extra rounds -----------------------------------------------------------
  // Cargo that starts misbehaving gets watched more often. An extra round runs
  // from the selected day onwards, so the record stays true to what was done.
  const [adding, setAdding] = useState(false)
  const [newTime, setNewTime] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  function cancelAdd() { setAdding(false); setNewTime(''); setAddError(null) }

  function commitAdd() {
    const hhmm = inputToHhmm(newTime)
    if (!hhmm) return setAddError('Enter a time, e.g. 22:00.')
    if (periods.includes(hhmm)) return setAddError(`There is already a ${periodLabel(hhmm)} round on this day.`)
    onChange(addExtraRound(voyage, hhmm, date))
    cancelAdd()
  }

  async function removeRound(time: Period) {
    // Stop it from this day on, drop the values it already holds here and later,
    // and take its photos with it — all three or the report tells a lie.
    await deletePhotosForPeriodFrom(voyage.id, time, date)
    onChange(removeExtraRound(clearPeriodFrom(voyage, time, date), time, date))
  }

  /** Spelt out in full — this is destructive and the scope is the surprising part. */
  async function removalMessage(time: Period): Promise<string> {
    const label = periodLabel(time)
    // Count only days that really hold something — a message that overstates the
    // damage teaches people to click straight through it.
    const holds = (d: string) =>
      Object.keys(voyage.readings?.[d]?.[time] ?? {}).length > 0 ||
      Object.keys(voyage.periodMeta?.[d]?.[time] ?? {}).length > 0
    const later = dates.filter(d => d > date && holds(d)).length
    const here = holds(date) ? 1 : 0
    const photos = await countPhotosForPeriodFrom(voyage.id, time, date)
    const parts = [
      `The ${label} reading stops from ${formatVoyageDate(date)} onwards.`,
      `Days before it keep their ${label} readings and still print in the report.`,
    ]
    if (here || later) {
      const days = here + later
      parts.push(`This deletes ${label} values already entered on ${days === 1 ? 'that day' : `${days} days`}${photos ? `, and ${photos} photo${photos === 1 ? '' : 's'} filed under it` : ''}.`)
    } else if (photos) {
      parts.push(`This deletes ${photos} photo${photos === 1 ? '' : 's'} filed under it.`)
    }
    parts.push('This cannot be undone.')
    return parts.join(' ')
  }

  if (dates.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">Set a valid monitoring start date on the Setup tab to enter readings.</p>
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
        <div className="ml-auto flex flex-wrap items-end gap-2">
          {hasColorRules && (
            <button
              onClick={() => onChange({ ...voyage, showColors: !colorsOn })}
              className={`btn-secondary ${colorsOn ? 'text-brand-700 border-brand-300' : 'text-gray-500'}`}
              title="Toggle temperature colour coding"
            >
              <Palette className="h-4 w-4" />Colours: {colorsOn ? 'On' : 'Off'}
            </button>
          )}
          {adding ? (
            <>
              <div>
                <label className="label-base">New reading time</label>
                <input
                  type="time"
                  autoFocus
                  className="input-base tnum w-[7.5rem]"
                  value={newTime}
                  onChange={e => { setNewTime(e.target.value); setAddError(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') cancelAdd() }}
                />
              </div>
              <button onClick={commitAdd} disabled={!newTime} className="btn-primary">Add</button>
              <button onClick={cancelAdd} className="btn-ghost">Cancel</button>
            </>
          ) : (
            <button onClick={() => setAdding(true)} className="btn-secondary whitespace-nowrap">
              <Plus className="h-4 w-4" />Add reading time
            </button>
          )}
        </div>
        {adding && (
          <p className="w-full text-xs text-gray-500 -mt-1">
            Taken from {formatVoyageDate(date)} onwards — this day and every later day. Earlier days are unchanged.
          </p>
        )}
        {addError && (
          <div className="w-full rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{addError}</div>
        )}
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10 min-w-[150px]">Reading</th>
              {periods.map(p => (
                <th key={p} className="px-2 py-2 font-semibold text-gray-600 text-center min-w-[90px] whitespace-nowrap">
                  <span className="tnum">{periodLabel(p)}</span>
                  {/* Only an extra round can be stopped — the base three have no
                      icon, which is how their permanence documents itself. */}
                  {!BASE_PERIODS.includes(p) && (
                    <RowDeleteButton
                      confirm={false}
                      ariaLabel={`Stop the ${periodLabel(p)} round`}
                      className="ml-1 align-middle"
                      onDelete={async () => {
                        const ok = await confirmDialog({
                          title: `Stop the ${periodLabel(p)} round?`,
                          message: await removalMessage(p),
                          confirmLabel: 'Stop this round',
                          danger: true,
                        })
                        if (ok) await removeRound(p)
                      }}
                    />
                  )}
                </th>
              ))}
            </tr>
            <tr className="border-b border-gray-200 bg-white">
              <th className="text-right px-3 py-1 text-xs font-medium text-gray-400 sticky left-0 bg-white z-10">Actual time</th>
              {periods.map(p => (
                <th key={p} className="px-1 py-1">
                  <input
                    type="time"
                    className="w-full text-center px-1 py-0.5 rounded border border-gray-200 text-xs tnum"
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
                    {periods.map((p, c) => (
                      <CellInput key={p} {...{ inputsRef, r, c, value: getReadingValue(voyage, date, p, hold, rt.id, rt.points[0].id),
                        color: readingCellColor(voyage, rt, hold, date, p, rt.points[0].id),
                        onValue: val => onChange(setReadingValue(voyage, date, p, hold, rt.id, rt.points[0].id, val)),
                        onKeyDown: handleKeyDown, onPaste: handlePaste }} />
                    ))}
                  </tr>
                )
              }
              return (
                <RowsForType key={rt.id} rt={rt} periodCount={periods.length}>
                  {rt.points.map(pt => {
                    const r = rowIndexOf.get(`${rt.id}:${pt.id}`)!
                    return (
                      <tr key={pt.id} className="border-b border-gray-100">
                        <td className="px-3 py-1.5 sticky left-0 bg-white z-10">
                          <span className="text-gray-700">{pt.name || '—'}</span>
                          {pt.group ? <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{pt.group}</span> : null}
                        </td>
                        {periods.map((p, c) => (
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
        {/* Fixed responsive columns, never grid-cols-${n}: Tailwind can't see a
            runtime class and the grid would collapse to one column. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {periods.map(p => (
            <div key={p}>
              {/* Once the boxes wrap onto a second row the placeholder alone no
                  longer says which round they belong to — and it vanishes on the
                  first keystroke anyway. */}
              <p className="text-[11px] text-gray-500 mb-0.5 tnum">{periodLabel(p)}</p>
              <textarea
                className="input-base min-h-[52px] text-sm"
                placeholder="Notes"
                value={voyage.periodMeta?.[date]?.[p]?.remarks ?? ''}
                onChange={e => onChange(setPeriodMeta(voyage, date, p, { remarks: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">Entering Hold {hold} · {formatVoyageDate(date)}. Arrow keys / Enter move between cells; paste a column straight from Excel. Extra reading times apply from the day you add them onwards.</p>
    </div>
  )
}

/** Renders a reading-type sub-header row followed by its point rows. */
function RowsForType({ rt, periodCount, children }: { rt: { name: string; unit: string }; periodCount: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-gray-50/70 border-b border-gray-200">
        <td colSpan={1 + periodCount} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 sticky left-0 bg-gray-50/70">
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
