'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { loadNewJobData } from '@/lib/offline/newJobData'
import { putDraft, offlineAvailable } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'
import { autoReportNotRequired } from '@/lib/jobs/reportPolicy'
import { addJobType, type SurveyorAccount } from '@/lib/jobs/tracker'
import { toast } from '@/components/ui/toast'
import { titleCaseVesselName } from '@/lib/utils'

// Local yyyy-mm-dd for the <input type=date> default (avoids the UTC off-by-one).
function isoDateLocal(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
function dmyFromISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// Mirrors the admin New Job form (Loading/Discharging wording from migration 147).
// Duplicated rather than shared because the admin job pages already each keep their
// own copy — a shared module would mean editing those files too.
const STAGE_OPTIONS: Record<string, { label: string; options: string[]; placeholder?: string }> = {
  'Draught Survey': { label: 'Stage', options: ['Initial', 'Interim', 'Final'] },
  'Cargo Survey': { label: 'Loading/Discharging', options: ['Loading', 'Discharging'], placeholder: 'Select loading or discharging…' },
  'Hire Survey': { label: 'Status', options: ['On-hire', 'Off-hire'] },
}
const CARGO_JOB_TYPES = new Set(['Cargo Loading', 'Cargo Discharging'])
// Same ~44px phone tap target the job pages use (see JobOpsPanel's log rows).
const TAP_BTN = 'py-2.5 text-base sm:py-2 sm:text-sm'
const CARGO_SUGGESTIONS = ['Methanol', 'Crude Oil', 'Gasoil / Diesel', 'Gasoline', 'Jet A-1 / Kerosene', 'Fuel Oil', 'LPG', 'Anhydrous Ammonia', 'Urea', 'DRI', 'Iron Ore', 'Coal']

export default function SurveyorNewChecklistPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [jobTypes, setJobTypes] = useState<any[]>([])
  const [surveyors, setSurveyors] = useState<SurveyorAccount[]>([])
  const [myName, setMyName] = useState('')
  const [myId, setMyId] = useState('')
  const [fromCache, setFromCache] = useState(false)
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)
  const [jobType, setJobType] = useState('')
  const [showNewJobType, setShowNewJobType] = useState(false)
  const [newJobTypeName, setNewJobTypeName] = useState('')
  const [jobStage, setJobStage] = useState('')
  const [cargoType, setCargoType] = useState('')
  // Extra surveyors on this job, beyond the owner (you). The owner is always the
  // primary via assigned_to; these attach as co-surveyors on sync (mig 150).
  const [coSurveyors, setCoSurveyors] = useState<Set<string>>(new Set())
  const [vesselName, setVesselName] = useState('')
  const [vessels, setVessels] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [scheduledDate, setScheduledDate] = useState(isoDateLocal(new Date()))
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  // Only Regular/Overtime here: migrations 124 + 148 make 'fixed' admin-only on
  // update, so a surveyor who picked it could never change it back.
  const [billingMode, setBillingMode] = useState<'overtime' | 'regular'>('regular')
  const [notes, setNotes] = useState('')
  const [reportNotRequired, setReportNotRequired] = useState(false)

  const stageConfig = STAGE_OPTIONS[jobType] ?? null
  // Same title shape as the admin form, so the same job reads identically whoever
  // made it. The label is the template name when one is picked, else the job type —
  // report-only jobs (Draught Survey, Hatch, Cargo…) have no template.
  const label = selectedTemplate?.name ?? jobType
  const labelWithStage = label && jobStage ? `${label} (${jobStage})` : label
  const autoTitle = vesselName.trim() && label
    ? `M.V. ${titleCaseVesselName(vesselName)} - ${labelWithStage} - ${dmyFromISO(scheduledDate)}`
    : ''

  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const onStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', onStatus)
    window.addEventListener('offline', onStatus)
    async function load() {
      // The surveyor IS the surveyor on their own jobs — use their own name,
      // read offline-safely from the cached profile (falls back to a live fetch).
      let name = ''
      let id = ''
      try { const c = localStorage.getItem('te_profile'); if (c) { const p = JSON.parse(c); name = p?.full_name ?? ''; id = p?.id ?? '' } } catch { /* storage unavailable */ }
      if (!name && (typeof navigator === 'undefined' || navigator.onLine)) {
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (user) { id = user.id; const { data: p } = await supabase.from('profiles').select('full_name').eq('id', user.id).single(); name = p?.full_name ?? '' }
        } catch { /* offline / no session */ }
      }
      setMyName(name)
      setMyId(id)
      const d = await loadNewJobData()
      setTemplates(d.templates)
      setClients(d.clients)
      setJobTypes(d.jobTypes)
      setSurveyors(d.surveyors)
      setFromCache(d.fromCache)
      setLoading(false)
      // Vessel datalist — online only; offline you just type (still linked on sync).
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const supabase = createClient()
          const { data: vsl } = await supabase.from('vessels').select('id, name').eq('is_active', true).order('name')
          if (vsl) setVessels(vsl as { id: string; name: string }[])
        } catch { /* offline / not permitted — datalist stays empty */ }
      }
    }
    load()
    return () => { window.removeEventListener('online', onStatus); window.removeEventListener('offline', onStatus) }
  }, [])

  // Smart default for "No report required" — report-only kinds (hatch/cargo/initial
  // draught) and templates with "requires report number" unticked pre-tick the box
  // (migration 136). Same rule and same drivers as the admin form; the surveyor can
  // still override it by hand until one of those drivers changes.
  useEffect(() => {
    setReportNotRequired(autoReportNotRequired({ jobType, jobStage, template: selectedTemplate }))
  }, [jobType, jobStage, templateId]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleTemplateChange(id: string) {
    setTemplateId(id)
    const tmpl = templates.find(t => t.id === id) ?? null
    setSelectedTemplate(tmpl)
    // A template's default job type (mig 131) fills the picker so routine jobs need
    // nothing set by hand. The qualifiers belong to the old type — clear them.
    if (tmpl?.default_job_type) {
      setJobStage('')
      setCargoType('')
      setJobType(tmpl.default_job_type)
    }
  }
  function handleJobTypeChange(val: string) {
    setJobStage('')
    setCargoType('')
    // "+ Add new job type…" reveals an inline name box; anything else is a real type.
    if (val === '__new__') { setShowNewJobType(true); setJobType('') }
    else { setShowNewJobType(false); setJobType(val) }
  }
  // Add a job type to the shared list (mig 150 lets staff INSERT). Online only —
  // it's a live write; the picker is hidden offline, so this can't be reached then.
  async function addNewJobType() {
    const name = newJobTypeName.trim()
    if (!name) return
    const res = await addJobType(name)
    if (res.error) { toast.error(res.error); return }
    const d = await loadNewJobData()
    setJobTypes(d.jobTypes)
    setJobType(name)
    setShowNewJobType(false)
    setNewJobTypeName('')
    toast.success(`Added job type “${name}”`)
  }
  function toggleCoSurveyor(id: string) {
    setCoSurveyors(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function handleClientChange(val: string) {
    if (val === '__new__') { setShowNewClient(true); setClientId('') }
    else { setShowNewClient(false); setNewClientName(''); setClientId(val) }
  }

  async function handleCreate() {
    // Job type is the primary field now (the template is optional — report-only
    // jobs like Draught Survey have no checklist). Enforced whenever the picker is
    // usable: with no cached job types the form falls back to the template's default
    // and must still create with no signal, so don't block that offline case.
    if (jobTypes.length > 0 && !jobType) return setError('Please choose a job type')
    if (jobTypes.length === 0 && !jobType) return setError('Please pick a template to set the job type')
    if (!vesselName.trim()) return setError('Vessel name is required')
    if (!scheduledDate) return setError('Please choose a survey date')
    if (endDate && endDate < scheduledDate) return setError('The end date can’t be before the start date')
    // On a single-day job, the end time must be after the start time.
    if (startTime && endTime && !endDate && endTime <= startTime) return setError('The end time must be after the start time')
    const finalSurveyor = myName.trim()
    if (!finalSurveyor) return setError('Could not read your name — reconnect once so your profile loads.')

    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) throw new Error('Your session has expired — please sign in again.')
      if (!offlineAvailable()) throw new Error('Local storage is unavailable on this device.')

      let finalClientId: string | null = clientId || null

      // "Request new" client/surveyor needs the network — only when online.
      if (online && showNewClient && newClientName.trim()) {
        await supabase.from('client_requests').insert({ requested_name: newClientName.trim(), requested_by: userId })
        fetch('/api/notify/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client_request', requestedName: newClientName.trim() }) }).catch(() => {})
        finalClientId = null
      }
      const id = crypto.randomUUID()
      // Start timestamp follows the chosen start time (noon when it's an all-day
      // booking), the same derivation the admin form uses — otherwise started_at
      // and start_time disagree and the double-booking check reads the wrong one.
      const startedAt = new Date(`${scheduledDate}T${startTime || '12:00'}:00`).toISOString()
      // Every key here is a jobs COLUMN (the two nested `template`/`client` objects
      // are the exception — UI-only, deliberately ignored by sync). Anything added
      // must also be mapped in sync.ts's create branch or it is silently dropped
      // when the draft reaches the server.
      const job = {
        id, title: autoTitle, template_id: templateId || null,
        template: selectedTemplate ? { id: templateId, name: selectedTemplate.name } : null,
        job_type: jobType || null,
        job_stage: jobStage || null,
        cargo_type: CARGO_JOB_TYPES.has(jobType) ? (cargoType.trim() || null) : null,
        vessel_name: titleCaseVesselName(vesselName), surveyor_name: finalSurveyor,
        client_id: finalClientId, client: finalClientId ? { name: clients.find(c => c.id === finalClientId)?.name ?? '' } : null,
        workflow_status: 'in_progress', created_by: userId, assigned_to: userId,
        started_at: startedAt, scheduled_date: scheduledDate, end_date: endDate || null,
        start_time: startTime || null, end_time: endTime || null,
        // is_overtime moves in lockstep with billing_mode — the jobs list OT badge,
        // filter and CSV all read is_overtime, not billing_mode.
        billing_mode: billingMode, is_overtime: billingMode === 'overtime',
        notes: notes.trim() || null, job_number: null,
        // Report-only kinds (e.g. hatch testing) skip the report number → N/A.
        // Carried on the draft; sync.ts passes it through to the server row.
        report_not_required: reportNotRequired,
      }

      // Create the job locally first (works with no signal). It syncs — creating
      // the server row + answers — when the device next reaches Supabase.
      await putDraft({
        key: '', jobId: id, userId, job, sections: selectedTemplate?.sections ?? [],
        // Extra co-surveyors (never the owner) — attached on sync via createDraftJob.
        surveyorIds: Array.from(coSurveyors).filter(sid => sid !== userId),
        values: {}, arrayValues: {}, signatures: {}, fieldPhotos: {}, generalPhotos: [],
        serverValues: {}, serverArrayValues: {}, serverSignatures: {},
        pendingSubmit: false, pendingCreate: true, dirty: true, needsSync: true,
        updatedAt: Date.now(), lastSyncedAt: null, syncError: null,
      })

      // If we have a connection, publish immediately so it appears on dashboards now.
      // syncDraft RETURNS its failures (RLS rejection, a dropped request) instead of
      // throwing, so say so — otherwise a job that never published looks like a clean
      // create. Either way the draft stays on the device and the manager retries.
      if (online) {
        try {
          const r = await syncDraft(supabase, id)
          if (!r.ok) toast.error(`${r.message} The job is saved on this device and will keep trying.`)
        } catch { /* manager retries */ }
      }

      router.push(`/surveyor/jobs/${id}`)
    } catch (err: any) {
      setError(err?.message ?? 'Could not start the checklist — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }
  // Only a dead end when there's NOTHING to create from — no checklist templates AND
  // no job types. With job types alone the surveyor can still start a report-only job.
  if (templates.length === 0 && jobTypes.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Nothing to Start Yet</h1>
        <p className="text-gray-500 mb-6">{fromCache ? 'No templates or job types are saved on this device yet. Connect to the internet once to download them.' : 'There are no templates or job types you can start. Contact your administrator.'}</p>
        <Link href="/surveyor" className="btn-secondary">Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveyor" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="text-gray-500 mt-0.5">Create a new survey checklist</p>
        </div>
      </div>

      {!online && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <WifiOff className="h-4 w-4 flex-shrink-0" />You&apos;re offline. The checklist will be saved on this device and sync automatically when you reconnect.
        </div>
      )}

      <div className="card p-6 space-y-5">
        {/* Job type leads now — it's the one required kind field. The checklist below
            is optional, so report-only jobs (Draught Survey, Hatch, Cargo…) start here. */}
        <div>
          <label className="label-base">Job type{jobTypes.length > 0 ? ' *' : ''}</label>
          {jobTypes.length > 0 ? (
            <select value={showNewJobType ? '__new__' : jobType} onChange={(e) => handleJobTypeChange(e.target.value)} className="input-base">
              <option value="">Select a job type…</option>
              {jobTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              {/* Adding a type is a live write — offer it only online. */}
              {online && <option value="__new__">+ Add new job type…</option>}
            </select>
          ) : (
            // Job types were never cached on this device — fall back to the template's
            // default rather than blocking the create (this must work with no signal).
            <div className="input-base bg-gray-50 text-gray-700 flex items-center">{jobType || 'Pick a template below to set this'}</div>
          )}
          {showNewJobType && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newJobTypeName}
                onChange={(e) => setNewJobTypeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewJobType() } }}
                className="input-base"
                placeholder="e.g. Tank Cleaning Survey"
                autoFocus
              />
              <button type="button" onClick={addNewJobType} className={`btn-secondary whitespace-nowrap ${TAP_BTN}`}>Add</button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">
            {jobTypes.length > 0
              ? 'Pick the kind of job. A checklist below is optional — leave it as “No checklist” for report-only jobs like a draught survey.'
              : 'Job types aren’t saved on this device yet. Connect once and they’ll be selectable here.'}
          </p>
        </div>

        {stageConfig && (
          <div>
            <label className="label-base">{stageConfig.label}</label>
            <select value={jobStage} onChange={(e) => setJobStage(e.target.value)} className="input-base">
              <option value="">{stageConfig.placeholder ?? `Select ${stageConfig.label.toLowerCase()}…`}</option>
              {stageConfig.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        {CARGO_JOB_TYPES.has(jobType) && (
          <div>
            <label className="label-base">Cargo type</label>
            <input type="text" list="cargoList" value={cargoType} onChange={(e) => setCargoType(e.target.value)} className="input-base" placeholder="e.g. Methanol, Crude Oil, Urea…" />
            <datalist id="cargoList">{CARGO_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
            <p className="text-xs text-gray-400 mt-1">The product being {jobType === 'Cargo Discharging' ? 'discharged' : 'loaded'}.</p>
          </div>
        )}

        {/* Optional checklist. Hidden when no templates are cached — there'd be nothing
            to pick. Leave it as “No checklist” for report-only jobs. */}
        {templates.length > 0 && (
          <div>
            <label className="label-base">Checklist template <span className="text-gray-400 font-normal">(optional)</span></label>
            <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className="input-base">
              <option value="">No checklist</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Adds a fillable checklist. Report-only jobs (e.g. a draught survey) don&apos;t need one.</p>
          </div>
        )}

        <div>
          <label className="label-base">Vessel Name *</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm font-medium pointer-events-none">M.V.</span>
            <input type="text" list="vesselList" value={vesselName} onChange={(e) => setVesselName(e.target.value)} className="input-base pl-12" placeholder="Atlantic Spirit" />
            <datalist id="vesselList">{vessels.map(v => <option key={v.id} value={v.name} />)}</datalist>
          </div>
          <p className="text-xs text-gray-400 mt-1">Pick an existing vessel or type a new one — it&apos;s linked to the Vessels directory automatically.</p>
        </div>

        {/* One field per row on a phone; two up from sm: — never a cramped grid at 360px. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label-base">Survey date *</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">Start date — sets the checklist name and the job&apos;s date. Defaults to today.</p>
          </div>
          <div>
            <label className="label-base">End date <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="date" value={endDate} min={scheduledDate} onChange={(e) => setEndDate(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">For multi-day jobs (e.g. a 7-day loadout). Leave blank for a single day.</p>
          </div>
          <div>
            <label className="label-base">Start time <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">Leave blank for an all-day booking.</p>
          </div>
          <div>
            <label className="label-base">End time <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">Used to spot overlapping surveyor bookings.</p>
          </div>
        </div>

        <div>
          <label className="label-base">How is this job billed?</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { mode: 'regular' as const, label: 'Regular hours', hint: 'Billable hours' },
              { mode: 'overtime' as const, label: 'Overtime', hint: 'Hours logged as OT' },
            ]).map(o => (
              <button
                key={o.mode}
                type="button"
                onClick={() => setBillingMode(o.mode)}
                className={`rounded-lg border px-3 py-3 sm:py-2.5 text-left transition-colors ${billingMode === o.mode ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <span className={`block text-sm font-medium ${billingMode === o.mode ? 'text-brand-800' : 'text-gray-700'}`}>{o.label}</span>
                <span className="block text-xs text-gray-400 mt-0.5">{o.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Fixed-price jobs are set by an admin. You can change this on the job later while it&apos;s open.</p>
        </div>

        {autoTitle && (
          <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3">
            <p className="text-xs font-medium text-brand-700 mb-0.5">Checklist name</p>
            <p className="text-sm text-brand-900 font-medium">{autoTitle}</p>
          </div>
        )}

        <div>
          <label className="label-base">Client</label>
          <select value={showNewClient ? '__new__' : clientId} onChange={(e) => handleClientChange(e.target.value)} className="input-base">
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            {online && <option value="__new__">+ Request new client…</option>}
          </select>
          {showNewClient && (
            <div className="mt-2">
              <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className="input-base" placeholder="Enter new client name…" />
              <p className="text-xs text-amber-600 mt-1">This will be submitted for admin approval.</p>
            </div>
          )}
        </div>

        <div>
          <label className="label-base">Surveyor</label>
          <div className="input-base bg-gray-50 text-gray-700 flex items-center">{myName || 'Your account'}</div>
          <p className="text-xs text-gray-400 mt-1">This job is created under your account.</p>
        </div>

        {/* Co-surveyors: anyone else who worked this job with you. Cached offline, so
            the list shows with no signal; empty until the device has been online once. */}
        {surveyors.filter(s => s.id !== myId).length > 0 && (
          <div>
            <label className="label-base">Other surveyors <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {surveyors.filter(s => s.id !== myId).map(s => (
                <label key={s.id} className="flex items-center gap-3 px-3 py-3 sm:py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={coSurveyors.has(s.id)} onChange={() => toggleCoSurveyor(s.id)} className="h-5 w-5 sm:h-4 sm:w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-gray-800">{s.full_name}</span>
                  {s.display_title && <span className="text-xs text-gray-400">{s.display_title}</span>}
                  {s.role === 'admin' && <span className="text-xs text-gray-400">admin</span>}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Tick anyone else on this job — it&apos;ll show on their dashboard too. You can change this on the job later.</p>
          </div>
        )}

        <div>
          <label className="label-base">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-base resize-y" placeholder="e.g. call number, special instructions…" />
        </div>

        {/* py-2 + the bigger phone-sized box keep this a ~44px tap target. */}
        <label className="flex items-start gap-3 py-2 cursor-pointer">
          <input type="checkbox" checked={reportNotRequired} onChange={(e) => setReportNotRequired(e.target.checked)} className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
          <span className="text-sm text-gray-700">No report required <span className="text-gray-400">— skips the report number (shows N/A on the jobs list)</span></span>
        </label>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      </div>

      {/* .btn-* is 36px; the ~44px phone size matches the rest of the field flow. */}
      <div className="flex justify-end gap-3">
        <Link href="/surveyor" className={`btn-secondary ${TAP_BTN}`}>Cancel</Link>
        <button onClick={handleCreate} disabled={saving} className={`btn-primary ${TAP_BTN}`}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Starting…' : 'Start Checklist'}
        </button>
      </div>
    </div>
  )
}
