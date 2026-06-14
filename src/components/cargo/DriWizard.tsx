'use client'

// DRI report phase tabs (Prep / Loading / Voyage / Discharge) that edit the
// offline Voyage.dri document. Each tab takes the dri object + an onChange that
// the workspace debounce-persists to IndexedDB. Sensor readings are NOT here —
// they live on the Readings tab; the report pulls them at render time.

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import SofLogger from './SofLogger'
import {
  DEFAULT_HOLD_CONDITION, DEFAULT_CARGO_CONDITION_OPENING, DEFAULT_OXYGEN_PCT,
  WIRING_SEQS, WEATHER_OPTIONS, SEA_STATE_OPTIONS, LENGTH_UNITS,
  type DriReport, type SofPhase, type IrReading, type VoyageLogEntry,
} from '@/lib/cargo/dri'
import type { Period } from '@/lib/cargo/types'

const cell = 'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'
const uid = () => crypto.randomUUID()
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5 mb-3">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

/** Generic repeatable list with per-row delete + an add button. */
function RepeatList<T extends { id: string }>({ items, onChange, makeNew, addLabel, empty, readOnly, render }: {
  items: T[]; onChange: (next: T[]) => void; makeNew: () => T; addLabel: string; empty?: string; readOnly?: boolean
  render: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode
}) {
  const update = (id: string, patch: Partial<T>) => onChange(items.map(i => i.id === id ? { ...i, ...patch } : i))
  const remove = (id: string) => onChange(items.filter(i => i.id !== id))
  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-sm text-gray-400">{empty ?? 'None yet.'}</p>}
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2 hover:bg-gray-50 transition-colors">
          <div className="flex-1 flex flex-wrap items-end gap-x-3 gap-y-2">{render(item, patch => update(item.id, patch))}</div>
          {!readOnly && <button onClick={() => remove(item.id)} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"><X className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {!readOnly && <button onClick={() => onChange([...items, makeNew()])} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" />{addLabel}</button>}
    </div>
  )
}

function Field({ label, children, w }: { label: string; children: React.ReactNode; w?: string }) {
  return <div className={w}><label className="block text-[11px] text-gray-400">{label}</label>{children}</div>
}

