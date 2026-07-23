'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft, Loader2, Save, Download, Trash2, CheckCircle2,
  ClipboardList, ListChecks, FolderOpen, Receipt,
} from 'lucide-react'
import { formatDate, formatDateTime, withTimeout } from '@/lib/utils'
import type { Client } from '@/lib/types/database'

interface SurveyorAccount { id: string; full_name: string; role: string }
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import JobChecklistEditor, { type JobChecklistEditorHandle } from '@/components/job/JobChecklistEditor'
import JobOpsPanel from '@/components/job/JobOpsPanel'
import JobInvoiceSummary from '@/components/job/JobInvoiceSummary'
import JobCargoVoyages from '@/components/job/JobCargoVoyages'
import UhtSummary from '@/components/uht/UhtSummary'
import { UHT_TEMPLATE_ID } from '@/lib/uht/fields'
import { WORKFLOW, advanceWorkflowTo } from '@/lib/jobs/tracker'
import { findOrCreateVessel } from '@/lib/vessels/api'
import { deliverJobPdf } from '@/lib/pdf/deliver'
import { titleCaseVesselName } from '@/lib/utils'

// shortLabel is what a phone shows — see the tab strip below.
const TABS = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: ClipboardList },
  { id: 'checklist', label: 'Checklist', shortLabel: 'Checklist', icon: ListChecks },
  { id: 'files', label: 'Files & Reports', shortLabel: 'Files', icon: FolderOpen },
  { id: 'billing', label: 'Invoice', shortLabel: 'Invoice', icon: Receipt },
] as const
type DetailTab = typeof TABS[number]['id']

// The .btn-* classes are 36px tall, under the ~44px touch target this app uses
// elsewhere (see JobOpsPanel's log rows). These are the correct-a-mistake controls,
// so they get the taller mobile size and fall back to the compact desktop metrics.
const TAP_BTN = 'py-2.5 text-base sm:py-2 sm:text-sm'

