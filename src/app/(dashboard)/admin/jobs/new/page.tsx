'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import type { ChecklistTemplate, Client, Profile, JobStatus } from '@/lib/types/database'

export default function NewJobPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [surveyors, setSurveyors] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '',
    template_id: '',
    client_id: '',
    assigned_to: '',
    status: 'draft' as JobStatus,
    scheduled_date: '',
    internal_notes: '',
  })

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()
      const [{ data: tmpl }, { data: cls }, { data: srv }] = await Promise.all([
        supabase.from('checklist_templates').select('*').eq('status', 'active').order('name'),
        supabase.from('clients').select('*').eq('is_active', true).order('name'),
        supabase.from('profiles').select('*').eq('role', 'surveyor').eq('is_active', true).order('full_name'),
      ])
      setTemplates(tmpl ?? [])
      setClients(cls ?? [])
      setSurveyors(srv ?? [])
      setLoading(false)
    }
    loadData()
  }, [])

  function update(patch: Partial<typeof form>) {
    setForm(prev => ({ ...prev, ...patch }))
  }

  async function handleSave() {
    if (!form.title.trim()) { setError('Job title is required'); return }
    if (!form.template_id) { setError('Please select a template'); return }
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setSaving(false); return }

    const payload: any = {
      title: form.title.trim(),
      template_id: form.template_id,
      created_by: user.id,
      status: form.assigned_to ? 'assigned' : 'draft',
    }
    if (form.client_id) payload.client_id = form.client_id
    if (form.assigned_to) payload.assigned_to = form.assigned_to
    if (form.scheduled_date) payload.scheduled_date = form.scheduled_date
    if (form.internal_notes.trim()) payload.internal_notes = form.internal_notes.trim()

    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .insert(payload)
      .select()
      .single()

    if (jobErr || !job) {
      setError(jobErr?.message ?? 'Failed to create job')
      setSaving(false)
      return
    }

    // If client assigned, create default permission
    if (form.client_id && job.id) {
      await supabase.from('client_job_permissions').insert({
        client_id: form.client_id,
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
          <h1 className="page-title">New Job</h1>
          <p className="text-gray-500 mt-0.5">Create a new survey job</p>
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <label className="label-base">Job Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            className="input-base"
            placeholder="e.g. Draft Survey – MV Endeavour"
          />
        </div>

        <div>
          <label className="label-base">Checklist Template *</label>
          <select value={form.template_id} onChange={(e) => update({ template_id: e.target.value })} className="input-base">
            <option value="">Select a template…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">No active templates. <Link href="/admin/templates/new" className="underline">Create one first.</Link></p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label-base">Client</label>
            <select value={form.client_id} onChange={(e) => update({ client_id: e.target.value })} className="input-base">
              <option value="">No client</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-base">Assign to Surveyor</label>
            <select value={form.assigned_to} onChange={(e) => update({ assigned_to: e.target.value })} className="input-base">
              <option value="">Unassigned</option>
              {surveyors.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label-base">Scheduled Date</label>
          <input
            type="date"
            value={form.scheduled_date}
            onChange={(e) => update({ scheduled_date: e.target.value })}
            className="input-base"
          />
        </div>

        <div>
          <label className="label-base">Internal Notes</label>
          <textarea
            value={form.internal_notes}
            onChange={(e) => update({ internal_notes: e.target.value })}
            className="input-base resize-none"
            rows={3}
            placeholder="Internal notes (not visible to clients or surveyors)"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

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
