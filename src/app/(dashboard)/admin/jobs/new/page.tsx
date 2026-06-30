'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { toast } from '@/components/ui/toast'
import { listJobTypes, addJobType, listSurveyorAccounts, logActivity, type SurveyorAccount } from '@/lib/jobs/tracker'
import { findOrCreateVessel } from '@/lib/vessels/api'
import { titleCaseVesselName } from '@/lib/utils'
import type { ChecklistTemplate, Client, JobType } from '@/lib/types/database'

// Local yyyy-mm-dd (for the <input type=date> default — avoids the UTC off-by-one
// that toISOString() causes around midnight in Trinidad, UTC-4).
function isoDateLocal(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}
function dmyFromISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// Conditional Stage picker: the broad survey types carry a qualifier (jobs.job_stage).
// Other types show no picker.
const STAGE_OPTIONS: Record<string, { label: string; options: string[] }> = {
  'Draught Survey': { label: 'Stage', options: ['Initial', 'Interim', 'Final'] },
  'Cargo Survey': { label: 'Direction', options: ['Loaded', 'Discharge'] },
  'Hire Survey': { label: 'Status', options: ['On-hire', 'Off-hire'] },
}

// Cargo Loading / Cargo Discharging jobs carry a "what's the cargo?" question.
const CARGO_JOB_TYPES = new Set(['Cargo Loading', 'Cargo Discharging'])
// Common cargoes — a datalist of suggestions; the field stays free text.
const CARGO_SUGGESTIONS = ['Methanol', 'Crude Oil', 'Gasoil / Diesel', 'Gasoline', 'Jet A-1 / Kerosene', 'Fuel Oil', 'LPG', 'Anhydrous Ammonia', 'Urea', 'DRI', 'Iron Ore', 'Coal']

