'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowLeft, Loader2, Save, Download, Eye, Trash2, CheckCircle2,
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

const TABS = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'checklist', label: 'Checklist', icon: ListChecks },
  { id: 'files', label: 'Files & Reports', icon: FolderOpen },
  { id: 'billing', label: 'Invoice', icon: Receipt },
] as const
type DetailTab = typeof TABS[number]['id']

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
  })

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
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => editorRef.current?.navigate('/admin/jobs')}
          className="btn-ghost py-2 px-3"
          aria-label="Back to checklists"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{job.title}</h1>
            {job.workflow_status && (
              <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.pill ?? ''}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.dot ?? ''}`} />
                {WORKFLOW[job.workflow_status as keyof typeof WORKFLOW]?.label ?? job.workflow_status}
              </span>
            )}
          </div>
          <p className="text-gray-500 mt-0.5 text-sm">
            {job.report_number && <span className="font-medium text-gray-700 tnum">{job.report_number}</span>}
            {job.job_type ? `${job.report_number ? ' · ' : ''}${job.job_type}` : ''}
            {job.template?.name ? ` · ${job.template.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!!job.submitted_at && (
            <button onClick={downloadPdf} disabled={sharing} className="btn-secondary" title="Download / Share PDF">
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Download / Share PDF</span>
            </button>
          )}
          <button onClick={() => setEditMode(!editMode)} className={editMode ? 'btn-secondary' : 'btn-secondary'}>
            {editMode ? 'Cancel' : 'Edit'}
          </button>
          {!editMode && (
            <button onClick={handleDelete} disabled={deleting} className="btn-ghost text-red-600 hover:text-red-700 hover:bg-red-50">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
          )}
          {editMode && (
            <button onClick={handleSaveEdit} disabled={saving} className="btn-primary">
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
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap -mb-px rounded-t-md transition-colors ${
              tab === t.id ? 'border-brand-600 text-brand-700 bg-brand-50/60' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
      <div className="space-y-6">
      <JobOpsPanel job={job} isAdmin section="ops" onChanged={load} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
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
                    <label className="label-base">Scheduled date</label>
                    <input type="date" value={editForm.scheduled_date} onChange={(e) => setEditForm(p => ({ ...p, scheduled_date: e.target.value }))} className="input-base" />
                    <p className="text-[11px] text-gray-400 mt-1">Sets where the job sits on the calendar.</p>
                  </div>
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-4">
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
                  <dd className="mt-1 text-sm text-gray-900">{job.template?.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Created by</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.creator?.full_name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Scheduled</dt>
                  <dd className="mt-1 text-sm text-gray-900">{job.scheduled_date ? formatDate(job.scheduled_date) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Started</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDateTime(job.started_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500">Submitted</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDateTime(job.submitted_at)}</dd>
                </div>
              </dl>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-medium text-gray-900 mb-3">Actions</h3>
            <div className="space-y-2">
              {/* Admin can push a completed checklist through if a surveyor's
                  submit is stuck. Lifecycle otherwise via the workflow stepper above. */}
              {!job.submitted_at && (
                <button onClick={markSubmitted} disabled={marking} className="btn-secondary w-full justify-start text-sm">
                  {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Mark as submitted
                </button>
              )}
              <button
                onClick={() => editorRef.current?.navigate(`/admin/templates/${job.template?.id}`)}
                className="btn-ghost w-full justify-start text-sm"
              >
                <Eye className="h-4 w-4" />
                View Template
              </button>
              {!!job.submitted_at && (
                <button onClick={downloadPdf} disabled={sharing} className="btn-ghost w-full justify-start text-sm">
                  {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download / Share PDF
                </button>
              )}
            </div>
          </div>
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
