'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, FileText, Copy, Edit, Loader2, Archive, RotateCcw, Trash2, Eye, ClipboardList, Ship } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatDateTime } from '@/lib/utils'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import CargoTemplatesPanel from '@/components/cargo/CargoTemplatesPanel'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import Tabs from '@/components/ui/Tabs'

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
  const [tab, setTab] = useState<'checklist' | 'cargo'>('checklist')

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
    if (!(await confirmDialog({ message: `Copy "${template.name}"? A duplicate will be created as a draft.`, confirmLabel: 'Copy' }))) return

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
        duplicated_from: template.id,
      })
      .select()
      .single()

    if (tErr || !newTemplate) { toast.error('Copy failed: ' + (tErr?.message ?? 'unknown error')); setCopying(null); return }

    const { data: sections } = await supabase
      .from('template_sections')
      .select('*, fields:template_fields(*)')
      .eq('template_id', template.id)
      .order('order_index')

    // Build id map: old id -> new DB id
    const idMap: Record<string, string> = {}

    // Pass 1: insert sections + fields WITHOUT conditional_logic/formula
    const sectionData: Array<{ oldSection: any; newSectionId: string }> = []
    for (const section of sections ?? []) {
      const { data: newSection } = await supabase
        .from('template_sections')
        .insert({
          template_id: newTemplate.id,
          title: section.title,
          description: section.description,
          order_index: section.order_index,
          conditional_logic: null,
        })
        .select()
        .single()

      if (!newSection) continue
      idMap[section.id] = newSection.id
      sectionData.push({ oldSection: section, newSectionId: newSection.id })

      for (const f of section.fields ?? []) {
        const { data: newField } = await supabase
          .from('template_fields')
          .insert({
            template_id: newTemplate.id,
            section_id: newSection.id,
            label: f.label,
            field_type: f.field_type,
            is_required: f.is_required,
            order_index: f.order_index,
            options: f.options,
            unit: f.unit,
            help_text: f.help_text,
            item_number: f.item_number,
            with_remarks: f.with_remarks,
            is_billable_hours: f.is_billable_hours ?? false,
            validation: f.validation,
            conditional_logic: null,
            calculation_formula: null,
          })
          .select()
          .single()

        if (newField) idMap[f.id] = newField.id
      }
    }

    // Pass 2: remap and apply conditional_logic + calculation_formula
    function remapLogic(logic: any) {
      if (!logic) return null
      return { ...logic, conditions: logic.conditions.map((c: any) => ({ ...c, field_id: idMap[c.field_id] ?? c.field_id })) }
    }
    function remapFormula(f: string) {
      return f.replace(/\{([^}]+)\}/g, (_: string, id: string) => `{${idMap[id] ?? id}}`)
    }

    for (const { oldSection, newSectionId } of sectionData) {
      if (oldSection.conditional_logic) {
        await supabase.from('template_sections').update({ conditional_logic: remapLogic(oldSection.conditional_logic) }).eq('id', newSectionId)
      }
      for (const f of oldSection.fields ?? []) {
        const newFieldId = idMap[f.id]
        if (!newFieldId) continue
        const updates: any = {}
        if (f.conditional_logic) updates.conditional_logic = remapLogic(f.conditional_logic)
        if (f.calculation_formula) updates.calculation_formula = remapFormula(f.calculation_formula)
        if (Object.keys(updates).length > 0) {
          await supabase.from('template_fields').update(updates).eq('id', newFieldId)
        }
      }
    }

    setCopying(null)
    load()
  }

  async function handleArchive(template: any) {
    if (!(await confirmDialog({ title: 'Archive template', message: `Archive "${template.name}"? Archived templates won't appear in the New Job dropdown for surveyors. You can restore it later.`, confirmLabel: 'Archive' }))) return

    setArchiving(template.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    const { data, error } = await supabase
      .from('checklist_templates')
      .update({
        status: 'archived',
        archived_by: session?.user.id,
        archived_at: new Date().toISOString(),
      })
      .eq('id', template.id).select('id')

    setArchiving(null)
    if (error) { toast.error('Could not archive: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('Archive was blocked — you may not have permission.'); return }
    load()
  }

  async function handleRestore(template: any) {
    if (!(await confirmDialog({ title: 'Restore template', message: `Restore "${template.name}"? It will be set back to Draft status.`, confirmLabel: 'Restore' }))) return

    setRestoring(template.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    const { data, error } = await supabase
      .from('checklist_templates')
      .update({
        status: 'draft',
        restored_by: session?.user.id,
        restored_at: new Date().toISOString(),
      })
      .eq('id', template.id).select('id')

    setRestoring(null)
    if (error) { toast.error('Could not restore: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('Restore was blocked — you may not have permission.'); return }
    load()
  }

  async function handleDelete(template: any) {
    if (!(await confirmDialog({ title: 'Delete template', message: `Permanently delete "${template.name}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return

    setDeleting(template.id)
    const supabase = createClient()
    const { data, error } = await supabase.from('checklist_templates').delete().eq('id', template.id).select('id')
    setDeleting(null)
    if (error) { toast.error('Could not delete: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('Delete was blocked — you may not have permission.'); return }
    load()
  }

  const active = templates.filter(t => t.status !== 'archived')
  const archived = templates.filter(t => t.status === 'archived')

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Templates"
        subtitle={loading ? '…' : `${active.length} active/draft · ${archived.length} archived`}
        actions={tab === 'checklist' && (
          <Link href="/admin/templates/new" className="btn-primary"><Plus className="h-4 w-4" />New Template</Link>
        )}
      />

      {/* Template kind tabs */}
      <Tabs
        active={tab}
        onChange={k => setTab(k as 'checklist' | 'cargo')}
        tabs={[
          { key: 'checklist', label: <><ClipboardList className="h-4 w-4" /> Checklist</> },
          { key: 'cargo', label: <><Ship className="h-4 w-4" /> Cargo Monitoring</> },
        ]}
      />

      {tab === 'cargo' && <CargoTemplatesPanel />}

      {tab === 'checklist' && (<>
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
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description={<><Link href="/admin/templates/new" className="text-brand-600 hover:underline">Create one</Link> to get started.</>}
          />
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
            <div key={template.id} className="card p-4 sm:p-5 opacity-75 border-dashed">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="flex items-start gap-3 sm:contents">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
                    <FileText className="h-5 w-5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-gray-700 truncate">{template.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 flex-shrink-0">Archived</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      {template.description && `${template.description} · `}
                      Archived by {template.archiver?.full_name ?? 'unknown'} on {formatDate(template.archived_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-2.5 sm:border-t-0 sm:pt-0 sm:flex-shrink-0 sm:flex-nowrap sm:gap-2">
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
            </div>
          ))}
        </div>
      )}
      </>)}
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
    <div className="card p-4 sm:p-5 hover:shadow-md transition-shadow">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        {/* On mobile: icon + info side-by-side. On sm+: transparent wrapper so they become direct flex children */}
        <div className="flex items-start gap-3 sm:contents">
          <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
            <FileText className="h-5 w-5 text-brand-700" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[template.status]}`}>{template.status}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {template.description && `${template.description} · `}v{template.version} · {template.creator?.full_name} · {template.created_at?.slice(0, 10)}
            </p>
          </div>
        </div>
        {/* Action buttons — wrap on mobile, inline on sm+ */}
        <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-2.5 sm:border-t-0 sm:pt-0 sm:flex-nowrap sm:gap-2 sm:flex-shrink-0">
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
          {isSuperAdmin ? (
            <button
              onClick={() => onDelete(template)}
              disabled={deleting === template.id}
              className="btn-ghost py-1.5 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Permanently delete template"
            >
              {deleting === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </button>
          ) : (
            <button
              onClick={() => onArchive(template)}
              disabled={archiving === template.id}
              className="btn-ghost py-1.5 px-3 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              title="Archive template (removes from surveyor dropdown)"
            >
              {archiving === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
