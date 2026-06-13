'use client'

// Statement of Facts logger — shared by the Loading (phase=LOAD) and Discharge
// (phase=DISCHARGE) wizard steps. Fast timestamped event entry with autocomplete
// from the controlled vocab; rows stay editable (times can be logged out of
// order — tugs/rain) and always DISPLAY grouped by date then sorted by time.

import { useState } from 'react'
import { Plus, X, ListChecks } from 'lucide-react'
import { sofVocab, type SofEvent, type SofPhase } from '@/lib/cargo/dri'

const hhmmToInput = (s: string) => (/^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : '')
const inputToHhmm = (s: string) => s.replace(':', '')
function fmtDate(iso: string): string {
  if (!iso) return '—'
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) } catch { return iso }
}

export default function SofLogger({ events, phase, defaultDate, onChange, readOnly }: {
  events: SofEvent[]
  phase: SofPhase
  defaultDate?: string
  onChange: (next: SofEvent[]) => void
  readOnly?: boolean
}) {
  const mine = events.filter(e => e.phase === phase)
  const others = events.filter(e => e.phase !== phase)
  const emit = (nextMine: SofEvent[]) => onChange([...others, ...nextMine])

  const [date, setDate] = useState(defaultDate ?? '')
  const [time, setTime] = useState('')
  const [text, setText] = useState('')
  const [hold, setHold] = useState('')
  const listId = `sof-vocab-${phase}`
  const needsHold = text.includes('#_')

  function add() {
    if (!date || !text.trim()) return
    const holdNo = hold.trim() ? Number(hold) : null
    let finalText = text.trim()
    if (holdNo != null && finalText.includes('#_')) finalText = finalText.replace('#_', `#${holdNo}`)
    const ev: SofEvent = { id: crypto.randomUUID(), phase, eventDate: date, eventTime: inputToHhmm(time) || '0000', eventText: finalText, holdNo, sortOrder: mine.length }
    emit([...mine, ev])
    setText(''); setHold('') // keep date + time for fast sequential logging
  }
  const update = (id: string, patch: Partial<SofEvent>) => emit(mine.map(e => e.id === id ? { ...e, ...patch } : e))
  const remove = (id: string) => emit(mine.filter(e => e.id !== id))

  // Group by date, sort within a date by time then insertion order.
  const groups = new Map<string, SofEvent[]>()
  for (const e of mine) { const g = groups.get(e.eventDate) ?? []; g.push(e); groups.set(e.eventDate, g) }
  const dates = [...groups.keys()].sort()
  for (const d of dates) groups.get(d)!.sort((a, b) => a.eventTime.localeCompare(b.eventTime) || a.sortOrder - b.sortOrder)

  const cell = 'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'

  return (
    <div className="space-y-4">
      <datalist id={listId}>{sofVocab(phase).map(v => <option key={v} value={v} />)}</datalist>

      {!readOnly && (
        <div className="card p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="text-[11px] text-gray-400">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={`${cell} block`} /></div>
            <div><label className="text-[11px] text-gray-400">Time</label><input type="time" value={hhmmToInput(time)} onChange={e => setTime(inputToHhmm(e.target.value))} className={`${cell} block`} /></div>
            <div className="flex-1 min-w-[200px]"><label className="text-[11px] text-gray-400">Event</label><input list={listId} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="Type or pick an event…" className={`${cell} block w-full`} /></div>
            {needsHold && <div><label className="text-[11px] text-amber-600">Hold #</label><input type="number" min={1} value={hold} onChange={e => setHold(e.target.value)} className={`${cell} block w-16`} /></div>}
            <button onClick={add} disabled={!date || !text.trim()} className="btn-primary py-1.5 px-3 text-sm"><Plus className="h-4 w-4" />Add</button>
          </div>
          {needsHold && <p className="text-[11px] text-amber-600 mt-1.5">This event has a hold placeholder (#_) — enter the hold number to fill it in.</p>}
        </div>
      )}

      {mine.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400"><ListChecks className="h-6 w-6 mx-auto mb-2 text-gray-300" />No events logged yet.</div>
      ) : (
        <div className="space-y-4">
          {dates.map(d => (
            <div key={d} className="card overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600">{fmtDate(d)}</div>
              <div className="divide-y divide-gray-50">
                {groups.get(d)!.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                    {readOnly ? (
                      <>
                        <span className="tnum text-sm text-gray-700 w-12 shrink-0">{e.eventTime}</span>
                        <span className="flex-1 text-sm text-gray-900">{e.eventText}</span>
                      </>
                    ) : (
                      <>
                        <input type="time" value={hhmmToInput(e.eventTime)} onChange={ev => update(e.id, { eventTime: inputToHhmm(ev.target.value) })} className={`${cell} w-[5.5rem] shrink-0 tnum`} />
                        <input list={listId} value={e.eventText} onChange={ev => update(e.id, { eventText: ev.target.value })} className={`${cell} flex-1`} />
                        <input type="number" min={1} value={e.holdNo ?? ''} onChange={ev => update(e.id, { holdNo: ev.target.value ? Number(ev.target.value) : null })} placeholder="Hold" title="Hold #" className={`${cell} w-16 shrink-0`} />
                        <button onClick={() => remove(e.id)} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
