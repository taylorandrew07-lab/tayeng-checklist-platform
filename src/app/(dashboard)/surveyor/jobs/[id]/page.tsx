'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CloudOff, Loader2, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import JobChecklistEditor, { type JobChecklistEditorHandle } from '@/components/job/JobChecklistEditor'
import JobOpsPanel from '@/components/job/JobOpsPanel'
import UhtSummary from '@/components/uht/UhtSummary'
import { UHT_TEMPLATE_ID } from '@/lib/uht/fields'
import { WORKFLOW } from '@/lib/jobs/tracker'
import { toast } from '@/components/ui/toast'
import { findOrCreateVessel } from '@/lib/vessels/api'
import { getDraft, putDraft, offlineAvailable } from '@/lib/offline/db'
import { titleCaseVesselName, withTimeout } from '@/lib/utils'
import type { WorkflowStatus } from '@/lib/types/database'

// The .btn-* classes are 36px tall, under the ~44px touch target this app uses
// elsewhere (see JobOpsPanel's log rows). These are the correct-a-mistake controls
// on a phone, so they get the taller mobile size and the compact desktop metrics.
const TAP_BTN = 'py-2.5 text-base sm:py-2 sm:text-sm'

// The broad survey types carry a qualifier (jobs.job_stage); mirror the New Job forms
// so a surveyor can set Loading/Discharging (etc.) here on both PC and mobile.
const STAGE_OPTIONS: Record<string, { label: string; options: string[]; placeholder?: string }> = {
  'Draught Survey': { label: 'Stage', options: ['Initial', 'Interim', 'Final'] },
  'Cargo Survey': { label: 'Loading/Discharging', options: ['Loading', 'Discharging'], placeholder: 'Select loading or discharging…' },
  'Hire Survey': { label: 'Status', options: ['On-hire', 'Off-hire'] },
}
// Cargo Survey carries a "what's the cargo?" question; the retired Cargo Loading /
// Cargo Discharging types (merged by mig 154) stay in the set for historic jobs.
const CARGO_JOB_TYPES = new Set(['Cargo Survey', 'Cargo Loading', 'Cargo Discharging'])
const CARGO_SUGGESTIONS = ['Methanol', 'Crude Oil', 'Gasoil / Diesel', 'Gasoline', 'Jet A-1 / Kerosene', 'Fuel Oil', 'LPG', 'Anhydrous Ammonia', 'Urea', 'DRI', 'Iron Ore', 'Coal']

// Both New Job forms build the title as "M.V. <vessel> - <template> - <date>", so
// correcting a mistyped vessel name here must swap that segment too — the admin job
// page, the jobs CSV and global search all read jobs.title, not vessel_name. Any
// title that doesn't have the expected prefix is left exactly as it is.
function retitleForVessel(title: string | null, oldVessel: string | null, newVessel: string): string | null {
  if (!title || !oldVessel || !newVessel || oldVessel === newVessel) return title
  const prefix = `M.V. ${oldVessel} - `
  return title.startsWith(prefix) ? `M.V. ${newVessel} - ${title.slice(prefix.length)}` : title
}