export default function NewJobPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [jobTypes, setJobTypes] = useState<JobType[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [surveyors, setSurveyors] = useState<SurveyorAccount[]>([])
  const [vessels, setVessels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [jobType, setJobType] = useState('')
  const [showNewJobType, setShowNewJobType] = useState(false)
  const [newJobTypeName, setNewJobTypeName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [vesselName, setVesselName] = useState('')
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [billingMode, setBillingMode] = useState<'overtime' | 'regular' | 'fixed'>('regular')
  const [scheduledDate, setScheduledDate] = useState(isoDateLocal(new Date()))
  const [endDate, setEndDate] = useState('')
  const [jobStage, setJobStage] = useState('')
  const [cargoType, setCargoType] = useState('')
  const [notes, setNotes] = useState('')

  const selectedTemplate = templates.find(t => t.id === templateId) ?? null
  const label = selectedTemplate?.name ?? jobType
  const stageConfig = STAGE_OPTIONS[jobType] ?? null
  const labelWithStage = label && jobStage ? `${label} (${jobStage})` : label
  const autoTitle = vesselName.trim() && label ? `M.V. ${titleCaseVesselName(vesselName)} - ${labelWithStage} - ${dmyFromISO(scheduledDate)}` : ''

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const [{ data: tmpl }, { data: cls }, { data: vsl }, jt, srv] = await Promise.all([
        supabase.from('checklist_templates').select('*').eq('status', 'active').order('name'),
        supabase.from('clients').select('*').eq('is_active', true).order('name'),
        supabase.from('vessels').select('id, name').eq('is_active', true).order('name'),
        listJobTypes(),
        listSurveyorAccounts(),
      ])
      setTemplates(tmpl ?? [])
      setClients(cls ?? [])
      setVessels((vsl ?? []) as { id: string; name: string }[])
      setJobTypes(jt)
      setSurveyors(srv)
      setLoading(false)
    }
    loadData()
  }, [])

  function togglePicked(id: string) { setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function addNewJobType() {
    const name = newJobTypeName.trim()
    if (!name) return
    const res = await addJobType(name)
    if (res.error) { toast.error(res.error); return }
    setJobTypes(await listJobTypes())
    setJobType(name)
    setShowNewJobType(false)
    setNewJobTypeName('')
    toast.success(`Added job type “${name}”`)
  }

  async function handleSave() {
    if (!jobType) { setError('Please choose a job type'); return }
    if (!vesselName.trim()) { setError('Vessel name is required'); return }
    if (!scheduledDate) { setError('Please choose a survey date'); return }
    if (endDate && endDate < scheduledDate) { setError('The end date can’t be before the start date'); return }
    setSaving(true); setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setSaving(false); return }

    let finalClientId = clientId || null
    if (showNewClient && newClientName.trim()) {
      const { error: reqErr } = await supabase.from('client_requests').insert({ requested_name: newClientName.trim(), requested_by: user.id })
      if (reqErr) { setError('Failed to submit client request: ' + reqErr.message); setSaving(false); return }
      finalClientId = null
    }

    const ids = Array.from(picked)
    const primary = surveyors.find(s => s.id === ids[0])
    const vessel = titleCaseVesselName(vesselName)
    const title = autoTitle || `M.V. ${vessel} - ${labelWithStage} - ${dmyFromISO(scheduledDate)}`

    // Link to the vessels directory (create on first use), keeping vessel_name as snapshot.
    const vesselId = await findOrCreateVessel(vessel)

    const { data: job, error: jobErr } = await supabase.from('jobs').insert({
      title,
      template_id: templateId || null,
      job_type: jobType,
      vessel_name: vessel,
      vessel_id: vesselId,
      surveyor_name: primary?.full_name ?? null,
      client_id: finalClientId,
      created_by: user.id,
      assigned_to: primary?.id ?? null,
      workflow_status: ids.length ? 'assigned' : 'new',
      billing_mode: billingMode,
      is_overtime: billingMode === 'overtime',
      notes: notes.trim() || null,
      job_stage: jobStage || null,
      cargo_type: CARGO_JOB_TYPES.has(jobType) ? (cargoType.trim() || null) : null,
      scheduled_date: scheduledDate,
      end_date: endDate || null,
      started_at: new Date(`${scheduledDate}T12:00:00`).toISOString(),
    }).select().single()

    if (jobErr || !job) { setError(jobErr?.message ?? 'Failed to create job'); setSaving(false); return }

    if (ids.length) {
      await supabase.from('job_surveyors').insert(ids.map(id => ({ job_id: job.id, surveyor_id: id, created_by: user.id })))
    }
    if (finalClientId) {
      await supabase.from('client_job_permissions').insert({ client_id: finalClientId, job_id: job.id, can_view_status: true, can_view_pdf: false, can_view_checklist_details: false })
    }
    await logActivity('job', job.id, 'created', { report_number: job.report_number })

    toast.success(`Job created — ${job.report_number ?? job.title}`)
    router.push(`/admin/jobs/${job.id}`)
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-rise">
      <div className="flex items-center gap-4">
        <Link href="/admin/jobs" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="text-gray-500 mt-0.5">A report number is assigned automatically.</p>
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label className="label-base">Job type *</label>
          <select
            value={showNewJobType ? '__new__' : jobType}
            onChange={e => { setJobStage(''); setCargoType(''); if (e.target.value === '__new__') { setShowNewJobType(true); setJobType('') } else { setShowNewJobType(false); setJobType(e.target.value) } }}
            className="input-base"
          >
            <option value="">Select a job type…</option>
            {jobTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            <option value="__new__">+ Add new job type…</option>
          </select>
          {showNewJobType && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={newJobTypeName}
                onChange={e => setNewJobTypeName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewJobType() } }}
                className="input-base"
                placeholder="e.g. Borescope Survey"
                autoFocus
              />
              <button type="button" onClick={addNewJobType} className="btn-secondary whitespace-nowrap">Add</button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">Add one here, or manage all job types in <Link href="/admin/settings" className="underline hover:text-gray-600">Settings</Link>.</p>
        </div>

        {stageConfig && (
          <div>
            <label className="label-base">{stageConfig.label}</label>
            <select value={jobStage} onChange={e => setJobStage(e.target.value)} className="input-base">
              <option value="">Select {stageConfig.label.toLowerCase()}…</option>
              {stageConfig.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}

        {CARGO_JOB_TYPES.has(jobType) && (
          <div>
            <label className="label-base">Cargo type</label>
            <input type="text" list="cargoList" value={cargoType} onChange={e => setCargoType(e.target.value)} className="input-base" placeholder="e.g. Methanol, Crude Oil, Urea…" />
            <datalist id="cargoList">{CARGO_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
            <p className="text-xs text-gray-400 mt-1">The product being {jobType === 'Cargo Discharging' ? 'discharged' : 'loaded'}.</p>
          </div>
        )}

        <div>
          <label className="label-base">Checklist template <span className="text-gray-400 font-normal">(optional — leave empty for a report-only job)</span></label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input-base">
            <option value="">No checklist (report only)</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label-base">Vessel name *</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm font-medium pointer-events-none">M.V.</span>
            <input type="text" list="vesselList" value={vesselName} onChange={e => setVesselName(e.target.value)} className="input-base pl-12" placeholder="Atlantic Spirit" />
            <datalist id="vesselList">{vessels.map(v => <option key={v.id} value={v.name} />)}</datalist>
          </div>
          <p className="text-xs text-gray-400 mt-1">Pick an existing vessel or type a new one — it&apos;s added to the Vessels directory and linked automatically.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label-base">Survey date *</label>
            <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">Start date — drives the job name, report date and start. Defaults to today.</p>
          </div>
          <div>
            <label className="label-base">End date <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="date" value={endDate} min={scheduledDate} onChange={e => setEndDate(e.target.value)} className="input-base" />
            <p className="text-xs text-gray-400 mt-1">For multi-day jobs (e.g. a 7-day loadout). Leave blank for a single day.</p>
          </div>
        </div>

        <div>
          <label className="label-base">How is this job billed?</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { mode: 'regular' as const, label: 'Regular hours', hint: 'Billable hours' },
              { mode: 'overtime' as const, label: 'Overtime', hint: 'Hours logged as OT' },
              { mode: 'fixed' as const, label: 'Fixed', hint: 'Flat fee, no hours' },
            ]).map(o => (
              <button
                key={o.mode}
                type="button"
                onClick={() => setBillingMode(o.mode)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${billingMode === o.mode ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <span className={`block text-sm font-medium ${billingMode === o.mode ? 'text-brand-800' : 'text-gray-700'}`}>{o.label}</span>
                <span className="block text-xs text-gray-400 mt-0.5">{o.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Overtime and Regular show the matching hours boxes per surveyor; Fixed shows none. You can change this on the job later.</p>
        </div>

        {autoTitle && (
          <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3">
            <p className="text-xs font-medium text-brand-700 mb-0.5">Job name</p>
            <p className="text-sm text-brand-900 font-medium">{autoTitle}</p>
          </div>
        )}

        <div>
          <label className="label-base">Client</label>
          <select value={showNewClient ? '__new__' : clientId} onChange={e => { if (e.target.value === '__new__') { setShowNewClient(true); setClientId('') } else { setShowNewClient(false); setNewClientName(''); setClientId(e.target.value) } }} className="input-base">
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__new__">+ Request new client…</option>
          </select>
          {showNewClient && (
            <div className="mt-2">
              <input type="text" value={newClientName} onChange={e => setNewClientName(e.target.value)} className="input-base" placeholder="Enter new client name…" />
              <p className="text-xs text-amber-600 mt-1">Submitted for admin approval before being added permanently.</p>
            </div>
          )}
        </div>

        <div>
          <label className="label-base">Surveyor(s)</label>
          {surveyors.length === 0 ? (
            <p className="text-xs text-amber-600">No surveyor accounts yet. <Link href="/admin/users" className="underline">Approve a surveyor first.</Link></p>
          ) : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {surveyors.map(s => (
                <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePicked(s.id)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <span className="text-gray-800">{s.full_name}</span>
                  {s.display_title && <span className="text-xs text-gray-400">{s.display_title}</span>}
                  {s.role === 'admin' && <span className="text-xs text-gray-400">admin</span>}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-1">You can assign more, or change them, on the job afterwards.</p>
        </div>

        <div>
          <label className="label-base">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base resize-y" placeholder="e.g. call number, gang count, special instructions…" />
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 animate-rise">{error}</div>}

      <div className="flex items-center justify-end gap-3 pb-6">
        <Link href="/admin/jobs" className="btn-secondary">Cancel</Link>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Creating…' : 'Create Job'}
        </button>
      </div>
    </div>
  )
}
