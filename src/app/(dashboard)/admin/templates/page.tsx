'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, FileText, Copy, Edit, Loader2, Archive, RotateCcw, Trash2, Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatDateTime } from '@/lib/utils'

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-700',
  archived: 'bg-red-100 text-red-700',
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const supabase = createClient()
    const [{ data: { session } }, { data: tmpl }] = await Promise.all([
      supabase.auth.getSession(),
      supabase
        .from('checklist_templates')
        .select(`
          *,
          creator:profiles!checklist_templates_created_by_fkey(full_name),
          archiver:profiles!checklist_templates_archived_by_fkey(full_name)
        `)
        .order('created_at', { ascending: false }),
    ])

    if (session?.user) {
      const { data: p } = await supabase.from('profiles').select('role, is_super_admin').eq('id', session.user.id).single()
      setProfile(p)
    }

    setTemplates(tmpl ?? [])
    setLoading(false)
  }

  const isSuperAdmin = profile?.is_super_admin === true

  async function handleCopy(template: any) {
    if (!confirm(`Copy "${template.name}"? A duplicate will be created as a draft.`)) return

    setCopying(template.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user.id

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
            template_id: newTemplate.id,
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
            item_number: f.item_number,
            with_remarks: f.with_remarks,
          }))
        )
      }
    }

    setCopying(null)
    load()
  }

  async function handleArchive(template: any) {
    if (!confirm(`Archive "${template.name}"?\n\nArchived templates will not appear in the New Checklist dropdown for surveyors. You can restore it later.`)) return

    setArchiving(template.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    await supabase
      .from('checklist_templates')
      .update({
        status: 'archived',
        archived_by: session?.user.id,
        archived_at: new Date().toISOString(),
      })
      .eq('id', template.id)

    setArchiving(null)
    load()
  }

  async function handleRestore(template: any) {
    if (!confirm(`Restore "${template.name}"? It will be set back to Draft status.`)) return

    setRestoring(template.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    await supabase
      .from('checklist_templates')
      .update({
        status: 'draft',
        restored_by: session?.user.id,
        restored_at: new Date().toISOString(),
      })
      .eq('id', template.id)

    setRestoring(null)
    load()
  }

  async function handleDelete(template: any) {
    if (!confirm(`Permanently delete "${template.name}"?\n\nThis cannot be undone. All template data will be lost.`)) return
    if (!confirm(`Are you absolutely sure? Type OK to confirm permanent deletion of "${template.name}".`)) return

    setDeleting(template.id)
    const supabase = createClient()
    await supabase.from('checklist_templates').delete().eq('id', template.id)
    setDeleting(null)
    load()
  }

  const active = templates.filter(t => t.status !== 'archived')
  const archived = templates.filter(t => t.status === 'archived')

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Checklist Templates</h1>
          <p className="text-gray-500 mt-1">{loading ? '…' : `${active.length} active/draft · ${archived.length} archived`}</p>
        </div>
        <Link href="/admin/templates/new" className="btn-primary">
          <Plus className="h-4 w-4" />New Template
        </Link>
      </div>

      {!loading && templates.length > 0 && (
        <div className="flex gap-2">
          {[
            { label: `Active (${templates.filter(t => t.status === 'active').length})`, color: 'bg-green-100 text-green-700' },
            { label: `Draft (${templates.filter(t => t.status === 'draft').length})`, color: 'bg-gray-100 text-gray-700' },
            { label: `Archived (${archived.length})`, color: 'bg-red-100 text-red-700' },
          ].map(pill => (
            <span key={pill.label} className={`text-xs font-medium px-3 py-1 rounded-full ${pill.color}`}>{pill.label}</span>
          ))}
        </div>
      )}

      {/* Active / Draft templates */}
      <div className="space-y-3">
        {loading ? (
          <div className="card p-10 flex items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />Loading…
          </div>
        ) : active.length === 0 ? (
          <div className="card p-10 text-center text-gray-400">
            No templates yet. <Link href="/admin/templates/new" className="text-brand-600 hover:underline">Create one →</Link>
          </div>
        ) : active.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            isSuperAdmin={isSuperAdmin}
            copying={copying}
            archiving={archiving}
            deleting={deleting}
            onCopy={handleCopy}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {/* Archived templates — only visible to super admin */}
      {isSuperAdmin && archived.length > 0 && (
        <div className="space-y-3">
          <h2 className="section-title flex items-center gap-2">
            <Archive className="h-4 w-4 text-gray-400" />
            Archived Templates
          </h2>
          {archived.map((template) => (
            <div key={template.id} className="card p-5 flex items-center gap-4 opacity-75 border-dashed">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-700 truncate">{template.name}</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">Archived</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5 truncate">
                  {template.description && `${template.description} · `}
                  Archived by {template.archiver?.full_name ?? 'unknown'} on {formatDate(template.archived_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleRestore(template)}
                  disabled={restoring === template.id}
                  className="btn-secondary py-1.5 px-3 text-xs text-green-700 border-green-200 hover:bg-green-50"
                  title="Restore to draft"
                >
                  {restoring === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Restore
                </button>
                <button
                  onClick={() => handleDelete(template)}
                  disabled={deleting === template.id}
                  className="btn-ghost py-1.5 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                  title="Permanently delete"
                >
                  {deleting === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateRow({
  template, isSuperAdmin, copying, archiving, deleting, onCopy, onArchive, onDelete
}: {
  template: any
  isSuperAdmin: boolean
  copying: string | null
  archiving: string | null
  deleting: string | null
  onCopy: (t: any) => void
  onArchive: (t: any) => void
  onDelete: (t: any) => void
}) {
  return (
    <div className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
        <FileText className="h-5 w-5 text-brand-700" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[template.status]}`}>{template.status}</span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5 truncate">
          {template.description && `${template.description} · `}v{template.version} · {template.creator?.full_name} · {template.created_at?.slice(0, 10)}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link href={`/admin/templates/${template.id}`} className="btn-ghost py-1.5 px-3 text-xs" title="Preview template">
          <Eye className="h-3.5 w-3.5" />Preview
        </Link>
        <Link href={`/admin/templates/${template.id}/edit`} className="btn-secondary py-1.5 px-3 text-xs">
          <Edit className="h-3.5 w-3.5" />Edit
        </Link>
        <button
          onClick={() => onCopy(template)}
          disabled={copying === template.id}
          className="btn-ghost py-1.5 px-3 text-xs"
        >
          {copying === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
          Copy
        </button>
        <button
          onClick={() => onArchive(template)}
          disabled={archiving === template.id}
          className="btn-ghost py-1.5 px-3 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          title="Archive template (removes from surveyor dropdown)"
        >
          {archiving === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
          Archive
        </button>
      </div>
    </div>
  )
}
