'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus, X, Upload, Download, Trash2, Loader2, Clock, CheckCircle2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import {
  WORKFLOW, WORKFLOW_ORDER, ATTACHMENT_KINDS, attachmentLabel, formatBytes, money, CURRENCIES,
  setWorkflowStatus, updateJobField, listJobSurveyors, listSurveyorAccounts, addJobSurveyor, removeJobSurveyor,
  updateJobSurveyorHours, updateJobSurveyorRates,
  listSurveyorOvertime, addSurveyorOvertime, deleteSurveyorOvertime,
  listJobAttachments, uploadJobAttachment, deleteJobAttachment, jobFileUrl, listJobActivity,
  type JobSurveyorRow, type SurveyorAccount, type OvertimeEntry,
} from '@/lib/jobs/tracker'
import type { Job, JobAttachment, WorkflowStatus, JobAttachmentKind, ActivityLogRow } from '@/lib/types/database'

function activityText(a: ActivityLogRow): string {
  const act = a.action
  if (act === 'created') return 'Job created'
  if (act === 'surveyor:add') return 'Surveyor added'
  if (act === 'surveyor:remove') return 'Surveyor removed'
  if (act === 'attachment:delete') return 'Attachment removed'
  if (act === 'invoice:save') return 'Invoice saved'
  if (act === 'invoice:delete') return 'Invoice deleted'
  if (act === 'invoice:email_draft') return 'Invoice email draft created'
  if (act.startsWith('workflow:')) {
    const raw = act.slice(9)
    const s = (raw === 'report_uploaded' ? 'report_ready' : raw === 'report_approved' ? 'approved' : raw) as WorkflowStatus
    return `Status → ${WORKFLOW[s]?.label ?? raw}`
  }
  if (act.startsWith('attachment:')) { const k = act.slice(11) as JobAttachmentKind; return `Uploaded ${attachmentLabel(k).toLowerCase()}` }
  return act
}

// Hours between two 'HH:MM' times, rolling past midnight if end <= start (a night shift).
function otHours(start: string, end: string): number {
  if (!start || !end) return 0
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
  let d = mins(end) - mins(start)
  if (d < 0) d += 24 * 60
  return Math.round((d / 60) * 100) / 100
}
const fmtEntryDate = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '—'

