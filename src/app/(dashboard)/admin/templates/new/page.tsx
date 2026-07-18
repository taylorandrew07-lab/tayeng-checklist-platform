'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TemplateBuilder from '@/components/template-builder/TemplateBuilder'
import type { BuilderSection } from '@/components/template-builder/types'
import { Save, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'
import type { TemplateStatus, ConditionalLogic, JobType } from '@/lib/types/database'
import { dirtyState } from '@/lib/dirty-state'
import { withTimeout } from '@/lib/utils'
import { listJobTypes } from '@/lib/jobs/tracker'

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

export default function NewTemplatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const duplicateFrom = searchParams.get('duplicate')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TemplateStatus>('draft')
  const [defaultJobType, setDefaultJobType] = useState('')
  const [jobTypes, setJobTypes] = useState<JobType[]>([])
  const [allowSurveyorStart, setAllowSurveyorStart] = useState(false)
  const [pdfIncludePhotos, setPdfIncludePhotos] = useState(false)
  const [requiresReportNumber, setRequiresReportNumber] = useState(true)
  const [manualNumbering, setManualNumbering] = useState(false)
  const [pdfDisclaimer, setPdfDisclaimer] = useState('')
  const [pdfPreamble, setPdfPreamble] = useState('')
  const [sections, setSections] = useState<BuilderSection[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!duplicateFrom)
  const [isDirty, setIsDirty] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [leaveDestination, setLeaveDestination] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  const loadedRef = useRef(false)

  // Mark dirty after initial load
  useEffect(() => {
    if (!loadedRef.current) return
    setIsDirty(true)
  }, [name, description, status, defaultJobType, allowSurveyorStart, pdfIncludePhotos, requiresReportNumber, pdfDisclaimer, pdfPreamble, sections])

  // Job types for the "default job type" picker (same active list the New Job form uses).
  useEffect(() => { listJobTypes().then(setJobTypes).catch(() => {}) }, [])

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
    if (!duplicateFrom) {
      loadedRef.current = true
      return
    }
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
        setDefaultJobType(tmpl.default_job_type ?? '')
        setRequiresReportNumber(tmpl.requires_report_number ?? true)
        // Duplicating carries the source's item_numbers, so it must carry the numbering mode too.
        setManualNumbering(tmpl.manual_numbering ?? false)

        // Build idMap: oldDbId -> newLocalUUID so we can remap conditional_logic
        const idMap: Record<string, string> = {}

        const sortedSections = (tmpl.sections ?? []).sort((a: any, b: any) => a.order_index - b.order_index)

        // First pass: assign new UUIDs for all sections and fields
        for (const s of sortedSections) {
          const newSecId = crypto.randomUUID()
          idMap[s.id] = newSecId
          for (const f of (s.fields ?? [])) {
            idMap[f.id] = crypto.randomUUID()
          }
        }

        // Second pass: build builder state with remapped IDs
        const builtSections: BuilderSection[] = sortedSections.map((s: any) => ({
          id: idMap[s.id],
          title: s.title,
          description: s.description ?? '',
          order_index: s.order_index,
          conditional_logic: remapConditional(s.conditional_logic, idMap),
          is_repeatable: s.is_repeatable ?? false,
          fields: (s.fields ?? [])
            .sort((a: any, b: any) => a.order_index - b.order_index)
            .map((f: any) => ({
              id: idMap[f.id],
              label: f.label,
              field_type: f.field_type,
              order_index: f.order_index,
              is_required: f.is_required,
              options: f.options ?? [],
              validation: f.validation ?? {},
              calculation_formula: f.calculation_formula
                ? remapFormula(f.calculation_formula, idMap)
                : '',
              conditional_logic: remapConditional(f.conditional_logic, idMap),
              help_text: f.help_text ?? '',
              unit: f.unit ?? '',
              item_number: f.item_number ?? '',
              with_remarks: f.with_remarks ?? false,
              is_billable_hours: f.is_billable_hours ?? false,
            })),
        }))
        setSections(builtSections)
      }
      setLoading(false)
      loadedRef.current = true
    }
    loadTemplate()
  }, [duplicateFrom])

  // handleSave: returns { ok, errorMsg } so callers never read stale React state.
  // redirectTo: where to navigate on success. undefined = /admin/templates, null = stay here.
  async function handleSave(opts?: { redirectTo?: string | null }): Promise<{ ok: boolean; errorMsg?: string }> {
    const fail = (m: string) => { setError(m); return { ok: false, errorMsg: m } }

    if (!name.trim()) return fail('Template name is required')

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
    if (broken.length > 0) return fail(`Cannot save — broken references:\n• ${broken.join('\n• ')}`)

    setSaving(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setSaving(false); return { ok: false, errorMsg: 'Not authenticated' } }

    const { data: template, error: tmplErr } = await supabase
      .from('checklist_templates')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        status,
        default_job_type: defaultJobType || null,
        allow_surveyor_start: allowSurveyorStart,
        pdf_include_photos: pdfIncludePhotos,
        requires_report_number: requiresReportNumber,
        manual_numbering: manualNumbering,
        pdf_disclaimer: pdfDisclaimer.trim() || null,
        pdf_preamble: pdfPreamble.trim() || null,
        created_by: user.id,
        duplicated_from: duplicateFrom || null,
      })
      .select()
      .single()

    if (tmplErr || !template) {
      setError(tmplErr?.message ?? 'Failed to create template')
      setSaving(false)
      return { ok: false }
    }

    // The builder assigns a real UUID to every section/field (duplicates were
    // remapped on load), so persist everything in two bulk inserts — no per-row
    // round-trips and no id remapping. Conditional logic already references UUIDs.
    try {
      const sectionRows = sections.map(s => ({
        id: s.id,
        template_id: template.id,
        title: s.title,
        description: s.description || null,
        order_index: s.order_index,
        conditional_logic: s.conditional_logic,
        is_repeatable: s.is_repeatable ?? false,
      }))
      if (sectionRows.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_sections').insert(sectionRows),
          20_000, 'Saving sections'
        )
        if (error) throw error
      }

      const fieldRows = sections.flatMap(s => s.fields.map(f => ({
        id: f.id,
        template_id: template.id,
        section_id: s.id,
        label: f.label,
        field_type: f.field_type,
        order_index: f.order_index,
        is_required: f.is_required,
        options: f.options.length ? f.options : null,
        validation: Object.keys(f.validation).length ? f.validation : null,
        calculation_formula: f.calculation_formula || null,
        conditional_logic: f.conditional_logic,
        help_text: f.help_text || null,
        unit: f.unit || null,
        item_number: f.item_number || null,
        with_remarks: f.with_remarks || false,
        is_billable_hours: f.field_type === 'calculated' ? f.is_billable_hours || false : false,
      })))
      if (fieldRows.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_fields').insert(fieldRows),
          20_000, 'Saving fields'
        )
        if (error) throw error
      }
    } catch (err: any) {
      // Roll back the template row so a failed save doesn't leave an empty template.
      await supabase.from('checklist_templates').delete().eq('id', template.id)
      setError(err?.message ?? 'Save failed — please try again')
      setSaving(false)
      return { ok: false, errorMsg: err?.message }
    }

    setSaving(false)
    setIsDirty(false)
    dirtyState.set(false)
    dirtyState.setHandler(null)
    const dest = opts?.redirectTo !== undefined ? opts.redirectTo : '/admin/templates'
    if (dest) router.push(dest)
    return { ok: true }
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
    setLeaveError(null)
    const dest = leaveDestination ?? '/admin/templates'
    const result = await handleSave({ redirectTo: dest })
    if (!result.ok) {
      setLeaveError(result.errorMsg ?? error ?? 'Save failed')
    } else {
      setShowLeaveDialog(false)
    }
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
          <div>
            <label className="label-base">Default job type <span className="text-gray-400 font-normal">— auto-filled on the Jobs page</span></label>
            <select value={defaultJobType} onChange={(e) => setDefaultJobType(e.target.value)} className="input-base">
              <option value="">None — set the type per job</option>
              {jobTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              {defaultJobType && !jobTypes.some(t => t.name === defaultJobType) && <option value={defaultJobType}>{defaultJobType}</option>}
            </select>
            <p className="text-xs text-gray-400 mt-1">Jobs created from this template get this type automatically (you can still change it on the job).</p>
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
          {/* Report numbering. Direct binding: switch ON = jobs get an auto report
              number; OFF = report-only (jobs show "N/A", skipping the number). */}
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setRequiresReportNumber(v => !v)}
                className={`relative w-10 h-6 rounded-full transition-colors ${requiresReportNumber ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${requiresReportNumber ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Jobs from this template get a report number <span className="font-normal text-gray-400">— turn OFF for report-only kinds (e.g. hatch testing, cargo, initial draught) so they show N/A</span></span>
            </label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setPdfIncludePhotos(!pdfIncludePhotos)}
                className={`relative w-10 h-6 rounded-full transition-colors ${pdfIncludePhotos ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pdfIncludePhotos ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Include photos in the PDF report <span className="font-normal text-gray-400">— captioned grid, grouped by field</span></span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF preamble <span className="font-normal text-gray-400">— short intro printed below the Job Details on page 1 (leave blank for none)</span></label>
            <textarea
              value={pdfPreamble}
              onChange={e => setPdfPreamble(e.target.value)}
              rows={3}
              placeholder="e.g. Taylor Engineering attended the above vessel to carry out…"
              className="input-base text-sm resize-y"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF disclaimer <span className="font-normal text-gray-400">— fixed boilerplate printed at the end of every report (leave blank for none)</span></label>
            <textarea
              value={pdfDisclaimer}
              onChange={e => setPdfDisclaimer(e.target.value)}
              rows={4}
              placeholder="e.g. This report remains the property of…"
              className="input-base text-sm resize-y"
            />
          </div>
        </div>
      </div>

      {/* Template builder */}
      <div className="space-y-3">
        <h2 className="section-title px-1">Template Fields</h2>
        <TemplateBuilder sections={sections} onChange={setSections} manualNumbering={manualNumbering} />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Single persistent save bar (this page has no autosave). Appears once the
          builder has unsaved changes; Cancel + Save live here, no duplicates. */}
      {isDirty && (
        <div className="sticky bottom-4 z-10">
          <div className="card p-3 flex items-center justify-between shadow-lg gap-3 max-w-4xl mx-auto">
            <p className="text-xs text-amber-600 font-medium">Unsaved changes</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => requestNavigate('/admin/templates')} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => handleSave()} disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
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
            {leaveError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 whitespace-pre-wrap">{leaveError}</div>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={confirmLeaveWithSave} disabled={saving} className="btn-primary justify-center">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save and leave'}
              </button>
              <button onClick={confirmLeaveWithout} className="btn-secondary justify-center text-red-600 hover:bg-red-50 border-red-200">
                Leave without saving
              </button>
              <button onClick={() => { setShowLeaveDialog(false); setLeaveError(null) }} className="btn-ghost justify-center">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
