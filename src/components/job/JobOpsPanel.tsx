'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus, X, Upload, Download, Trash2, Loader2, Clock, CheckCircle2, MapPin } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import {
  WORKFLOW, WORKFLOW_ORDER, normalizeWorkflowStatus, ATTACHMENT_KINDS, attachmentLabel, formatBytes, money, CURRENCIES,
  setWorkflowStatus, updateJobField, clearJobLabourForFixed, listJobSurveyors, listSurveyorAccounts, addJobSurveyor, removeJobSurveyor,
  updateJobSurveyorHours, updateJobSurveyorRates,
  listSurveyorOvertime, addSurveyorOvertime, deleteSurveyorOvertime, shiftHours,
  listSurveyorKm, addSurveyorKm, deleteSurveyorKm, KM_MIN, KM_MAX,
  listJobAttachments, uploadJobAttachment, deleteJobAttachment, jobFileUrl, listJobActivity,
  type JobSurveyorRow, type SurveyorAccount, type OvertimeEntry, type KmEntry,
} from '@/lib/jobs/tracker'
import { asLabourUnit, labourLabels, type LabourUnit } from '@/lib/jobs/labourUnit'
import { checkSurveyorConflicts } from '@/lib/jobs/conflicts'
import { notifyAssignment } from '@/lib/jobs/notify'
import type { Job, JobAttachment, WorkflowStatus, JobAttachmentKind, ActivityLogRow } from '@/lib/types/database'

function activityText(a: ActivityLogRow): string {
  const act = a.action
  if (act === 'created') return 'Job created'
  if (act === 'hours:update') return 'Hours updated'
  if (act === 'rates:update') return 'Pay rates updated'
  if (act === 'surveyor:add') return 'Surveyor added'
  if (act === 'surveyor:remove') return 'Surveyor removed'
  if (act === 'attachment:delete') return 'Attachment removed'
  if (act === 'invoice:save') return 'Invoice saved'
  if (act === 'invoice:delete') return 'Invoice deleted'
  if (act === 'invoice:email_draft') return 'Invoice email draft created'
  if (act.startsWith('workflow:')) {
    // History is kept honest — retired slugs (new/assigned/approved/invoiced/sent/
    // paid) are folded onto their post-145 stage only for display.
    const raw = act.slice(9)
    return `Status → ${WORKFLOW[normalizeWorkflowStatus(raw)]?.label ?? raw}`
  }
  if (act.startsWith('attachment:')) { const k = act.slice(11) as JobAttachmentKind; return `Uploaded ${attachmentLabel(k).toLowerCase()}` }
  return act
}

// dd/mm — compact day shown beside a shift time.
const fmtDay = (iso: string | null) => iso ? iso.split('-').reverse().slice(0, 2).join('/') : '—'
// A shift line: "27/06 08:00 → 28/06 02:00", collapsing the stop day when same as start.
function fmtSpan(e: { entry_date: string | null; start_time: string | null; end_date: string | null; end_time: string | null }): string {
  const start = `${fmtDay(e.entry_date)} ${e.start_time ?? '--:--'}`
  const stopDay = e.end_date && e.end_date !== e.entry_date ? `${fmtDay(e.end_date)} ` : ''
  return `${start} → ${stopDay}${e.end_time ?? '--:--'}`
}