export default function AdminChecklistDetailPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string
  const editorRef = useRef<JobChecklistEditorHandle>(null)

  const [job, setJob] = useState<any>(null)
  const [surveyors, setSurveyors] = useState<SurveyorAccount[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [vessels, setVessels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [marking, setMarking] = useState(false)
  const [sharing, setSharing] = useState(false)

  // Share (mobile) or download (desktop) the server-rendered checklist PDF.
  async function downloadPdf() {
    setSharing(true)
    try {
      await deliverJobPdf(jobId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the report.')
    } finally {
      setSharing(false)
    }
  }
  const [tab, setTabState] = useState<DetailTab>('overview')
  // Persist the active tab in the URL (?tab=) so reopening or reloading this job —
  // e.g. a mobile/desktop PWA returning from the background, or navigating away and
  // back — restores the same tab instead of snapping to Overview.
  function setTab(t: DetailTab) {
    setTabState(t)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (t === 'overview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url)
  }
  const [editForm, setEditForm] = useState({
    title: '',
    vessel_name: '',
    surveyor_id: '',
    client_id: '',
    scheduled_date: '',
    end_date: '',
    job_stage: '',
    cargo_type: '',
    port_location: '',
    notes: '',
  })
  // Conditional Stage qualifier — only the broad survey types carry one.
  const STAGE_OPTIONS: Record<string, { label: string; options: string[] }> = {
    'Draught Survey': { label: 'Stage', options: ['Initial', 'Interim', 'Final'] },
    'Cargo Survey': { label: 'Loading/Discharging', options: ['Loading', 'Discharging'] },
    'Hire Survey': { label: 'Status', options: ['On-hire', 'Off-hire'] },
  }
  // Cargo Survey jobs carry a "what's the cargo?" question; the retired Cargo Loading /
  // Cargo Discharging types (merged by mig 154) stay in the set for historic jobs.
  const CARGO_JOB_TYPES = new Set(['Cargo Survey', 'Cargo Loading', 'Cargo Discharging'])
  const CARGO_SUGGESTIONS = ['Methanol', 'Crude Oil', 'Gasoil / Diesel', 'Gasoline', 'Jet A-1 / Kerosene', 'Fuel Oil', 'LPG', 'Anhydrous Ammonia', 'Urea', 'DRI', 'Iron Ore', 'Coal']
  const showCargoType = CARGO_JOB_TYPES.has(job?.job_type ?? '')

  useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Restore the tab from the URL on first mount (mirrors setTab above).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && TABS.some(x => x.id === t)) setTabState(t as DetailTab)
  }, [])

  async function load() {
    const supabase = createClient()
    const [
      { data: jobData },
      { data: srvData },
      { data: cliData },
      { data: vslData },
    ] = await Promise.all([
      supabase.from('jobs').select(`
        *,
        template:checklist_templates(name, id),
        client:clients(name),
        creator:profiles!jobs_created_by_fkey(full_name)
      `).eq('id', jobId).single(),
      supabase.from('profiles').select('id, full_name, role').in('role', ['surveyor', 'admin']).eq('is_active', true).order('full_name'),
      supabase.from('clients').select('*').eq('is_active', true).order('name'),
      supabase.from('vessels').select('id, name').eq('is_active', true).order('name'),
    ])

    if (!jobData) { router.push('/admin/jobs'); return }

    const accounts = (srvData as SurveyorAccount[]) ?? []
    // Resolve the current surveyor to an account: prefer the assigned account,
    // else match the stored name; if it's a legacy free-text name with no
    // account, keep it as a "(current)" option so saving doesn't wipe it.
    let surveyorId = ''
    if (jobData.assigned_to && accounts.some(a => a.id === jobData.assigned_to)) surveyorId = jobData.assigned_to
    else if (jobData.surveyor_name && accounts.some(a => a.full_name === jobData.surveyor_name)) surveyorId = accounts.find(a => a.full_name === jobData.surveyor_name)!.id
    else if (jobData.surveyor_name) surveyorId = '__current__'

    setJob(jobData)
    setSurveyors(accounts)
    setClients(cliData ?? [])
    setVessels((vslData ?? []) as { id: string; name: string }[])
    setEditForm({
      title: jobData.title,
      vessel_name: jobData.vessel_name ?? '',
      surveyor_id: surveyorId,
      client_id: jobData.client_id ?? '',
      scheduled_date: jobData.scheduled_date ?? '',
      end_date: jobData.end_date ?? '',
      job_stage: jobData.job_stage ?? '',
      cargo_type: jobData.cargo_type ?? '',
      port_location: jobData.port_location ?? '',
      notes: jobData.notes ?? '',
    })
    setLoading(false)
  }

  async function handleSaveEdit() {
    setSaving(true)
    const supabase = createClient()
    try {
      // Resolve the surveyor selection to a name + account assignment.
      let surveyorNameVal: string | null = job.surveyor_name ?? null
      let assignedToVal: string | null = job.assigned_to ?? null
      if (editForm.surveyor_id === '') { surveyorNameVal = null; assignedToVal = null }
      else if (editForm.surveyor_id !== '__current__') {
        const a = surveyors.find(s => s.id === editForm.surveyor_id)
        if (a) { surveyorNameVal = a.full_name; assignedToVal = a.id }
      }

      // Standardise the (possibly edited) vessel name + link to the directory.
      const vessel = titleCaseVesselName(editForm.vessel_name)
      const vesselId = vessel ? await withTimeout(findOrCreateVessel(vessel), 12_000, 'Linking vessel') : null

      // .select('id') so a 0-row RLS denial is surfaced instead of a false "saved".
      const { data, error: err } = await withTimeout(
        supabase.from('jobs').update({
          title: editForm.title,
          vessel_name: vessel || null,
          vessel_id: vesselId,
          surveyor_name: surveyorNameVal,
          assigned_to: assignedToVal,
          client_id: editForm.client_id || null,
          scheduled_date: editForm.scheduled_date || null,
          end_date: editForm.end_date || null,
          job_stage: editForm.job_stage || null,
          cargo_type: showCargoType ? (editForm.cargo_type.trim() || null) : null,
          port_location: editForm.port_location.trim() || null,
          notes: editForm.notes || null,
        }).eq('id', jobId).select('id'),
        15_000, 'Saving job'
      )

      if (err) { setError(err.message); return }
      if (!data || data.length === 0) { setError('Save was blocked — permission denied or the job no longer exists.'); return }

      setEditMode(false)
      toast.success('Job saved')
      load()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save — please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // Admin escape hatch: push a completed-but-stuck checklist through, regardless
  // of the surveyor's device/state. Sets submitted + advances the workflow.
  async function markSubmitted() {
    setMarking(true)
    const supabase = createClient()
    // .select('id') so a 0-row RLS denial on this escape-hatch is surfaced rather
    // than reporting a false "Marked as submitted".
    const { data, error: err } = await supabase.from('jobs')
      .update({ submitted_at: job.submitted_at ?? new Date().toISOString() })
      .eq('id', jobId).select('id')
    if (err) { toast.error(err.message); setMarking(false); return }
    if (!data || data.length === 0) { toast.error('Could not mark as submitted — permission denied or the job no longer exists.'); setMarking(false); return }
    // Best-effort workflow advance — time-bounded so a stalled request can't hang
    // the button (the submit itself is already verified above).
    await withTimeout(advanceWorkflowTo(jobId, 'report_ready'), 8_000, 'Updating status').catch(() => {})
    toast.success('Marked as submitted')
    setMarking(false)
    load()
  }

  async function handleDelete() {
    if (!(await confirmDialog({ message: `Delete "${job.title}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return
    setDeleting(true)
    const supabase = createClient()
    const { data, error: err } = await supabase.from('jobs').delete().eq('id', jobId).select('id')
    if (err) { setError(err.message); setDeleting(false); return }
    if (!data || data.length === 0) { setError('Delete was blocked — permission denied or the job no longer exists.'); setDeleting(false); return }
    router.push('/admin/jobs')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (!job) return null


  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* The action group wraps to its own full-width row on a phone. Kept as one
          non-wrapping row it needed ~294px of the 328px available at 360px, which
          left the title ~34px and pushed Delete/Save off the edge under Android
          font scaling — Edit and Delete became unreachable. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          onClick={() => editorRef.current?.navigate('/admin/jobs')}
          className={`btn-ghost px-3 ${TAP_BTN}`}
          aria-label="Back to jobs"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{job.title}</h1>
            {job.workflow_status && (
              <span className={`inline-flex flex-shrink-0 items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.pill ?? ''}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.dot ?? ''}`} />
                {WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.label ?? job.workflow_status}
              </span>
            )}
          </div>
          <p className="text-gray-500 mt-0.5 text-sm truncate">
            {job.report_number && <span className="font-medium text-gray-700 tnum">{job.report_number}</span>}
            {job.job_type ? `${job.report_number ? ' · ' : ''}${job.job_type}` : ''}
            {job.job_stage ? ` · ${job.job_stage}` : ''}
            {job.template?.name ? ` · ${job.template.name}` : ''}
          </p>
        </div>
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
          {!!job.submitted_at && (
            <button onClick={downloadPdf} disabled={sharing} className={`btn-secondary ${TAP_BTN}`} title="Download / Share PDF" aria-label="Download / Share PDF">
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Download / Share PDF</span>
            </button>
          )}
          {/* Admin escape hatch when a surveyor's submit is stuck; lifecycle otherwise
              runs through the workflow stepper on the Overview tab. */}
          {!editMode && !job.submitted_at && (
            <button onClick={markSubmitted} disabled={marking} className={`btn-secondary ${TAP_BTN}`} title="Mark as submitted" aria-label="Mark as submitted">
              {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Mark submitted</span>
            </button>
          )}
          <button onClick={() => setEditMode(!editMode)} className={`btn-secondary ${TAP_BTN}`}>
            {editMode ? 'Cancel' : 'Edit'}
          </button>
          {!editMode && (
            <button onClick={handleDelete} disabled={deleting} className={`btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50 ${TAP_BTN}`}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
          )}
          {editMode && (
            <button onClick={handleSaveEdit} disabled={saving} className={`btn-primary ${TAP_BTN}`}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-200 overflow-x-auto">
        {/* Icons and the long "Files & Reports" label are dropped below sm: with them
            the four tabs measured ~474px against 328px at 360px, so Invoice sat
            off-screen with nothing to hint the strip scrolls. */}
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-3 sm:py-2.5 text-sm font-medium border-b-2 whitespace-nowrap -mb-px rounded-t-md transition-colors ${
              tab === t.id ? 'border-brand-600 text-brand-700 bg-brand-50/60' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <t.icon className="h-4 w-4 hidden sm:block" />
            <span className="sm:hidden">{t.shortLabel}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'overview' && (
      <div className="space-y-6">
      <JobOpsPanel job={job} isAdmin section="ops" onChanged={load} />

      <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <h2 className="section-title">Job Details</h2>

            {editMode ? (
              <div className="space-y-4">
                <div>
                  <label className="label-base">Title</label>
                  <input type="text" value={editForm.title} onChange={(e) => setEditForm(p => ({ ...p, title: e.target.value }))} className="input-base" />
                </div>
                <div>
                  <label className="label-base">Vessel Name</label>
                  <input type="text" list="vesselListEdit" value={editForm.vessel_name} onChange={(e) => setEditForm(p => ({ ...p, vessel_name: e.target.value }))} className="input-base" placeholder="e.g. Atlantic Spirit" />
                  <datalist id="vesselListEdit">{vessels.map(v => <option key={v.id} value={v.name} />)}</datalist>
                  <p className="text-[11px] text-gray-400 mt-1">Saving links this job to the vessel in the directory.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-base">Surveyor</label>
                    <select value={editForm.surveyor_id} onChange={(e) => setEditForm(p => ({ ...p, surveyor_id: e.target.value }))} className="input-base">
                      <option value="">— No surveyor —</option>
                      {editForm.surveyor_id === '__current__' && <option value="__current__">{job.surveyor_name} (current)</option>}
                      {surveyors.map(s => <option key={s.id} value={s.id}>{s.full_name}{s.role === 'admin' ? ' (admin)' : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label-base">Client</label>
                    <select value={editForm.client_id} onChange={(e) => setEditForm(p => ({ ...p, client_id: e.target.value }))} className="input-base">
                      <option value="">No client</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-base">Start date</label>
                    <input type="date" value={editForm.scheduled_date} onChange={(e) => setEditForm(p => ({ ...p, scheduled_date: e.target.value }))} className="input-base" />
                    <p className="text-[11px] text-gray-400 mt-1">Sets where the job sits on the calendar.</p>
                  </div>
                  <div>
                    <label className="label-base">End date <span className="text-gray-400 font-normal">(multi-day)</span></label>
                    <input type="date" value={editForm.end_date} min={editForm.scheduled_date} onChange={(e) => setEditForm(p => ({ ...p, end_date: e.target.value }))} className="input-base" />
                    <p className="text-[11px] text-gray-400 mt-1">Leave blank for a single-day job.</p>
                  </div>
                  {STAGE_OPTIONS[job.job_type ?? ''] && (
                    <div>
                      <label className="label-base">{STAGE_OPTIONS[job.job_type ?? ''].label}</label>
                      <select value={editForm.job_stage} onChange={(e) => setEditForm(p => ({ ...p, job_stage: e.target.value }))} className="input-base">
                        <option value="">— None —</option>
                        {STAGE_OPTIONS[job.job_type ?? ''].options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  {showCargoType && (
                    <div>
                      <label className="label-base">Cargo type</label>
                      <input type="text" list="cargoList" value={editForm.cargo_type} onChange={(e) => setEditForm(p => ({ ...p, cargo_type: e.target.value }))} className="input-base" placeholder="e.g. Methanol, Crude Oil, Urea…" />
                      <datalist id="cargoList">{CARGO_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
                    </div>
                  )}
                </div>
                <div>
                  <label className="label-base">Port / Location</label>
                  <input type="text" value={editForm.port_location} onChange={(e) => setEditForm(p => ({ ...p, port_location: e.target.value }))} className="input-base" placeholder="e.g. Port of Point Lisas, Berth 3" />
                  <p className="text-[11px] text-gray-400 mt-1">Where the survey took place — handy on report-only jobs with no checklist.</p>
                </div>
                <div>
                  <label className="label-base">Notes</label>
                  <textarea value={editForm.notes} onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="input-base resize-y" placeholder="e.g. call number, gang count, special instructions…" />
                </div>
              </div>
            ) : (
              // Stacks on a phone, matching the edit-mode grids above: at 360px two
              // columns are ~136px each and a vessel/client name wraps to three lines.
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs font-medium text-gray-500">Vessel</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.vessel_name
                    ? (job.vessel_id
                      ? <Link href={`/admin/vessels/${job.vessel_id}`} className="text-brand-700 hover:underline">M.V. {job.vessel_name}</Link>
                      : `M.V. ${job.vessel_name}`)
                    : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Surveyor</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.surveyor_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Client</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.client?.name
                    ? (job.client_id
                      ? <Link href={`/admin/clients/${job.client_id}`} className="text-brand-700 hover:underline">{job.client.name}</Link>
                      : job.client.name)
                    : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Template</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {job.template?.name}
                    {job.template?.id && (
                      <button onClick={() => editorRef.current?.navigate(`/admin/templates/${job.template?.id}`)} className="ml-2 text-brand-700 hover:underline text-xs">View</button>
                    )}
                  </dd>
                </div>
                {job.job_stage && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">{STAGE_OPTIONS[job.job_type ?? '']?.label ?? 'Stage'}</dt>
                    <dd className="mt-1 text-sm text-gray-900">{job.job_stage}</dd>
                  </div>
                )}
                {job.cargo_type && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Cargo type</dt>
                    <dd className="mt-1 text-sm text-gray-900">{job.cargo_type}</dd>
                  </div>
                )}
                {job.port_location && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Port / Location</dt>
                    <dd className="mt-1 text-sm text-gray-900">{job.port_location}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-gray-500">Created by</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.creator?.full_name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">{job.end_date ? 'Dates' : 'Scheduled'}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.scheduled_date
                    ? (job.end_date ? `${formatDate(job.scheduled_date)} – ${formatDate(job.end_date)}` : formatDate(job.scheduled_date))
                    : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDateTime(job.started_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Submitted</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDateTime(job.submitted_at)}</dd>
                </div>
                {job.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-gray-500">Notes</dt>
                    <dd className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{job.notes}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
      </div>

      {/* Cargo voyages billed on this job (cargo jobs / jobs that already have links) */}
      <JobCargoVoyages
        jobId={jobId}
        vesselName={job.vessel_name}
        isCargoJob={/cargo/i.test(job.job_type ?? '') || /cargo/i.test(job.template?.name ?? '')}
      />
      </div>
      )}

      {tab === 'files' && (
        <JobOpsPanel job={job} isAdmin section="files" onChanged={load} />
      )}

      {tab === 'billing' && (
        <JobInvoiceSummary job={job} />
      )}

      {/* Checklist editor stays mounted (preserves unsaved edits + the back/leave
          guard via editorRef); shown only on the Checklist tab. */}
      <div className={tab === 'checklist' ? 'space-y-6' : 'hidden'}>
        {job.template?.id === UHT_TEMPLATE_ID && (
          <UhtSummary jobId={jobId} vesselName={job.vessel_name} clientName={job.client?.name} />
        )}
        <JobChecklistEditor ref={editorRef} jobId={jobId} backHref="/admin/jobs" hideInlinePdf />
      </div>
    </div>
  )
}