function SurveyorRow({ row, jobId, isAdmin, highlightOT, billableHours, defaultDate, onRemove, onSaved }: {
  row: JobSurveyorRow; jobId: string; isAdmin: boolean; highlightOT?: boolean; billableHours?: number | null; defaultDate?: string | null; onRemove: () => void; onSaved: () => void
}) {
  const [reg, setReg] = useState(String(row.regular_hours ?? 0))
  const [ot, setOt] = useState(String(row.overtime_hours ?? 0))
  const [payRate, setPayRate] = useState(row.pay_rate != null ? String(row.pay_rate) : '')
  const [otRate, setOtRate] = useState(row.overtime_rate != null ? String(row.overtime_rate) : '')
  const [cur, setCur] = useState(row.pay_currency || 'TTD')
  const [saving, setSaving] = useState(false)

  // Overtime time-log (migration 111). When entries exist they ARE the OT hours.
  const [entries, setEntries] = useState<OvertimeEntry[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [nDate, setNDate] = useState(defaultDate ?? '')
  const [nStart, setNStart] = useState('')
  const [nEnd, setNEnd] = useState('')
  const [nNote, setNNote] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const otTotal = Math.round(entries.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
  const otFromLog = entries.length > 0

  async function loadEntries() { setEntries(await listSurveyorOvertime(row.id)) }
  useEffect(() => { void loadEntries() }, [row.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist OT hours = log total (when logged) else the typed number. Keeps the one
  // job_surveyors.overtime_hours that billing reads in sync with the detail log.
  async function persistHours(otValue: number, regValue = Number(reg) || 0): Promise<boolean> {
    const h = await updateJobSurveyorHours(row.id, jobId, { regular_hours: regValue, overtime_hours: otValue })
    if (h.error) { toast.error(h.error); return false }
    return true
  }

  async function save() {
    setSaving(true)
    const ok = await persistHours(otFromLog ? otTotal : Number(ot) || 0)
    let err = ok ? undefined : 'x'
    if (ok && isAdmin) {
      const r = await updateJobSurveyorRates(row.id, jobId, { pay_rate: payRate === '' ? null : Number(payRate), overtime_rate: otRate === '' ? null : Number(otRate), pay_currency: cur })
      err = r.error
    }
    setSaving(false)
    if (err) { if (err !== 'x') toast.error(err); return }
    toast.success('Hours saved'); onSaved()
  }

  async function applyChecklistHours() {
    if (billableHours == null) return
    setReg(String(billableHours))
    setSaving(true)
    const ok = await persistHours(otFromLog ? otTotal : Number(ot) || 0, billableHours)
    setSaving(false)
    if (!ok) return
    toast.success(`Applied ${billableHours} billable hrs`); onSaved()
  }

  async function addEntry() {
    const hrs = otHours(nStart, nEnd)
    if (!nStart || !nEnd) { toast.error('Enter a start and end time'); return }
    setLogBusy(true)
    const res = await addSurveyorOvertime(row.id, { entry_date: nDate || null, start_time: nStart, end_time: nEnd, hours: hrs, note: nNote.trim() || null })
    if (res.error) { setLogBusy(false); toast.error(res.error); return }
    const next = await listSurveyorOvertime(row.id)
    setEntries(next)
    const total = Math.round(next.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
    await persistHours(total)
    setOt(String(total)); setNStart(''); setNEnd(''); setNNote('')
    setLogBusy(false); onSaved()
  }

  async function removeEntry(id: string) {
    setLogBusy(true)
    const res = await deleteSurveyorOvertime(id)
    if (res.error) { setLogBusy(false); toast.error(res.error); return }
    const next = await listSurveyorOvertime(row.id)
    setEntries(next)
    const total = Math.round(next.reduce((s, e) => s + (e.hours || 0), 0) * 100) / 100
    await persistHours(total)
    setOt(String(total))
    setLogBusy(false); onSaved()
  }

  const numCls = 'input-base py-1 text-sm'
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-800">{row.full_name}{row.display_title ? <span className="font-normal text-gray-400"> · {row.display_title}</span> : null}{row.role === 'admin' ? ' (admin)' : ''}</span>
        {isAdmin && <button onClick={onRemove} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-gray-400 flex items-center justify-between gap-2">
            <span>Regular hrs <span className="text-gray-300">· client</span></span>
            {billableHours != null && Number(reg) !== billableHours && (
              <button type="button" onClick={applyChecklistHours} className="text-brand-600 hover:underline font-medium">use {billableHours}h</button>
            )}
          </label>
          <input type="number" min={0} step="0.5" value={reg} onChange={e => setReg(e.target.value)} className={numCls} />
        </div>
        <div>
          <label className={`text-[11px] ${highlightOT ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>Overtime hrs <span className="text-gray-300">{otFromLog ? '· from log' : '· OT pay'}</span></label>
          {otFromLog
            ? <input type="number" value={otTotal} readOnly className={`${numCls} bg-gray-50 text-gray-600`} title="Driven by the time-log below" />
            : <input type="number" min={0} step="0.5" value={ot} onChange={e => setOt(e.target.value)} className={`${numCls} ${highlightOT ? 'ring-1 ring-amber-300 border-amber-300' : ''}`} />}
        </div>
        {isAdmin && <div><label className="text-[11px] text-gray-400">Pay rate /hr</label><input type="number" min={0} step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && <div><label className="text-[11px] text-gray-400">OT rate /hr</label><input type="number" min={0} step="0.01" value={otRate} onChange={e => setOtRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && <div><label className="text-[11px] text-gray-400">Currency</label><select value={cur} onChange={e => setCur(e.target.value)} className={numCls}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
      </div>

      {/* Overtime time-log */}
      <div className="mt-2">
        <button type="button" onClick={() => setLogOpen(o => !o)} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-800">
          <Clock className="h-3 w-3" />OT time-log{entries.length ? ` · ${entries.length} shift${entries.length === 1 ? '' : 's'} · ${otTotal}h` : ''}
          <ChevronRight className={`h-3 w-3 transition-transform ${logOpen ? 'rotate-90' : ''}`} />
        </button>
        {logOpen && (
          <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-2 space-y-1.5">
            {entries.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="tnum text-gray-500 w-16">{fmtEntryDate(e.entry_date)}</span>
                <span className="tnum">{e.start_time}–{e.end_time}</span>
                <span className="font-medium tnum">{e.hours}h</span>
                {e.note && <span className="text-gray-400 truncate flex-1">{e.note}</span>}
                <button onClick={() => removeEntry(e.id)} disabled={logBusy} className="ml-auto btn-ghost py-0.5 px-1 text-gray-400 hover:text-red-600"><X className="h-3 w-3" /></button>
              </div>
            ))}
            {entries.length === 0 && <p className="text-[11px] text-gray-400">No shifts logged yet — add each day&apos;s overtime below.</p>}
            <div className="flex flex-wrap items-end gap-1.5 pt-1.5 border-t border-gray-200">
              <div><label className="block text-[10px] text-gray-400">Date</label><input type="date" value={nDate} onChange={e => setNDate(e.target.value)} className="input-base py-0.5 px-1.5 text-xs w-32" /></div>
              <div><label className="block text-[10px] text-gray-400">Start</label><input type="time" value={nStart} onChange={e => setNStart(e.target.value)} className="input-base py-0.5 px-1.5 text-xs w-24" /></div>
              <div><label className="block text-[10px] text-gray-400">End</label><input type="time" value={nEnd} onChange={e => setNEnd(e.target.value)} className="input-base py-0.5 px-1.5 text-xs w-24" /></div>
              <span className="text-xs text-gray-500 pb-1.5">= <span className="font-medium tnum">{otHours(nStart, nEnd)}h</span></span>
              <input type="text" value={nNote} onChange={e => setNNote(e.target.value)} placeholder="note (optional)" className="input-base py-0.5 px-1.5 text-xs flex-1 min-w-[80px]" />
              <button onClick={addEntry} disabled={logBusy} className="btn-secondary py-1 px-2 text-xs">{logBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Add</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-xs text-gray-500">OT pay: <span className="font-medium text-gray-700 tnum">{money(row.overtime_pay, row.pay_currency)}</span>{isAdmin && row.regular_pay > 0 ? ` · reg ${money(row.regular_pay, row.pay_currency)}` : ''}</p>
        <button onClick={save} disabled={saving} className="btn-secondary py-1 px-2.5 text-xs">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save</button>
      </div>
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
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')
  const [kind, setKind] = useState<JobAttachmentKind>('preliminary')
  const [isOT, setIsOT] = useState(!!job.is_overtime)
  const [billableHours, setBillableHours] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function toggleOvertime() {
    const next = !isOT
    setIsOT(next)
    const res = await updateJobField(job.id, { is_overtime: next })
    if (res.error) { setIsOT(!next); toast.error(res.error); return }
    onChanged()
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
  const idx = WORKFLOW_ORDER.indexOf(current)
  const next = idx >= 0 && idx < WORKFLOW_ORDER.length - 1 ? WORKFLOW_ORDER[idx + 1] : null

  async function advance(to: WorkflowStatus) {
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
    const res = await addJobSurveyor(job.id, addId)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
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
      {showOps && (
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
                {next === 'approved' ? 'Approve report' : `Advance to ${WORKFLOW[next].label}`}
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
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-medium text-gray-900">Surveyors &amp; hours</h3>
          {isAdmin ? (
            <button onClick={toggleOvertime} title="Mark this as an overtime job"
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${isOT ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'}`}>
              <Clock className="h-3.5 w-3.5" />Overtime job{isOT ? ' · on' : ''}
            </button>
          ) : isOT ? (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium bg-amber-100 text-amber-700"><Clock className="h-3.5 w-3.5" />Overtime job</span>
          ) : null}
        </div>
        <p className="text-[11px] text-gray-400 mb-3">Regular hours are billed to the client · Overtime hours are paid to the surveyor as OT.</p>
        {billableHours != null && (
          <p className="text-[11px] text-brand-700 bg-brand-50/70 rounded-md px-2.5 py-1.5 mb-3">
            Checklist billable hours: <strong>{billableHours} hrs</strong> — use the <em>“use {billableHours}h”</em> link to set a surveyor&apos;s regular (client-billed) hours.
          </p>
        )}
        {surveyors.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">No surveyors assigned yet.</p>
        ) : (
          <div className="space-y-3 mb-3">
            {surveyors.map(s => (
              <SurveyorRow key={s.id} row={s} jobId={job.id} isAdmin={isAdmin} highlightOT={isOT} billableHours={billableHours} defaultDate={job.scheduled_date} onRemove={() => remove(s)} onSaved={() => { onChanged(); reload() }} />
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
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload</button>
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

      {/* Activity (admin/office only) */}
      {showOps && isAdmin && (
      <div className="card p-5">
        <h3 className="font-medium text-gray-900 mb-3">Activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {activity.map(a => (
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
