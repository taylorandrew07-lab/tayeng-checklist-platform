'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus, X, Upload, Download, Trash2, Loader2, Clock, CheckCircle2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import {
  WORKFLOW, WORKFLOW_ORDER, ATTACHMENT_KINDS, attachmentLabel, formatBytes, money, CURRENCIES,
  setWorkflowStatus, updateJobField, listJobSurveyors, listSurveyorAccounts, addJobSurveyor, removeJobSurveyor,
  updateJobSurveyorHours, updateJobSurveyorRates,
  listJobAttachments, uploadJobAttachment, deleteJobAttachment, jobFileUrl, listJobActivity,
  type JobSurveyorRow, type SurveyorAccount,
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

function SurveyorRow({ row, jobId, isAdmin, highlightOT, onRemove, onSaved }: {
  row: JobSurveyorRow; jobId: string; isAdmin: boolean; highlightOT?: boolean; onRemove: () => void; onSaved: () => void
}) {
  const [reg, setReg] = useState(String(row.regular_hours ?? 0))
  const [ot, setOt] = useState(String(row.overtime_hours ?? 0))
  const [payRate, setPayRate] = useState(row.pay_rate != null ? String(row.pay_rate) : '')
  const [otRate, setOtRate] = useState(row.overtime_rate != null ? String(row.overtime_rate) : '')
  const [cur, setCur] = useState(row.pay_currency || 'TTD')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const h = await updateJobSurveyorHours(row.id, jobId, { regular_hours: Number(reg) || 0, overtime_hours: Number(ot) || 0 })
    let err = h.error
    if (!err && isAdmin) {
      const r = await updateJobSurveyorRates(row.id, jobId, { pay_rate: payRate === '' ? null : Number(payRate), overtime_rate: otRate === '' ? null : Number(otRate), pay_currency: cur })
      err = r.error
    }
    setSaving(false)
    if (err) { toast.error(err); return }
    toast.success('Hours saved'); onSaved()
  }

  const numCls = 'input-base py-1 text-sm'
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-800">{row.display_title ?? row.full_name}{row.role === 'admin' ? ' (admin)' : ''}</span>
        {isAdmin && <button onClick={onRemove} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-[11px] text-gray-400">Regular hrs <span className="text-gray-300">· client</span></label><input type="number" min={0} step="0.5" value={reg} onChange={e => setReg(e.target.value)} className={numCls} /></div>
        <div><label className={`text-[11px] ${highlightOT ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>Overtime hrs <span className="text-gray-300">· OT pay</span></label><input type="number" min={0} step="0.5" value={ot} onChange={e => setOt(e.target.value)} className={`${numCls} ${highlightOT ? 'ring-1 ring-amber-300 border-amber-300' : ''}`} /></div>
        {isAdmin && <div><label className="text-[11px] text-gray-400">Pay rate /hr</label><input type="number" min={0} step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && <div><label className="text-[11px] text-gray-400">OT rate /hr</label><input type="number" min={0} step="0.01" value={otRate} onChange={e => setOtRate(e.target.value)} className={numCls} /></div>}
        {isAdmin && <div><label className="text-[11px] text-gray-400">Currency</label><select value={cur} onChange={e => setCur(e.target.value)} className={numCls}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-xs text-gray-500">OT pay: <span className="font-medium text-gray-700 tnum">{money(row.overtime_pay, row.pay_currency)}</span>{isAdmin && row.regular_pay > 0 ? ` · reg ${money(row.regular_pay, row.pay_currency)}` : ''}</p>
        <button onClick={save} disabled={saving} className="btn-secondary py-1 px-2.5 text-xs">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save</button>
      </div>
    </div>
  )
}

export default function JobOpsPanel({ job, isAdmin, onChanged }: { job: Job; isAdmin: boolean; onChanged: () => void }) {
  const [surveyors, setSurveyors] = useState<JobSurveyorRow[]>([])
  const [accounts, setAccounts] = useState<SurveyorAccount[]>([])
  const [attachments, setAttachments] = useState<JobAttachment[]>([])
  const [activity, setActivity] = useState<(ActivityLogRow & { actor_name: string | null })[]>([])
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')
  const [kind, setKind] = useState<JobAttachmentKind>('preliminary')
  const [isOT, setIsOT] = useState(!!job.is_overtime)
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
    if (!(await confirmDialog({ message: `Remove ${row.display_title ?? row.full_name} from this job?`, confirmLabel: 'Remove' }))) return
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
      {/* Workflow */}
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

      {/* Surveyors & hours */}
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
        {surveyors.length === 0 ? (
          <p className="text-sm text-gray-400 mb-3">No surveyors assigned yet.</p>
        ) : (
          <div className="space-y-3 mb-3">
            {surveyors.map(s => (
              <SurveyorRow key={s.id} row={s} jobId={job.id} isAdmin={isAdmin} highlightOT={isOT} onRemove={() => remove(s)} onSaved={() => { onChanged(); reload() }} />
            ))}
          </div>
        )}
        {isAdmin && available.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={addId} onChange={e => setAddId(e.target.value)} className="input-base text-sm py-1.5 flex-1">
              <option value="">Add a surveyor…</option>
              {available.map(a => <option key={a.id} value={a.id}>{a.display_title ?? a.full_name}{a.role === 'admin' ? ' (admin)' : ''}</option>)}
            </select>
            <button onClick={add} disabled={!addId || busy} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Add</button>
          </div>
        )}
      </div>

      {/* Attachments */}
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

      {/* Activity (admin/office only) */}
      {isAdmin && (
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
