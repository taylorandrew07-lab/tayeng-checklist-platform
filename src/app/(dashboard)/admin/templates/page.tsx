'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, FileText, Copy, Edit, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-700',
  archived: 'bg-red-100 text-red-700',
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const { data } = await supabase
      .from('checklist_templates')
      .select('*, creator:profiles!checklist_templates_created_by_fkey(full_name)')
      .order('created_at', { ascending: false })
    setTemplates(data ?? [])
    setLoading(false)
  }

  async function handleCopy(template: any) {
    if (!confirm(`Copy "${template.name}"? A duplicate will be created as a draft.`)) return

    setCopying(template.id)
    const supabase = createClient()

    // Get session for created_by
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user.id

    // Create new template
    const { data: newTemplate, error: tErr } = await supabase
      .from('checklist_templates')
      .insert({
        name: `Copy of ${template.name}`,
        description: template.description,
        status: 'draft',
        version: 1,
        allow_surveyor_start: template.allow_surveyor_start,
        created_by: userId,
      })
      .select()
      .single()

    if (tErr || !newTemplate) { alert('Copy failed: ' + tErr?.message); setCopying(null); return }

    // Copy sections and fields
    const { data: sections } = await supabase
      .from('template_sections')
      .select('*, fields:template_fields(*)')
      .eq('template_id', template.id)
      .order('order_index')

    for (const section of sections ?? []) {
      const { data: newSection } = await supabase
        .from('template_sections')
        .insert({
          template_id: newTemplate.id,
          title: section.title,
          description: section.description,
          order_index: section.order_index,
          conditional_logic: section.conditional_logic,
        })
        .select()
        .single()

      if (newSection && section.fields?.length) {
        await supabase.from('template_fields').insert(
          section.fields.map((f: any) => ({
            section_id: newSection.id,
            label: f.label,
            field_type: f.field_type,
            is_required: f.is_required,
            order_index: f.order_index,
            options: f.options,
            unit: f.unit,
            help_text: f.help_text,
            conditional_logic: f.conditional_logic,
            calculation_formula: f.calculation_formula,
          }))
        )
      }
    }

    setCopying(null)
    load()
  }

  const grouped = {
    active: templates.filter(t => t.status === 'active'),
    draft: templates.filter(t => t.status === 'draft'),
    archived: templates.filter(t => t.status === 'archived'),
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Checklist Templates</h1>
          <p className="text-gray-500 mt-1">{loading ? '…' : `${templates.length} templates total`}</p>
        </div>
        <Link href="/admin/templates/new" className="btn-primary">
          <Plus className="h-4 w-4" />New Template
        </Link>
      </div>

      {!loading && templates.length > 0 && (
        <div className="flex gap-2">
          {[
            { label: `Active (${grouped.active.length})`, color: 'bg-green-100 text-green-700' },
            { label: `Draft (${grouped.draft.length})`, color: 'bg-gray-100 text-gray-700' },
            { label: `Archived (${grouped.archived.length})`, color: 'bg-red-100 text-red-700' },
          ].map(pill => (
            <span key={pill.label} className={`text-xs font-medium px-3 py-1 rounded-full ${pill.color}`}>{pill.label}</span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          <div className="card p-10 flex items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading…
          </div>
        ) : templates.length === 0 ? (
          <div className="card p-10 text-center text-gray-400">
            No templates yet. <Link href="/admin/templates/new" className="text-brand-600 hover:underline">Create one →</Link>
          </div>
        ) : templates.map((template) => (
          <div key={template.id} className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-brand-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[template.status]}`}>{template.status}</span>
                {template.allow_surveyor_start && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Surveyor start</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5 truncate">
                {template.description} · v{template.version} · {template.creator?.full_name} · {template.created_at?.slice(0, 10)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href={`/admin/templates/${template.id}/edit`} className="btn-secondary py-1.5 px-3 text-xs">
                <Edit className="h-3.5 w-3.5" />Edit
              </Link>
              <button
                onClick={() => handleCopy(template)}
                disabled={copying === template.id}
                className="btn-ghost py-1.5 px-3 text-xs"
                title="Copy template"
              >
                {copying === template.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Copy className="h-3.5 w-3.5" />}
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
