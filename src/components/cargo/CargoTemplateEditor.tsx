'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { type ReadingType, defaultReadingTypes, normalizeReadingTypes, HOLD_COUNT_OPTIONS, DEFAULT_HOLD_COUNT } from '@/lib/cargo/types'
import ReadingTypeManager from '@/components/cargo/ReadingTypeManager'

type Status = 'draft' | 'active' | 'archived'

interface Props {
  /** When set, edits an existing template; otherwise creates one. */
  templateId?: string
}

export default function CargoTemplateEditor({ templateId }: Props) {
  const router = useRouter()
  const isEdit = !!templateId

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('active')
  const [defaultHoldCount, setDefaultHoldCount] = useState<number>(DEFAULT_HOLD_COUNT)
  const [readingTypes, setReadingTypes] = useState<ReadingType[]>(defaultReadingTypes())

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!templateId) return
    let active = true
    async function load() {
      const supabase = createClient()
      const { data, error } = await supabase.from('cargo_templates').select('*').eq('id', templateId).single()
      if (!active) return
      if (error || !data) { setError(error?.message ?? 'Template not found'); setLoading(false); return }
      setName(data.name ?? '')
      setDescription(data.description ?? '')
      setStatus((data.status as Status) ?? 'active')
      setDefaultHoldCount(data.default_hold_count ?? DEFAULT_HOLD_COUNT)
      setReadingTypes(Array.isArray(data.reading_types) && data.reading_types.length ? normalizeReadingTypes(data.reading_types) : defaultReadingTypes())
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [templateId])

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }
    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        status,
        default_hold_count: defaultHoldCount,
        reading_types: readingTypes,
      }

      if (isEdit) {
        const { error } = await supabase.from('cargo_templates').update(payload).eq('id', templateId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('cargo_templates').insert({ ...payload, created_by: user.id })
        if (error) throw error
      }
      router.push('/admin/templates')
    } catch (err: any) {
      setError(err?.message ?? 'Could not save the template.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex-1">
          <h1 className="page-title">{isEdit ? 'Edit Cargo Template' : 'New Cargo Template'}</h1>
          <p className="text-gray-500 mt-0.5">Define the reading types and default hold count for cargo monitoring voyages.</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="section-title">Template Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label-base">Template Name *</label>
            <input className="input-base" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Coal Cargo Monitoring" />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Description</label>
            <textarea className="input-base resize-none" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="When to use this template" />
          </div>
          <div>
            <label className="label-base">Default Number of Holds</label>
            <select className="input-base" value={defaultHoldCount} onChange={e => setDefaultHoldCount(Number(e.target.value))}>
              {HOLD_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n} Hold{n > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label-base">Status</label>
            <select className="input-base" value={status} onChange={e => setStatus(e.target.value as Status)}>
              <option value="active">Active (available to surveyors)</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h2 className="section-title mb-2">Reading Types</h2>
        <ReadingTypeManager readingTypes={readingTypes} holdCount={defaultHoldCount} onChange={setReadingTypes} />
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex justify-end gap-3 pb-6">
        <Link href="/admin/templates" className="btn-secondary">Cancel</Link>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>
    </div>
  )
}
