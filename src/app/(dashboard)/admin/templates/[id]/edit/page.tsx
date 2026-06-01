'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TemplateBuilder from '@/components/template-builder/TemplateBuilder'
import type { BuilderSection } from '@/components/template-builder/types'
import { Save, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'
import type { TemplateStatus, ConditionalLogic } from '@/lib/types/database'
import { dirtyState } from '@/lib/dirty-state'

// --- Remap helpers ---
function remapConditional(
  logic: ConditionalLogic | null,
  map: Record<string, string>
): ConditionalLogic | null {
  if (!logic || !Object.keys(map).length) return logic
  return {
    ...logic,
    conditions: logic.conditions.map(c => ({
      ...c,
      field_id: map[c.field_id] ?? c.field_id,
    })),
  }
}

function remapFormula(f: string, map: Record<string, string>): string {
  return f.replace(/\{([^}]+)\}/g, (_, id) => `{${map[id] ?? id}}`)
}

export default function EditTemplatePage() {
  const router = useRouter()
  const params = useParams()
  const templateId = params.id as string

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TemplateStatus>('draft')
  const [allowSurveyorStart, setAllowSurveyorStart] = useState(false)
  const [sections, setSections] = useState<BuilderSection[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobCount, setJobCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [leaveDestination, setLeaveDestination] = useState<string | null>(null)

  // Track original DB IDs so we can update in place
  const originalSectionIds = useRef<Set<string>>(new Set())
  const originalFieldIds = useRef<Set<string>>(new Set())
  const loadedRef = useRef(false)

  // Mark dirty only after initial load
  useEffect(() => {
    if (!loadedRef.current) return
    setIsDirty(true)
  }, [name, description, status, allowSurveyorStart, sections])

  // Sync to global dirty-state so sidebar links respect it
  useEffect(() => {
    dirtyState.set(isDirty)
    dirtyState.setHandler(isDirty ? requestNavigate : null)
  }, [isDirty]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { return () => { dirtyState.set(false); dirtyState.setHandler(null) } }, [])

  // Warn on browser close when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: tmpl }, { count }] = await Promise.all([
        supabase
          .from('checklist_templates')
          .select('*, sections:template_sections(*, fields:template_fields(*))')
          .eq('id', templateId)
          .single(),
        supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('template_id', templateId),
      ])

      if (!tmpl) { router.push('/admin/templates'); return }

      setName(tmpl.name)
      setDescription(tmpl.description ?? '')
      setStatus(tmpl.status)
      setAllowSurveyorStart(tmpl.allow_surveyor_start)
      setJobCount(count ?? 0)

      const secIds = new Set<string>()
      const fieldIds = new Set<string>()

      const builtSections: BuilderSection[] = (tmpl.sections ?? [])
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((s: any) => {
          secIds.add(s.id)
          return {
            id: s.id,
            title: s.title,
            description: s.description ?? '',
            order_index: s.order_index,
            conditional_logic: s.conditional_logic,
            fields: (s.fields ?? [])
              .sort((a: any, b: any) => a.order_index - b.order_index)
              .map((f: any) => {
                fieldIds.add(f.id)
                return {
                  id: f.id,
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
                  item_number: f.item_number ?? '',
                  with_remarks: f.with_remarks ?? false,
                }
              }),
          }
        })

      originalSectionIds.current = secIds
      originalFieldIds.current = fieldIds
      setSections(builtSections)
      setLoading(false)
      loadedRef.current = true
    }
    load()
  }, [templateId, router])

  async function handleSave() {
    if (!name.trim()) { setError('Template name is required'); return }

    // Validate: no broken conditional/formula references
    const allFieldIds = new Set(sections.flatMap(s => s.fields.map(f => f.id)))
    const broken: string[] = []
    for (const section of sections) {
      if (section.conditional_logic) {
        for (const c of section.conditional_logic.conditions) {
          if (c.field_id && !allFieldIds.has(c.field_id)) broken.push(`Section "${section.title}" condition → missing field`)
        }
      }
      for (const field of section.fields) {
        if (field.conditional_logic) {
          for (const c of field.conditional_logic.conditions) {
            if (c.field_id && !allFieldIds.has(c.field_id)) broken.push(`"${field.label}" condition → missing field`)
          }
        }
        if (field.calculation_formula) {
          const refs = Array.from(field.calculation_formula.matchAll(/\{([^}]+)\}/g)).map(m => m[1])
          for (const r of refs) {
            if (!allFieldIds.has(r)) broken.push(`"${field.label}" formula → missing field {${r}}`)
          }
        }
      }
    }
    if (broken.length > 0) {
      setError(`Cannot save — broken references:\n• ${broken.join('\n• ')}`)
      return
    }

    setSaving(true)
    setError(null)

    const supabase = createClient()

    // a. Update template meta
    const { error: tmplErr } = await supabase
      .from('checklist_templates')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        status,
        allow_surveyor_start: allowSurveyorStart,
      })
      .eq('id', templateId)

    if (tmplErr) {
      setError(tmplErr.message)
      setSaving(false)
      return
    }

    const currentSectionIds = new Set(sections.map(s => s.id))
    const currentFieldIds = new Set(sections.flatMap(s => s.fields.map(f => f.id)))

    // b. Delete removed sections (CASCADE deletes fields)
    for (const id of Array.from(originalSectionIds.current)) {
      if (!currentSectionIds.has(id)) {
        await supabase.from('template_sections').delete().eq('id', id)
      }
    }

    // d. Delete removed fields
    for (const id of Array.from(originalFieldIds.current)) {
      if (!currentFieldIds.has(id)) {
        await supabase.from('template_fields').delete().eq('id', id)
      }
    }

    // Maps from local builder IDs to new DB IDs (only for newly inserted items)
    const sectionIdMap: Record<string, string> = {}
    const newFieldIdMap: Record<string, string> = {}

    for (const section of sections) {
      let dbSectionId: string

      if (originalSectionIds.current.has(section.id)) {
        // c. Update existing section
        await supabase.from('template_sections').update({
          title: section.title,
          description: section.description || null,
          order_index: section.order_index,
          conditional_logic: section.conditional_logic,
        }).eq('id', section.id)
        dbSectionId = section.id
      } else {
        // c. Insert new section
        const { data: sec } = await supabase
          .from('template_sections')
          .insert({
            template_id: templateId,
            title: section.title,
            description: section.description || null,
            order_index: section.order_index,
            conditional_logic: null, // remapped in pass f
          })
          .select()
          .single()

        if (!sec) continue
        sectionIdMap[section.id] = sec.id
        dbSectionId = sec.id
      }

      // e. Upsert fields
      for (const field of section.fields) {
        if (originalFieldIds.current.has(field.id)) {
          // Update existing field
          await supabase.from('template_fields').update({
            section_id: dbSectionId,
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
            item_number: field.item_number || null,
            with_remarks: field.with_remarks || false,
          }).eq('id', field.id)
        } else {
          // Insert new field
          const { data: f } = await supabase
            .from('template_fields')
            .insert({
              template_id: templateId,
              section_id: dbSectionId,
              label: field.label,
              field_type: field.field_type,
              order_index: field.order_index,
              is_required: field.is_required,
              options: field.options.length ? field.options : null,
              validation: Object.keys(field.validation).length ? field.validation : null,
              calculation_formula: field.calculation_formula
                ? remapFormula(field.calculation_formula, newFieldIdMap)
                : null,
              conditional_logic: null, // remapped in pass f
              placeholder: field.placeholder || null,
              help_text: field.help_text || null,
              unit: field.unit || null,
              default_value: field.default_value || null,
              item_number: field.item_number || null,
              with_remarks: field.with_remarks || false,
            })
            .select()
            .single()

          if (f) newFieldIdMap[field.id] = f.id
        }
      }
    }

    // f. Remap pass — fix conditional_logic for newly inserted items
    const hasNewIds = Object.keys(newFieldIdMap).length > 0 || Object.keys(sectionIdMap).length > 0
    if (hasNewIds) {
      for (const section of sections) {
        // Remap section conditional_logic if it's a new section
        if (!originalSectionIds.current.has(section.id) && section.conditional_logic) {
          const remapped = remapConditional(section.conditional_logic, newFieldIdMap)
          const dbId = sectionIdMap[section.id]
          if (dbId) {
            await supabase.from('template_sections').update({ conditional_logic: remapped }).eq('id', dbId)
          }
        }

        for (const field of section.fields) {
          if (!originalFieldIds.current.has(field.id) && field.conditional_logic) {
            const remapped = remapConditional(field.conditional_logic, newFieldIdMap)
            const dbId = newFieldIdMap[field.id]
            if (dbId) {
              await supabase.from('template_fields').update({ conditional_logic: remapped }).eq('id', dbId)
            }
          }
          // Also remap calculation_formula for new fields (already done during insert above,
          // but if newFieldIdMap grew after the insert we re-apply)
          if (!originalFieldIds.current.has(field.id) && field.calculation_formula) {
            const remapped = remapFormula(field.calculation_formula, newFieldIdMap)
            const dbId = newFieldIdMap[field.id]
            if (dbId && remapped !== field.calculation_formula) {
              await supabase.from('template_fields').update({ calculation_formula: remapped }).eq('id', dbId)
            }
          }
        }
      }
    }

    setIsDirty(false)
    router.push('/admin/templates')
  }

  function requestNavigate(dest: string) {
    if (isDirty) {
      setLeaveDestination(dest)
      setShowLeaveDialog(true)
    } else {
      router.push(dest)
    }
  }

  async function confirmLeaveWithSave() {
    setShowLeaveDialog(false)
    await handleSave()
  }

  function confirmLeaveWithout() {
    setIsDirty(false)
    setShowLeaveDialog(false)
    if (leaveDestination) router.push(leaveDestination)
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
        <button
          type="button"
          onClick={() => requestNavigate('/admin/templates')}
          className="btn-ghost py-2 px-3"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="page-title">Edit Template</h1>
          <p className="text-gray-500 mt-0.5">{jobCount > 0 ? `${jobCount} job${jobCount !== 1 ? 's' : ''} using this template` : 'No jobs yet'}</p>
        </div>
        {isDirty && (
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {jobCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            This template is used by {jobCount} job{jobCount !== 1 ? 's' : ''}. Changes to fields may affect in-progress jobs. Consider duplicating instead of editing if jobs are active.
          </p>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <h2 className="section-title">Template Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label-base">Template Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-base resize-none" rows={2} />
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
              <span className="text-sm font-medium text-gray-700">Allow surveyor start</span>
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="section-title px-1">Template Fields</h2>
        <TemplateBuilder sections={sections} onChange={setSections} />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center justify-end gap-3 pb-6">
        <button type="button" onClick={() => requestNavigate('/admin/templates')} className="btn-secondary">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Sticky bottom save bar */}
      {isDirty && (
        <div className="sticky bottom-4 z-10">
          <div className="card p-3 flex items-center justify-between shadow-lg gap-3 max-w-4xl mx-auto">
            <p className="text-xs text-amber-600 font-medium">Unsaved changes</p>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Leave dialog */}
      {showLeaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Unsaved changes</h3>
                <p className="text-sm text-gray-500 mt-1">You have unsaved changes. What would you like to do?</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={confirmLeaveWithSave} disabled={saving} className="btn-primary justify-center">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save and leave
              </button>
              <button onClick={confirmLeaveWithout} className="btn-secondary justify-center text-red-600 hover:bg-red-50 border-red-200">
                Leave without saving
              </button>
              <button onClick={() => setShowLeaveDialog(false)} className="btn-ghost justify-center">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
