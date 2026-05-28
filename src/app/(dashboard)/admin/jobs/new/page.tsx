'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save, Plus } from 'lucide-react'
import Link from 'next/link'
import type { ChecklistTemplate, Client, SurveyorName } from '@/lib/types/database'

function formatDateDMY(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const y = date.getFullYear()
  return `${d}-${m}-${y}`
}

export default function NewChecklistPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [surveyorNames, setSurveyorNames] = useState<SurveyorName[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<ChecklistTemplate | null>(null)
  const [vesselName, setVesselName] = useState('')
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)
  const [surveyorName, setSurveyorName] = useState('')
  const [newSurveyorName, setNewSurveyorName] = useState('')
  const [showNewSurveyor, setShowNewSurveyor] = useState(false)

  const today = formatDateDMY(new Date())

  const autoTitle = vesselName.trim() && selectedTemplate
    ? `M.V. ${vesselName.trim()} - ${selectedTemplate.name} - ${today}`
    : ''

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const [{ data: tmpl }, { data: cls }, { data: srv }] = await Promise.all([
        supabase.from('checklist_templates').select('*').eq('status', 'active').order('name'),
        supabase.from('clients').select('*').eq('is_active', true).order('name'),
        supabase.from('surveyor_names').select('*').eq('is_active', true).order('name'),
      ])
      setTemplates(tmpl ?? [])
      setClients(cls ?? [])
      setSurveyorNames(srv ?? [])
      setLoading(false)
    }
    loadData()
  }, [])

  function handleTemplateChange(id: string) {
    setTemplateId(id)
    setSelectedTemplate(templates.find(t => t.id === id) ?? null)
  }

  function handleSurveyorChange(val: string) {
    if (val === '__new__') {
      setShowNewSurveyor(true)
      setSurveyorName('')
    } else {
      setShowNewSurveyor(false)
      setNewSurveyorName('')
      setSurveyorName(val)
    }
  }

  function handleClientChange(val: string) {
    if (val === '__new__') {
      setShowNewClient(true)
      setClientId('')
    } else {
      setShowNewClient(false)
      setNewClientName('')
      setClientId(val)
    }
  }

  async function handleSave() {
    if (!templateId) { setError('Please select a checklist template'); return }
    if (!vesselName.trim()) { setError('Vessel name is required'); return }

    const finalSurveyor = showNewSurveyor ? newSurveyorName.trim() : surveyorName
    if (!finalSurveyor) { setError('Surveyor name is required'); return }

    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setSaving(false); return }

    let finalClientId = clientId || null

    // Handle new client request
    if (showNewClient && newClientName.trim()) {
      const { error: reqErr } = await supabase.from('client_requests').insert({
        requested_name: newClientName.trim(),
        requested_by: user.id,
      })
      if (reqErr) { setError('Failed to submit client request: ' + reqErr.message); setSaving(false); return }
      finalClientId = null // No client ID yet — pending approval
    }

    // Handle new surveyor name request
    if (showNewSurveyor && newSurveyorName.trim()) {
      await supabase.from('surveyor_name_requests').insert({
        requested_name: newSurveyorName.trim(),
        requested_by: user.id,
      })
    }

    const title = autoTitle || `M.V. ${vesselName.trim()} - ${selectedTemplate?.name ?? ''} - ${today}`

    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert({
        title,
        template_id: templateId,
        vessel_name: vesselName.trim(),
        surveyor_name: finalSurveyor,
        client_id: finalClientId,
        created_by: user.id,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (jobErr || !job) {
      setError(jobErr?.message ?? 'Failed to create checklist')
      setSaving(false)
      return
    }

    if (finalClientId && job.id) {
      await supabase.from('client_job_permissions').insert({
        client_id: finalClientId,
        job_id: job.id,
        can_view_status: true,
        can_view_pdf: false,
        can_view_checklist_details: false,
      })
    }

    router.push(`/admin/jobs/${job.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/jobs" className="btn-ghost py-2 px-3">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="page-title">New Checklist</h1>
          <p className="text-gray-500 mt-0.5">Create a new survey checklist</p>
        </div>
      </div>

      <div className="card p-6 space-y-5">
        {/* Template */}
        <div>
          <label className="label-base">Checklist Template *</label>
          <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className="input-base">
            <option value="">Select a template…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No active templates. <Link href="/admin/templates/new" className="underline">Create one first.</Link></p>
          )}
        </div>

        {/* Vessel name */}
        <div>
          <label className="label-base">Vessel Name *</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm font-medium pointer-events-none">M.V.</span>
            <input
              type="text"
              value={vesselName}
              onChange={(e) => setVesselName(e.target.value)}
              className="input-base pl-12"
              placeholder="Atlantic Spirit"
            />
          </div>
        </div>

        {/* Auto-generated title preview */}
        {autoTitle && (
          <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3">
            <p className="text-xs font-medium text-brand-700 mb-0.5">Checklist name (auto-generated)</p>
            <p className="text-sm text-brand-900 font-medium">{autoTitle}</p>
          </div>
        )}

        {/* Client */}
        <div>
          <label className="label-base">Client</label>
          <select
            value={showNewClient ? '__new__' : clientId}
            onChange={(e) => handleClientChange(e.target.value)}
            className="input-base"
          >
            <option value="">No client</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="__new__">+ Request new client…</option>
          </select>
          {showNewClient && (
            <div className="mt-2">
              <input
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="input-base"
                placeholder="Enter new client name…"
              />
              <p className="text-xs text-amber-600 mt-1">This name will be submitted for Admin approval before being added permanently.</p>
            </div>
          )}
        </div>

        {/* Surveyor name */}
        <div>
          <label className="label-base">Surveyor Name *</label>
          <select
            value={showNewSurveyor ? '__new__' : surveyorName}
            onChange={(e) => handleSurveyorChange(e.target.value)}
            className="input-base"
          >
            <option value="">Select surveyor…</option>
            {surveyorNames.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
            <option value="__new__">Request New - Insert Name</option>
          </select>
          {showNewSurveyor && (
            <div className="mt-2">
              <input
                type="text"
                value={newSurveyorName}
                onChange={(e) => setNewSurveyorName(e.target.value)}
                className="input-base"
                placeholder="Enter full name…"
              />
              <p className="text-xs text-amber-600 mt-1">This name will be submitted for Admin approval before being permanently added.</p>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center justify-end gap-3 pb-6">
        <Link href="/admin/jobs" className="btn-secondary">Cancel</Link>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Creating…' : 'Create Checklist'}
        </button>
      </div>
    </div>
  )
}