// ── Shared: IR gun readings table (Loading + Discharge) ──────────────────────
function IrTable({ rows, phase, onChange, readOnly }: { rows: IrReading[]; phase: SofPhase; onChange: (all: IrReading[]) => void; readOnly?: boolean }) {
  const mine = rows.filter(r => r.phase === phase)
  const others = rows.filter(r => r.phase !== phase)
  return (
    <RepeatList
      items={mine} readOnly={readOnly} addLabel="Add IR reading" empty="No IR gun readings yet."
      onChange={next => onChange([...others, ...next])}
      makeNew={() => ({ id: uid(), phase, readingDate: '', readingTime: '', holdNo: 1, fwdC: null, midC: null, aftC: null })}
      render={(r, u) => (<>
        <Field label="Date"><input type="date" value={r.readingDate} onChange={e => u({ readingDate: e.target.value })} className={cell} /></Field>
        <Field label="Time"><input type="time" value={r.readingTime ? `${r.readingTime.slice(0, 2)}:${r.readingTime.slice(2)}` : ''} onChange={e => u({ readingTime: e.target.value.replace(':', '') })} className={cell} /></Field>
        <Field label="Hold"><input type="number" min={1} value={r.holdNo} onChange={e => u({ holdNo: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
        <Field label="Fwd °C"><input type="number" step="0.1" value={r.fwdC ?? ''} onChange={e => u({ fwdC: num(e.target.value) })} className={`${cell} w-20`} /></Field>
        <Field label="Mid °C"><input type="number" step="0.1" value={r.midC ?? ''} onChange={e => u({ midC: num(e.target.value) })} className={`${cell} w-20`} /></Field>
        <Field label="Aft °C"><input type="number" step="0.1" value={r.aftC ?? ''} onChange={e => u({ aftC: num(e.target.value) })} className={`${cell} w-20`} /></Field>
      </>)}
    />
  )
}

// ── PREP ─────────────────────────────────────────────────────────────────────
export function PrepTab({ dri, holdCount, onChange, readOnly }: { dri: DriReport; holdCount: number; onChange: (d: DriReport) => void; readOnly?: boolean }) {
  // Reconcile hold inspections to the current hold count (keep existing edits).
  const inspections = useMemo(() => {
    const map = new Map(dri.holdInspections.map(h => [h.holdNo, h]))
    return Array.from({ length: holdCount }, (_, i) => map.get(i + 1) ?? { holdNo: i + 1, conditionText: DEFAULT_HOLD_CONDITION, clean: true })
  }, [dri.holdInspections, holdCount])

  return (
    <div className="space-y-5">
      <Section title="Preliminary meeting">
        <div className="space-y-2">
          <Field label="Meeting date" w="max-w-[200px]"><input type="date" disabled={readOnly} value={dri.preliminaryMeeting?.meetingDate ?? ''} onChange={e => onChange({ ...dri, preliminaryMeeting: { notes: dri.preliminaryMeeting?.notes ?? '', meetingDate: e.target.value } })} className={`${cell} block`} /></Field>
          <textarea disabled={readOnly} rows={3} placeholder="Meeting notes…" value={dri.preliminaryMeeting?.notes ?? ''} onChange={e => onChange({ ...dri, preliminaryMeeting: { meetingDate: dri.preliminaryMeeting?.meetingDate, notes: e.target.value } })} className="input-base text-sm resize-y" />
        </div>
      </Section>

      <Section title="Ultrasonic hatch testing">
        <RepeatList items={dri.ultrasonicHatchTests} readOnly={readOnly} addLabel="Add test" empty="No hatch tests recorded."
          onChange={x => onChange({ ...dri, ultrasonicHatchTests: x })}
          makeNew={() => ({ id: uid(), testDate: '', notes: '' })}
          render={(t, u) => (<>
            <Field label="Test date"><input type="date" value={t.testDate} onChange={e => u({ testDate: e.target.value })} className={cell} /></Field>
            <Field label="Notes" w="flex-1 min-w-[200px]"><input value={t.notes ?? ''} onChange={e => u({ notes: e.target.value })} className={`${cell} w-full`} /></Field>
          </>)} />
      </Section>

      <Section title="Stock pile inspection" hint="Optional — only some reports include this.">
        <RepeatList items={dri.stockpileInspections} readOnly={readOnly} addLabel="Add inspection" empty="None recorded."
          onChange={x => onChange({ ...dri, stockpileInspections: x })}
          makeNew={() => ({ id: uid(), inspectedOn: '', description: '' })}
          render={(s, u) => (<>
            <Field label="Inspected on"><input type="datetime-local" value={s.inspectedOn} onChange={e => u({ inspectedOn: e.target.value })} className={cell} /></Field>
            <Field label="Description" w="flex-1 min-w-[220px]"><input value={s.description} onChange={e => u({ description: e.target.value })} className={`${cell} w-full`} /></Field>
          </>)} />
      </Section>

      <Section title="Hold inspections" hint="Standard sentence pre-filled per hold — edit as needed.">
        <div className="space-y-2">
          {inspections.map(h => (
            <div key={h.holdNo} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
              <span className="text-sm font-medium text-gray-700 w-16 shrink-0">Hold {h.holdNo}</span>
              <input disabled={readOnly} value={h.conditionText} onChange={e => onChange({ ...dri, holdInspections: inspections.map(x => x.holdNo === h.holdNo ? { ...x, conditionText: e.target.value } : x) })} className={`${cell} flex-1`} />
              <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0"><input type="checkbox" disabled={readOnly} checked={h.clean} onChange={e => onChange({ ...dri, holdInspections: inspections.map(x => x.holdNo === h.holdNo ? { ...x, clean: e.target.checked } : x) })} className="h-4 w-4 rounded border-gray-300 text-brand-600" />clean</label>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Thermocouple wire installation">
        <RepeatList items={dri.tcWireInstalls} readOnly={readOnly} addLabel="Add row" empty="No installations recorded."
          onChange={x => onChange({ ...dri, tcWireInstalls: x })}
          makeNew={() => ({ id: uid(), installDate: '', holdNo: 1, wiringSeq: WIRING_SEQS[0], startTime: '', completedTime: '' })}
          render={(t, u) => (<>
            <Field label="Date"><input type="date" value={t.installDate} onChange={e => u({ installDate: e.target.value })} className={cell} /></Field>
            <Field label="Hold"><input type="number" min={1} value={t.holdNo} onChange={e => u({ holdNo: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Wiring seq."><select value={t.wiringSeq} onChange={e => u({ wiringSeq: e.target.value as typeof t.wiringSeq })} className={cell}>{WIRING_SEQS.map(w => <option key={w}>{w}</option>)}</select></Field>
            <Field label="Start"><input type="time" value={t.startTime ? `${t.startTime.slice(0, 2)}:${t.startTime.slice(2)}` : ''} onChange={e => u({ startTime: e.target.value.replace(':', '') })} className={cell} /></Field>
            <Field label="Completed"><input type="time" value={t.completedTime ? `${t.completedTime.slice(0, 2)}:${t.completedTime.slice(2)}` : ''} onChange={e => u({ completedTime: e.target.value.replace(':', '') })} className={cell} /></Field>
          </>)} />
      </Section>

      <Section title="Thermocouple wire lengths">
        <RepeatList items={dri.tcWireLengths} readOnly={readOnly} addLabel="Add length" empty="No wire lengths recorded."
          onChange={x => onChange({ ...dri, tcWireLengths: x })}
          makeNew={() => ({ id: uid(), wiringLevel: '', appliesToHolds: '', tcNumber: 1, lengthValue: 0, lengthUnit: LENGTH_UNITS[0] })}
          render={(t, u) => (<>
            <Field label="Wiring level"><input value={t.wiringLevel} onChange={e => u({ wiringLevel: e.target.value })} placeholder="Base / Level 1…" className={`${cell} w-28`} /></Field>
            <Field label="Holds"><input value={t.appliesToHolds} onChange={e => u({ appliesToHolds: e.target.value })} placeholder="1,3,5" className={`${cell} w-20`} /></Field>
            <Field label="TC #"><input type="number" min={1} value={t.tcNumber} onChange={e => u({ tcNumber: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Length"><input type="number" step="0.01" value={t.lengthValue} onChange={e => u({ lengthValue: Number(e.target.value) })} className={`${cell} w-24`} /></Field>
            <Field label="Unit"><select value={t.lengthUnit} onChange={e => u({ lengthUnit: e.target.value as typeof t.lengthUnit })} className={cell}>{LENGTH_UNITS.map(x => <option key={x}>{x}</option>)}</select></Field>
          </>)} />
      </Section>
    </div>
  )
}

// ── LOADING ──────────────────────────────────────────────────────────────────
export function LoadingTab({ dri, defaultDate, onChange, readOnly }: { dri: DriReport; defaultDate?: string; onChange: (d: DriReport) => void; readOnly?: boolean }) {
  return (
    <div className="space-y-5">
      <Section title="Statement of Facts — Loading"><SofLogger events={dri.sofEvents} phase="LOAD" defaultDate={defaultDate} readOnly={readOnly} onChange={ev => onChange({ ...dri, sofEvents: ev })} /></Section>
      <Section title="IR gun temperature readings — Loading"><IrTable rows={dri.irReadings} phase="LOAD" readOnly={readOnly} onChange={ir => onChange({ ...dri, irReadings: ir })} /></Section>
      <Section title="Inerting report">
        <RepeatList items={dri.inerting} readOnly={readOnly} addLabel="Add hold" empty="No inerting recorded."
          onChange={x => onChange({ ...dri, inerting: x })}
          makeNew={() => ({ id: uid(), holdNo: 1, commencedAt: '', completedAt: '', totalHours: 0, totalMinutes: 0, oxygenPct: DEFAULT_OXYGEN_PCT })}
          render={(t, u) => (<>
            <Field label="Hold"><input type="number" min={1} value={t.holdNo} onChange={e => u({ holdNo: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Commenced"><input type="datetime-local" value={t.commencedAt} onChange={e => u({ commencedAt: e.target.value })} className={cell} /></Field>
            <Field label="Completed"><input type="datetime-local" value={t.completedAt} onChange={e => u({ completedAt: e.target.value })} className={cell} /></Field>
            <Field label="Hrs"><input type="number" min={0} value={t.totalHours} onChange={e => u({ totalHours: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Mins"><input type="number" min={0} max={59} value={t.totalMinutes} onChange={e => u({ totalMinutes: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Oxygen %"><input type="number" step="0.1" value={t.oxygenPct} onChange={e => u({ oxygenPct: Number(e.target.value) })} className={`${cell} w-20`} /></Field>
          </>)} />
      </Section>
    </div>
  )
}

// ── VOYAGE (daily log) ───────────────────────────────────────────────────────
const SLOTS: Period[] = ['0600', '1200', '1800']
export function VoyageLogTab({ dri, onChange, readOnly }: { dri: DriReport; onChange: (d: DriReport) => void; readOnly?: boolean }) {
  const byDate = useMemo(() => {
    const m = new Map<string, VoyageLogEntry[]>()
    for (const e of dri.voyageLog) { const g = m.get(e.logDate) ?? []; g.push(e); m.set(e.logDate, g) }
    return m
  }, [dri.voyageLog])
  const dates = [...byDate.keys()].sort()

  function addDay(date: string) {
    if (!date || byDate.has(date)) return
    const seeded: VoyageLogEntry[] = SLOTS.map(slot => ({ id: uid(), logDate: date, slot, readingsTaken: true, holdsList: 'all holds', weather: 'clear and sunny', seaState: 'calm', sealingFoamOk: true, atmosphericTempC: null }))
    onChange({ ...dri, voyageLog: [...dri.voyageLog, ...seeded] })
  }
  const upd = (id: string, patch: Partial<VoyageLogEntry>) => onChange({ ...dri, voyageLog: dri.voyageLog.map(e => e.id === id ? { ...e, ...patch } : e) })
  const removeDay = (date: string) => onChange({ ...dri, voyageLog: dri.voyageLog.filter(e => e.logDate !== date) })

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="card p-3 flex items-end gap-2">
          <Field label="Add a day"><input type="date" id="vl-add" className={`${cell} block`} onChange={e => { addDay(e.target.value); e.target.value = '' }} /></Field>
          <span className="text-xs text-gray-400 pb-1.5">Seeds the 0600 / 1200 / 1800 slots with the standard sentence.</span>
        </div>
      )}
      {dates.length === 0 ? <div className="card p-8 text-center text-sm text-gray-400">No voyage days yet.</div> : dates.map(d => (
        <div key={d} className="card overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600">{new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {!readOnly && <button onClick={() => removeDay(d)} className="text-xs text-gray-400 hover:text-red-600">Remove day</button>}
          </div>
          <div className="divide-y divide-gray-50">
            {SLOTS.map(slot => {
              const e = byDate.get(d)!.find(x => x.slot === slot)
              if (!e) return null
              return (
                <div key={slot} className="px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="tnum text-sm font-medium text-gray-700 w-12">{slot}</span>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500"><input type="checkbox" disabled={readOnly} checked={e.readingsTaken} onChange={ev => upd(e.id, { readingsTaken: ev.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600" />readings taken</label>
                    {e.readingsTaken ? (<>
                      <Field label="Holds"><input disabled={readOnly} value={e.holdsList} onChange={ev => upd(e.id, { holdsList: ev.target.value })} className={`${cell} w-28`} /></Field>
                      <Field label="Weather"><select disabled={readOnly} value={e.weather} onChange={ev => upd(e.id, { weather: ev.target.value as VoyageLogEntry['weather'] })} className={cell}>{WEATHER_OPTIONS.map(w => <option key={w}>{w}</option>)}</select></Field>
                      <Field label="Sea state"><select disabled={readOnly} value={e.seaState} onChange={ev => upd(e.id, { seaState: ev.target.value as VoyageLogEntry['seaState'] })} className={cell}>{SEA_STATE_OPTIONS.map(s => <option key={s}>{s}</option>)}</select></Field>
                      <label className="flex items-center gap-1.5 text-xs text-gray-500"><input type="checkbox" disabled={readOnly} checked={e.sealingFoamOk} onChange={ev => upd(e.id, { sealingFoamOk: ev.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600" />sealing foam OK</label>
                      {slot === '1800' && <Field label="Atmos. °C"><input disabled={readOnly} type="number" step="0.1" value={e.atmosphericTempC ?? ''} onChange={ev => upd(e.id, { atmosphericTempC: num(ev.target.value) })} className={`${cell} w-20`} /></Field>}
                    </>) : (
                      <input disabled={readOnly} value={e.note ?? ''} onChange={ev => upd(e.id, { note: ev.target.value })} placeholder="Reason readings could not be taken…" className={`${cell} flex-1 min-w-[220px]`} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── DISCHARGE ────────────────────────────────────────────────────────────────
export function DischargeTab({ dri, defaultDate, onChange, readOnly }: { dri: DriReport; defaultDate?: string; onChange: (d: DriReport) => void; readOnly?: boolean }) {
  return (
    <div className="space-y-5">
      <Section title="Statement of Facts — Discharge"><SofLogger events={dri.sofEvents} phase="DISCHARGE" defaultDate={defaultDate} readOnly={readOnly} onChange={ev => onChange({ ...dri, sofEvents: ev })} /></Section>
      <Section title="Hold openings" hint="Standard cargo-condition sentence pre-filled — edit as needed.">
        <RepeatList items={dri.holdOpenings} readOnly={readOnly} addLabel="Add hold opening" empty="No hold openings recorded."
          onChange={x => onChange({ ...dri, holdOpenings: x })}
          makeNew={() => ({ id: uid(), holdNo: 1, openedAt: '', condensation: false, cargoCondition: DEFAULT_CARGO_CONDITION_OPENING, irFwdC: null, irMidC: null, irAftC: null, notes: '' })}
          render={(h, u) => (<>
            <Field label="Hold"><input type="number" min={1} value={h.holdNo} onChange={e => u({ holdNo: Number(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Opened"><input type="datetime-local" value={h.openedAt} onChange={e => u({ openedAt: e.target.value })} className={cell} /></Field>
            <Field label="Cargo condition" w="flex-1 min-w-[200px]"><input value={h.cargoCondition} onChange={e => u({ cargoCondition: e.target.value })} className={`${cell} w-full`} /></Field>
            <Field label="Fwd °C"><input type="number" step="0.1" value={h.irFwdC ?? ''} onChange={e => u({ irFwdC: num(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Mid °C"><input type="number" step="0.1" value={h.irMidC ?? ''} onChange={e => u({ irMidC: num(e.target.value) })} className={`${cell} w-16`} /></Field>
            <Field label="Aft °C"><input type="number" step="0.1" value={h.irAftC ?? ''} onChange={e => u({ irAftC: num(e.target.value) })} className={`${cell} w-16`} /></Field>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 pb-1.5"><input type="checkbox" checked={h.condensation} onChange={e => u({ condensation: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-brand-600" />condensation</label>
          </>)} />
      </Section>
      <Section title="IR gun temperature readings — Discharge"><IrTable rows={dri.irReadings} phase="DISCHARGE" readOnly={readOnly} onChange={ir => onChange({ ...dri, irReadings: ir })} /></Section>
      <Section title="Barge list">
        <RepeatList items={dri.barges} readOnly={readOnly} addLabel="Add barge" empty="No barges recorded."
          onChange={x => onChange({ ...dri, barges: x })}
          makeNew={() => ({ id: uid(), location: '', bargeId: '', holds: '', commenceAt: '', completedAt: '' })}
          render={(b, u) => (<>
            <Field label="Location"><input value={b.location} onChange={e => u({ location: e.target.value })} className={`${cell} w-32`} /></Field>
            <Field label="Barge"><input value={b.bargeId} onChange={e => u({ bargeId: e.target.value })} className={`${cell} w-28`} /></Field>
            <Field label="Holds"><input value={b.holds} onChange={e => u({ holds: e.target.value })} placeholder="1,2" className={`${cell} w-20`} /></Field>
            <Field label="Commence"><input type="datetime-local" value={b.commenceAt} onChange={e => u({ commenceAt: e.target.value })} className={cell} /></Field>
            <Field label="Completed"><input type="datetime-local" value={b.completedAt} onChange={e => u({ completedAt: e.target.value })} className={cell} /></Field>
          </>)} />
      </Section>
    </div>
  )
}
