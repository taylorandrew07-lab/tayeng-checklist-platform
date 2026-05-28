'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import type { ChecklistTemplate } from '@/lib/types/database'

export default function SurveyorNewJobPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', template_id: '', scheduled_date: '' })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('checklist_templates')
        .select('*')
        .eq('status', 'active')
        .eq('allow_surveyor_start', true)
        .order('name')
      setTemplates(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function handleCreate() {
    if (!form.title.trim()) { setError('Job title required'); return }
    if (!form.template_id) { setError('Please select a template'); return }
    setSaving(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { data: job, error: err } = await supabase.from('jobs').insert({
      title: form.title.trim(),
      template_id: form.template_id,
      assigned_to: user.id,
      created_by: user.id,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      scheduled_date: form.scheduled_date || null,
    }).select().single()

    if (err || !job) { setError(err?.message ?? 'Failed to create job'); setSaving(false); return }
    router.push(`/surveyor/jobs/${job.id}`)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }

  if (templates.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">No Templates Available</h1>
        <p className="text-gray-500 mb-6">There are no approved templates available for you to start a new job. Contact your administrator.</p>
        <Link href="/surveyor" className="btn-secondary">Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveyor" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="page-title">Start New Job</h1>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <label className="label-base">Job Title *</label>
          <input type="text" value={form.title} onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))} className="input-base" placeholder="e.g. Draught Survey – MV Aurora" />
        </div>
        <div>
          <label className="label-base">Template *</label>
          <select value={form.template_id} onChange={(e) => setForm(p => ({ ...p, template_id: e.target.value }))} className="input-base">
            <option value="">Select template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Date</label>
          <input type="date" value={form.scheduled_date} onChange={(e) => setForm(p => ({ ...p, scheduled_date: e.target.value }))} className="input-base" />
        </div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="flex justify-end gap-3">
        <Link href="/surveyor" className="btn-secondary">Cancel</Link>
        <button onClick={handleCreate} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Creating…' : 'Start Job'}
        </button>
      </div>
    </div>
  )
}