export default function SurveyorJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string
  const editorRef = useRef<JobChecklistEditorHandle>(null)
  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({ vessel_name: '', scheduled_date: '', port_location: '', notes: '', job_stage: '', cargo_type: '' })
  // The job exists only in this device's IndexedDB draft — no server row yet.
  const [localOnly, setLocalOnly] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  function fillEditForm(j: any) {
    setEditForm({ vessel_name: j?.vessel_name ?? '', scheduled_date: j?.scheduled_date ?? '', port_location: j?.port_location ?? '', notes: j?.notes ?? '', job_stage: j?.job_stage ?? '', cargo_type: j?.cargo_type ?? '' })
  }

  async function load() {
    const supabase = createClient()
    // getSession() reads the locally-persisted session, so this still identifies
    // the user with no signal — getUser() would need the network.
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id ?? null
    setUserId(uid)

    let data: any = null
    try {
      const res = await supabase
        .from('jobs')
        // labour_unit must be selected: JobOpsPanel defaults a missing unit to hours,
        // and on a day-billed job that would let the OT shift log overwrite the
        // hand-typed day count with a sum of HOURS, paid at the day rate (mig 148).
        .select('id, title, report_number, job_type, job_stage, cargo_type, vessel_name, workflow_status, template_id, assigned_to, surveyor_name, client_id, created_by, created_at, updated_at, scheduled_date, end_date, notes, port_location, is_overtime, billing_mode, labour_unit, client:clients(name)')
        .eq('id', jobId).single()
      data = res.data
    } catch { /* no signal — fall through to the local draft */ }

    if (data) {
      setLocalOnly(false)
      setJob(data)
      fillEditForm(data)
      setLoading(false)
      return
    }

    // No server row. A job started with no signal lives only in the local draft
    // until it syncs (the New Job form writes the draft, then routes straight
    // here), so load it from there — otherwise the surveyor is bounced onto
    // "Job not found." on the one screen the offline form exists to reach.
    let draftJob: any = null
    if (uid && offlineAvailable()) {
      const draft = await getDraft(uid, jobId).catch(() => undefined)
      if (draft?.pendingCreate && draft.job) draftJob = draft.job
    }
    setLocalOnly(!!draftJob)
    setJob(draftJob)
    if (draftJob) fillEditForm(draftJob)
    setLoading(false)
  }
  useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fix a typo made while creating the job on a phone. Deliberately limited to the
  // three columns a surveyor is actually allowed to write: enforce_surveyor_job_update
  // (mig 020, last rewritten by mig 148) raises on any change to client_id or
  // template_id, so offering those here would just error on save — an admin has to
  // do it. Closed jobs are locked for everyone but admins (mig 117).
  async function handleSaveEdit() {
    setSaving(true)
    try {
      const supabase = createClient()
      const vessel = titleCaseVesselName(editForm.vessel_name)

      // Not on the server yet: correct the draft instead. sync.ts's create
      // whitelist carries title/vessel_name/scheduled_date/notes onto the insert,
      // so the correction publishes with the job. No vessel lookup here — that
      // needs the network and the sync does it anyway.
      if (localOnly) {
        if (!userId) { toast.error('Your session has expired — please sign in again.'); return }
        const draft = await getDraft(userId, jobId).catch(() => undefined)
        if (!draft) { toast.error('This job is no longer saved on this device.'); return }
        const nextJob = {
          ...draft.job,
          title: retitleForVessel(draft.job?.title ?? null, draft.job?.vessel_name ?? null, vessel),
          vessel_name: vessel || null,
          scheduled_date: editForm.scheduled_date || null,
          port_location: editForm.port_location.trim() || null,
          notes: editForm.notes || null,
          job_stage: editForm.job_stage || null,
          cargo_type: CARGO_JOB_TYPES.has(draft.job?.job_type ?? '') ? (editForm.cargo_type.trim() || null) : (draft.job?.cargo_type ?? null),
        }
        await putDraft({ ...draft, job: nextJob, updatedAt: Date.now() })
        setEditMode(false)
        toast.success('Saved on this device')
        load()
        return
      }

      const vesselId = vessel ? await withTimeout(findOrCreateVessel(vessel), 12_000, 'Linking vessel') : null
      // .select('id') so a 0-row RLS denial is surfaced instead of a false "saved".
      const { data, error } = await withTimeout(
        supabase.from('jobs').update({
          vessel_name: vessel || null,
          vessel_id: vesselId,
          // Keep the stored title in step with the vessel name (see retitleForVessel).
          title: retitleForVessel(job.title ?? null, job.vessel_name ?? null, vessel),
          scheduled_date: editForm.scheduled_date || null,
          port_location: editForm.port_location.trim() || null,
          notes: editForm.notes || null,
          // job_stage / cargo_type aren't in enforce_surveyor_job_update's blacklist
          // (mig 148), so a surveyor may set them. Only write cargo_type on cargo jobs.
          job_stage: editForm.job_stage || null,
          cargo_type: CARGO_JOB_TYPES.has(job.job_type ?? '') ? (editForm.cargo_type.trim() || null) : (job.cargo_type ?? null),
        }).eq('id', jobId).select('id'),
        15_000, 'Saving job'
      )
      if (error) { toast.error(error.message); return }
      if (!data || data.length === 0) { toast.error('Save was blocked — ask an admin to make this change.'); return }
      setEditMode(false)
      toast.success('Job saved')
      load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save — please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  function back() {
    if (job?.template_id) editorRef.current?.navigate('/surveyor')
    else router.push('/surveyor')
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!job) return <div className="max-w-3xl mx-auto py-16 text-center text-gray-400">Job not found.</div>

  const w = WORKFLOW[job.workflow_status as WorkflowStatus]
  const locked = job.workflow_status === 'closed'
  const stageConfig = STAGE_OPTIONS[job.job_type ?? ''] ?? null
  const showCargoType = CARGO_JOB_TYPES.has(job.job_type ?? '')

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-rise">
      {/* Wraps so the Edit/Save/Cancel group drops to its own full-width row on a
          phone rather than squeezing the title to nothing. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button onClick={back} className={`btn-ghost px-3 ${TAP_BTN}`} aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{job.vessel_name ?? job.title}</h1>
            {w && <span className={`inline-flex flex-shrink-0 items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}</span>}
          </div>
          <p className="text-gray-500 mt-0.5 text-sm truncate">
            {job.report_number && <span className="font-medium text-gray-700 tnum">{job.report_number}</span>}
            {job.job_type ? `${job.report_number ? ' · ' : ''}${job.job_type}` : ''}
          </p>
        </div>
        {!locked && (
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
            <button onClick={() => { if (editMode) load(); setEditMode(!editMode) }} className={`btn-secondary ${TAP_BTN}`}>
              {editMode ? 'Cancel' : 'Edit'}
            </button>
            {editMode && (
              <button onClick={handleSaveEdit} disabled={saving} className={`btn-primary ${TAP_BTN}`}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            )}
          </div>
        )}
      </div>

      {editMode && !locked && (
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Job details</h2>
          <div>
            <label className="label-base">Vessel Name</label>
            <input type="text" value={editForm.vessel_name} onChange={(e) => setEditForm(p => ({ ...p, vessel_name: e.target.value }))} className="input-base" placeholder="e.g. Atlantic Spirit" />
          </div>
          <div>
            <label className="label-base">Survey date</label>
            <input type="date" value={editForm.scheduled_date} onChange={(e) => setEditForm(p => ({ ...p, scheduled_date: e.target.value }))} className="input-base" />
          </div>
          {stageConfig && (
            <div>
              <label className="label-base">{stageConfig.label}</label>
              <select value={editForm.job_stage} onChange={(e) => setEditForm(p => ({ ...p, job_stage: e.target.value }))} className="input-base">
                <option value="">{stageConfig.placeholder ?? `Select ${stageConfig.label.toLowerCase()}…`}</option>
                {stageConfig.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          {showCargoType && (
            <div>
              <label className="label-base">Cargo type</label>
              <input type="text" list="cargoList" value={editForm.cargo_type} onChange={(e) => setEditForm(p => ({ ...p, cargo_type: e.target.value }))} className="input-base" placeholder="e.g. Methanol, Crude Oil, Urea…" />
              <datalist id="cargoList">{CARGO_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
              <p className="text-xs text-gray-400 mt-1">The product being {editForm.job_stage === 'Discharging' ? 'discharged' : 'loaded'}.</p>
            </div>
          )}
          <div>
            <label className="label-base">Port / Location</label>
            <input type="text" value={editForm.port_location} onChange={(e) => setEditForm(p => ({ ...p, port_location: e.target.value }))} className="input-base" placeholder="e.g. Port of Point Lisas, Berth 3" />
            <p className="text-xs text-gray-400 mt-1">Where the survey took place.</p>
          </div>
          <div>
            <label className="label-base">Notes</label>
            <textarea value={editForm.notes} onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={2} className="input-base resize-y" placeholder="e.g. call number, gang count, special instructions…" />
          </div>
          <p className="text-[11px] text-gray-400">
            Picked the wrong client or template? Only an admin can change those — ask them to correct it.
          </p>
        </div>
      )}

      {localOnly && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <CloudOff className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>Saved on this device and not yet sent to the office. Fill in the checklist as normal — the job and your answers publish automatically when you next have a signal.</span>
        </div>
      )}

      {job.workflow_status === 'closed' && (
        <div className="rounded-lg bg-gray-100 border border-gray-200 px-4 py-3 text-sm text-gray-700">
          This job has been invoiced and closed. Your hours, overtime, distance and checklist are locked and can no longer be edited. If something needs correcting, ask an admin.
        </div>
      )}

      {/* Surveyor ops: read-only status + their own assignment + report/VOS upload.
          Every row it reads and writes (job_surveyors, uploads) is keyed on a job
          row that doesn't exist yet, so it only appears once the job has synced. */}
      {!localOnly && <JobOpsPanel job={job} isAdmin={false} onChanged={load} />}

      {!localOnly && job.template_id === UHT_TEMPLATE_ID && (
        <UhtSummary jobId={jobId} vesselName={job.vessel_name} clientName={job.client?.name} />
      )}

      {/* Checklist editor only for checklist jobs (report-only jobs have no template). */}
      {job.template_id && (
        <div className="border-t border-gray-200 pt-6">
          <JobChecklistEditor ref={editorRef} jobId={jobId} backHref="/surveyor" />
        </div>
      )}
    </div>
  )
}
