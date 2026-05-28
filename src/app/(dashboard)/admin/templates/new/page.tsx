'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TemplateBuilder from '@/components/template-builder/TemplateBuilder'
import type { BuilderSection } from '@/components/template-builder/types'
import { Save, ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import type { TemplateStatus } from '@/lib/types/database'

export default function NewTemplatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const duplicateFrom = searchParams.get('duplicate')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TemplateStatus>('draft')
  const [allowSurveyorStart, setAllowSurveyorStart] = useState(false)
  const [sections, setSections] = useState<BuilderSection[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!duplicateFrom)

  useEffect(() => {
    if (!duplicateFrom) return
    async function loadTemplate() {
      const supabase = createClient()
      const { data: tmpl } = await supabase
        .from('checklist_templates')
        .select('*, sections:template_sections(*, fields:template_fields(*))')
        .eq('id', duplicateFrom)
        .single()

      if (tmpl) {
        setName(`${tmpl.name} (Copy)`)
        setDescription(tmpl.description ?? '')
        const builtSections: BuilderSection[] = (tmpl.sections ?? [])
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((s: any) => ({
            id: crypto.randomUUID(),
            title: s.title,
            description: s.description ?? '',
            order_index: s.order_index,
            conditional_logic: s.conditional_logic,
            fields: (s.fields ?? [])
              .sort((a: any, b: any) => a.order_index - b.order_index)
              .map((f: any) => ({
                id: crypto.randomUUID(),
                label: f.label,
                field_type: f.field_type,
                order_index: f.order_index,
                is_required: f.is_required,
                options: f.options ?? [],
                validation: f.validation ?? {},
                calculation_formula: f.calculation_formula ?? '',
                conditional_logic: f.conditional_logic,
                placeholder: f.placeholder ?? '',
                help_text: f.help_text ?? '',
                unit: f.unit ?? '',
                default_value: f.default_value ?? '',
              })),
          }))
        setSections(builtSections)
      }
      setLoading(false)
    }
    loadTemplate()
  }, [duplicateFrom])

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setSaving(false); return }

    const { data: template, error: tmplErr } = await supabase
      .from('checklist_templates')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        status,
        allow_surveyor_start: allowSurveyorStart,
        created_by: user.id,
        duplicated_from: duplicateFrom || null,
      })
      .select()
      .single()

    if (tmplErr || !template) {
      setError(tmplErr?.message ?? 'Failed to create template')
      setSaving(false)
      return
    }

    // Insert sections and fields
    for (const section of sections) {
      const { data: sec, error: secErr } = await supabase
        .from('template_sections')
        .insert({
          template_id: template.id,
          title: section.title,
          description: section.description || null,
          order_index: section.order_index,
          conditional_logic: section.conditional_logic,
        })
        .select()
        .single()

      if (secErr || !sec) continue

      // Insert fields with the NEW section id so references are correct
      const fieldIdMap: Record<string, string> = {}
      for (const field of section.fields) {
        const { data: f } = await supabase
          .from('template_fields')
          .insert({
            template_id: template.id,
            section_id: sec.id,
            label: field.label,
            field_type: field.field_type,
            order_index: field.order_index,
            is_required: field.is_required,
            options: field.options.length ? field.options : null,
            validation: Object.keys(field.validation).length ? field.validation : null,
            calculation_formula: field.calculation_formula || null,
            conditional_logic: field.conditional_logic,
            placeholder: field.placeholder || null,
            help_text: field.help_text || null,
            unit: field.unit || null,
            default_value: field.default_value || null,
          })
          .select()
          .single()

        if (f) fieldIdMap[field.id] = f.id
      }
    }

    router.push('/admin/templates')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates" className="btn-ghost py-2 px-3">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="page-title">{duplicateFrom ? 'Duplicate Template' : 'New Template'}</h1>
          <p className="text-gray-500 mt-0.5">Design the checklist structure</p>
        </div>
      </div>

      {/* Template metadata */}
      <div className="card p-6 space-y-4">
        <h2 className="section-title">Template Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label-base">Template Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-base"
              placeholder="e.g. Marine Survey Checklist"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-base resize-none"
              rows={2}
              placeholder="Brief description of this template's purpose"
            />
          </div>
          <div>
            <label className="label-base">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TemplateStatus)} className="input-base">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setAllowSurveyorStart(!allowSurveyorStart)}
                className={`relative w-10 h-6 rounded-full transition-colors ${allowSurveyorStart ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${allowSurveyorStart ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Allow surveyors to start new jobs from this template</span>
            </label>
          </div>
        </div>
      </div>

      {/* Template builder */}
      <div className="space-y-3">
        <h2 className="section-title px-1">Template Fields</h2>
        <TemplateBuilder sections={sections} onChange={setSections} />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Save actions */}
      <div className="flex items-center justify-end gap-3 pb-6">
        <Link href="/admin/templates" className="btn-secondary">
          Cancel
        </Link>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>
    </div>
  )
}