function SurveyorRow({ row, jobId, isAdmin, billingMode, unit, locked, billableHours, defaultDate, onRemove, onSaved, onEntries, onKm, registerFlush, onDirty }: {
  row: JobSurveyorRow; jobId: string; isAdmin: boolean; billingMode: 'overtime' | 'regular' | 'fixed'; unit: LabourUnit; locked?: boolean; billableHours?: number | null; defaultDate?: string | null; onRemove: () => void; onSaved: () => void; onEntries?: (rowId: string, entries: OvertimeEntry[]) => void; onKm?: (rowId: string, entries: KmEntry[]) => void; registerFlush?: (id: string, flush: (() => Promise<void>) | null) => void; onDirty?: (id: string, dirty: boolean) => void
}) {
  const isOTMode = billingMode === 'overtime'
  const isRegMode = billingMode === 'regular'
  const isFixed = billingMode === 'fixed'
  // Hours or days (migration 148) — same quantity columns, different words.
  const L = labourLabels(unit)
  const isDays = unit === 'days'
  const [reg, setReg] = useState(String(row.regular_hours ?? 0))
  const [ot, setOt] = useState(String(row.overtime_hours ?? 0))
  const [payRate, setPayRate] = useState(row.pay_rate != null ? String(row.pay_rate) : '')
  const [otRate, setOtRate] = useState(row.overtime_rate != null ? String(row.overtime_rate) : '')
  const [cur, setCur] = useState(row.pay_currency || 'TTD')

  // Overtime time-log (migration 111/115). When entries exist they ARE the OT hours.
  // Each entry is a start date/time → stop date/time span (may cross midnight/days).
  const [entries, setEntries] = useState<OvertimeEntry[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [nStartDate, setNStartDate] = useState(defaultDate ?? '')
  const [nStartTime, setNStartTime] = useState('')
  const [nEndDate, setNEndDate] = useState(defaultDate ?? '')
  const [nEndTime, setNEndTime] = useState('')
  const [nLocation, setNLocation] = useState('')
  const [nNote, setNNote] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const otTotal = Math.round(entries.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
  // The log is in HOURS, so it can only drive the OT quantity on an hours-billed job.
  // On a day-billed job (mig 148) the quantity is typed by hand and the log is kept as
  // evidence of the shifts worked — the mig-148 trigger guard enforces the same rule
  // server-side, so an out-of-band shift can't overwrite the typed day count either.
  const otFromLog = !isDays && entries.length > 0
  const preview = shiftHours(nStartDate, nStartTime, nEndDate || nStartDate, nEndTime)

  // Kilometre log (migration 116) — one trip per drive, 10–140 km. Shown for every
  // job regardless of billing mode; the per-surveyor total rolls up to the job total.
  const [kmEntries, setKmEntries] = useState<KmEntry[]>([])
  const [kmOpen, setKmOpen] = useState(false)
  const [nKmDate, setNKmDate] = useState(defaultDate ?? '')
  const [nKm, setNKm] = useState('')
  const [nKmNote, setNKmNote] = useState('')
  const [kmBusy, setKmBusy] = useState(false)
  const kmTotal = kmEntries.reduce((s, e) => s + (e.km || 0), 0)

  async function loadEntries() { const next = await listSurveyorOvertime(row.id); setEntries(next); onEntries?.(row.id, next) }
  async function loadKm() { const next = await listSurveyorKm(row.id); setKmEntries(next); onKm?.(row.id, next) }
  useEffect(() => { void loadEntries(); void loadKm() }, [row.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addKm() {
    const n = Number(nKm)
    if (!Number.isInteger(n) || n < KM_MIN || n > KM_MAX) { toast.error(`Distance must be a whole number between ${KM_MIN} and ${KM_MAX} km`); return }
    setKmBusy(true)
    const res = await addSurveyorKm(row.id, { trip_date: nKmDate || defaultDate || null, km: n, note: nKmNote.trim() || null })
    if (res.error) { setKmBusy(false); toast.error(res.error); return }
    await loadKm()
    setNKm(''); setNKmNote('')
    setKmBusy(false); onSaved()
  }
  async function removeKm(id: string) {
    setKmBusy(true)
    const res = await deleteSurveyorKm(id)
    if (res.error) { setKmBusy(false); toast.error(res.error); return }
    await loadKm()
    setKmBusy(false); onSaved()
  }

  // Persist OT hours = log total (when logged) else the typed number. Keeps the one
  // job_surveyors.overtime_hours that billing reads in sync with the detail log.
  async function persistHours(otValue: number, regValue = Number(reg) || 0): Promise<boolean> {
    const h = await updateJobSurveyorHours(row.id, jobId, { regular_hours: regValue, overtime_hours: otValue })
    if (h.error) { toast.error(h.error); return false }
    savedRef.current.reg = regValue; savedRef.current.ot = otValue
    return true
  }

  // Last-saved snapshot of every editable field, so we only write what actually changed
  // and can tell the parent whether this row is "dirty" (has unsaved edits).
  const savedRef = useRef({
    reg: Number(row.regular_hours) || 0,
    ot: Number(row.overtime_hours) || 0,
    payRate: row.pay_rate != null ? String(row.pay_rate) : '',
    otRate: row.overtime_rate != null ? String(row.overtime_rate) : '',
    cur: row.pay_currency || 'TTD',
  })

  // Write any changed fields. Quiet (no toast) — the panel-level Save button + status
  // indicator own the feedback. Used by both the debounced autosave and the Save button.
  async function flush(): Promise<void> {
    if (locked) return // closed job — RLS blocks writes; don't even try
    const otValue = otFromLog ? otTotal : Number(ot) || 0
    const regValue = Number(reg) || 0
    const needHours = regValue !== savedRef.current.reg || otValue !== savedRef.current.ot
    const needRates = isAdmin && (payRate !== savedRef.current.payRate || otRate !== savedRef.current.otRate || cur !== savedRef.current.cur)
    if (!needHours && !needRates) return
    if (needHours && !(await persistHours(otValue, regValue))) return
    if (needRates) {
      const r = await updateJobSurveyorRates(row.id, jobId, { pay_rate: payRate === '' ? null : Number(payRate), overtime_rate: otRate === '' ? null : Number(otRate), pay_currency: cur })
      if (r.error) { toast.error(r.error); return }
      savedRef.current.payRate = payRate; savedRef.current.otRate = otRate; savedRef.current.cur = cur
    }
    onDirty?.(row.id, false); onSaved()
  }

  // Register this row's flush with the parent so the single Save button can persist it.
  // flushRef always points at the latest closure (updated after each commit) so the
  // registered + debounced calls read current field values.
  const flushRef = useRef(flush)
  useEffect(() => { flushRef.current = flush })
  useEffect(() => {
    registerFlush?.(row.id, () => flushRef.current())
    return () => registerFlush?.(row.id, null)
  }, [row.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced autosave: ~1.2s after the last edit the row saves itself, silently. This
  // is what keeps the "unsaved changes" prompt from ever really showing.
  useEffect(() => {
    const otValue = otFromLog ? otTotal : Number(ot) || 0
    const regValue = Number(reg) || 0
    const dirty = regValue !== savedRef.current.reg || otValue !== savedRef.current.ot ||
      (isAdmin && (payRate !== savedRef.current.payRate || otRate !== savedRef.current.otRate || cur !== savedRef.current.cur))
    onDirty?.(row.id, dirty)
    if (!dirty) return
    const t = setTimeout(() => { void flushRef.current() }, 1200)
    return () => clearTimeout(t)
    // otFromLog is a dep so that switching the job back to hours (mig 148) re-asserts
    // the shift-log total over the day quantity that was standing in its place.
  }, [reg, ot, otTotal, otFromLog, payRate, otRate, cur]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyChecklistHours() {
    if (billableHours == null) return
    setReg(String(billableHours)) // the debounced autosave persists it
  }

  async function addEntry() {
    const sd = nStartDate || defaultDate || ''
    const ed = nEndDate || sd
    if (!sd || !nStartTime || !nEndTime) { toast.error('Enter a start date, start time and stop time'); return }
    const hrs = shiftHours(sd, nStartTime, ed, nEndTime)
    if (hrs <= 0) { toast.error('The stop date/time must be after the start'); return }
    setLogBusy(true)
    const res = await addSurveyorOvertime(row.id, { entry_date: sd, start_time: nStartTime, end_date: ed, end_time: nEndTime, hours: hrs, location: nLocation.trim() || null, note: nNote.trim() || null })
    if (res.error) { setLogBusy(false); toast.error(res.error); return }
    const next = await listSurveyorOvertime(row.id)
    setEntries(next); onEntries?.(row.id, next)
    // Days mode: the log is evidence only, so it must not rewrite the hand-typed day
    // quantity (mig 148 — the trigger enforces the same rule server-side).
    if (!isDays) {
      const total = Math.round(next.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
      await persistHours(total)
      setOt(String(total))
    }
    // Keep the dates (next shift is usually the same day); clear the times + per-shift fields.
    setNStartTime(''); setNEndTime(''); setNLocation(''); setNNote('')
    setLogBusy(false); onSaved()
  }

  async function removeEntry(id: string) {
    setLogBusy(true)
    const res = await deleteSurveyorOvertime(id)
    if (res.error) { setLogBusy(false); toast.error(res.error); return }
    const next = await listSurveyorOvertime(row.id)
    setEntries(next); onEntries?.(row.id, next)
    if (!isDays) {
      const total = Math.round(next.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
      await persistHours(total)
      setOt(String(total))
    }
    setLogBusy(false); onSaved()
  }

  const numCls = 'input-base py-1 text-sm'
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-800">{row.full_name}{row.display_title ? <span className="font-normal text-gray-400"> · {row.display_title}</span> : null}{row.role === 'admin' ? ' (admin)' : ''}</span>
        {isAdmin && <button onClick={onRemove} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {isFixed ? (
        <p className="text-xs text-gray-400 italic">Fixed-price job — no hours to log.</p>
      ) : (
      <div className="grid grid-cols-2 gap-2">
        {isRegMode && (
        <div>
          <label className="text-[11px] text-gray-400 flex items-center justify-between gap-2">
            <span>{L.regular} <span className="text-gray-300">· client</span></span>
            {/* The checklist's billable figure is an HOURS quantity — never offer it
                as a day count (mig 148). */}
            {!isDays && billableHours != null && Number(reg) !== billableHours && (
              <button type="button" onClick={applyChecklistHours} className="text-brand-600 hover:underline font-medium">use {billableHours}h</button>
            )}
          </label>
          <input type="number" min={0} step="0.5" value={reg} onChange={e => setReg(e.target.value)} disabled={locked} className={numCls} />
        </div>
        )}
        {isOTMode && (
        <div>
          <label className="text-[11px] text-amber-600 font-medium">{L.overtime} <span className="text-gray-300">{otFromLog ? '· from log' : '· OT pay'}</span></label>
          {otFromLog
            ? <input type="number" value={otTotal} readOnly className={`${numCls} bg-gray-50 text-gray-600`} title="Driven by the time-log below" />
            : <input type="number" min={0} step="0.5" value={ot} onChange={e => setOt(e.target.value)} disabled={locked} className={`${numCls} ring-1 ring-amber-300 border-amber-300`} />}
        </div>
        )}
        {isAdmin && isRegMode && <div><label className="text-[11px] text-gray-400">{L.payRate}</label><input type="number" min={0} step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && isOTMode && <div><label className="text-[11px] text-gray-400">{L.otRate}</label><input type="number" min={0} step="0.01" value={otRate} onChange={e => setOtRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && <div><label className="text-[11px] text-gray-400">Currency</label><select value={cur} onChange={e => setCur(e.target.value)} className={numCls}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
      </div>
      )}

      {/* Overtime time-log — only in overtime mode */}
      {isOTMode && (
      <div className="mt-2">
        <button type="button" onClick={() => setLogOpen(o => !o)} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800">
          <Clock className="h-3 w-3" />OT time-log{entries.length ? ` · ${entries.length} shift${entries.length === 1 ? '' : 's'} · ${otTotal}h` : ''}
          <ChevronRight className={`h-3 w-3 transition-transform ${logOpen ? 'rotate-90' : ''}`} />
        </button>
        {logOpen && (
          <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-2 space-y-1.5">
            {isDays && <p className="text-[11px] text-gray-500">This job is billed by the day — shifts here are a record of the hours worked, not the payable quantity. Type the overtime days above.</p>}
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="tnum text-gray-600 flex-shrink-0">{fmtSpan(e)}</span>
                <span className="font-medium tnum flex-shrink-0">{e.hours}h</span>
                {e.location && <span className="text-gray-500 flex-shrink-0 px-1.5 py-0.5 rounded bg-gray-100">{e.location}</span>}
                {e.note && <span className="text-gray-400 truncate flex-1 min-w-0">{e.note}</span>}
                {!locked && <button onClick={() => removeEntry(e.id)} disabled={logBusy} className="ml-auto btn-ghost p-2 sm:py-0.5 sm:px-1 text-gray-400 hover:text-red-600 flex-shrink-0"><X className="h-3 w-3" /></button>}
              </div>
            ))}
            {entries.length === 0 && <p className="text-[11px] text-gray-400">No shifts logged yet{locked ? '.' : ' — add each shift below (a shift can run from one day into the next).'}</p>}
            {!locked && (
            <div className="pt-1.5 border-t border-gray-200 space-y-1.5">
              {/* Mobile: full-width stacked 44px fields; sm+ keeps the compact inline row for admin desktop. */}
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2 sm:gap-x-2 sm:gap-y-1.5">
                <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Start date</label><input type="date" value={nStartDate} onChange={e => { const v = e.target.value; setNStartDate(v); if (!nEndDate || nEndDate < v) setNEndDate(v) }} className="input-base w-full py-2.5 px-3 text-base sm:w-32 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
                <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Start time</label><input type="time" value={nStartTime} onChange={e => setNStartTime(e.target.value)} className="input-base w-full py-2.5 px-3 text-base sm:w-24 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
                <span className="hidden sm:inline text-gray-300 pb-1.5">→</span>
                <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Stop date</label><input type="date" value={nEndDate} min={nStartDate || undefined} onChange={e => setNEndDate(e.target.value)} className="input-base w-full py-2.5 px-3 text-base sm:w-32 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
                <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Stop time</label><input type="time" value={nEndTime} onChange={e => setNEndTime(e.target.value)} className="input-base w-full py-2.5 px-3 text-base sm:w-24 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
                <span className="w-full sm:w-auto text-sm sm:text-xs text-gray-500 sm:pb-1.5">= <span className="font-medium tnum">{preview}h</span></span>
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2 sm:gap-x-2 sm:gap-y-1.5">
                <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Location</label><input type="text" list={`oloc-${row.id}`} value={nLocation} onChange={e => setNLocation(e.target.value)} placeholder="Vessel / Shore / Jetty" className="input-base w-full py-2.5 px-3 text-base sm:w-36 sm:py-0.5 sm:px-1.5 sm:text-xs" /><datalist id={`oloc-${row.id}`}><option value="Vessel" /><option value="Shore" /><option value="Jetty" /></datalist></div>
                <input type="text" value={nNote} onChange={e => setNNote(e.target.value)} placeholder="note (optional)" className="input-base w-full py-2.5 px-3 text-base sm:flex-1 sm:min-w-[80px] sm:py-0.5 sm:px-1.5 sm:text-xs" />
                <button onClick={addEntry} disabled={logBusy} className="btn-secondary w-full justify-center py-2.5 text-base sm:w-auto sm:py-1 sm:px-2 sm:text-xs">{logBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Add</button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Kilometre log — shown for every job (all billing modes) */}
      <div className="mt-2">
        <button type="button" onClick={() => setKmOpen(o => !o)} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800">
          <MapPin className="h-3 w-3" />Distance{kmEntries.length ? ` · ${kmEntries.length} trip${kmEntries.length === 1 ? '' : 's'} · ${kmTotal} km` : ''}
          <ChevronRight className={`h-3 w-3 transition-transform ${kmOpen ? 'rotate-90' : ''}`} />
        </button>
        {kmOpen && (
          <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-2 space-y-1.5">
            {kmEntries.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="tnum text-gray-600 flex-shrink-0">{fmtDay(e.trip_date)}</span>
                <span className="font-medium tnum flex-shrink-0">{e.km} km</span>
                {e.note && <span className="text-gray-400 truncate flex-1 min-w-0">{e.note}</span>}
                {!locked && <button onClick={() => removeKm(e.id)} disabled={kmBusy} className="ml-auto btn-ghost p-2 sm:py-0.5 sm:px-1 text-gray-400 hover:text-red-600 flex-shrink-0"><X className="h-3 w-3" /></button>}
              </div>
            ))}
            {kmEntries.length === 0 && <p className="text-[11px] text-gray-400">No trips logged yet{locked ? '.' : ` — add each drive (${KM_MIN}–${KM_MAX} km, whole numbers).`}</p>}
            {!locked && (
            <div className="pt-1.5 border-t border-gray-200 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2 sm:gap-x-2 sm:gap-y-1.5">
              <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Date</label><input type="date" value={nKmDate} onChange={e => setNKmDate(e.target.value)} className="input-base w-full py-2.5 px-3 text-base sm:w-32 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
              <div className="w-full sm:w-auto"><label className="block text-[10px] text-gray-400">Distance (km)</label><input type="number" min={KM_MIN} max={KM_MAX} step={1} value={nKm} onChange={e => setNKm(e.target.value)} placeholder={`${KM_MIN}–${KM_MAX}`} className="input-base w-full py-2.5 px-3 text-base sm:w-24 sm:py-0.5 sm:px-1.5 sm:text-xs" /></div>
              <input type="text" value={nKmNote} onChange={e => setNKmNote(e.target.value)} placeholder="note (optional)" className="input-base w-full py-2.5 px-3 text-base sm:flex-1 sm:min-w-[80px] sm:py-0.5 sm:px-1.5 sm:text-xs" />
              <button onClick={addKm} disabled={kmBusy} className="btn-secondary w-full justify-center py-2.5 text-base sm:w-auto sm:py-1 sm:px-2 sm:text-xs">{kmBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Add</button>
            </div>
            )}
          </div>
        )}
      </div>

      {!isFixed && (
      <div className="mt-2">
        <p className="text-xs text-gray-500">
          {isOTMode
            ? <>OT pay: <span className="font-medium text-gray-700 tnum">{money(row.overtime_pay, row.pay_currency)}</span></>
            : <>Reg pay: <span className="font-medium text-gray-700 tnum">{money(row.regular_pay, row.pay_currency)}</span></>}
        </p>
      </div>
      )}
    </div>
  )
}

// `section` lets the job-detail tabs place the file area separately:
//   'ops'   → Workflow + Surveyors & hours + Activity
//   'files' → Reports & files only
//   undefined → everything (default; backward-compatible)
export default function JobOpsPanel({ job, isAdmin, onChanged, section }: { job: Job; isAdmin: boolean; onChanged: () => void; section?: 'ops' | 'files' }) {
  const showOps = section !== 'files'
  const showFiles = section !== 'ops'
  const [surveyors, setSurveyors] = useState<JobSurveyorRow[]>([])
  const [accounts, setAccounts] = useState<SurveyorAccount[]>([])
  const [attachments, setAttachments] = useState<JobAttachment[]>([])
  const [activity, setActivity] = useState<(ActivityLogRow & { actor_name: string | null })[]>([])
  const [activityOpen, setActivityOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')
  const [kind, setKind] = useState<JobAttachmentKind>('preliminary')
  const [billingMode, setBillingMode] = useState<'overtime' | 'regular' | 'fixed'>(job.billing_mode ?? 'regular')
  // Hours or days (migration 148) — per job, both billing modes, admin-only.
  const [unit, setUnit] = useState<LabourUnit>(asLabourUnit(job.labour_unit))
  const L = labourLabels(unit)
  const [billableHours, setBillableHours] = useState<number | null>(null)
  const [otByRow, setOtByRow] = useState<Record<string, OvertimeEntry[]>>({})
  const [kmByRow, setKmByRow] = useState<Record<string, KmEntry[]>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  // One Save for all surveyor rows. Each row autosaves ~1.2s after an edit and reports
  // its dirty state + a flush() here; the button just flushes everything now, and the
  // unsaved-changes guard only fires in the rare window before an autosave lands.
  const flushers = useRef<Map<string, () => Promise<void>>>(new Map())
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set())
  const [savingAll, setSavingAll] = useState(false)
  const registerFlush = (id: string, fn: (() => Promise<void>) | null) => { if (fn) flushers.current.set(id, fn); else flushers.current.delete(id) }
  const markDirty = (id: string, dirty: boolean) => setDirtyRows(prev => {
    if (dirty === prev.has(id)) return prev
    const n = new Set(prev); if (dirty) n.add(id); else n.delete(id); return n
  })
  async function saveAll() {
    setSavingAll(true)
    try { await Promise.all([...flushers.current.values()].map(f => f())); toast.success('Saved') }
    finally { setSavingAll(false) }
  }
  // Warn before leaving (reload/close) while edits are still in flight — should be rare.
  useEffect(() => {
    if (dirtyRows.size === 0) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirtyRows.size])

  // Job-level overtime roll-up across every surveyor (each row reports its own entries
  // up via onEntries; RLS means a surveyor only contributes their own). Coverage is the
  // earliest start → latest stop across all logged shifts — the actual job coverage.
  const allOt = Object.values(otByRow).flat()
  const otAllTotal = Math.round(allOt.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
  const kmAllTotal = Object.values(kmByRow).flat().reduce((s, e) => s + (e.km || 0), 0)
  const startKey = (e: OvertimeEntry) => `${e.entry_date ?? ''}T${e.start_time ?? ''}`
  const stopKey = (e: OvertimeEntry) => `${e.end_date || e.entry_date || ''}T${e.end_time ?? ''}`
  const startable = allOt.filter(e => e.entry_date && e.start_time)
  const stoppable = allOt.filter(e => (e.end_date || e.entry_date) && e.end_time)
  const earliest = startable.length ? startable.reduce((a, e) => (startKey(e) < startKey(a) ? e : a)) : null
  const latest = stoppable.length ? stoppable.reduce((a, e) => (stopKey(e) > stopKey(a) ? e : a)) : null

  async function setMode(mode: 'overtime' | 'regular' | 'fixed') {
    const prev = billingMode
    if (mode === prev) return
    // Switching to fixed clears any logged hours (they'd otherwise keep paying via
    // the labour metrics — audit M6). Confirm first; km/distance is kept.
    if (mode === 'fixed') {
      const anyHours = surveyors.some(s => Number(s.regular_hours) || Number(s.overtime_hours)) || Object.keys(otByRow).length > 0
      if (anyHours && !(await confirmDialog({
        message: `Switching to fixed-price clears all logged regular and overtime ${L.noun} (and overtime shifts) on this job — distance/km is kept. This can’t be undone. Continue?`,
        danger: true, confirmLabel: 'Switch & clear hours',
      }))) return
    }
    setBillingMode(mode)
    // Keep is_overtime in lockstep so the jobs-list OT filter/badge/CSV stay correct.
    const res = await updateJobField(job.id, { billing_mode: mode, is_overtime: mode === 'overtime' })
    if (res.error) { setBillingMode(prev); toast.error(res.error); return }
    if (mode === 'fixed') {
      const cl = await clearJobLabourForFixed(job.id)
      if (cl.error) toast.error(`Switched to fixed, but clearing hours failed: ${cl.error}`)
      reload()
    }
    onChanged()
  }

  // Hours ⇄ days (migration 148). Nothing is converted — a day length would have to
  // be invented — so any quantity already entered simply changes meaning. Say so
  // before switching when there is something to reinterpret.
  async function setLabourUnit(next: LabourUnit) {
    const prev = unit
    if (next === prev) return
    const anyQty = surveyors.some(s => Number(s.regular_hours) || Number(s.overtime_hours))
    if (anyQty && !(await confirmDialog({
      message: `Switching this job to ${labourLabels(next).noun} keeps the quantities already entered — they will now mean ${labourLabels(next).noun}, not ${labourLabels(prev).noun}. Check each surveyor's quantity and rate afterwards. Continue?`,
      confirmLabel: `Switch to ${labourLabels(next).noun}`,
    }))) return
    setUnit(next)
    const res = await updateJobField(job.id, { labour_unit: next })
    if (res.error) { setUnit(prev); toast.error(res.error); return }
    onChanged(); reload()
  }

  async function reload() {
    const [s, at] = await Promise.all([listJobSurveyors(job.id), listJobAttachments(job.id)])
    setSurveyors(s); setAttachments(at)
    if (isAdmin) setActivity(await listJobActivity(job.id)) // activity_log is admin/office-only under RLS
    // The checklist's calculated billable hours (e.g. OVID "Total hours"), so it can
    // be one-click applied to a surveyor's client-billed regular hours below.
    if (job.template_id) {
      const supabase = createClient()
      const { data: f } = await supabase.from('template_fields')
        .select('id').eq('template_id', job.template_id).eq('is_billable_hours', true)
        .order('order_index').limit(1).maybeSingle()
      if (f?.id) {
        const { data: v } = await supabase.from('job_field_values')
          .select('value').eq('job_id', job.id).eq('field_id', f.id).maybeSingle()
        const n = parseFloat(v?.value ?? '')
        setBillableHours(Number.isFinite(n) && n > 0 ? n : null)
      } else {
        setBillableHours(null)
      }
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); if (isAdmin) listSurveyorAccounts().then(setAccounts) }, [job.id])

  const current = job.workflow_status
  // Once an admin closes a job, surveyors can no longer edit it (RLS enforces this;
  // this just makes the UI read-only so they see the lock instead of hitting errors).
  const surveyorLocked = !isAdmin && current === 'closed'
  const idx = WORKFLOW_ORDER.indexOf(current)
  const next = idx >= 0 && idx < WORKFLOW_ORDER.length - 1 ? WORKFLOW_ORDER[idx + 1] : null

  async function advance(to: WorkflowStatus) {
    // Closing is normally what CREATING AN INVOICE does. Closing by hand is allowed
    // (report-only jobs still need a way to finish) but it locks every surveyor edit
    // and leaves no billing record, so make that explicit first.
    if (to === 'closed' && job.workflow_status !== 'closed' && !job.invoice_id) {
      if (!(await confirmDialog({
        message: 'Closing this job locks all surveyor edits (hours, overtime, km, answers and photos). There is no invoice on it, so it will show up under “Invoice missing” on the Reconcile page. Jobs are normally closed automatically when you create their invoice. Close it anyway?',
        danger: true, confirmLabel: 'Close without invoicing',
      }))) return
    }
    setBusy(true)
    const res = await setWorkflowStatus(job.id, to)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Status → ${WORKFLOW[to].label}`)
    onChanged(); reload()
  }

  async function add() {
    if (!addId) return
    setBusy(true)
    // Warn (but allow) if this surveyor is already booked on an overlapping job.
    if (job.scheduled_date) {
      const clashes = await checkSurveyorConflicts(addId, {
        scheduled_date: job.scheduled_date, end_date: job.end_date,
        start_time: job.start_time, end_time: job.end_time,
      }, job.id)
      if (clashes.length) {
        setBusy(false)
        const name = accounts.find(a => a.id === addId)?.full_name ?? 'This surveyor'
        const list = clashes.map(c => `${c.vessel_name ?? c.title} (${c.scheduled_date}${c.start_time ? ` ${c.start_time.slice(0, 5)}` : ', all-day'})`).join('; ')
        const ok = await confirmDialog({ message: `${name} already has ${list}, which overlaps this job. Assign anyway?`, confirmLabel: 'Assign anyway' })
        if (!ok) return
        setBusy(true)
      }
    }
    const res = await addJobSurveyor(job.id, addId)
    if (res.error) { setBusy(false); toast.error(res.error); return }
    // Let the newly-added surveyor know (in-app + email). Best-effort.
    await notifyAssignment(
      { id: job.id, title: job.title, scheduled_date: job.scheduled_date, start_time: job.start_time, vessel_name: job.vessel_name },
      [addId],
    )
    setBusy(false)
    setAddId(''); onChanged(); reload()
  }
  async function remove(row: JobSurveyorRow) {
    if (!(await confirmDialog({ message: `Remove ${row.full_name} from this job?`, confirmLabel: 'Remove' }))) return
    await removeJobSurveyor(row.id, job.id); onChanged(); reload()
  }

  async function upload(file: File | null) {
    if (!file) return
    setBusy(true)
    const res = await uploadJobAttachment(job.id, kind, file)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (res.error) { toast.error(res.error); return }
    toast.success(`${attachmentLabel(kind)} uploaded`)
    onChanged(); reload()
  }
  async function download(att: JobAttachment) {
    const url = await jobFileUrl(att.storage_path)
    if (url) window.open(url, '_blank')
  }
  async function removeAtt(att: JobAttachment) {
    if (!(await confirmDialog({ message: `Delete "${att.doc_name}"?`, danger: true, confirmLabel: 'Delete' }))) return
    await deleteJobAttachment(att); reload()
  }

  const available = accounts.filter(a => !surveyors.some(s => s.surveyor_id === a.id))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* The workflow stepper is a read-only, billing-vocabulary admin pipeline; a
          surveyor only ever reads it, and the page header already carries the status
          pill and the closed-job lock. Hide the whole card for non-admins. */}
      {showOps && isAdmin && (
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-medium text-gray-900">Workflow</h3>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${WORKFLOW[current]?.pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${WORKFLOW[current]?.dot}`} />{WORKFLOW[current]?.label}
          </span>
        </div>
        {/* compact stepper */}
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] text-gray-400 mb-4">
          {WORKFLOW_ORDER.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className={i <= idx ? 'text-gray-700 font-medium' : ''}>{WORKFLOW[s].label}</span>
              {i < WORKFLOW_ORDER.length - 1 && <ChevronRight className="h-3 w-3 text-gray-300" />}
            </li>
          ))}
        </ol>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {next && (
              <button onClick={() => advance(next)} disabled={busy} className="btn-primary text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {next === 'invoice_ready' ? 'Report done — mark invoice ready' : `Advance to ${WORKFLOW[next].label}`}
              </button>
            )}
            <select value="" onChange={e => { if (e.target.value) advance(e.target.value as WorkflowStatus) }} className="input-base text-sm py-1.5 w-auto" aria-label="Set status">
              <option value="">Set status…</option>
              {WORKFLOW_ORDER.map(s => <option key={s} value={s} disabled={s === current}>{WORKFLOW[s].label}</option>)}
            </select>
          </div>
        )}
      </div>
      )}

      {showOps && (
      <div className="card p-5">
        {/* Wraps: for an admin the heading + the Regular/Overtime/Fixed and Hours/Days
            toggles measure ~326px against the 288px inside this card at 360px, so
            without it the toggles were pushed off the right of the viewport. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="font-medium text-gray-900">Surveyors &amp; hours</h3>
            {surveyors.length > 0 && (savingAll ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" />Saving…</span>
            ) : dirtyRows.size > 0 ? (
              // Rows autosave ~1.2s after an edit; this chip is the manual-flush escape
              // hatch for the rare in-flight window (e.g. leaving on flaky wifi).
              <button onClick={saveAll} title="Save now" className="inline-flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Unsaved changes — save now</button>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Saved</span>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isAdmin || (!surveyorLocked && billingMode !== 'fixed') ? (
              // Admins pick all three modes; surveyors flip Regular/Overtime on their
              // own OPEN jobs (they know which jobs are OT — mig 124 gates the rest:
              // closed jobs and 'fixed' stay admin-only).
              <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium" role="group" aria-label="Billing mode">
                {([
                  { mode: 'regular' as const, label: 'Regular' },
                  { mode: 'overtime' as const, label: 'Overtime' },
                  ...(isAdmin ? [{ mode: 'fixed' as const, label: 'Fixed' }] : []),
                ]).map(o => (
                  <button key={o.mode} onClick={() => setMode(o.mode)} title={`Bill this job as ${o.label.toLowerCase()}`}
                    className={`px-2.5 py-1 rounded-full transition-colors ${billingMode === o.mode ? (o.mode === 'overtime' ? 'bg-amber-100 text-amber-700' : 'bg-white text-gray-800 shadow-sm') : 'text-gray-500 hover:text-gray-700'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${billingMode === 'overtime' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}><Clock className="h-3.5 w-3.5" />{billingMode === 'overtime' ? 'Overtime job' : billingMode === 'fixed' ? 'Fixed-price job' : 'Regular-hours job'}</span>
            )}
            {/* Hours ⇄ days (migration 148) — what every quantity on this job MEANS.
                Fixed-price has no quantity, so it has no unit. Admin-only: a surveyor
                may flip Regular/Overtime on their own open job (mig 124) but not the
                unit, so they get a read-only pill instead of the toggle. */}
            {billingMode !== 'fixed' && (isAdmin ? (
              <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium" role="group" aria-label="Labour unit">
                {(['hours', 'days'] as const).map(u => (
                  <button key={u} onClick={() => setLabourUnit(u)} title={`Pay and bill this job by the ${u === 'hours' ? 'hour' : 'day'}`}
                    className={`px-2.5 py-1 rounded-full transition-colors ${unit === u ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {labourLabels(u).toggle}
                  </button>
                ))}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-gray-100 text-gray-600">{L.pill}</span>
            ))}
          </div>
        </div>
        {surveyorLocked && (
          <p className="text-xs text-gray-700 bg-gray-100 border border-gray-200 rounded-md px-2.5 py-1.5 mb-3 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-gray-500" />This job is closed — your hours, overtime and distance are locked for payment and can no longer be edited.
          </p>
        )}
        <p className="text-[11px] text-gray-400 mb-3">
          {billingMode === 'overtime' ? `Overtime ${L.noun} are paid to the surveyor as OT and billed to the client.`
            : billingMode === 'fixed' ? 'Fixed-price job — no hours; only distance is logged per surveyor.'
            : `Regular ${L.noun} are billed to the client.`}
          {billingMode !== 'fixed' && unit === 'days' && ' Days are typed in by hand — the OT time-log stays a record of the shifts worked.'}
          {' '}Distance (km) is logged per surveyor on every job.
        </p>
        {/* The checklist figure is an hours quantity, so it has nothing to say on a
            day-billed job (mig 148). */}
        {billableHours != null && unit === 'hours' && (
          <p className="text-[11px] text-brand-700 bg-brand-50/70 rounded-md px-2.5 py-1.5 mb-3">
            Checklist billable hours: <strong>{billableHours} hrs</strong> — use the <em>“use {billableHours}h”</em> link to set a surveyor&apos;s regular (client-billed) hours.
          </p>
        )}
        {allOt.length > 0 && (
          <div className="mb-3 rounded-md bg-amber-50/70 border border-amber-100 px-2.5 py-1.5 text-[11px] text-amber-800 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {/* Always hours — it comes from the shift log. On a day-billed job that
                makes it evidence of shifts worked, not the payable quantity. */}
            <span>{unit === 'days' ? 'Shifts logged (all surveyors)' : 'Total OT (all surveyors)'}: <strong className="tnum">{otAllTotal}h</strong></span>
            {earliest && latest && (
              <span>Coverage: <strong className="tnum">{fmtDay(earliest.entry_date)} {earliest.start_time}</strong> → <strong className="tnum">{fmtDay(latest.end_date || latest.entry_date)} {latest.end_time}</strong></span>
            )}
          </div>
        )}
        {kmAllTotal > 0 && (
          <div className="mb-3 rounded-md bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600 flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-gray-400" />Total distance (all surveyors): <strong className="tnum">{kmAllTotal} km</strong>
          </div>
        )}
        {surveyors.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">No surveyors assigned yet.</p>
        ) : (
          <div className="space-y-3 mb-3">
            {surveyors.map(s => (
              <SurveyorRow key={s.id} row={s} jobId={job.id} isAdmin={isAdmin} billingMode={billingMode} unit={unit} locked={surveyorLocked} billableHours={billableHours} defaultDate={job.scheduled_date} onRemove={() => remove(s)} onSaved={() => { onChanged(); reload() }} onEntries={(rowId, es) => setOtByRow(prev => ({ ...prev, [rowId]: es }))} onKm={(rowId, es) => setKmByRow(prev => ({ ...prev, [rowId]: es }))} registerFlush={registerFlush} onDirty={markDirty} />
            ))}
          </div>
        )}
        {isAdmin && available.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={addId} onChange={e => setAddId(e.target.value)} className="input-base text-sm py-1.5 flex-1">
              <option value="">Add a surveyor…</option>
              {available.map(a => <option key={a.id} value={a.id}>{a.full_name}{a.display_title ? ` · ${a.display_title}` : ''}{a.role === 'admin' ? ' (admin)' : ''}</option>)}
            </select>
            <button onClick={add} disabled={!addId || busy} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Add</button>
          </div>
        )}
      </div>
      )}

      {showFiles && (
      <div className="card p-5">
        <h3 className="font-medium text-gray-900 mb-3">Reports &amp; files</h3>
        <div className="flex items-center gap-2 mb-3">
          <select value={kind} onChange={e => setKind(e.target.value as JobAttachmentKind)} className="input-base text-sm py-1.5 flex-1">
            {ATTACHMENT_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <input ref={fileRef} type="file" className="hidden" onChange={e => upload(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()} disabled={busy || surveyorLocked} className="btn-secondary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload</button>
        </div>
        {attachments.length === 0 ? (
          <p className="text-sm text-gray-400">No files uploaded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {attachments.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">{attachmentLabel(a.kind)}</span>
                <span className="text-gray-700 truncate flex-1">{a.doc_name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(a.size_bytes)}</span>
                <button onClick={() => download(a)} className="btn-ghost py-1 px-1.5 text-brand-600"><Download className="h-3.5 w-3.5" /></button>
                {isAdmin && <button onClick={() => removeAtt(a)} className="btn-ghost py-1 px-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Activity (admin/office only) — collapsed to the latest entry; expand for
          the full history so a busy job doesn't stretch the page. */}
      {showOps && isAdmin && (
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="font-medium text-gray-900">Activity{activity.length > 0 ? <span className="font-normal text-gray-400 text-sm"> · {activity.length}</span> : null}</h3>
          {activity.length > 1 && (
            <button type="button" onClick={() => setActivityOpen(o => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800">
              {activityOpen ? 'Show latest only' : `Show all (${activity.length})`}
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${activityOpen ? '-rotate-90' : 'rotate-90'}`} />
            </button>
          )}
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {(activityOpen ? activity : activity.slice(0, 1)).map(a => (
              <li key={a.id} className="flex gap-3 text-sm">
                <Clock className="h-4 w-4 text-gray-300 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-gray-800">{activityText(a)}</p>
                  <p className="text-xs text-gray-400">{a.actor_name ?? 'Someone'} · {formatDateTime(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      )}
    </div>
  )
}
